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
const { clone, scopeProjects, inScope, hireRemaining, hireRowFee, hireWaiting, hireNeedMore, hireStage, HIRE_JOB_CLOSED, hireBookings, bookingOpen, jobProgress, HIRE_PAYABLE } = require('../logic');

const isOther = p => (p.campaign_type || 'kol') === 'other';
const str = v => String(v == null ? '' : v).trim();
const personKey = it => str(it.name).toLowerCase() + '|' + str(it.kind).toLowerCase();
// วันนี้ตามเวลาไทย (YYYY-MM-DD) — ใช้เทียบกับกำหนดส่งรายชื่อที่เก็บเป็นวันที่ล้วน
const todayTH = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

// ===== Talent Book (book) =====
// สถานะของชื่อที่เสนอในใบขอให้หา — ค่าในฐานชุดเดียวกับ routes/projects.js (CAND_*) · ไม่มีสถานะ = ชื่อเก่าที่ยังรอเลือก
const CAND_NEW = 'เสนอ';
const CAND_PICKED = 'เลือกแล้ว';
const CAND_DROPPED = 'ไม่เอา';
// ชื่อที่ถูกเลือกแล้วแต่คนช่วยหาแจ้งว่ามาไม่ได้ ถูกคืนเป็น "ไม่เอา" พร้อมโน้ต "คิวไม่ว่าง…" (logic.bookingUnavailable)
// — กติกาเดียวกับ isUnavailNote ฝั่งหน้าเว็บ (requestText.js) ใบขอให้หาโชว์ว่า "มาไม่ได้" การ์ดต้องไม่บอกว่า "ไม่ได้เลือก"
const isUnavailNote = note => /^คิวไม่ว่าง(\s*:|\s*$)/.test(str(note));
// วันที่ล้วน (YYYY-MM-DD) ของช่องวันที่ในแถว · เวลาเสนอชื่อ (ISO) แปลงเป็นวันตามเวลาไทย ไม่งั้นชื่อที่เสนอหลังเที่ยงคืนจะถอยไปหนึ่งวัน
const dayOf = v => (str(v) ? str(v).slice(0, 10) : null);
const thDayOf = v => { const t = Date.parse(str(v)); return Number.isFinite(t) ? new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10) : null; };
// ชนิดไฟล์คอมการ์ดจากนามสกุล (ตัวรับไฟล์รับแค่ png/jpg/jpeg/webp/pdf) — กติกาเดียวกับ fileKind ใน HireRequestCard.jsx
// นามสกุลอื่นที่ไม่ควรมีอยู่จริง = ไม่ถือเป็นรูป (การ์ดขึ้นตัวอักษรย่อแทน ดีกว่าชี้ไปไฟล์ที่เปิดไม่ได้)
const fileKind = f => {
    if (!f || typeof f !== 'object') return null;
    const n = str(f.filename || f.original);
    if (/\.pdf$/i.test(n)) return 'pdf';
    return /\.(png|jpe?g|webp|gif)$/i.test(n) ? 'image' : null;
};
// ลิงก์รูป/คลิปภายนอกส่งออกเฉพาะ http/https — ค่าพวกนี้คนพิมพ์เอง (javascript: ฯลฯ ห้ามหลุดไปเป็นปุ่มเปิดบนการ์ด)
const webUrl = v => { const s = str(v); return /^https?:\/\/\S+$/i.test(s) ? s : null; };
const seg = v => encodeURIComponent(str(v));
// รายการใหม่สุดก่อน: วันที่ใหม่กว่า (ไม่มีวัน = ท้ายสุด) → วันเดียวกันให้แถวคนในงานมาก่อนชื่อที่เสนอ
// (คนที่ถูกเลือกจากใบกลายเป็นแถวคนในงานวันเดียวกับใบ — แถวคนคือเรื่องล่าสุดของเขา) → เวลาเสนอ → งานใหม่กว่า
const newestFirst = (a, b) => (b.date || '').localeCompare(a.date || '')
    || (a.direct ? 0 : 1) - (b.direct ? 0 : 1)
    || b.ts.localeCompare(a.ts)
    || (Number(b.project_id) || 0) - (Number(a.project_id) || 0);

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
                // เฉพาะคนที่คอนเฟิร์มแล้ว (ผู้ใช้ขอ) = ตกลงแล้ว / ถ่ายเสร็จ / ส่งงานแล้ว และไม่ค้างยืนยันคิว/ค่าตัวใหม่
                // เกณฑ์เดียวกับเงินก้อน "ตกลงแล้ว" (hireBreakdown) — คนที่ยังกำลังคุย หรือรอคนช่วยหายืนยันคิว ยังไม่ใช่ "คนที่เคยจ้าง"
                if (it.mode === 'casting' || bookingOpen(it) || !HIRE_PAYABLE.includes(str(it.status))) return;
                // ไม่ได้ระบุวันใช้งาน ให้ถือวันเริ่มแคมเปญแทน ไม่งั้นตัวกรองช่วงวันจะตัดทิ้งทั้งที่มีงานจริง
                const date = it.use_date || p.start_date || null;
                if (from && date && date < from) return;
                if (to && date && date > to) return;
                jobs.push({
                    name: str(it.name), kind: str(it.kind) || null, agency: str(it.agency) || null,
                    contact: str(it.contact) || null, fee: Number(it.fee) || 0,
                    status: str(it.status) || null, use_date: it.use_date || null, date,
                    project_id: p.id, project_name: p.name, brand: p.brand || null,
                    // ผู้ติดต่อ = คนของทีมที่ดูแลงานนี้ (creator ก่อน · งานเก่าเก็บไว้ที่ owner) — คนละอย่างกับ contact (เบอร์/LINE ของผู้รับงาน)
                    team_contact: str(p.creator) || str(p.owner) || null
                });
            });
        });

        const q = str(search).toLowerCase();
        const picked = jobs.filter(j =>
            (!kind || j.kind === kind)
            && (!q || [j.name, j.kind, j.agency, j.contact, j.project_name, j.brand, j.team_contact]
                .some(v => String(v == null ? '' : v).toLowerCase().includes(q))));

        // ยุบเป็นรายคน
        const byPerson = new Map();
        picked.forEach(j => {
            let row = byPerson.get(personKey(j));
            if (!row) {
                row = {
                    key: personKey(j), name: j.name, kind: j.kind, agency: j.agency, contact: j.contact,
                    jobs: 0, fee_jobs: 0, total_fee: 0, last_fee: 0, last_date: null, fee_date: null,
                    brands: [], campaigns: [], statuses: [], team_contacts: []
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
            if (j.team_contact && !row.team_contacts.includes(j.team_contact)) row.team_contacts.push(j.team_contact);
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

    // Talent Book — แกลเลอรีคอมการ์ดของ "ทุกคนที่เคยเสนอ/บันทึกไว้ให้แบรนด์" (1 การ์ด = ชื่อ + ประเภทงาน แบบเดียวกับ list)
    // ต่างจาก list(): list เอาเฉพาะคนที่คอนเฟิร์มแล้ว · book รวมคนในงานทุกสถานะ + ชื่อที่คนช่วยหาเสนอในใบขอให้หาทุกสถานะ
    //  booked  = มีงานที่คอนเฟิร์มแล้วอย่างน้อย 1 งาน (เกณฑ์เดียวกับ list / เงินก้อน "ตกลงแล้ว" ของ hireBreakdown)
    //  casting = ที่เหลือ · sub = สถานะของรายการล่าสุดของคนนั้น
    //    waiting รอเลือก · spare สำรองไว้ (ใบได้คนครบ/งานปิดแล้ว) · dropped ไม่ได้เลือก · talking กำลังคุย · booking รอยืนยันคิว
    // ชื่อที่เสนอตามสิทธิ์แบรนด์เหมือนแถวคน (คนช่วยหาที่ไม่มีสิทธิ์แบรนด์ไม่เห็นรายชื่อย้อนหลังของแบรนด์นั้น)
    // ส่งออกเฉพาะช่องที่การ์ดโชว์ — ไม่มีหมายเหตุ / เหตุผลที่ไม่เอา / id ผู้ใช้ · ตัวกรอง/ค้นหาทำฝั่งหน้าเว็บจากข้อมูลชุดนี้
    async book({ scopeBrands = null } = {}) {
        const snap = await loadSnapshot(['other_projects']);
        const projs = scopeProjects(snap.other_projects.slice(), scopeBrands).filter(isOther);

        // แบนเป็น "รายการ" ทีละครั้งที่คนนั้นโผล่ในงาน (แถวคนในงาน / ชื่อที่ถูกเสนอ) แล้วค่อยยุบเป็นการ์ดรายคน
        const entries = [];
        projs.forEach(p => {
            const items = (Array.isArray(p.hire_items) ? p.hire_items : []).filter(it => it && typeof it === 'object');
            const job = {
                project_id: p.id, project_name: p.name || null, brand: p.brand || null,
                // ผู้ติดต่อ = คนของทีมที่ดูแลงาน (creator ก่อน · งานเก่าเก็บที่ owner) — เหมือน list
                team_contact: str(p.creator) || str(p.owner) || null
            };
            const base = `/projects/${seg(p.id)}/hires/`;
            // ใบขอให้หาไม่มีตัวคน ห้ามเป็นการ์ด · แถวที่ยังไม่ใส่ชื่อยังไม่นับเป็นคน
            const people = items.filter(it => it.mode !== 'casting' && str(it.name));
            people.forEach(it => {
                const confirmed = !bookingOpen(it) && HIRE_PAYABLE.includes(str(it.status));
                // path ต้องเปิดได้ด้วยเส้น GET /projects/:id/hires/:key/image ที่มีอยู่แล้ว — แถวเก่าที่ไม่มี key เปิดรูปไม่ได้ ข้ามไป
                const fk = str(it.key) ? fileKind(it.image) : null;
                entries.push({
                    ...job, direct: true, absorbed: false,
                    key: personKey(it), name: str(it.name), kind: str(it.kind) || null,
                    agency: str(it.agency) || null, contact: str(it.contact) || null, link: str(it.link) || null,
                    // ไม่ใส่วัน (ฟอร์มมีคนแล้วข้ามได้) → วันยืนยันคิว → วันสร้างงาน — ปล่อย null จะกลายเป็นรายการเก่าสุด
                    // แล้วสถานะ / ค่าตัว / "ล่าสุด" บนการ์ดไปเอาของเก่ามาโชว์แทนเรื่องที่เพิ่งบันทึก
                    date: dayOf(it.use_date) || dayOf(p.start_date)
                        || thDayOf(it.booking && it.booking.confirmed_at) || thDayOf(p.created_at), ts: '',
                    fee: Number(it.fee) || 0, confirmed,
                    sub: confirmed ? null : bookingOpen(it) ? 'booking' : 'talking',
                    file: fk ? { type: fk, path: `${base}${seg(it.key)}/image` } : null,
                    image_link: null, clip_file: null, clip_link: null, by: null
                });
            });
            items.filter(it => it.mode === 'casting').forEach(r => {
                // ชื่อที่ยังรอเลือกในใบที่ได้คนครบแล้ว หรือในงานที่ปิดไปแล้ว ไม่มีใครเลือกต่อ = ตัวสำรอง ไม่ใช่ "รอเลือก"
                const noSeat = hireRemaining(r) <= 0 || HIRE_JOB_CLOSED.includes(p.status);
                (Array.isArray(r.candidates) ? r.candidates : []).forEach(c => {
                    if (!c || typeof c !== 'object' || !str(c.name)) return;
                    const st = str(c.status) || CAND_NEW;
                    // คนที่ถูกเลือกแล้วมีแถวคนในงานของตัวเอง (from_request + from_candidate · แถวเก่าผูกด้วยชื่อ)
                    // → ยุบเข้าการ์ดของแถวนั้น (แม้ชื่อจะถูกแก้ไปแล้ว) ให้แถวคนเป็นตัวบอกสถานะ/ค่าตัว ส่วนชื่อที่เสนอให้แค่คนเสนอ/รูป/คลิป
                    const hired = st === CAND_PICKED ? people.find(d => d.from_request != null && String(d.from_request) === String(r.key)
                        && (d.from_candidate ? String(d.from_candidate) === String(c.key) : str(d.name) === str(c.name))) : null;
                    // เส้นเปิดไฟล์ของชื่อที่เสนอ (GET …/candidates/:ckey/image|video) ต้องมีทั้ง key ของใบและของชื่อ
                    const files = str(r.key) && str(c.key) ? `${base}${seg(r.key)}/candidates/${seg(c.key)}/` : null;
                    const fk = files ? fileKind(c.image) : null;
                    entries.push({
                        ...job, direct: false, absorbed: !!hired,
                        key: hired ? personKey(hired) : personKey({ name: c.name, kind: r.kind }),
                        name: str(c.name), kind: str(r.kind) || null,
                        agency: str(c.agency) || null, contact: str(c.contact) || null, link: str(c.link) || null,
                        // วันของงาน (เหมือนแถวคน) ก่อน · ใบที่ไม่มีวันใช้วันที่เสนอชื่อ
                        date: dayOf(r.use_date) || dayOf(p.start_date) || thDayOf(c.at), ts: str(c.at),
                        fee: Number(c.fee) || 0, confirmed: false,
                        // เลือกแล้วแต่ไม่มีแถวคนในงาน (ข้อมูลเก่า) ยังไม่ใช่งานที่ตกลง — ถือว่ารอยืนยันคิว
                        sub: st === CAND_PICKED ? 'booking'
                            : st === CAND_DROPPED ? (isUnavailNote(c.decided_note) ? 'unavailable' : 'dropped')
                            : noSeat ? 'spare' : 'waiting',
                        file: fk ? { type: fk, path: `${files}image` } : null,
                        image_link: webUrl(c.image_link),
                        clip_file: files && c.video && typeof c.video === 'object'
                            && str(c.video.filename || c.video.original) ? `${files}video` : null,
                        clip_link: webUrl(c.video_link),
                        by: str(c.by_name) || null
                    });
                });
            });
        });

        entries.sort(newestFirst);
        const byPerson = new Map();
        entries.forEach(e => {
            if (!byPerson.has(e.key)) byPerson.set(e.key, []);
            byPerson.get(e.key).push(e);
        });

        const uniq = vals => [...new Set(vals.filter(Boolean))];
        const cards = [...byPerson.values()].map(list => {
            // list เรียงใหม่สุดก่อนแล้ว — "ค่าล่าสุดที่ไม่ว่าง" = ตัวแรกที่เจอ
            const first = pick => { for (const e of list) { const v = pick(e); if (v) return v; } return null; };
            // ชื่อที่เสนอที่ถูกยุบเข้าแถวคนแล้วไม่นับซ้ำเป็นสถานะ/ค่าตัว (แถวคนเป็นเรื่องจริงของเขาต่อจากนั้น)
            const own = list.filter(e => !e.absorbed);
            const head = own[0] || list[0];
            const booked = own.some(e => e.confirmed);
            const fileOf = type => first(e => (e.file && e.file.type === type ? { type, path: e.file.path } : null));
            const imageLink = first(e => e.image_link);
            const clipFile = first(e => e.clip_file);
            const clipLink = first(e => e.clip_link);
            const projects = [];
            list.forEach(e => {
                if (!projects.some(x => String(x.id) === String(e.project_id))) projects.push({ id: e.project_id, name: e.project_name });
            });
            return {
                key: head.key, name: head.name, kind: head.kind,
                group: booked ? 'booked' : 'casting',
                sub: booked ? null : head.sub,
                agency: first(e => e.agency), contact: first(e => e.contact), link: first(e => e.link),
                // รูปจริงก่อน (โชว์เป็นรูปย่อได้) → PDF → ลิงก์รูปภายนอก (หน้าเว็บไม่ดึงรูปจากเว็บคนอื่นมาโชว์ แค่เป็นปุ่มเปิด)
                photo: fileOf('image') || fileOf('pdf') || (imageLink ? { type: 'link', url: imageLink } : null),
                clip: clipFile ? { type: 'file', path: clipFile } : clipLink ? { type: 'link', url: clipLink } : null,
                // ค่าตัว (hired) = งานที่คอนเฟิร์มแล้วเท่านั้น · ที่เหลือเป็นราคาที่เสนอ/ยังคุยอยู่ (proposed) · ฿0 = ยังไม่ได้ใส่ ไม่โชว์
                fees: own.filter(e => e.fee > 0).slice(0, 3).map(e => ({
                    fee: e.fee, kind: e.confirmed ? 'hired' : 'proposed',
                    project_id: e.project_id, project_name: e.project_name, brand: e.brand, date: e.date
                })),
                team_contacts: uniq(list.map(e => e.team_contact)),
                proposed_by: uniq(list.map(e => e.by)),
                jobs: projects.length,
                projects,
                brands: uniq(list.map(e => e.brand)),
                last_date: first(e => e.date)
            };
        });
        cards.sort((a, b) => (b.last_date || '').localeCompare(a.last_date || '') || a.name.localeCompare(b.name, 'th'));

        const booked = cards.filter(c => c.group === 'booked').length;
        return clone({
            counts: { all: cards.length, booked, casting: cards.length - booked },
            kinds: uniq(cards.map(c => c.kind)).sort(),
            // ชิปแบรนด์ = เฉพาะแบรนด์ที่มีการ์ด (งานถูกกรองตามสิทธิ์มาแล้ว แบรนด์ที่ไม่มีสิทธิ์จึงไม่หลุดมา)
            brands: uniq(cards.flatMap(c => c.brands)).sort(),
            cards
        });
    },

    // ใบขอจัดหาที่ยังเป็น "งาน" ของใครบางคน — ใช้ทั้งหน้างานจัดหาและตัวเลขแดงบนเมนู
    // เห็นได้ 3 ทาง: แบรนด์ที่ตัวเองมีสิทธิ์ · ใบที่ถูกมอบหมายให้ตัวเอง · ใบที่ตัวเองเป็นคนขอ
    // สองทางหลังตั้งใจให้ข้ามสิทธิ์แบรนด์ได้ เพราะคนที่ถูกมอบงานต้องเห็นงานของตัวเองเสมอ
    // (เห็นเฉพาะ "ใบนั้น" ไม่ได้เปิดทั้งแคมเปญให้ — เส้นแก้ไขก็ตรวจซ้ำอีกชั้นที่ routes/projects.js)
    // withNames = แปะชื่อคนขอ (requested_by_name) ด้วยไหม — เส้นนับเลขแดงถูกเรียกทุก 60 วินาทีจากทุกหน้า ไม่ต้องใช้ชื่อ จึงปิดไว้
    // project = id งาน (ตัวเลข) → rows / summary เหลือเฉพาะใบของงานนั้น (หน้างานเปิดลิ้นชักใบจากแถวนี้) · counts ยังนับทุกใบเหมือนเดิม
    async tasks({ userId = null, scopeBrands = null, mine = '', status, search, brand, project = null, withNames = true } = {}) {
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
                    // Scope of Work — ส่วนหนึ่งของบรีฟที่คนช่วยหาต้องเห็น (ลิ้นชักใบ / การ์ดใบ) · ใบเก่าที่ไม่มี = null
                    scope: str(it.scope) || null,
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
        const pid = project === null || project === undefined || project === '' ? null : String(project);
        const picked = rows.filter(r =>
            (mine !== 'find' || r.is_assignee)
            && (mine !== 'ask' || r.is_requester)
            && (mine !== 'todo' || r.my_todo)
            && (pid === null || String(r.project_id) === pid)
            && (!brand || r.brand === brand)
            && (!status || r.status === status)
            && (!q || [r.project_name, r.brand, r.kind, r.spec, r.scope, r.assignee_name, r.place]
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
    // progress = ความคืบหน้าของงาน (คน / เงิน / เรื่องที่ต้องทำ) ชุดเดียวกับที่หน้างานคิดเองจาก hire_items (jobProgress)
    async jobs({ scopeBrands = null } = {}) {
        const snap = await loadSnapshot(['other_projects']);
        const today = todayTH();
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
                created_at: p.created_at || null, updated_at: p.updated_at || null,
                progress: jobProgress(items, p.status, today)
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
        // เงิน / ตำแหน่งรวมของงานที่ยังไม่จบ (กล่องสรุปบนแท็บงานทั้งหมด) — บวกจาก progress ของแต่ละงาน ตัวเลขจึงตรงกับการ์ดเสมอ
        // slots.agreed = ตกลงแล้ว + ถ่ายเสร็จ + ส่งงานแล้ว · slots.pending = กำลังคุย + รอยืนยันคิว · slots.need = ยังต้องหา
        const sum = pick => open.reduce((s, r) => s + pick(r.progress), 0);
        return clone({
            summary: {
                jobs: rows.length,
                open_jobs: open.length,
                people: open.reduce((s, r) => s + r.people_count, 0),
                remaining: open.reduce((s, r) => s + r.remaining, 0),
                total_fee: open.reduce((s, r) => s + r.total_fee, 0),
                money: {
                    agreed: sum(g => g.money.agreed),
                    pending: sum(g => g.money.pending),
                    unfilled: sum(g => g.money.unfilled)
                },
                slots: {
                    agreed: sum(g => g.people.agreed + g.people.shot + g.people.delivered),
                    pending: sum(g => g.people.talking + g.people.booking),
                    need: sum(g => g.people.need)
                }
            },
            brands: [...new Set(rows.map(r => r.brand).filter(Boolean))].sort(),
            rows
        });
    }
};

module.exports = { hires };
