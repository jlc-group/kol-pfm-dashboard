// ร่างฟอร์ม "สร้างแคมเปญใหม่" (ผู้ใช้สั่ง 21 ต.ค. 2026) — เผลอปิดหน้าต่างก่อนกดสร้าง แล้วกดสร้างใหม่ ข้อมูลที่กรอกไว้กลับมาครบ
// เก็บ 2 ที่:
//   • localStorage ต่อผู้ใช้ = ตัวจริง — ข้อความล้วน รอดการรีเฟรช · ไฟล์จำได้แค่ชื่อ (ต้องเลือกใหม่) · ทุกแท็บเห็นตัวเดียวกัน
//   • หน่วยความจำ = สำเนาของการเก็บครั้งล่าสุดในแท็บนี้ ไว้คืนไฟล์บรีฟที่เลือกไว้ (File เก็บลง localStorage ไม่ได้)
//     ใช้เมื่อตรงกับ localStorage เท่านั้น (เวลาเก็บเดียวกัน) — แท็บอื่นสร้างแคมเปญ/ล้างร่างไปแล้ว ร่างเก่าในแท็บนี้ต้องไม่ฟื้น
//     localStorage ใช้ไม่ได้ (โหมดส่วนตัว / ถูกบล็อก / เต็ม) = ใช้หน่วยความจำอย่างเดียว (ปิด-เปิดหน้าต่างยังได้ แค่รีเฟรชแล้วหาย)
// สร้างแคมเปญสำเร็จ / กด "ล้างฟอร์ม" = ลบร่าง · ฟอร์มแก้ไขแคมเปญไม่ใช้ร่าง · ร่างเก่าเกิน 7 วันทิ้ง

const VER = 1;
const TTL = 7 * 24 * 60 * 60 * 1000;
const keyOf = uid => `kol:project-draft:${uid == null ? 'anon' : uid}`;
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isFile = v => typeof File !== 'undefined' && v instanceof File;

let mem = null;   // { uid, at, stored, form, adGroups, productBriefs, briefFile, pbFiles, files } · stored = เขียนลง localStorage สำเร็จ

const FORM_TEXT = ['name', 'brand', 'objective', 'brief_link', 'owner', 'start_date', 'end_date'];

// มีอะไรให้เก็บไหม — ฟอร์มเปล่า (เปิดแล้วปิดเลย) ไม่ต้องเก็บ ไม่งั้นครั้งหน้าขึ้นป้าย "กู้ข้อมูล" ทั้งที่ไม่มีอะไร
export function draftHasContent(d) {
    if (!d) return false;
    const form = isMap(d.form) ? d.form : {};
    if (FORM_TEXT.some(k => String(form[k] ?? '').trim())) return true;
    if (Array.isArray(d.adGroups) && d.adGroups.length) return true;
    if (isMap(d.productBriefs) && Object.values(d.productBriefs).some(b => isMap(b) && String(b.link ?? '').trim())) return true;
    return !!d.briefFile || (isMap(d.pbFiles) && Object.keys(d.pbFiles).length > 0);
}

// ไฟล์บรีฟแต่ละช่อง: slot 'brief' = บรีฟหลัก · รหัสสินค้า = บรีฟของสินค้านั้น
const slotFile = (d, slot) => (slot === 'brief' ? d.briefFile : (isMap(d.pbFiles) ? d.pbFiles[slot] : null));
// ช่องนี้ได้บรีฟแล้ว (เลือกไฟล์ใหม่ หรือเปลี่ยนไปใส่ลิงก์แทน) — ไม่ต้องเตือนให้เลือกไฟล์เดิมอีก
function slotDone(d, slot) {
    if (isFile(slotFile(d, slot))) return true;
    const link = slot === 'brief' ? (isMap(d.form) ? d.form.brief_link : '') : (isMap(d.productBriefs) && isMap(d.productBriefs[slot]) ? d.productBriefs[slot].link : '');
    return !!String(link ?? '').trim();
}
// ชื่อไฟล์ทุกช่องที่ต้องจำ = ไฟล์ที่เลือกอยู่ตอนนี้ + ไฟล์ที่ยังรอเลือกใหม่จากร่างก่อนรีเฟรช (pending) ที่ช่องนั้นยังว่าง
function fileList(d) {
    const out = [];
    if (isFile(d.briefFile)) out.push({ slot: 'brief', name: d.briefFile.name });
    if (isMap(d.pbFiles)) Object.entries(d.pbFiles).forEach(([slot, f]) => { if (isFile(f)) out.push({ slot, name: f.name }); });
    (Array.isArray(d.pending) ? d.pending : []).forEach(p => {
        if (isMap(p) && p.slot && !slotDone(d, p.slot) && !out.some(x => x.slot === p.slot)) out.push({ slot: String(p.slot), name: String(p.name ?? '') });
    });
    return out;
}
// ไฟล์ที่ต้องเลือกใหม่ (ชื่อจำได้ แต่ไม่มีตัวไฟล์ในร่างที่คืน)
const lostOf = (files, d) => files.filter(f => !isFile(slotFile(d, f.slot)));
export const fileLabel = f => (f.slot === 'brief' ? f.name : `${f.slot}: ${f.name}`);

// เก็บร่าง (เรียกเมื่อฟอร์มเปลี่ยน) — ฟอร์มเปล่า = ลบร่าง · d.pending = ไฟล์ที่ยังรอเลือกใหม่ (จาก readProjectDraft().lostFiles)
export function saveProjectDraft(uid, d, now = Date.now()) {
    if (!draftHasContent(d)) { clearProjectDraft(uid); return; }
    const files = fileList(d);
    mem = { uid, at: now, stored: false, form: d.form, adGroups: d.adGroups, productBriefs: d.productBriefs, briefFile: d.briefFile || null, pbFiles: d.pbFiles || {}, files };
    try {
        window.localStorage.setItem(keyOf(uid), JSON.stringify({ v: VER, at: now, form: d.form, adGroups: d.adGroups, productBriefs: d.productBriefs, files }));
        mem.stored = true;
    } catch { /* เก็บข้ามการรีเฟรชไม่ได้ — ยังมีในหน่วยความจำ */ }
}

export function clearProjectDraft(uid) {
    if (mem && mem.uid === uid) mem = null;
    try { window.localStorage.removeItem(keyOf(uid)); } catch { /* ไม่เป็นไร */ }
}

const fromMem = () => ({ at: mem.at, form: mem.form, adGroups: mem.adGroups, productBriefs: mem.productBriefs,
    briefFile: mem.briefFile, pbFiles: mem.pbFiles, lostFiles: lostOf(mem.files, mem) });

// อ่านร่างของผู้ใช้นี้ → { at, form, adGroups, productBriefs, briefFile, pbFiles, lostFiles: [{ slot, name }] } หรือ null
export function readProjectDraft(uid, now = Date.now()) {
    const mine = mem && mem.uid === uid && now - mem.at < TTL ? mem : null;
    let text;
    try { text = window.localStorage.getItem(keyOf(uid)); } catch {
        return mine ? fromMem() : null;   // localStorage ใช้ไม่ได้ — หน่วยความจำอย่างเดียว
    }
    if (text == null) {
        // ไม่มีใน localStorage: แท็บอื่นสร้างแคมเปญ/ล้างร่างไปแล้ว → ร่างในแท็บนี้เก่าแล้ว ทิ้ง
        // ยกเว้นแท็บนี้เขียนลง localStorage ไม่สำเร็จเอง (เต็ม) — มีแค่ในหน่วยความจำ
        if (mine && !mine.stored) return fromMem();
        if (mem && mem.uid === uid) mem = null;
        return null;
    }
    let raw = null;
    try { raw = JSON.parse(text); } catch { raw = null; }
    // รูปแบบไม่ตรง (รุ่นเก่า / ข้อมูลเสีย) หรือเก่าเกิน = ทิ้ง ไม่ให้ฟอร์มพัง
    if (!isMap(raw) || raw.v !== VER || !Number.isFinite(raw.at) || now - raw.at >= TTL
        || !isMap(raw.form) || !Array.isArray(raw.adGroups) || !raw.adGroups.every(isMap)) {
        clearProjectDraft(uid);
        return null;
    }
    // ตรงกับที่แท็บนี้เก็บครั้งล่าสุด = ใช้หน่วยความจำ (ได้ไฟล์บรีฟคืนด้วย) · ไม่ตรง = แท็บอื่นเก็บทีหลัง ใช้ของ localStorage
    if (mine && mine.at === raw.at) return fromMem();
    if (mem && mem.uid === uid) mem = null;
    const files = (Array.isArray(raw.files) ? raw.files : []).filter(f => isMap(f) && f.slot).map(f => ({ slot: String(f.slot), name: String(f.name ?? '') }));
    const d = { at: raw.at, form: raw.form, adGroups: raw.adGroups, productBriefs: isMap(raw.productBriefs) ? raw.productBriefs : {}, briefFile: null, pbFiles: {} };
    d.lostFiles = lostOf(files, d);
    return draftHasContent(d) || d.lostFiles.length ? d : null;
}

// ร่างเก็บได้ถึง 7 วัน ระหว่างนั้น Admin อาจเปลี่ยนชื่อ/ซ่อน Target (หน้า Products & Targets) — ตอนกู้เอาเฉพาะ Target ที่สินค้ายังเลือกได้
// ที่หายไปคืนใน dropped ให้ฟอร์มบอก (แถวนั้นกลับเป็นยังไม่เลือก Target ให้เลือกใหม่) · targetsOf(code) = Target ที่เลือกได้ของสินค้านั้น
export function refreshDraftTargets(groups, targetsOf) {
    const dropped = [];
    const out = (Array.isArray(groups) ? groups : []).map(g => {
        if (!isMap(g) || !Array.isArray(g.blocks)) return g;
        return {
            ...g,
            blocks: g.blocks.map(b => {
                if (!isMap(b) || !isMap(b.product_targets)) return b;
                const pt = {};
                Object.entries(b.product_targets).forEach(([code, list]) => {
                    const ok = targetsOf(code);
                    const arr = Array.isArray(list) ? list : (list ? [list] : []);
                    pt[code] = arr.filter(t => ok.includes(t));
                    arr.filter(t => !ok.includes(t)).forEach(t => { if (!dropped.includes(t)) dropped.push(t); });
                });
                return { ...b, product_targets: pt };
            })
        };
    });
    return { groups: out, dropped };
}
