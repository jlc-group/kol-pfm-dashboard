const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// คนตรวจคลิป + งานของคนตรวจ (27 ต.ค. 2026) — ตรรกะล้วน ฝั่ง server (CJS) และหน้าเว็บ (ESM) ต้องตอบเหมือนกันทุกกรณี
const S = require('../server/src/data/reviewers');
let C;
before(async () => { C = await import(pathToFileURL(path.join(__dirname, '../client/src/data/reviewers.js')).href); });

const ASSIGN = { default: 7, groups: { g1: 3, gone: 9, bad: 'x' } };
const KEYS = new Set(['g1', 'g2']);

test('คนตรวจ 3 ชั้น: รายคลิป ทับ รายกลุ่ม ทับ ทั้งแคมเปญ · กลุ่มที่ถูกลบไม่นับ · ไม่ตั้งเลย = ยังไม่มีคนตรวจ', () => {
    assert.deepEqual(S.reviewerOf({ reviewer_id: 5, group_key: 'g1' }, ASSIGN, KEYS), { id: 5, from: 'clip' });
    assert.deepEqual(S.reviewerOf({ group_key: 'g1' }, ASSIGN, KEYS), { id: 3, from: 'group' });
    assert.deepEqual(S.reviewerOf({ group_key: 'g2' }, ASSIGN, KEYS), { id: 7, from: 'campaign' }, 'กลุ่มที่ไม่ได้ตั้ง = ตามแคมเปญ');
    assert.deepEqual(S.reviewerOf({ group_key: 'gone' }, ASSIGN, KEYS), { id: 7, from: 'campaign' }, 'กลุ่มที่ถูกลบไปแล้ว = ตามแคมเปญ');
    assert.deepEqual(S.reviewerOf({ group_key: 'g1' }, {}, KEYS), { id: null, from: null });
    assert.deepEqual(S.reviewerOf({ reviewer_id: '0', group_key: null }, null, KEYS), { id: null, from: null });
    assert.deepEqual(S.normalizeAssign({ default: 'abc', groups: [] }), { default: null, groups: {} });
    assert.deepEqual(S.normalizeAssign(ASSIGN), { default: 7, groups: { g1: 3, gone: 9 } }, 'ค่าเพี้ยนทิ้ง');
});

test('งานของคลิปในมุมคนตรวจ: ลงงานแล้ว > Approve > ยังไม่ส่งดราฟ > ขอแก้ไข / รอตรวจ · ดราฟล่าสุดเป็นดราฟที่เท่าไหร่', () => {
    assert.equal(S.reviewBucket({ post_url: 'https://x', draft_status: 'revise', draft_link: 'a' }), 'posted');
    assert.equal(S.reviewBucket({ draft_status: 'approve' }), 'approved');
    assert.equal(S.reviewBucket({ draft_link: '  ' }), 'todo');
    assert.equal(S.reviewBucket({ draft_link: 'a', draft_status: 'revise' }), 'revise');
    assert.equal(S.reviewBucket({ draft_link3: 'c', draft_status: null }), 'review');
    assert.equal(S.reviewBucket(null), 'todo');
    assert.equal(S.latestDraftNo({ draft_link: 'a', draft_link2: 'b' }), 2);
    assert.equal(S.latestDraftNo({ draft_link4: 'd' }), 4);
    assert.equal(S.latestDraftNo({}), 0);
});

test('server กับหน้าเว็บตอบเหมือนกันทุกกรณี (สุ่ม 400 แถว)', () => {
    const pick = (arr, i) => arr[i % arr.length];
    const assigns = [ASSIGN, {}, null, { default: 2 }, { groups: { g2: 4 } }, { default: '3', groups: { g1: '0' } }];
    for (let i = 0; i < 400; i++) {
        const sub = {
            reviewer_id: pick([null, 5, '6', 0, 'x'], i),
            group_key: pick(['g1', 'g2', 'gone', null], i * 7),
            draft_link: pick(['', 'a', null], i * 3), draft_link2: pick([null, 'b'], i * 5), draft_link5: pick([null, ' ', 'e'], i * 11),
            draft_status: pick([null, 'approve', 'revise', ''], i * 13),
            post_url: pick([null, '', 'https://p'], i * 17)
        };
        const a = pick(assigns, i * 19);
        const keys = pick([KEYS, null, new Set()], i * 23);
        assert.deepEqual(C.reviewerOf(sub, a, keys), S.reviewerOf(sub, a, keys), JSON.stringify({ sub, a }));
        assert.equal(C.reviewBucket(sub), S.reviewBucket(sub));
        assert.equal(C.latestDraftNo(sub), S.latestDraftNo(sub));
        assert.deepEqual(C.normalizeAssign(a), S.normalizeAssign(a));
    }
});

test('รอมานานแค่ไหน: ไม่ถึงชั่วโมง / ชั่วโมง / 1-2 วัน ส้ม / เกิน 2 วัน แดง', () => {
    const now = Date.parse('2026-10-27T12:00:00Z');
    assert.deepEqual(C.waitedText('2026-10-27T11:30:00Z', now), { text: 'ไม่ถึงชั่วโมง', level: '' });
    assert.deepEqual(C.waitedText('2026-10-27T07:00:00Z', now), { text: '5 ชม.', level: '' });
    assert.deepEqual(C.waitedText('2026-10-26T10:00:00Z', now), { text: '1 วัน', level: 'warn' });
    assert.deepEqual(C.waitedText('2026-10-25T10:00:00Z', now), { text: '2 วัน', level: 'warn' });
    assert.deepEqual(C.waitedText('2026-10-24T10:00:00Z', now), { text: '3 วัน', level: 'bad' });
    assert.deepEqual(C.waitedText(null, now), { text: '—', level: '' });
});
