const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ป้าย "อัปเดตใหม่" บนการ์ดแคมเปญ (ผู้ใช้สั่ง 2 ต.ค. 2026)
// server (store/logic.js updateLatest) ต้องคิดเวลาล่าสุดแบบเดียวกับหน้าเว็บ (client/src/utils/tabUpdates.js listLatest / processLatest)
// — หน้าแคมเปญเก็บเวลาที่เปิดดูด้วยค่าจากฝั่งหน้าเว็บ การ์ดเทียบด้วยค่าจาก server ถ้าคิดต่างกัน ป้ายจะค้างหรือไม่ขึ้น
const { updateLatest } = require(path.join(__dirname, '../server/src/store/logic'));
const CLIENT = path.join(__dirname, '../client/src/utils/tabUpdates.js');

const SUBS = [
    { status: 'submitted', submitted_at: '2026-10-01T03:00:00.000Z', list_updated_at: '2026-10-01T04:00:00.000Z', work_updated_at: '2026-10-02T09:00:00.000Z' },
    { status: 'confirmed', submitted_at: '2026-09-30T01:00:00.000Z', decided_at: '2026-10-01T05:00:00.000Z', work_updated_at: '2026-10-02T07:00:00.000Z' },
    { status: 'confirmed', submitted_at: '2026-09-30T02:00:00.000Z', list_updated_at: null, work_updated_at: null },
    { status: 'rejected', submitted_at: '2026-10-02T10:00:00.000Z', decided_at: '2026-10-02T11:00:00.000Z', work_updated_at: '2026-10-02T12:00:00.000Z' }
];

test('updateLatest: รายชื่อ = เวลาส่ง/แก้รายชื่อ/คัดเลือกล่าสุดทุกแถว · On Process = งานล่าสุดเฉพาะคนที่คัดเลือกแล้ว · ไม่มี = ค่าว่าง', () => {
    assert.deepEqual(updateLatest(SUBS), { list_latest: '2026-10-02T11:00:00.000Z', process_latest: '2026-10-02T07:00:00.000Z' });
    assert.deepEqual(updateLatest([]), { list_latest: '', process_latest: '' });
    assert.deepEqual(updateLatest(null), { list_latest: '', process_latest: '' });
    assert.deepEqual(updateLatest([{ status: 'confirmed' }]), { list_latest: '', process_latest: '' });
});

test('server ให้ผลตรงกับหน้าเว็บ (listLatest / processLatest) ทุกชุดข้อมูล', async () => {
    const C = await import(pathToFileURL(CLIENT).href);
    const cases = [SUBS, [], SUBS.slice(0, 1), SUBS.slice(1, 3), [{ status: 'confirmed', work_updated_at: '2026-10-02T00:00:00.000Z' }]];
    for (const subs of cases) {
        assert.deepEqual(updateLatest(subs), { list_latest: C.listLatest(subs), process_latest: C.processLatest(subs) }, JSON.stringify(subs).slice(0, 80));
    }
});

test('cardUpdates: ครั้งแรกในเครื่องนี้ไม่เด้งย้อนหลัง · อัปเดตหลังเปิดดู = ป้ายขึ้น · เปิดดูแท็บแล้ว (markSeen) = หาย · localStorage ใช้ไม่ได้ = ไม่พัง', async () => {
    const store = new Map();
    globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
    try {
        const C = await import(pathToFileURL(CLIENT).href);
        const t1 = updateLatest(SUBS);
        assert.deepEqual(C.cardUpdates(7, t1.list_latest, t1.process_latest), { list: false, process: false }, 'ครั้งแรก = ถือว่าเห็นแล้ว');
        assert.deepEqual(C.cardUpdates(7, t1.list_latest, t1.process_latest), { list: false, process: false }, 'ไม่มีอะไรใหม่');
        // เอเจนซี่ส่งดราฟใหม่ให้คนที่คัดเลือกแล้ว
        const subs2 = SUBS.map((s, i) => (i === 1 ? { ...s, work_updated_at: '2026-10-02T13:00:00.000Z' } : s));
        const t2 = updateLatest(subs2);
        assert.deepEqual(C.cardUpdates(7, t2.list_latest, t2.process_latest), { list: false, process: true }, 'On Process มีอัปเดต');
        // หน้าแคมเปญ: เปิดแท็บ On Process (markSeen ด้วยข้อมูลชุดเดียวกัน) → ป้ายบนการ์ดหาย
        C.markSeen(7, 'process', subs2);
        assert.deepEqual(C.cardUpdates(7, t2.list_latest, t2.process_latest), { list: false, process: false });
        // หน้าแคมเปญเปิดก่อนการ์ด (ensureInit ฝั่งนั้น) แล้วมีรายชื่อใหม่เข้ามา
        C.tabBadges(8, SUBS);
        const subs3 = [...SUBS, { status: 'submitted', submitted_at: '2026-10-03T01:00:00.000Z' }];
        const t3 = updateLatest(subs3);
        assert.deepEqual(C.cardUpdates(8, t3.list_latest, t3.process_latest), { list: true, process: false }, 'รายชื่อ KOL มีอัปเดต');
        // server รุ่นก่อน (ยังไม่รีสตาร์ต) ไม่ส่ง list_latest / process_latest → ไม่มีป้าย และไม่ตั้งค่าเริ่มต้นเป็น ''
        // (ไม่งั้นพอ server ใหม่ขึ้น การ์ดนี้จะขึ้น "อัปเดตใหม่" ค้างทั้งที่ไม่มีอะไรใหม่)
        assert.deepEqual(C.cardUpdates(10, undefined, undefined), { list: false, process: false });
        assert.equal(store.has('kolseen:10:init'), false, 'ไม่ตั้งค่าเริ่มต้นตอน server ยังเป็นรุ่นก่อน');
        assert.deepEqual(C.cardUpdates(10, t3.list_latest, t3.process_latest), { list: false, process: false }, 'server ใหม่ขึ้นแล้ว = ครั้งแรกจริง ไม่เด้ง');
        assert.equal(store.get('kolseen:10:list'), t3.list_latest);
        // localStorage พัง
        globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
        assert.deepEqual(C.cardUpdates(9, t3.list_latest, t3.process_latest), { list: false, process: false });
    } finally {
        delete globalThis.localStorage;
    }
});
