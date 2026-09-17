/**
 * งานจ้างอื่น ๆ (hires) — รวมรายชื่อผู้รับงานจากแคมเปญ campaign_type = 'other' ทุกใบ
 *
 * แคมเปญแบบนี้ไม่มีแถวใน submissions / project_kols รายชื่อทั้งหมดอยู่ใน projects.hire_items (JSONB)
 * หน้ารวมจึงต้องแบนรายการจ้างของทุกแคมเปญออกมา แล้วยุบเป็น "รายคน" ที่นี่
 *
 * คนเดียวกัน = ชื่อ + ประเภทงานเดียวกัน — ห้ามใช้ hire_items[].key เพราะนั่นคือรหัสของ "แถว"
 * คนเดิมที่ถูกจ้างสองงานจะมีสองแถวคนละ key เสมอ
 */
const { loadSnapshot } = require('./_snapshot');
const { clone, scopeProjects, inScope, hireRemaining, hireRowFee } = require('../logic');

const isOther = p => (p.campaign_type || 'kol') === 'other';
const str = v => String(v == null ? '' : v).trim();
const personKey = it => str(it.name).toLowerCase() + '|' + str(it.kind).toLowerCase();

const hires = {
    // 1 แถวที่คืนออกไป = 1 คน · summary.jobs = จำนวนครั้งที่จ้าง (คนหนึ่งอาจถูกจ้างหลายครั้ง)
    async list({ scopeBrands = null, brand, kind, from, to, search } = {}) {
        const snap = await loadSnapshot(['other_projects']);
        let projs = scopeProjects(snap.other_projects.slice(), scopeBrands).filter(isOther);
        if (brand) projs = projs.filter(p => p.brand === brand);

        // แบนออกมาเป็นรายการจ้างทีละครั้งก่อน
        const jobs = [];
        projs.forEach(p => {
            (Array.isArray(p.hire_items) ? p.hire_items : []).forEach(it => {
                if (!str(it.name)) return;   // แถวที่ยังไม่ได้ใส่ชื่อ ยังไม่นับเป็นคน
                // ไม่ได้ระบุวันใช้งาน ให้ถือวันเริ่มแคมเปญแทน ไม่งั้นตัวกรองช่วงวันจะตัดทิ้งทั้งที่มีงานจริง
                const date = it.use_date || p.start_date || null;
                if (from && date && date < from) return;
                if (to && date && date > to) return;
                jobs.push({
                    name: str(it.name), kind: str(it.kind) || null, agency: str(it.agency) || null,
                    contact: str(it.contact) || null, fee: Number(it.fee) || 0,
                    status: str(it.status) || null, use_date: it.use_date || null, date,
                    project_id: p.id, project_name: p.name, brand: p.brand || null
                });
            });
        });

        const q = str(search).toLowerCase();
        const picked = jobs.filter(j =>
            (!kind || j.kind === kind)
            && (!q || [j.name, j.kind, j.agency, j.contact, j.project_name, j.brand]
                .some(v => String(v == null ? '' : v).toLowerCase().includes(q))));

        // ยุบเป็นรายคน
        const byPerson = new Map();
        picked.forEach(j => {
            let row = byPerson.get(personKey(j));
            if (!row) {
                row = {
                    key: personKey(j), name: j.name, kind: j.kind, agency: j.agency, contact: j.contact,
                    jobs: 0, total_fee: 0, last_fee: 0, last_date: null,
                    brands: [], campaigns: [], statuses: []
                };
                byPerson.set(row.key, row);
            }
            row.jobs += 1;
            row.total_fee += j.fee;
            // ค่าตัวล่าสุด = ของงานที่วันใหม่สุด · งานที่ไม่มีวันเลยใช้เป็นค่าตั้งต้นไปก่อน
            if (j.date ? (!row.last_date || j.date > row.last_date) : (!row.last_date && !row.last_fee)) {
                row.last_date = j.date || row.last_date;
                row.last_fee = j.fee;
            }
            if (!row.agency && j.agency) row.agency = j.agency;
            if (!row.contact && j.contact) row.contact = j.contact;
            if (j.brand && !row.brands.includes(j.brand)) row.brands.push(j.brand);
            if (!row.campaigns.some(c => c.id === j.project_id)) row.campaigns.push({ id: j.project_id, name: j.project_name });
            if (j.status && !row.statuses.includes(j.status)) row.statuses.push(j.status);
        });

        const rows = [...byPerson.values()]
            .map(r => ({ ...r, avg_fee: r.jobs ? Math.round((r.total_fee / r.jobs) * 100) / 100 : 0 }))
            .sort((a, b) => (b.last_date || '').localeCompare(a.last_date || '')
                || b.total_fee - a.total_fee
                || a.name.localeCompare(b.name));

        // ตัวเลือก "ประเภทงาน" มาจากงานทั้งหมดก่อนกรอง ไม่งั้นพอเลือกแล้วตัวเลือกอื่นจะหายไปจนเปลี่ยนไม่ได้
        const kinds = [...new Set(jobs.map(j => j.kind).filter(Boolean))].sort();
        const projectCount = new Set(picked.map(j => j.project_id)).size;

        return clone({
            summary: {
                people: rows.length,
                jobs: picked.length,
                projects: projectCount,
                total_fee: picked.reduce((s, j) => s + j.fee, 0)
            },
            kinds,
            rows
        });
    },

    // ใบขอจัดหาที่ยังเป็น "งาน" ของใครบางคน — ใช้ทั้งหน้างานจัดหาและตัวเลขแดงบนเมนู
    // เห็นได้ 3 ทาง: แบรนด์ที่ตัวเองมีสิทธิ์ · ใบที่ถูกมอบหมายให้ตัวเอง · ใบที่ตัวเองเป็นคนขอ
    // สองทางหลังตั้งใจให้ข้ามสิทธิ์แบรนด์ได้ เพราะคนที่ถูกมอบงานต้องเห็นงานของตัวเองเสมอ
    // (เห็นเฉพาะ "ใบนั้น" ไม่ได้เปิดทั้งแคมเปญให้ — เส้นแก้ไขก็ตรวจซ้ำอีกชั้นที่ routes/projects.js)
    async tasks({ userId = null, scopeBrands = null, mine = '', status, search, brand } = {}) {
        const snap = await loadSnapshot(['other_projects']);
        const uid = userId == null ? null : String(userId);
        const rows = [];
        snap.other_projects.filter(isOther).forEach(p => {
            const inBrand = inScope(p, scopeBrands);
            (Array.isArray(p.hire_items) ? p.hire_items : []).forEach(it => {
                if (!it || it.mode !== 'casting') return;
                const isAssignee = uid !== null && it.assignee_id != null && String(it.assignee_id) === uid;
                const isRequester = inBrand && uid !== null && it.requested_by_id != null && String(it.requested_by_id) === uid;
                if (!inBrand && !isAssignee) return;
                const cands = Array.isArray(it.candidates) ? it.candidates : [];
                rows.push({
                    project_id: p.id, project_name: p.name, brand: p.brand || null,
                    key: it.key, kind: str(it.kind) || null, spec: str(it.spec) || null,
                    fee: Number(it.fee) || 0,
                    headcount: Number(it.headcount) || 1, filled: Number(it.filled) || 0,
                    remaining: hireRemaining(it), budget: hireRowFee(it),
                    use_date: it.use_date || null, deadline: it.deadline || null,
                    place: str(it.place) || null, note: str(it.note) || null,
                    status: str(it.status) || 'กำลังหา',
                    assignee_id: it.assignee_id == null ? null : it.assignee_id,
                    assignee_name: str(it.assignee_name) || null,
                    requested_by_id: it.requested_by_id == null ? null : it.requested_by_id,
                    candidates: cands,
                    candidate_count: cands.length,
                    waiting_count: cands.filter(c => (str(c.status) || 'เสนอ') === 'เสนอ').length,
                    is_assignee: isAssignee, is_requester: isRequester, in_brand: inBrand
                });
            });
        });

        const q = str(search).toLowerCase();
        const picked = rows.filter(r =>
            (mine !== 'find' || r.is_assignee)
            && (mine !== 'ask' || r.is_requester)
            && (!brand || r.brand === brand)
            && (!status || r.status === status)
            && (!q || [r.project_name, r.brand, r.kind, r.spec, r.assignee_name, r.place]
                .some(v => String(v == null ? '' : v).toLowerCase().includes(q))));

        // งานที่ยังต้องหาขึ้นก่อน แล้วเรียงตามกำหนดส่งรายชื่อที่ใกล้ที่สุด (ใบที่ไม่ได้กำหนดไปท้ายสุด)
        picked.sort((a, b) =>
            (a.remaining > 0 ? 0 : 1) - (b.remaining > 0 ? 0 : 1)
            || (a.deadline ? 0 : 1) - (b.deadline ? 0 : 1)
            || String(a.deadline || '').localeCompare(String(b.deadline || ''))
            || String(a.project_name || '').localeCompare(String(b.project_name || ''), 'th'));

        // ตัวเลขแดงนับเฉพาะงานที่ "รอเราทำ" จริง ๆ — ของคนอื่นไม่นับ ไม่งั้นตัวเลขจะไม่มีความหมาย
        const toFind = rows.filter(r => r.is_assignee && r.remaining > 0).length;
        const toDecide = rows.filter(r => r.is_requester && r.waiting_count > 0).length;

        return clone({
            summary: {
                requests: picked.length,
                people_needed: picked.reduce((s, r) => s + r.remaining, 0),
                budget: picked.reduce((s, r) => s + r.budget, 0),
                waiting: picked.reduce((s, r) => s + r.waiting_count, 0)
            },
            counts: {
                to_find: toFind,
                to_decide: toDecide,
                unassigned: rows.filter(r => !r.assignee_id && r.remaining > 0 && r.in_brand).length,
                total: toFind + toDecide
            },
            brands: [...new Set(rows.map(r => r.brand).filter(Boolean))].sort(),
            rows: picked
        });
    }
};

module.exports = { hires };
