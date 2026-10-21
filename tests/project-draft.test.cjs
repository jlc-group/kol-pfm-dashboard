// ร่างฟอร์ม "สร้างแคมเปญใหม่" (21 ต.ค. 2026) — client/src/utils/projectDraft.js
// ปิดหน้าต่างก่อนกดสร้าง → กดสร้างใหม่ได้ข้อมูลเดิม · หน่วยความจำเก็บไฟล์ · localStorage รอดรีเฟรช (ไฟล์บอกแค่ชื่อ)
// ฟอร์มเปล่าไม่เก็บ · ร่างเสีย/รุ่นอื่น/เก่าเกิน 7 วัน = ทิ้ง · แยกต่อผู้ใช้ · localStorage พัง = ฟอร์มไม่พัง
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// localStorage / File จำลอง (node ไม่มี)
const LS = new Map();
let lsBroken = false;
globalThis.window = {
    localStorage: {
        getItem: k => { if (lsBroken) throw new Error('blocked'); return LS.has(k) ? LS.get(k) : null; },
        setItem: (k, v) => { if (lsBroken) throw new Error('quota'); LS.set(k, String(v)); },
        removeItem: k => { if (lsBroken) throw new Error('blocked'); LS.delete(k); }
    }
};
if (typeof globalThis.File === 'undefined') {
    globalThis.File = class File { constructor(parts, name) { this.name = name; } };
}

let D;
// โหลดโมดูลใหม่ทุกเทสต์ (หน่วยความจำในโมดูลเริ่มว่าง = จำลองการรีเฟรชหน้า)
const fresh = async () => import(pathToFileURL(path.join(__dirname, '../client/src/utils/projectDraft.js')).href + '?t=' + Math.random());
before(async () => { D = await fresh(); });
beforeEach(() => { LS.clear(); lsBroken = false; });

const T0 = Date.UTC(2026, 9, 21, 3, 0, 0);
const emptyForm = { name: '', brand: '', objective: '', brief_link: '', owner: '', creator: '', budget: '', kol_target: '', start_date: '', end_date: '', status: 'Draft' };
const filled = (over = {}) => ({
    form: { ...emptyForm, name: 'KOL พ.ย.', brand: "Jula's Herb" },
    adGroups: [{ key: 'g1', platform: 'TikTok', blocks: [{ platform: 'TikTok', products: ['L3'], product_targets: { L3: ['MF_SUN_MASS_18_54'] } }] }],
    productBriefs: { L3: { link: 'https://x/brief' } },
    briefFile: null, pbFiles: {}, ...over
});

test('ฟอร์มเปล่า = ไม่มีอะไรให้เก็บ (เปิดแล้วปิดเลย ครั้งหน้าไม่ขึ้นป้ายกู้ข้อมูล)', () => {
    assert.equal(D.draftHasContent({ form: emptyForm, adGroups: [], productBriefs: {}, briefFile: null, pbFiles: {} }), false);
    assert.equal(D.draftHasContent({ form: { ...emptyForm, name: '  ' }, adGroups: [], productBriefs: { L3: { link: ' ' } } }), false, 'ช่องว่างล้วนไม่นับ');
    assert.equal(D.draftHasContent(null), false);
    for (const k of ['name', 'brand', 'objective', 'brief_link', 'owner', 'start_date', 'end_date']) {
        assert.equal(D.draftHasContent({ form: { ...emptyForm, [k]: 'x' }, adGroups: [] }), true, k);
    }
    assert.equal(D.draftHasContent({ form: emptyForm, adGroups: [{ key: 'g' }] }), true, 'กดเพิ่มกลุ่มสินค้าแล้ว');
    assert.equal(D.draftHasContent({ form: emptyForm, adGroups: [], productBriefs: { L3: { link: 'https://x' } } }), true);
    assert.equal(D.draftHasContent({ form: emptyForm, adGroups: [], briefFile: new File([], 'a.pdf') }), true);
    assert.equal(D.draftHasContent({ form: emptyForm, adGroups: [], pbFiles: { L3: new File([], 'b.pdf') } }), true);
});

test('เก็บแล้วอ่านคืนครบ (ปิดหน้าต่าง → กดสร้างใหม่) · ไฟล์ที่เลือกไว้ยังอยู่ในหน่วยความจำ', () => {
    const f = new File([], 'brief.pdf'), pf = new File([], 'l3.pdf');
    D.saveProjectDraft(1, filled({ briefFile: f, pbFiles: { L3: pf } }), T0);
    const d = D.readProjectDraft(1, T0 + 60000);
    assert.equal(d.at, T0);
    assert.equal(d.form.name, 'KOL พ.ย.');
    assert.deepEqual(d.adGroups, filled().adGroups);
    assert.deepEqual(d.productBriefs, { L3: { link: 'https://x/brief' } });
    assert.equal(d.briefFile, f, 'ไฟล์บรีฟหลักตัวเดิม');
    assert.equal(d.pbFiles.L3, pf);
    assert.deepEqual(d.lostFiles, []);
});

test('รีเฟรชหน้า (หน่วยความจำหาย): อ่านจาก localStorage ได้ · ไฟล์ต้องเลือกใหม่ บอกชื่อไว้', async () => {
    D.saveProjectDraft(1, filled({ briefFile: new File([], 'brief.pdf'), pbFiles: { L3: new File([], 'l3.pdf') } }), T0);
    const raw = JSON.parse(LS.get('kol:project-draft:1'));
    assert.equal(raw.v, 1);
    assert.equal('briefFile' in raw || 'pbFiles' in raw, false, 'ไม่พยายามเก็บ File ลง localStorage');
    const R = await fresh();
    const d = R.readProjectDraft(1, T0 + 1000);
    assert.equal(d.form.name, 'KOL พ.ย.');
    assert.deepEqual(d.adGroups, filled().adGroups);
    assert.equal(d.briefFile, null);
    assert.deepEqual(d.pbFiles, {});
    assert.deepEqual(d.lostFiles, [{ slot: 'brief', name: 'brief.pdf' }, { slot: 'L3', name: 'l3.pdf' }]);
    assert.deepEqual(d.lostFiles.map(R.fileLabel), ['brief.pdf', 'L3: l3.pdf']);
});

test('ไฟล์ที่รอเลือกใหม่ (pending) จำต่อจนกว่าจะเลือกไฟล์ / ใส่ลิงก์แทน — เก็บร่างรอบถัดไปไม่ทำรายชื่อหาย', async () => {
    D.saveProjectDraft(1, filled({ briefFile: new File([], 'brief.pdf'), pbFiles: { L3: new File([], 'l3.pdf') }, productBriefs: { L3: { link: '' } } }), T0);   // เลือกไฟล์ = ช่องลิงก์ว่าง (setPbFile)
    let R = await fresh();
    const d = R.readProjectDraft(1, T0 + 1000);
    // ผู้ใช้แก้ชื่อ (ยังไม่ได้เลือกไฟล์ใหม่) → เก็บร่างใหม่พร้อม pending
    R.saveProjectDraft(1, { ...d, form: { ...d.form, name: 'แก้ชื่อ' }, pending: d.lostFiles }, T0 + 2000);
    assert.deepEqual(R.readProjectDraft(1, T0 + 3000).lostFiles.map(R.fileLabel), ['brief.pdf', 'L3: l3.pdf'], 'แท็บเดิม (หน่วยความจำ) ยังบอก');
    R = await fresh();
    assert.deepEqual(R.readProjectDraft(1, T0 + 3000).lostFiles.map(R.fileLabel), ['brief.pdf', 'L3: l3.pdf'], 'รีเฟรชอีกรอบยังบอก');
    // เลือกไฟล์บรีฟหลักใหม่ + ใส่ลิงก์แทนไฟล์ของ L3 → ไม่ต้องเตือนแล้ว
    const nf = new File([], 'brief-v2.pdf');
    R.saveProjectDraft(1, { ...d, briefFile: nf, productBriefs: { L3: { link: 'https://y' } }, pending: d.lostFiles }, T0 + 4000);
    const back = R.readProjectDraft(1, T0 + 5000);
    assert.equal(back.briefFile, nf);
    assert.deepEqual(back.lostFiles, []);
    assert.deepEqual(JSON.parse(LS.get('kol:project-draft:1')).files, [{ slot: 'brief', name: 'brief-v2.pdf' }]);
});

test('หลายแท็บ: localStorage เป็นตัวจริง — แท็บอื่นสร้างแคมเปญ/ล้างร่างแล้ว ร่างเก่าในแท็บนี้ไม่ฟื้น · แท็บอื่นเก็บทีหลัง = ได้ของใหม่', async () => {
    // แท็บ 1 (D) กรอกแล้วปิด
    D.saveProjectDraft(1, filled({ briefFile: new File([], 'a.pdf') }), T0);
    // แท็บ 2 (หน่วยความจำของตัวเอง) กู้ร่าง แล้วสร้างแคมเปญสำเร็จ → ลบร่าง
    const T2 = await fresh();
    assert.equal(T2.readProjectDraft(1, T0 + 1000).form.name, 'KOL พ.ย.');
    T2.clearProjectDraft(1);
    assert.equal(D.readProjectDraft(1, T0 + 2000), null, 'แท็บ 1 กดสร้างใหม่ = ฟอร์มเปล่า (ไม่สร้างซ้ำ)');
    // แท็บ 1 เก็บร่าง → แท็บ 2 แก้ต่อและเก็บทีหลัง → แท็บ 1 ได้ของแท็บ 2 (ไม่ใช่ของเก่าในหน่วยความจำตัวเอง)
    D.saveProjectDraft(1, filled({ briefFile: new File([], 'a.pdf') }), T0 + 3000);
    const d2 = T2.readProjectDraft(1, T0 + 4000);
    assert.deepEqual(d2.lostFiles.map(T2.fileLabel), ['a.pdf'], 'แท็บ 2 ไม่มีไฟล์ของแท็บ 1');
    T2.saveProjectDraft(1, { ...d2, form: { ...d2.form, name: 'แท็บ 2 แก้' }, pending: d2.lostFiles }, T0 + 5000);
    const d1 = D.readProjectDraft(1, T0 + 6000);
    assert.equal(d1.form.name, 'แท็บ 2 แก้');
    assert.equal(d1.briefFile, null);
    assert.deepEqual(d1.lostFiles.map(D.fileLabel), ['a.pdf']);
});

test('กู้ร่าง: Target ที่ถูกเปลี่ยนชื่อ/ซ่อนแล้วเอาออก + บอกชื่อ · ช่องอื่นไม่แตะ', () => {
    const ok = { L3: ['F_SUN_MASS_18_54', 'MF_SUN_MASS_18_55'], L10: ['F_SUN_MASS_18_54'] };
    const groups = [{ key: 'g', concept: 'x', blocks: [
        { platform: 'TikTok', products: ['L3', 'L10'], budget: '10', product_targets: { L3: ['MF_SUN_MASS_18_54', 'F_SUN_MASS_18_54'], L10: ['F_SUN_MASS_18_54'] } },
        { platform: 'Instagram', products: ['L3'], product_targets: null },
        { platform: 'Facebook', products: ['L10'], product_targets: { L10: 'OLD_ONE' } }] }, { key: 'g2' }];
    const r = D.refreshDraftTargets(groups, c => ok[c] || []);
    assert.deepEqual(r.groups[0].blocks[0].product_targets, { L3: ['F_SUN_MASS_18_54'], L10: ['F_SUN_MASS_18_54'] });
    assert.equal(r.groups[0].blocks[0].budget, '10');
    assert.equal(r.groups[0].blocks[1].product_targets, null);
    assert.deepEqual(r.groups[0].blocks[2].product_targets, { L10: [] });
    assert.deepEqual(r.dropped, ['MF_SUN_MASS_18_54', 'OLD_ONE']);
    assert.deepEqual(r.groups[1], { key: 'g2' });
    assert.deepEqual(D.refreshDraftTargets(groups, c => ok[c] || []).groups[0].concept, 'x');
    assert.deepEqual(D.refreshDraftTargets(null, () => []), { groups: [], dropped: [] });
});

test('แยกต่อผู้ใช้ · ล้าง = หายทั้งหน่วยความจำและ localStorage · ฟอร์มกลับเป็นเปล่า = ลบร่าง', async () => {
    D.saveProjectDraft(1, filled(), T0);
    assert.equal(D.readProjectDraft(2, T0), null, 'คนอื่นไม่เห็นร่างของเรา');
    D.saveProjectDraft(2, filled({ form: { ...emptyForm, name: 'ของคนที่ 2' } }), T0);
    assert.equal(D.readProjectDraft(1, T0).form.name, 'KOL พ.ย.', 'ร่างของคนที่ 2 ไม่ทับของเรา (localStorage)');
    D.clearProjectDraft(1);
    assert.equal(D.readProjectDraft(1, T0), null);
    assert.equal(LS.has('kol:project-draft:1'), false);
    assert.equal(D.readProjectDraft(2, T0).form.name, 'ของคนที่ 2');
    D.saveProjectDraft(2, { form: emptyForm, adGroups: [], productBriefs: {} }, T0);
    assert.equal(D.readProjectDraft(2, T0), null, 'ลบข้อมูลจนฟอร์มเปล่า = ไม่มีร่าง');
    assert.equal(LS.has('kol:project-draft:2'), false);
});

test('ร่างเก่าเกิน 7 วัน / รุ่นอื่น / ข้อมูลเสีย = ทิ้ง (ฟอร์มเริ่มเปล่า ไม่พัง)', async () => {
    D.saveProjectDraft(1, filled(), T0);
    assert.ok(D.readProjectDraft(1, T0 + 6 * 86400000));
    assert.equal(D.readProjectDraft(1, T0 + 7 * 86400000), null, 'ครบ 7 วัน (หน่วยความจำ)');
    const R = await fresh();
    assert.equal(R.readProjectDraft(1, T0 + 7 * 86400000), null, 'ครบ 7 วัน (localStorage)');
    assert.equal(LS.has('kol:project-draft:1'), false, 'ร่างหมดอายุถูกลบทิ้ง');
    const put = v => LS.set('kol:project-draft:1', typeof v === 'string' ? v : JSON.stringify(v));
    const ok = { v: 1, at: T0, form: { name: 'x' }, adGroups: [], productBriefs: {}, files: [] };
    for (const bad of ['{ไม่ใช่ json', 'null', '[]', { ...ok, v: 2 }, { ...ok, at: 'x' }, { ...ok, form: null }, { ...ok, adGroups: {} }, { ...ok, adGroups: [null] }]) {
        put(bad);
        const S = await fresh();
        assert.equal(S.readProjectDraft(1, T0), null, JSON.stringify(bad));
    }
    put({ ...ok, productBriefs: 'x', files: ['เก่า.pdf', { name: 'ไม่มีช่อง' }] });
    const S = await fresh();
    const d = S.readProjectDraft(1, T0);
    assert.deepEqual([d.productBriefs, d.lostFiles], [{}, []], 'ช่องเสริมเสีย = ใช้ค่าว่าง');
});

test('localStorage ใช้ไม่ได้ (โหมดส่วนตัว / เต็ม): ไม่ throw · ยังจำในหน่วยความจำ (ปิดแล้วเปิดใหม่ยังได้)', () => {
    lsBroken = true;
    assert.doesNotThrow(() => D.saveProjectDraft(1, filled(), T0));
    assert.equal(D.readProjectDraft(1, T0).form.name, 'KOL พ.ย.');
    assert.doesNotThrow(() => D.clearProjectDraft(1));
    assert.equal(D.readProjectDraft(1, T0), null);
});
