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
const { clone, scopeProjects, inScope, hireRemaining, hireRowFee, hireWaiting, hireNeedMore, hireStage, HIRE_JOB_CLOSED, hireBookings, bookingOpen } = require('../logic');

const isOther = p => (p.campaign_type || 'kol') === 'other';
const str = v => String(v == null ? '' : v).trim();
const personKey = it => str(it.name).toLowerCase() + '|' + str(it.kind).toLowerCase();
// วันนี้ตามเวลาไทย (YYYY-MM-DD) — ใช้เทียบกับกำหนดส่งรายชื่อที่เก็บเป็นวันที่ล้วน
const todayTH = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

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
                    jobs: 0, fee_jobs: 0, total_fee: 0, last_fee: 0, last_date: null, fee_date: null,
                    brands: [], campaigns: [], statuses: []
                };
                byPerson.set(row.key, row);
            }
            row.jobs += 1;
            row.total_fee += j.fee;
            if (j.date && (!row.last_date || j.date > row.last_date)) row.last_date = j.date;
            // ค่าตัวล่าสุด / เฉลี่ย นับเฉพาะงานที่ใส่ค่าตัวแล้ว — คนที่บันทึกไว้ตอนยังคุยราคา (฿0) ไม่ใช่ค่าตัวจริง
            // ค่าตัวล่าสุด = ของงานที่วันใหม่สุด · งานที่ไม่มีวันเลยใช้เป็นค่าตั้งต้นไปก่อน
            if (j.fee > 0) {
                row.fee_jobs += 1;
                if (j.date ? (!row.fee_date || j.date > row.fee_date) : (!row.fee_date && !row.last_fee)) {
                    row.fee_date = j.date || row.fee_date;
                    row.last_fee = j.fee;
                }
            }
            if (!row.agency && j.agency) row.agency = j.agency;
            if (!row.contact && j.contact) row.contact = j.contact;
            if (j.brand && !row.brands.includes(j.brand)) row.brands.push(j.brand);
            if (!row.campaigns.some(c => c.id === j.project_id)) row.campaigns.push({ id: j.project_id, name: j.project_name });
            if (j.status && !row.statuses.includes(j.status)) row.statuses.push(j.status);
        });

        const rows = [...byPerson.values()]
            .map(({ fee_date, ...r }) => ({ ...r, avg_fee: r.fee_jobs ? Math.round((r.total_fee / r.fee_jobs) * 100) / 100 : 0 }))
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
    // withNames = แปะชื่อคนขอ (requested_by_name) ด้วยไหม — เส้นนับเลขแดงถูกเรียกทุก 60 วินาทีจากทุกหน้า ไม่ต้องใช้ชื่อ จึงปิดไว้
    async tasks({ userId = null, scopeBrands = null, mine = '', status, search, brand, withNames = true } = {}) {
        const snap = await loadSnapshot(withNames ? ['other_projects', 'user_names'] : ['other_projects']);
        // ชื่อโชว์แบบเดียวกับคนช่วยหา (ชื่อเล่น → ชื่อจริง → username) · อ่านจากคิวรีเบาที่ไม่มีรหัสผ่าน
        const nameOf = new Map((snap.user_names || []).map(u => [String(u.id), str(u.nickname) || str(u.full_name) || str(u.username) || null]));
        const uid = userId == null ? null : String(userId);
        const today = todayTH();
        const rows = [];
        snap.other_projects.filter(isOther).forEach(p => {
            const inBrand = inScope(p, scopeBrands);
            const all = Array.isArray(p.hire_items) ? p.hire_items : [];
            all.forEach(it => {
                if (!it || it.mode !== 'casting') return;
                const isAssignee = uid !== null && it.assignee_id != null && String(it.assignee_id) === uid;
                const isRequester = inBrand && uid !== null && it.requested_by_id != null && String(it.requested_by_id) === uid;
                if (!inBrand && !isAssignee) return;
                const cands = Array.isArray(it.candidates) ? it.candidates : [];
                const stage = hireStage(it, p.status, all);
                const bk = hireBookings(all, it.key);
                const noAssignee = it.assignee_id === null || it.assignee_id === undefined || it.assignee_id === '';
                const remaining = hireRemaining(it);
                const waiting = hireWaiting(it);
                const needMore = hireNeedMore(it);
                const open = stage !== 'closed' && remaining > 0;
                // "ถึงตาฉัน" — ต้องตรงกับที่เลขแดงบนเมนูนับ (ใบหนึ่งนับครั้งเดียวแม้เป็นทั้งคนขอและคนหา)
                const todo = [];
                if (open && isAssignee && needMore > 0) todo.push('find');
                if (open && isRequester && waiting > 0) todo.push('decide');
                if (open && isRequester && waiting === 0 && noAssignee) todo.push('assign');
                // คนที่อนุมัติแล้วรอคอนเฟิร์มคิว = งานของคนหา (ใบที่ไม่มีคนหา → คนขอคอนเฟิร์มเอง) · ค่าตัวใหม่ = งานของคนขอ
                if (stage !== 'closed' && bk.pending > 0 && (isAssignee || (isRequester && noAssignee))) todo.push('confirm');
                if (stage !== 'closed' && isRequester && bk.fee_review > 0) todo.push('fee');
                rows.push({
                    project_id: p.id, project_name: p.name, brand: p.brand || null,
                    key: it.key, kind: str(it.kind) || null, spec: str(it.spec) || null,
                    fee: Number(it.fee) || 0,
                    headcount: Number(it.headcount) || 1, filled: Number(it.filled) || 0,
                    remaining, budget: hireRowFee(it),
                    use_date: it.use_date || null, deadline: it.deadline || null,
                    place: str(it.place) || null, note: str(it.note) || null,
                    status: str(it.status) || 'กำลังหา',
                    assignee_id: it.assignee_id == null ? null : it.assignee_id,
                    assignee_name: str(it.assignee_name) || null,
                    requested_by_id: it.requested_by_id == null ? null : it.requested_by_id,
                    // คนขอ + เวลาที่ขอ (ประทับตอนสร้างใบใน mergeHireItems) — ผู้ใช้ที่ถูกลบไปแล้ว = null
                    requested_by_name: it.requested_by_id == null ? null : (nameOf.get(String(it.requested_by_id)) || null),
                    requested_at: it.requested_at || null,
                    candidates: cands,
                    candidate_count: cands.length,
                    waiting_count: waiting,
                    rejected_count: cands.filter(c => str(c.status) === 'ไม่เอา').length,
                    need_more: needMore,
                    job_status: p.status || 'Draft',
                    stage,
                    // ลูกบอลอยู่ที่ใคร: assign = ทีมต้องมอบหมายคนหา · finder = คนหา · team = ทีมแบรนด์ต้องอนุมัติ
                    waiting_on: stage === 'unassigned' ? 'assign'
                        : stage === 'finding' ? 'finder'
                            : stage === 'booking' ? (noAssignee ? 'team' : 'finder')
                            : (stage === 'deciding' || stage === 'fee') ? 'team' : 'none',
                    booking_pending: bk.pending,
                    fee_review: bk.fee_review,
                    // คนที่อนุมัติแล้วรอคอนเฟิร์ม — คนหาต้องเห็นเพื่อคอนเฟิร์มคิว (เฉพาะคนที่ได้จากใบนี้ ไม่ใช่ทั้งงาน)
                    bookings: bk.rows.map(r => ({
                        key: r.key, mode: 'direct', from_request: r.from_request, from_candidate: r.from_candidate || null,
                        kind: r.kind || null, name: r.name || null, agency: r.agency || null, contact: r.contact || null,
                        fee: Number(r.fee) || 0, use_date: r.use_date || null, use_time: r.use_time || null,
                        place: r.place || null, note: r.note || null, status: r.status || null, booking: r.booking
                    })),
                    overdue: !!(open && it.deadline && needMore > 0 && String(it.deadline) < today),
                    todo, my_todo: todo.length > 0,
                    is_assignee: isAssignee, is_requester: isRequester, in_brand: inBrand
                });
            });
        });

        const q = str(search).toLowerCase();
        const picked = rows.filter(r =>
            (mine !== 'find' || r.is_assignee)
            && (mine !== 'ask' || r.is_requester)
            && (mine !== 'todo' || r.my_todo)
            && (!brand || r.brand === brand)
            && (!status || r.status === status)
            && (!q || [r.project_name, r.brand, r.kind, r.spec, r.assignee_name, r.place]
                .some(v => String(v == null ? '' : v).toLowerCase().includes(q))));

        // งานที่ถึงตาเราขึ้นก่อน → เลยกำหนด → ยังต้องหา → กำหนดส่งรายชื่อที่ใกล้ที่สุด (ใบที่ไม่ได้กำหนดไปท้ายสุด)
        picked.sort((a, b) =>
            (a.my_todo ? 0 : 1) - (b.my_todo ? 0 : 1)
            || (a.overdue ? 0 : 1) - (b.overdue ? 0 : 1)
            || (a.stage === 'closed' ? 1 : 0) - (b.stage === 'closed' ? 1 : 0)
            || (a.remaining > 0 ? 0 : 1) - (b.remaining > 0 ? 0 : 1)
            || (a.deadline ? 0 : 1) - (b.deadline ? 0 : 1)
            || String(a.deadline || '').localeCompare(String(b.deadline || ''))
            || String(a.project_name || '').localeCompare(String(b.project_name || ''), 'th'));

        // ตัวเลขแดงนับเฉพาะงานที่ "รอเราทำ" จริง ๆ — ของคนอื่นไม่นับ ไม่งั้นตัวเลขจะไม่มีความหมาย
        // total นับเป็น "ใบ" ไม่ใช่ผลบวกของแต่ละแบบ: เป็นทั้งคนขอและคนหาในใบเดียวกันก็นับครั้งเดียว
        const toFind = rows.filter(r => r.todo.includes('find')).length;
        const toDecide = rows.filter(r => r.todo.includes('decide')).length;
        const toAssign = rows.filter(r => r.todo.includes('assign')).length;
        const toConfirm = rows.filter(r => r.todo.includes('confirm')).length;
        const toFee = rows.filter(r => r.todo.includes('fee')).length;

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
                to_assign: toAssign,
                to_confirm: toConfirm,
                to_fee: toFee,
                unassigned: rows.filter(r => r.stage === 'unassigned' && r.in_brand).length,
                total: rows.filter(r => r.my_todo).length
            },
            brands: [...new Set(rows.map(r => r.brand).filter(Boolean))].sort(),
            rows: picked
        });
    },

    // งานจ้างอื่น ๆ รายงาน (1 แถว = 1 งาน) เฉพาะแบรนด์ที่มีสิทธิ์ — คนหาที่ไม่มีสิทธิ์แบรนด์ (scope = []) ได้รายการว่าง
    async jobs({ scopeBrands = null } = {}) {
        const snap = await loadSnapshot(['other_projects']);
        const rows = scopeProjects(snap.other_projects.slice(), scopeBrands).filter(isOther).map(p => {
            const items = (Array.isArray(p.hire_items) ? p.hire_items : []).filter(Boolean);
            const people = items.filter(it => it.mode !== 'casting' && str(it.name));
            // คนเดิมลงสองวันเป็นสองแถว แต่เป็นคนเดียว — นับชื่อไม่ซ้ำให้ตรงกับตัวเลข "ผู้รับงาน" ในหน้างาน
            const names = [...new Set(people.map(it => str(it.name)))];
            const requests = items.filter(it => it.mode === 'casting');
            const closed = HIRE_JOB_CLOSED.includes(p.status);
            // งานที่ปิดแล้วไม่มีใครต้องหา/อนุมัติต่อ (ตรงกับ hireStage = closed ที่คิว/การ์ดใช้)
            const openReq = closed ? [] : requests.filter(it => hireRemaining(it) > 0);
            const dates = items.map(it => it.use_date).filter(Boolean).map(String).sort();
            return {
                id: p.id, name: p.name, brand: p.brand || null, status: p.status || 'Draft',
                contact: str(p.creator) || str(p.owner) || null,
                start_date: dates[0] || p.start_date || null,
                end_date: dates[dates.length - 1] || p.end_date || null,
                item_count: items.length,
                people_count: names.length,
                names,
                request_count: requests.length,
                remaining: openReq.reduce((s, it) => s + hireRemaining(it), 0),
                // ชื่อที่รออนุมัติของใบที่ครบแล้วเป็นแค่ตัวสำรอง ไม่นับว่ารอทีม
                waiting: openReq.reduce((s, it) => s + hireWaiting(it), 0),
                // คนที่อนุมัติแล้วแต่ยังไม่คอนเฟิร์มคิว / ค่าตัวใหม่รอทีมอนุมัติ (งานปิดแล้วไม่นับ)
                booking_pending: closed ? 0 : items.filter(it => it.mode !== 'casting' && it.from_request != null && bookingOpen(it) && it.booking.state === 'pending').length,
                fee_review: closed ? 0 : items.filter(it => it.mode !== 'casting' && it.from_request != null && bookingOpen(it) && it.booking.state === 'fee_review').length,
                total_fee: items.reduce((s, it) => s + hireRowFee(it), 0),
                closed,
                created_at: p.created_at || null, updated_at: p.updated_at || null
            };
        });
        // งานที่ยังไม่จบและมีเรื่องค้าง (รออนุมัติ / ยังต้องหา) ขึ้นก่อน แล้วงานใหม่สุดก่อน
        rows.sort((a, b) =>
            (a.closed ? 1 : 0) - (b.closed ? 1 : 0)
            || ((b.waiting > 0 || b.remaining > 0 || b.booking_pending > 0 || b.fee_review > 0) ? 1 : 0)
                - ((a.waiting > 0 || a.remaining > 0 || a.booking_pending > 0 || a.fee_review > 0) ? 1 : 0)
            || String(b.created_at || '').localeCompare(String(a.created_at || ''))
            || (Number(b.id) || 0) - (Number(a.id) || 0));
        const open = rows.filter(r => !r.closed);
        return clone({
            summary: {
                jobs: rows.length,
                open_jobs: open.length,
                people: open.reduce((s, r) => s + r.people_count, 0),
                remaining: open.reduce((s, r) => s + r.remaining, 0),
                total_fee: open.reduce((s, r) => s + r.total_fee, 0)
            },
            brands: [...new Set(rows.map(r => r.brand).filter(Boolean))].sort(),
            rows
        });
    }
};

module.exports = { hires };
