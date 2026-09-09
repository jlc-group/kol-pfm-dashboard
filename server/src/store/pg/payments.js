/**
 * pgStore — payments (สถานะเอกสาร/การจ่ายต่อแคมเปญ) + installments (งวดการจ่าย)
 *
 * พอร์ตมาจาก jsonStore ตรง ๆ โดยยึด "พฤติกรรมเดิมเป๊ะ" เป็นเกณฑ์เดียว:
 *   • ชื่อเมธอด/พารามิเตอร์/ค่า default เหมือนเดิมทุกตัว
 *   • รูปคืนค่าเหมือนเดิม รวมถึงกรณีไม่พบ (null / { error: '...' })
 *   • ข้อความ error ภาษาไทยเหมือนเดิมทุกตัวอักษร
 *   • ลำดับการเรียงใช้ .localeCompare() ชุดเดียวกับของเดิม
 *
 * ส่วนอ่านที่เป็นการ "ประกอบข้อมูลข้ามตาราง" (listWithProjects / listByProject / list / listManual)
 * ใช้ loadSnapshot() แล้ววิ่งอัลกอริทึมเดิมทับ snapshot — ไม่เขียนใหม่เป็น SQL aggregation
 * เพราะสูตร/เงื่อนไขละเอียดและไม่มีเทสต์คอยจับความเพี้ยน
 */
const {
    query, withTransaction,
    asDate, asJson,
    insertRow, updateRow
} = require('./_base');
const { loadSnapshot } = require('./_snapshot');
const { clone, now } = require('../logic');

// ============================ ตัวช่วยร่วม (ยกมาจาก jsonStore) ============================

// เอเจนซี่ของแคมเปญ — เอาจากบัญชีที่ผูกกับลิงก์ ถ้าไม่มีค่อยใช้ชื่อบนลิงก์
function projectAgencies(p, groupKey, users) {
    const out = [];
    for (const l of (p.agency_links || [])) {
        // ระบุกลุ่มมา = เอาเฉพาะเจ้าที่รับผิดชอบกลุ่มนั้น (ลิงก์เก่าที่ไม่ได้เลือกกลุ่มถือว่ารับทุกกลุ่ม)
        if (groupKey && Array.isArray(l.groups) && l.groups.length && !l.groups.includes(groupKey)) continue;
        const acc = users.find(u => u.role === 'agency' && (u.agency_tokens || []).includes(l.token));
        const name = (acc && acc.username) || l.name;
        if (name && !out.includes(name)) out.push(name);
    }
    return out;
}

// เติมข้อมูลประกอบให้งวด (ชื่อแคมเปญ/แบรนด์/กลุ่ม/วันของรอบทำจ่าย)
// jsonStore อ่านจาก db.projects + db.pay_batches — ที่นี่ส่งเข้ามาเป็นอาร์กิวเมนต์แทน
function decorateInstallment(it, projects, batches) {
    const p = projects.find(x => x.id === it.project_id);
    const batch = it.batch_id ? batches.find(b => b.id === it.batch_id) : null;
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

// อ่านแคมเปญ/รอบทำจ่ายเท่าที่งวดนั้นอ้างถึง แล้วเติมข้อมูลประกอบ (ใช้กับเมธอดที่คืนงวดเดียว)
async function decorateOne(row, client) {
    const run = (q, v) => (client ? client.query(q, v) : query(q, v));
    let projects = [];
    if (row.project_id !== null && row.project_id !== undefined) {
        projects = (await run('SELECT * FROM projects WHERE id = $1', [row.project_id])).rows;
    }
    let batches = [];
    if (row.batch_id) {
        batches = (await run('SELECT * FROM pay_batches WHERE id = $1', [row.batch_id])).rows;
    }
    return decorateInstallment(row, projects, batches);
}

// SELECT ของ installments — คอลัมน์ "of" ชนคำสงวน ต้องใส่เครื่องหมายคำพูดเสมอ
const SEL_INST = 'SELECT *, "of" AS of FROM installments';

const toInt = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

// ============================ payments ============================

function findPaymentRow(projectId, client) {
    const pid = toInt(projectId);
    if (pid === null) return Promise.resolve(null);
    const q = 'SELECT * FROM payments WHERE project_id = $1 ORDER BY id LIMIT 1';
    const run = client ? client.query(q, [pid]) : query(q, [pid]);
    return run.then(r => r.rows[0] || null);
}

// ไม่มีแถวก็สร้างให้ ด้วยค่าตั้งต้นชุดเดียวกับ jsonStore
async function ensurePaymentRow(projectId, client) {
    let pay = await findPaymentRow(projectId, client);
    if (!pay) {
        pay = await insertRow('payments', {
            project_id: Number(projectId), agency_name: null, payment_date: null,
            status: 'รอทำจ่าย', quotation: null, invoice: null, notes: null, updated_at: now()
        }, client);
    }
    return pay;
}

// ช่องไฟล์ที่อนุญาตให้เขียน — กันชื่อคอลัมน์แปลกปลอมหลุดเข้า SQL
const FILE_COLS = ['quotation', 'invoice'];

const payments = {
    // รวมทุก Project + ข้อมูลการจ่าย (admin เห็นทุกทีม)
    async listWithProjects() {
        const snap = await loadSnapshot(['projects', 'teams', 'users', 'payments', 'installments', 'pay_batches']);
        return snap.projects
            .slice()
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .map(p => {
                const team = snap.teams.find(t => t.id === p.team_id);
                const pay = snap.payments.find(x => x.project_id === Number(p.id)) || {};
                // สรุปงวดของแคมเปญนี้ — สถานะการจ่ายมาจากงวด ไม่ได้ตั้งมือแล้ว
                const its = snap.installments.filter(i => i.project_id === p.id);
                const paidAmt = its.filter(i => i.status === 'paid').reduce((s, i) => s + (Number(i.amount) || 0), 0);
                const planAmt = its.reduce((s, i) => s + (Number(i.amount) || 0), 0);
                return clone({
                    project_id: p.id,
                    project_name: p.name,
                    brand: p.brand,
                    budget: p.budget,
                    team_name: team ? team.name : null,
                    agency_name: pay.agency_name || null,
                    payment_date: pay.payment_date || null,
                    status: pay.status || 'รอทำจ่าย',
                    quotation: pay.quotation || null,
                    invoice: pay.invoice || null,
                    notes: pay.notes || null,
                    quotation_link: pay.quotation_link || null,
                    agencies: projectAgencies(p, undefined, snap.users),   // เอเจนซี่ของแคมเปญนี้ (จากบัญชีที่ผูกกับลิงก์)
                    // กลุ่มในแคมเปญ + งบของกลุ่ม + เจ้าที่รับผิดชอบ (ไว้ตั้งแผนจ่ายแยกกลุ่ม)
                    ad_groups: (p.ad_groups || []).map(g => ({
                        key: g.key, concept: g.concept || null, budget: Number(g.budget) || 0,
                        agencies: projectAgencies(p, g.key, snap.users)
                    })),
                    installments: its.map(i => decorateInstallment(i, snap.projects, snap.pay_batches)),
                    planned_amount: planAmt,
                    paid_amount: paidAmt,
                    updated_at: pay.updated_at || null
                });
            });
    },

    async get(projectId) {
        return clone((await findPaymentRow(projectId)) || null);
    },

    // แก้ข้อมูลข้อความ (ชื่อเอเจนซี่ / รอบวันจ่าย / สถานะ / โน้ต)
    async update(projectId, fields) {
        const pid = toInt(projectId);
        if (pid === null) return null;
        return withTransaction(async client => {
            const hit = await client.query('SELECT 1 FROM projects WHERE id = $1', [pid]);
            if (!hit.rowCount) return null;
            const pay = await ensurePaymentRow(pid, client);
            const patch = {};
            for (const key of ['agency_name', 'payment_date', 'status', 'notes', 'quotation_link']) {
                if (fields[key] !== undefined) {
                    // ช่องวันที่ว่าง ('') ต้องเป็น NULL ไม่งั้น DATE ของ Postgres รับไม่ได้
                    patch[key] = key === 'payment_date' ? asDate(fields[key]) : fields[key];
                }
            }
            patch.updated_at = now();
            const row = await updateRow('payments', pay.id, patch, client);
            return clone(row);
        });
    },

    // บันทึกไฟล์ (type = 'quotation' | 'invoice')
    async setFile(projectId, type, meta) {
        const pid = toInt(projectId);
        if (pid === null) return null;
        return withTransaction(async client => {
            const hit = await client.query('SELECT 1 FROM projects WHERE id = $1', [pid]);
            if (!hit.rowCount) return null;
            const pay = await ensurePaymentRow(pid, client);
            const patch = {};
            if (FILE_COLS.includes(type)) patch[type] = asJson(meta); // { filename, original, size, uploaded_at }
            patch.updated_at = now();
            const row = await updateRow('payments', pay.id, patch, client);
            return clone(row);
        });
    }
};

// ============================ installments ============================

const installments = {
    // งวดของแคมเปญหนึ่ง (ทุกเอเจนซี่) เรียงตามเจ้าแล้วตามเลขงวด
    async listByProject(projectId) {
        const snap = await loadSnapshot(['installments', 'projects', 'pay_batches']);
        return snap.installments
            .filter(i => i.project_id === Number(projectId))
            .sort((a, b) => (a.agency || '').localeCompare(b.agency || '', 'th')
                || (a.group_key || '').localeCompare(b.group_key || '') || a.no - b.no)
            .map(i => decorateInstallment(i, snap.projects, snap.pay_batches));
    },

    // ทุกงวดในระบบ (ไว้ทำหน้ารอบทำจ่าย) — pending = ยังไม่เข้ารอบไหน
    async list({ status } = {}) {
        const snap = await loadSnapshot(['installments', 'projects', 'pay_batches']);
        let rows = snap.installments.slice();
        if (status) rows = rows.filter(i => (i.status || 'pending') === status);
        return rows
            .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.id - b.id)
            .map(i => decorateInstallment(i, snap.projects, snap.pay_batches));
    },

    // ตั้ง/แก้แผนการจ่ายของ (แคมเปญ + เอเจนซี่) — แทนที่ของเดิมทั้งชุด
    // งวดที่จ่ายไปแล้วห้ามยุ่ง ไม่งั้นยอดในสลิปที่ออกไปแล้วจะเพี้ยน
    async setPlan(projectId, agency, groupKey, plan) {
        const pid = toInt(projectId);
        if (pid === null) return { error: 'ไม่พบแคมเปญ' };
        return withTransaction(async client => {
            const p = (await client.query('SELECT * FROM projects WHERE id = $1', [pid])).rows[0];
            if (!p) return { error: 'ไม่พบแคมเปญ' };
            const gk = groupKey || null;
            if (gk && !(p.ad_groups || []).some(g => g.key === gk)) return { error: 'ไม่พบกลุ่มนี้ในแคมเปญ' };

            // แผนแยกกันตาม (แคมเปญ + เอเจนซี่ + กลุ่ม) — คนละกลุ่มไม่ทับกัน
            const all = (await client.query(
                `${SEL_INST} WHERE project_id = $1 AND agency IS NOT DISTINCT FROM $2 ORDER BY id FOR UPDATE`,
                [p.id, agency === undefined ? null : agency])).rows;
            const same = i => (i.group_key || null) === gk;

            // ห้ามมีทั้ง "ทั้งแคมเปญ" และ "รายกลุ่ม" ของเจ้าเดียวกันพร้อมกัน ยอดจะถูกนับซ้ำ
            const others = all.filter(i => !same(i));
            if (gk && others.some(i => !i.group_key)) {
                return { error: 'เจ้านี้มีแผนแบบ "ทั้งแคมเปญ" อยู่แล้ว — ลบแผนนั้นก่อนถึงจะตั้งแยกรายกลุ่มได้ ไม่งั้นยอดจะนับซ้ำ' };
            }
            if (!gk && others.some(i => i.group_key)) {
                return { error: 'เจ้านี้ตั้งแผนแยกรายกลุ่มไว้แล้ว — ลบแผนรายกลุ่มก่อนถึงจะตั้งแบบทั้งแคมเปญได้ ไม่งั้นยอดจะนับซ้ำ' };
            }
            const mine = all.filter(same);
            if (mine.some(i => i.status === 'paid')) {
                return { error: 'มีงวดที่ทำจ่ายไปแล้ว แก้แผนไม่ได้ ต้องยกเลิกรอบทำจ่ายนั้นก่อน' };
            }

            // บันทึกแผนซ้ำต้องไม่ทำใบแจ้งหนี้ที่แนบไว้แล้วหาย — ยกของงวดเดิมตำแหน่งเดียวกันมาใช้ต่อ
            // (jsonStore ใช้ id เดิมของงวดตำแหน่งเดียวกัน ที่นี่จึง UPDATE ทับแทนการลบแล้วสร้างใหม่)
            const old = mine.slice().sort((a, b) => a.no - b.no);
            const rows = [];
            for (let idx = 0; idx < plan.length; idx++) {
                const x = plan[idx];
                const prev = old[idx] || null;
                const data = {
                    project_id: p.id,
                    agency: agency === undefined ? null : agency,
                    group_key: gk,
                    manual_id: null,
                    title: null,
                    no: idx + 1,
                    of: plan.length,
                    percent: Number(x.percent) || 0,
                    amount: Number(x.amount) || 0,
                    due_date: asDate(x.due_date || null),
                    note: x.note || null,
                    // เอกสารของงวดเดิมยังใช้ได้ ไม่ต้องแนบใหม่
                    invoice: prev ? asJson(prev.invoice) : null,
                    invoice_link: prev ? prev.invoice_link : null,
                    status: 'pending',
                    batch_id: null,
                    created_at: prev ? prev.created_at : now(),
                    updated_at: now()
                };
                rows.push(prev
                    ? await updateRow('installments', prev.id, data, client)
                    : await insertRow('installments', data, client));
            }
            // งวดเดิมที่เกินจากแผนใหม่ต้องหายไป (jsonStore ลบทั้งชุดแล้วใส่ใหม่ตามจำนวน plan)
            const leftover = old.slice(plan.length).map(i => i.id);
            if (leftover.length) {
                await client.query('DELETE FROM installments WHERE id = ANY($1::int[])', [leftover]);
            }
            return { data: rows.map(r => decorateInstallment(r, [p], [])) };
        });
    },

    // แก้ยอด/วันครบกำหนดของงวดเดียว (งวดที่จ่ายแล้วแก้ไม่ได้)
    async update(id, fields) {
        const iid = toInt(id);
        if (iid === null) return { error: 'ไม่พบงวดนี้' };
        return withTransaction(async client => {
            const it = (await client.query(`${SEL_INST} WHERE id = $1 FOR UPDATE`, [iid])).rows[0];
            if (!it) return { error: 'ไม่พบงวดนี้' };
            if (it.status === 'paid') return { error: 'งวดนี้ทำจ่ายไปแล้ว แก้ไม่ได้' };
            const patch = {};
            if (fields.amount !== undefined) patch.amount = Number(fields.amount) || 0;
            if (fields.percent !== undefined) patch.percent = Number(fields.percent) || 0;
            if (fields.due_date !== undefined) patch.due_date = asDate(fields.due_date || null);
            if (fields.note !== undefined) patch.note = fields.note || null;
            patch.updated_at = now();
            // RETURNING * คืนคอลัมน์ "of" มาในชื่อเดิมอยู่แล้ว ไม่ต้องอ่านซ้ำ
            const row = await updateRow('installments', iid, patch, client);
            return { data: await decorateOne(row, client) };
        });
    },

    // ===== รายการจ่ายนอกแคมเปญ (ตั้งเอง ไม่ผูกกับ project) =====
    // ทั้งชุดอ้างอิงด้วย manual_id เดียวกัน แก้/ลบทีเดียวทั้งชุด
    async listManual() {
        const snap = await loadSnapshot(['installments', 'projects', 'pay_batches']);
        const byId = {};
        for (const i of snap.installments) {
            if (i.project_id || !i.manual_id) continue;
            (byId[i.manual_id] = byId[i.manual_id] || []).push(i);
        }
        return Object.keys(byId).map(id => {
            const rows = byId[id].slice().sort((a, b) => a.no - b.no);
            const paid = rows.filter(r => r.status === 'paid').reduce((s, r) => s + (Number(r.amount) || 0), 0);
            return clone({
                manual_id: id,
                title: rows[0].title || null,
                agency: rows[0].agency || null,
                planned_amount: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
                paid_amount: paid,
                installments: rows.map(r => decorateInstallment(r, snap.projects, snap.pay_batches))
            });
        }).sort((a, b) => (a.title || '').localeCompare(b.title || '', 'th'));
    },

    // สร้าง/แก้ทั้งชุด — ส่ง manual_id มาด้วยคือแก้ของเดิม ไม่ส่งคือสร้างใหม่
    async setManualPlan({ manual_id, title, agency, plan }) {
        const id = manual_id || 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        return withTransaction(async client => {
            const old = (await client.query(
                `${SEL_INST} WHERE project_id IS NULL AND manual_id = $1 ORDER BY id FOR UPDATE`, [id]
            )).rows.sort((a, b) => a.no - b.no);
            if (old.some(i => i.status === 'paid')) {
                return { error: 'มีงวดที่ทำจ่ายไปแล้ว แก้ไม่ได้ ต้องยกเลิกรอบทำจ่ายนั้นก่อน' };
            }
            const rows = [];
            for (let idx = 0; idx < plan.length; idx++) {
                const x = plan[idx];
                const prev = old[idx] || null;
                const data = {
                    project_id: null,
                    manual_id: id,
                    title: String(title || '').trim() || 'รายการจ่าย',
                    agency: agency === undefined ? null : agency,
                    group_key: null,
                    no: idx + 1,
                    of: plan.length,
                    percent: Number(x.percent) || 0,
                    amount: Number(x.amount) || 0,
                    due_date: asDate(x.due_date || null),
                    note: x.note || null,
                    invoice: prev ? asJson(prev.invoice) : null,
                    invoice_link: prev ? prev.invoice_link : null,
                    status: 'pending',
                    batch_id: null,
                    created_at: prev ? prev.created_at : now(),
                    updated_at: now()
                };
                rows.push(prev
                    ? await updateRow('installments', prev.id, data, client)
                    : await insertRow('installments', data, client));
            }
            const leftover = old.slice(plan.length).map(i => i.id);
            if (leftover.length) {
                await client.query('DELETE FROM installments WHERE id = ANY($1::int[])', [leftover]);
            }
            return { data: { manual_id: id, installments: rows.map(r => decorateInstallment(r, [], [])) } };
        });
    },

    async removeManual(manualId) {
        return withTransaction(async client => {
            const mine = (await client.query(
                'SELECT id, status FROM installments WHERE project_id IS NULL AND manual_id = $1 FOR UPDATE',
                [manualId === undefined ? null : manualId])).rows;
            if (!mine.length) return { error: 'ไม่พบรายการนี้' };
            if (mine.some(i => i.status === 'paid')) {
                return { error: 'มีงวดที่ทำจ่ายไปแล้ว ลบไม่ได้ ต้องยกเลิกรอบทำจ่ายนั้นก่อน' };
            }
            await client.query('DELETE FROM installments WHERE id = ANY($1::int[])', [mine.map(i => i.id)]);
            return { data: { removed: mine.length } };
        });
    },

    // ลบแผนของ (แคมเปญ + เอเจนซี่ + กลุ่ม) ทั้งชุด — งวดที่จ่ายแล้วลบไม่ได้
    async removePlan(projectId, agency, groupKey) {
        const pid = toInt(projectId);
        const gk = groupKey || null;
        if (pid === null) return { error: 'ไม่พบแผนนี้' };
        return withTransaction(async client => {
            const mine = (await client.query(
                `SELECT id, status FROM installments
                  WHERE project_id = $1 AND agency IS NOT DISTINCT FROM $2
                    AND (CASE WHEN group_key = '' THEN NULL ELSE group_key END) IS NOT DISTINCT FROM $3
                  FOR UPDATE`,
                [pid, agency === undefined ? null : agency, gk])).rows;
            if (!mine.length) return { error: 'ไม่พบแผนนี้' };
            if (mine.some(i => i.status === 'paid')) {
                return { error: 'มีงวดที่ทำจ่ายไปแล้ว ลบแผนไม่ได้ ต้องยกเลิกรอบทำจ่ายนั้นก่อน' };
            }
            await client.query('DELETE FROM installments WHERE id = ANY($1::int[])', [mine.map(i => i.id)]);
            return { data: { removed: mine.length } };
        });
    },

    // แนบใบแจ้งหนี้ของงวด — งวดที่จ่ายแล้วก็ยังแนบ/เปลี่ยนได้ เพราะเอกสารมักตามมาทีหลัง
    async setInvoice(id, meta) {
        const iid = toInt(id);
        if (iid === null) return null;
        const row = await updateRow('installments', iid, { invoice: asJson(meta), updated_at: now() });
        if (!row) return null;
        return decorateOne(row);
    },

    // ลิงก์ใบแจ้งหนี้ — งวดที่จ่ายแล้วก็แก้ได้ เหมือนไฟล์
    async setInvoiceLink(id, link) {
        const iid = toInt(id);
        if (iid === null) return null;
        const value = (link && String(link).trim()) ? String(link).trim() : null;
        const row = await updateRow('installments', iid, { invoice_link: value, updated_at: now() });
        if (!row) return null;
        return decorateOne(row);
    },

    async get(id) {
        const iid = toInt(id);
        if (iid === null) return null;
        const it = (await query(`${SEL_INST} WHERE id = $1`, [iid])).rows[0];
        return it ? decorateOne(it) : null;
    },

    async removeByProject(projectId) {
        const pid = toInt(projectId);
        if (pid === null) return 0;
        const r = await query('DELETE FROM installments WHERE project_id = $1', [pid]);
        return r.rowCount;
    }
};

module.exports = { payments, installments };
