/**
 * pgStore: payBatches (รอบทำจ่าย — สลิป 1 ใบ ครอบได้หลายงวด) + rateRequests (สอบถาม Rate Card)
 *
 * พอร์ตมาจาก jsonStore บรรทัด 2085-2201 แบบ "พฤติกรรมต้องเหมือนเดิมทุกกรณี"
 * รวมถึงกรณีไม่เจอข้อมูล (คืน null) และกรณีผิดเงื่อนไข (คืน { error: 'ข้อความไทย' })
 * ห้ามเปลี่ยนข้อความ error หรือรูปแบบค่าที่คืน เพราะหน้าเว็บอ่านตรง ๆ ทั้งหมด
 *
 * งานที่แตะหลายแถว/หลายตาราง (create / addItems / remove) อยู่ใน transaction เดียว
 * เพราะถ้าพังกลางคัน งวดจะค้างสถานะ 'paid' โดยไม่มีรอบทำจ่ายอยู่จริง
 */
const { query, withTransaction, asJson, asNumOrNull } = require('./_base');
const { now, clone, scopeProjects, todayTH } = require('../logic');

// ===== ทำจ่ายอัตโนมัติ (ผู้ใช้สั่ง 8 ต.ค. 2026) =====
// งวดที่แนบใบแจ้งหนี้แล้ว (ไฟล์หรือลิงก์) และเลยวันทำจ่าย (due_date) มาแล้ว 1 วัน = นับว่าจ่ายแล้วเอง ไม่ต้องกดสร้างรอบ
// มัดเป็นรอบตามกติกาเดิม: 1 เอเจนซี่ + 1 วันทำจ่าย = สลิป 1 ใบ (ต่อการตรวจแต่ละครั้ง) · แนบสลิปทีหลังในแท็บรอบที่จ่ายแล้ว
// ยกเลิกรอบของงวดที่เลยวันแล้ว = สถานะ 'hold' (พักไว้) — ระบบไม่นับจ่ายซ้ำจนกว่าจะบันทึกแผนงวดใหม่ (กลับเป็น pending)
const AUTO_PAY_BY = 'ระบบอัตโนมัติ';
const AUTO_PAY_NOTE = 'ย้ายเป็นจ่ายแล้วอัตโนมัติ — เลยวันทำจ่าย 1 วัน';
const HAS_INVOICE_SQL = `(jsonb_typeof(invoice) = 'object' OR NULLIF(btrim(COALESCE(invoice_link, '')), '') IS NOT NULL)`;
// เงื่อนไข "ถึงเวลาจ่ายอัตโนมัติ" — $n = วันนี้ (เวลาไทย) · due_date < วันนี้ = เลยวันทำจ่ายมาแล้วอย่างน้อย 1 วัน
const dueForAutoPay = n => `(due_date IS NOT NULL AND due_date < $${n}::date AND ${HAS_INVOICE_SQL})`;
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const hasInvoice = i => !!(i && ((i.invoice && typeof i.invoice === 'object') || (i.invoice_link && String(i.invoice_link).trim())));
// งวดที่สร้างรอบทำจ่ายเองได้ (เส้นเดิม) — กติกาเดียวกับอัตโนมัติ: มีใบแจ้งหนี้ + เลยวันทำจ่ายแล้ว
const payableNow = (i, today) => hasInvoice(i) && isDay(i.due_date) && String(i.due_date) < today;
const NOT_YET_PAYABLE = 'ทำจ่ายได้เฉพาะงวดที่แนบใบแจ้งหนี้แล้ว และเลยวันทำจ่ายมาแล้ว 1 วัน (ระบบย้ายให้อัตโนมัติ)';

// เลือกตัวรันคำสั่ง: อยู่ใน transaction ให้ใช้ client เดิม ไม่งั้นใช้ pool
const run = (client) => (text, params) => (client ? client.query(text, params) : query(text, params));

// id ที่ใช้ค้นต้องเป็นจำนวนเต็มเท่านั้น — jsonStore ใช้ Number(id) แล้ว find ไม่เจอ (undefined)
// ถ้าปล่อย NaN/ทศนิยมลงไปใน SQL int[] ไดรเวอร์จะโยน error ซึ่งเป็นพฤติกรรมคนละแบบ
const intOrNull = (v) => {
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
};

// ============================ ตัวช่วยประกอบข้อมูล (คัดลอกตรรกะจาก jsonStore) ============================

// เทียบเท่า decorateInstallment ของ jsonStore แต่อ่านจากก้อนข้อมูลที่ดึงมาแทน db
function decorateInstallment(snap, it) {
    const p = snap.projects.find(x => x.id === it.project_id);
    const batch = it.batch_id ? snap.pay_batches.find(b => b.id === it.batch_id) : null;
    const gi = it.group_key && p ? (p.ad_groups || []).findIndex(g => g.key === it.group_key) : -1;
    const g = gi >= 0 ? p.ad_groups[gi] : null;
    return clone({
        ...it,
        group_no: gi >= 0 ? gi + 1 : null,
        group_concept: g ? g.concept : null,
        // รายการนอกแคมเปญ (ตั้งเอง) ใช้ชื่อที่พิมพ์ไว้แทนชื่อแคมเปญ
        manual: !it.project_id,
        project_name: p ? p.name : (it.title || null),
        brand: p ? p.brand : null,
        project_budget: p ? p.budget : null,
        batch_date: batch ? batch.pay_date : null
    });
}

// เทียบเท่า decorateBatch ของ jsonStore
function decorateBatch(snap, b) {
    const items = snap.installments.filter(i => i.batch_id === b.id).map(it => decorateInstallment(snap, it));
    return clone({ ...b, items, item_count: items.length });
}

/**
 * ดึงงวด + แคมเปญ เฉพาะที่จำเป็นต่อการประกอบรอบทำจ่ายชุดนี้ แล้วประกอบผลลัพธ์
 * (ไม่ใช้ loadSnapshot ทั้งฐาน เพราะ decorate ใช้แค่ 3 ตารางนี้ และ list ถูกเรียกบ่อย)
 * ลำดับ items เรียงตาม id เหมือนลำดับที่เคยถูก push ลง array ใน db.json
 */
async function decorateBatches(batchRows, client) {
    if (!batchRows.length) return [];
    const q = run(client);
    const ids = batchRows.map(b => b.id);
    const installments = (await q(
        'SELECT *, "of" AS of FROM installments WHERE batch_id = ANY($1::int[]) ORDER BY id', [ids])).rows;
    const projectIds = [...new Set(installments.map(i => i.project_id).filter(v => v !== null && v !== undefined))];
    const projects = projectIds.length
        ? (await q('SELECT * FROM projects WHERE id = ANY($1::int[]) ORDER BY id', [projectIds])).rows
        : [];
    const snap = { installments, projects, pay_batches: batchRows };
    return batchRows.map(b => decorateBatch(snap, b));
}

async function decorateOne(b, client) {
    return (await decorateBatches([b], client))[0];
}

// lock = ล็อกแถวไว้จนจบ transaction (FOR UPDATE) — กันชนกับตัวจ่ายอัตโนมัติที่กำลังเติมงวดเข้ารอบเดียวกัน
async function findBatch(id, client, lock = false) {
    const n = intOrNull(id);
    if (n === null) return null;
    const r = await run(client)('SELECT * FROM pay_batches WHERE id = $1' + (lock ? ' FOR UPDATE' : ''), [n]);
    return r.rows[0] || null;
}

/** งวดตาม id ที่ส่งมา เรียงตาม id (เหมือนลำดับใน array เดิม) — id ที่ไม่ใช่จำนวนเต็มถือว่าหาไม่เจอ */
async function findInstallments(ids, client, lock = false) {
    const valid = ids.filter(n => Number.isInteger(n));
    if (!valid.length) return [];
    const r = await run(client)(
        'SELECT *, "of" AS of FROM installments WHERE id = ANY($1::int[]) ORDER BY id' + (lock ? ' FOR UPDATE' : ''), [valid]);
    return r.rows;
}

// ============================ pay batches ============================

const payBatches = {
    async list() {
        const rows = (await query('SELECT * FROM pay_batches ORDER BY id')).rows;
        const sorted = rows
            .slice()
            .sort((a, b) => (b.pay_date || '').localeCompare(a.pay_date || '') || b.id - a.id);
        return decorateBatches(sorted);
    },

    async get(id) {
        const b = await findBatch(id);
        return b ? decorateOne(b) : null;
    },

    // สร้างรอบทำจ่าย = จับงวดหลายงวดมัดเป็นสลิปใบเดียว
    async create({ agency, pay_date, installment_ids, note, created_by }) {
        const ids = (installment_ids || []).map(Number);
        return withTransaction(async (client) => {
            const rows = await findInstallments(ids, client, true);
            if (!rows.length) return { error: 'ยังไม่ได้เลือกงวดที่จะจ่าย' };
            if (rows.length !== ids.length) return { error: 'มีงวดที่หาไม่เจอในระบบ' };
            if (rows.some(i => i.status === 'paid')) return { error: 'มีงวดที่ถูกรวมในรอบอื่นไปแล้ว' };
            if (rows.some(i => !payableNow(i, todayTH()))) return { error: NOT_YET_PAYABLE };
            // สลิปใบเดียวโอนให้เจ้าเดียว — ปนเจ้าไม่ได้
            const names = [...new Set(rows.map(i => i.agency))];
            if (names.length > 1) return { error: 'รวมงวดข้ามเอเจนซี่ในสลิปใบเดียวไม่ได้' };

            const total = rows.reduce((s, i) => s + (Number(i.amount) || 0), 0);
            const stamp = now();
            const ins = await client.query(
                `INSERT INTO pay_batches (agency, pay_date, total, slip, note, created_by, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                [agency || names[0] || null, pay_date || null, total, null,
                 note || null, created_by || null, stamp, stamp]);
            const b = ins.rows[0];

            await client.query(
                `UPDATE installments SET status = 'paid', batch_id = $1, updated_at = $2
                 WHERE id = ANY($3::int[])`,
                [b.id, now(), rows.map(i => i.id)]);

            return { data: await decorateOne(b, client) };
        });
    },

    // เติมงวดเข้ารอบที่มีอยู่แล้ว — สลิปยังเป็นใบเดียว ยอดรวมขยับตาม
    async addItems(id, installment_ids) {
        const ids = (installment_ids || []).map(Number);
        return withTransaction(async (client) => {
            const b = await findBatch(id, client, true);
            if (!b) return { error: 'ไม่พบรอบทำจ่ายนี้' };
            const rows = await findInstallments(ids, client, true);
            if (rows.length !== ids.length) return { error: 'มีงวดที่หาไม่เจอในระบบ' };
            if (rows.some(i => i.status === 'paid')) return { error: 'มีงวดที่ถูกรวมในรอบอื่นไปแล้ว' };
            if (rows.some(i => !payableNow(i, todayTH()))) return { error: NOT_YET_PAYABLE };
            if (rows.some(i => i.agency !== b.agency)) {
                return { error: 'งวดที่เลือกไม่ใช่ของ ' + b.agency + ' — สลิปใบเดียวโอนให้เจ้าเดียว' };
            }

            if (rows.length) {
                await client.query(
                    `UPDATE installments SET status = 'paid', batch_id = $1, updated_at = $2
                     WHERE id = ANY($3::int[])`,
                    [b.id, now(), rows.map(i => i.id)]);
            }
            const all = (await client.query('SELECT amount FROM installments WHERE batch_id = $1', [b.id])).rows;
            const total = all.reduce((s, i) => s + (Number(i.amount) || 0), 0);
            const upd = await client.query(
                'UPDATE pay_batches SET total = $1, updated_at = $2 WHERE id = $3 RETURNING *',
                [total, now(), b.id]);

            return { data: await decorateOne(upd.rows[0], client) };
        });
    },

    async update(id, fields) {
        const b = await findBatch(id);
        if (!b) return null;
        const set = {};
        if (fields.pay_date !== undefined) set.pay_date = fields.pay_date || null;
        if (fields.note !== undefined) set.note = fields.note || null;
        set.updated_at = now();
        const cols = Object.keys(set);
        const r = await query(
            `UPDATE pay_batches SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}
             WHERE id = $${cols.length + 1} RETURNING *`,
            [...cols.map(c => set[c]), b.id]);
        return decorateOne(r.rows[0]);
    },

    async setSlip(id, meta) {
        const b = await findBatch(id);
        if (!b) return null;
        const r = await query(
            'UPDATE pay_batches SET slip = $1, updated_at = $2 WHERE id = $3 RETURNING *',
            [asJson(meta), now(), b.id]);
        return decorateOne(r.rows[0]);
    },

    // ยกเลิกรอบ — งวดข้างในกลับไปรอทำจ่าย ไม่ได้หายไปไหน
    // งวดที่เลยวันทำจ่ายแล้ว (มีใบแจ้งหนี้) = 'hold' พักไว้ ไม่งั้นระบบจะนับจ่ายอัตโนมัติซ้ำทันที
    // คืนข้อมูลรอบที่ลบออกไปด้วย (+ held = จำนวนงวดที่พักไว้) เพื่อให้ route เอาไปบันทึกประวัติพร้อมเหตุผล
    async remove(id, { today } = {}) {
        const n = intOrNull(id);
        if (n === null) return null;
        const day = isDay(today) ? today : todayTH();
        return withTransaction(async (client) => {
            // ล็อกรอบก่อน — ถ้าตัวจ่ายอัตโนมัติกำลังเติมงวดเข้ารอบนี้ จะรอให้เสร็จก่อน แล้วงวดนั้นถูกยกเลิกไปด้วย (ไม่ค้าง paid ไร้รอบ)
            const b = await findBatch(n, client, true);
            if (!b) return null;
            // ต้องประกอบข้อมูลก่อนลบ ไม่งั้นงวดจะถูกตัดออกจากรอบไปแล้ว
            const gone = await decorateOne(b, client);
            const back = await client.query(
                `UPDATE installments
                    SET status = CASE WHEN ${dueForAutoPay(3)} THEN 'hold' ELSE 'pending' END,
                        batch_id = NULL, updated_at = $1
                  WHERE batch_id = $2 RETURNING status`, [now(), n, day]);
            await client.query('DELETE FROM pay_batches WHERE id = $1', [n]);
            gone.held = back.rows.filter(r => r.status === 'hold').length;
            return gone;
        });
    },

    // ย้ายงวดที่ถึงเวลาเป็นจ่ายแล้ว (เรียกจาก services/autoPay — ตอนเปิด server / ทุก 10 นาที / ก่อนเปิดหน้าทำจ่าย)
    // today = วันนี้เวลาไทย 'YYYY-MM-DD' · ทุกครั้งสร้างรอบใหม่ต่อ (เอเจนซี่ + วันทำจ่าย) — ไม่เติมเข้ารอบเดิม
    // (รอบเดิมอาจโอนเงินไปแล้ว งวดที่ใบแจ้งหนี้มาช้าจึงได้สลิปของตัวเอง · ไม่แตะรอบที่มีอยู่ = ไม่ชนกับยกเลิกรอบ / ลบแคมเปญ)
    // คืน { count, total, batches: [{ id, agency, pay_date, added, amount, total, projects }] }
    async autoPayDue(today) {
        if (!isDay(today)) throw new Error('autoPayDue: วันที่ต้องเป็น YYYY-MM-DD');
        return withTransaction(async (client) => {
            // รอล็อกไม่เกิน 5 วิ / ทั้งคำสั่งไม่เกิน 20 วิ — ค้างแล้วล้มออกมา รอบหน้าค่อยลองใหม่ (หน้าทำจ่ายไม่ค้างตาม)
            await client.query("SET LOCAL lock_timeout = '5s'");
            await client.query("SET LOCAL statement_timeout = '20s'");
            // SKIP LOCKED: งวดที่อีกคำขอกำลังจัดการอยู่ ข้ามไป (ไม่นับซ้ำ ไม่รอกันค้าง)
            const due = (await client.query(
                `SELECT * FROM installments
                  WHERE status = 'pending' AND ${dueForAutoPay(1)}
                  ORDER BY due_date, id FOR UPDATE SKIP LOCKED`, [today])).rows;
            if (!due.length) return { count: 0, total: 0, batches: [] };

            const pids = [...new Set(due.map(i => i.project_id).filter(v => v !== null && v !== undefined))];
            const names = new Map(pids.length
                ? (await client.query('SELECT id, name FROM projects WHERE id = ANY($1::int[])', [pids])).rows.map(p => [p.id, p.name])
                : []);
            const groups = new Map();
            for (const i of due) {
                const key = JSON.stringify([i.agency || null, String(i.due_date)]);
                if (!groups.has(key)) groups.set(key, { agency: i.agency || null, day: String(i.due_date), rows: [] });
                groups.get(key).rows.push(i);
            }

            const out = [];
            for (const g of groups.values()) {
                const stamp = now();
                const amount = g.rows.reduce((s, i) => s + (Number(i.amount) || 0), 0);
                const b = (await client.query(
                    `INSERT INTO pay_batches (agency, pay_date, total, slip, note, created_by, created_at, updated_at)
                     VALUES ($1, $2, $3, NULL, $4, $5, $6, $6) RETURNING *`,
                    [g.agency, g.day, amount, AUTO_PAY_NOTE, AUTO_PAY_BY, stamp])).rows[0];
                // แถวถูกล็อกไว้แล้ว (FOR UPDATE ด้านบน) — เงื่อนไข status กันไว้อีกชั้น
                await client.query(
                    `UPDATE installments SET status = 'paid', batch_id = $1, updated_at = $2
                      WHERE id = ANY($3::int[]) AND status = 'pending'`,
                    [b.id, stamp, g.rows.map(i => i.id)]);
                out.push({
                    id: b.id, agency: g.agency, pay_date: g.day, added: g.rows.length, amount, total: amount,
                    projects: [...new Set(g.rows.map(i => names.get(i.project_id) || i.title).filter(Boolean))]
                });
            }
            return {
                count: due.length,
                total: due.reduce((s, i) => s + (Number(i.amount) || 0), 0),
                batches: out
            };
        });
    }
};

// ============================ rate requests (สอบถาม Rate Card) ============================

const rateRequests = {
    async create(fields) {
        const r = await query(
            `INSERT INTO rate_requests
                (kol_name, link_account, brand, products, platforms, scope, budget, no_budget,
                 brief_link, brief_note, status, created_by, team_id, created_at, request_type, contract_period)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [
                fields.kol_name || null,
                fields.link_account || null,
                fields.brand || null,
                asJson(Array.isArray(fields.products) ? fields.products : [], []),
                asJson(Array.isArray(fields.platforms) ? fields.platforms : [], []),
                fields.scope || null,
                fields.no_budget ? null : (Number(fields.budget) || 0),
                !!fields.no_budget,
                fields.brief_link || null,
                fields.brief_note || null,
                'open',
                fields.created_by || null,
                asNumOrNull(fields.team_id ?? null),
                now(),
                fields.request_type === 'presenter' ? 'presenter' : 'kol',
                fields.contract_period || null
            ]);
        return clone(r.rows[0]);
    },

    async list({ scopeBrands = null } = {}) {
        let rows = (await query('SELECT * FROM rate_requests ORDER BY id')).rows;
        rows = scopeProjects(rows, scopeBrands);
        return rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map(clone);
    },

    async findById(id) {
        const n = Number(id);
        if (!Number.isInteger(n)) return null;
        const r = await query('SELECT * FROM rate_requests WHERE id = $1', [n]);
        return r.rows.length ? clone(r.rows[0]) : null;
    },

    // ตอบราคา / เปลี่ยนสถานะ — ส่งมาเฉพาะคีย์ที่จะแก้ คีย์ที่ไม่ส่งคงค่าเดิม
    async update(id, fields) {
        const n = Number(id);
        if (!Number.isInteger(n)) return null;
        const set = [];
        const vals = [];
        const put = (col, val) => { vals.push(val); set.push(`${col} = $${vals.length}`); };
        if (fields.status !== undefined) put('status', fields.status);
        if (fields.quoted_rate !== undefined) put('quoted_rate', fields.quoted_rate === null ? null : Number(fields.quoted_rate) || 0);
        if (fields.answer_note !== undefined) put('answer_note', fields.answer_note || null);
        if (fields.answered_by !== undefined) put('answered_by', fields.answered_by || null);
        if (fields.answered_at !== undefined) put('answered_at', fields.answered_at || null);
        if (!set.length) return await rateRequests.findById(n);
        vals.push(n);
        const r = await query(`UPDATE rate_requests SET ${set.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
        return r.rows.length ? clone(r.rows[0]) : null;
    }
};

module.exports = { payBatches, rateRequests, AUTO_PAY_BY, AUTO_PAY_NOTE, payableNow };
