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
const { now, clone, scopeProjects } = require('../logic');

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

async function findBatch(id, client) {
    const n = intOrNull(id);
    if (n === null) return null;
    const r = await run(client)('SELECT * FROM pay_batches WHERE id = $1', [n]);
    return r.rows[0] || null;
}

/** งวดตาม id ที่ส่งมา เรียงตาม id (เหมือนลำดับใน array เดิม) — id ที่ไม่ใช่จำนวนเต็มถือว่าหาไม่เจอ */
async function findInstallments(ids, client) {
    const valid = ids.filter(n => Number.isInteger(n));
    if (!valid.length) return [];
    const r = await run(client)(
        'SELECT *, "of" AS of FROM installments WHERE id = ANY($1::int[]) ORDER BY id', [valid]);
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
            const rows = await findInstallments(ids, client);
            if (!rows.length) return { error: 'ยังไม่ได้เลือกงวดที่จะจ่าย' };
            if (rows.length !== ids.length) return { error: 'มีงวดที่หาไม่เจอในระบบ' };
            if (rows.some(i => i.status === 'paid')) return { error: 'มีงวดที่ถูกรวมในรอบอื่นไปแล้ว' };
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
            const b = await findBatch(id, client);
            if (!b) return { error: 'ไม่พบรอบทำจ่ายนี้' };
            const rows = await findInstallments(ids, client);
            if (rows.length !== ids.length) return { error: 'มีงวดที่หาไม่เจอในระบบ' };
            if (rows.some(i => i.status === 'paid')) return { error: 'มีงวดที่ถูกรวมในรอบอื่นไปแล้ว' };
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

    // ยกเลิกรอบ — งวดข้างในกลับไปเป็นรอทำจ่ายเหมือนเดิม ไม่ได้หายไปไหน
    // คืนข้อมูลรอบที่ลบออกไปด้วย เพื่อให้ route เอาไปบันทึกประวัติพร้อมเหตุผล
    async remove(id) {
        const n = intOrNull(id);
        if (n === null) return null;
        return withTransaction(async (client) => {
            const b = await findBatch(n, client);
            if (!b) return null;
            // ต้องประกอบข้อมูลก่อนลบ ไม่งั้นงวดจะถูกตัดออกจากรอบไปแล้ว
            const gone = await decorateOne(b, client);
            await client.query(
                `UPDATE installments SET status = 'pending', batch_id = NULL, updated_at = $1
                 WHERE batch_id = $2`, [now(), n]);
            await client.query('DELETE FROM pay_batches WHERE id = $1', [n]);
            return gone;
        });
    }
};

// ============================ rate requests (สอบถาม Rate Card) ============================

const rateRequests = {
    async create(fields) {
        const r = await query(
            `INSERT INTO rate_requests
                (kol_name, link_account, brand, products, platforms, scope, budget, no_budget,
                 brief_link, brief_note, status, created_by, team_id, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
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
                now()
            ]);
        return clone(r.rows[0]);
    },

    async list({ scopeBrands = null } = {}) {
        let rows = (await query('SELECT * FROM rate_requests ORDER BY id')).rows;
        rows = scopeProjects(rows, scopeBrands);
        return rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map(clone);
    }
};

module.exports = { payBatches, rateRequests };
