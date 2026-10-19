const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ป้าย KOL PFM ของ WeBoostX หน้า Ads (19 ต.ค. 2026) + path รูปปก IG / FB ที่หน้าเว็บยอมโหลด — ตรรกะล้วน
let web, thumb;
before(async () => {
    web = await import(pathToFileURL(path.join(__dirname, '../client/src/data/wxPfm.js')).href);
    thumb = await import(pathToFileURL(path.join(__dirname, '../client/src/data/postThumb.js')).href);
});

test('wxPfmBadge: "เกรด · คะแนน" ตามที่ WeBoostX ส่ง · สีตามเกรด', () => {
    assert.deepEqual(web.wxPfmBadge(7.7, 'A'), { text: 'A · 7.7', grade: 'A', cls: 'a' });
    assert.deepEqual(web.wxPfmBadge('8.40', 'S'), { text: 'S · 8.4', grade: 'S', cls: 's' }, 'ค่าจากฐานเป็นสตริงก็ได้');
    assert.equal(web.wxPfmBadge(7.73, 'A').text, 'A · 7.73');
    assert.equal(web.wxPfmBadge(5, 'B').text, 'B · 5');
    assert.equal(web.wxPfmBadge(0, 'D').text, 'D · 0');
    assert.equal(web.wxPfmBadge(10, 'S').text, 'S · 10');
    // เกรดใช้ตามที่ส่งมา ไม่คิดเองจากคะแนน (7.996 → pfm 8.0 แต่เกรด A)
    assert.deepEqual(web.wxPfmBadge(8, 'A'), { text: 'A · 8', grade: 'A', cls: 'a' });
    for (const g of ['S', 'A', 'B', 'C', 'D']) assert.equal(web.wxPfmBadge(5, g).cls, g.toLowerCase());
});

test('wxPfmBadge: ยังไม่มีคะแนน / ค่าแปลก = "—"', () => {
    for (const [p, g] of [[null, null], [undefined, undefined], [null, 'A'], [7, null], ['', 'A'], ['abc', 'A'], [11, 'S'], [-1, 'D'], [5, 'E'], [5, '']]) {
        assert.deepEqual(web.wxPfmBadge(p, g), { text: '—', grade: null, cls: 'none' }, `${p} ${g}`);
    }
});

test('isWxPlatform: เฉพาะ Instagram / Facebook (ผู้ใช้เลือก — TikTok ไม่ขึ้นป้าย)', () => {
    for (const p of ['Instagram', 'instagram', 'Facebook', 'FACEBOOK']) assert.equal(web.isWxPlatform(p), true, p);
    for (const p of ['TikTok', 'YouTube', '', null, undefined]) assert.equal(web.isWxPlatform(p), false, String(p));
});

test('tooltip ตามข้อความที่กำหนด', () => {
    assert.equal(web.WX_PFM_TITLE, 'KOL PFM (WeBoostX): engagement จากแอดต่อ 1,000 impressions เทียบโพสต์ KOL ของแบรนด์และแพลตฟอร์มเดียวกัน — ไม่ใช่ตัวบอกว่าแอดถูกหรือแพง');
});

test('okThumbPath: path รูปปก IG / FB (?v=wx…) ผ่าน · path ของ WeBoostX / ลิงก์ภายนอกไม่ผ่าน', () => {
    assert.equal(thumb.okThumbPath('/ads/11/thumb?v=wx0123456789abcdef'), true);
    for (const p of ['/api/v1/integrations/kol-pfm/thumbnail/4321', 'http://127.0.0.1:8201/api/v1/integrations/kol-pfm/thumbnail/1',
        'https://weboostx2.wejlc.com/x', '/ads/11/thumb?v=WX01', '/ads/11/thumb?v=wx0123456789abcdef&k=1'])
        assert.equal(thumb.okThumbPath(p), false, p);
});
