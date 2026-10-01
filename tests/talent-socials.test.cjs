const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ช่องทาง Social หลายช่องของคนใน Talent Book (ผู้ใช้สั่ง 1 ต.ค. 2026) — server/src/data/talentSocials.js
// วางลิงก์โปรไฟล์ → รู้เองว่าแพลตฟอร์มไหน ชื่อช่องอะไร · แถวเก่าที่มีแค่ link (Account) ต้องไม่หาย
// หน้าเว็บมีสำเนา client/src/data/talentSocials.js — ถ้ามีไฟล์นั้นแล้ว เทสต์ท้ายไฟล์เทียบผลสองฝั่งให้ตรงกันทุกกรณี
const S = require(path.join(__dirname, '../server/src/data/talentSocials.js'));
const { detectSocial, profileUrl, normalizeSocials, validateSocials, linkFromSocials, socialHandleText, SOCIAL_PLATFORMS, SOCIAL_OTHER } = S;

test('รายการแพลตฟอร์มตามที่ผู้ใช้เลือก (ลำดับในฟอร์ม)', () => {
    assert.deepEqual(SOCIAL_PLATFORMS, ['TikTok', 'Instagram', 'Facebook', 'YouTube', 'X', 'Lemon8', 'อื่น ๆ']);
    assert.equal(SOCIAL_OTHER, 'อื่น ๆ');
    assert.deepEqual(S.AVATAR_PLATFORMS, ['TikTok', 'YouTube', 'X']);
});

test('วางลิงก์โปรไฟล์ → แพลตฟอร์ม + ชื่อช่อง + ลิงก์มาตรฐาน', () => {
    const d = raw => detectSocial(raw);
    assert.deepEqual(d('https://www.tiktok.com/@aom_chr'), { platform: 'TikTok', handle: 'aom_chr', url: 'https://www.tiktok.com/@aom_chr' });
    // ตัดพารามิเตอร์ติดตาม / ลิงก์คลิปกลายเป็นลิงก์ช่อง / ไม่มี https:// / ตัวพิมพ์ใหญ่ในโดเมน
    assert.deepEqual(d('https://www.tiktok.com/@aom_chr?is_from_webapp=1&sender_device=pc'), d('https://www.tiktok.com/@aom_chr'));
    assert.deepEqual(d('https://www.tiktok.com/@aom_chr/video/7690488609664748807'), d('https://www.tiktok.com/@aom_chr'));
    assert.deepEqual(d('tiktok.com/@aom_chr'), d('https://www.tiktok.com/@aom_chr'));
    assert.deepEqual(d('https://WWW.TikTok.com/@aom_chr/'), d('https://www.tiktok.com/@aom_chr'));
    assert.deepEqual(d('https://m.tiktok.com/@aom_chr'), d('https://www.tiktok.com/@aom_chr'));
    assert.deepEqual(d('https://www.instagram.com/baitoey/?igsh=abc123'), { platform: 'Instagram', handle: 'baitoey', url: 'https://www.instagram.com/baitoey' });
    assert.deepEqual(d('instagram.com/baitoey'), { platform: 'Instagram', handle: 'baitoey', url: 'https://www.instagram.com/baitoey' });
    assert.deepEqual(d('https://www.instagram.com/stories/baitoey/123/'), { platform: 'Instagram', handle: 'baitoey', url: 'https://www.instagram.com/baitoey' });
    assert.deepEqual(d('https://www.facebook.com/somchai.page'), { platform: 'Facebook', handle: 'somchai.page', url: 'https://www.facebook.com/somchai.page' });
    assert.deepEqual(d('https://www.youtube.com/@YouTube'), { platform: 'YouTube', handle: 'YouTube', url: 'https://www.youtube.com/@YouTube' });
    assert.deepEqual(d('https://x.com/X'), { platform: 'X', handle: 'X', url: 'https://x.com/X' });
    assert.deepEqual(d('https://twitter.com/jack/status/20'), { platform: 'X', handle: 'jack', url: 'https://x.com/jack' });
    assert.deepEqual(d('https://www.lemon8-app.com/@mint.review?region=th'), { platform: 'Lemon8', handle: 'mint.review', url: 'https://www.lemon8-app.com/@mint.review' });
    // ชื่อช่องภาษาไทย (YouTube) — อ่านกลับเป็นตัวอักษร ลิงก์เข้ารหัสแล้ว
    const th = d('https://www.youtube.com/@%E0%B8%AA%E0%B8%A1%E0%B8%8A%E0%B8%B2%E0%B8%A2');
    assert.equal(th.handle, 'สมชาย');
    assert.equal(th.url, 'https://www.youtube.com/@%E0%B8%AA%E0%B8%A1%E0%B8%8A%E0%B8%B2%E0%B8%A2');
});

test('ลิงก์ที่ไม่มีชื่อช่อง: รู้แพลตฟอร์ม แต่เก็บลิงก์เดิม', () => {
    const d = raw => detectSocial(raw);
    assert.deepEqual(d('https://vt.tiktok.com/ZSabc123/'), { platform: 'TikTok', handle: '', url: 'https://vt.tiktok.com/ZSabc123/' });
    assert.deepEqual(d('https://www.instagram.com/p/C9xyz/'), { platform: 'Instagram', handle: '', url: 'https://www.instagram.com/p/C9xyz/' });
    assert.deepEqual(d('https://www.facebook.com/profile.php?id=1000123'), { platform: 'Facebook', handle: '', url: 'https://www.facebook.com/profile.php?id=1000123' });
    assert.deepEqual(d('https://www.youtube.com/channel/UCabc'), { platform: 'YouTube', handle: '', url: 'https://www.youtube.com/channel/UCabc' });
    assert.deepEqual(d('https://youtu.be/dQw4w9WgXcQ'), { platform: 'YouTube', handle: '', url: 'https://youtu.be/dQw4w9WgXcQ' });
    assert.deepEqual(d('https://x.com/i/status/1'), { platform: 'X', handle: '', url: 'https://x.com/i/status/1' });
    // /c/ชื่อ (YouTube แบบเก่า) = ชื่อช่องได้ แต่ประกอบกลับเป็น /@ไม่ได้ → เก็บลิงก์เดิม
    assert.deepEqual(d('https://www.youtube.com/c/OldName'), { platform: 'YouTube', handle: 'OldName', url: 'https://www.youtube.com/c/OldName' });
    // เว็บอื่น = อื่น ๆ
    assert.deepEqual(d('https://linktr.ee/aom'), { platform: 'อื่น ๆ', handle: '', url: 'https://linktr.ee/aom' });
});

test('ไม่ใช่ลิงก์ = null (ชื่อเฉย ๆ / javascript: / โดเมนอื่นที่ไม่มี https://)', () => {
    for (const raw of ['', '   ', null, undefined, 'aom_chr', '@aom_chr', 'IG @baitoey', 'javascript:alert(1)', 'data:text/html,x',
        'ftp://tiktok.com/@a', 'linktr.ee/aom', 'https://', 'https://www.tiktok.com/@a b', {}]) {
        assert.equal(detectSocial(raw), null, String(raw));
    }
});

test('profileUrl: ประกอบลิงก์จากชื่อช่อง (ตัด @ · ชื่อมีช่องว่าง/อื่น ๆ = ประกอบไม่ได้)', () => {
    assert.equal(profileUrl('TikTok', '@aom_chr'), 'https://www.tiktok.com/@aom_chr');
    assert.equal(profileUrl('Instagram', 'baitoey'), 'https://www.instagram.com/baitoey');
    assert.equal(profileUrl('Facebook', 'page.name'), 'https://www.facebook.com/page.name');
    assert.equal(profileUrl('YouTube', 'YouTube'), 'https://www.youtube.com/@YouTube');
    assert.equal(profileUrl('X', '@X'), 'https://x.com/X');
    assert.equal(profileUrl('Lemon8', 'mint'), 'https://www.lemon8-app.com/@mint');
    assert.equal(profileUrl('อื่น ๆ', 'aom'), '');
    assert.equal(profileUrl('TikTok', 'a b'), '');
    assert.equal(profileUrl('TikTok', 'a/../b'), '');
    assert.equal(profileUrl('TikTok', ''), '');
    // ลิงก์ที่ประกอบแล้ว อ่านกลับได้ชื่อเดิม
    for (const p of ['TikTok', 'Instagram', 'Facebook', 'YouTube', 'X', 'Lemon8']) {
        assert.deepEqual(detectSocial(profileUrl(p, 'name.one')), { platform: p, handle: 'name.one', url: profileUrl(p, 'name.one') }, p);
    }
});

test('normalizeSocials: ลิงก์ตัดสินแพลตฟอร์ม · ชื่อที่พิมพ์เองชนะ · มีแต่ชื่อ = ประกอบลิงก์ · ตัดแถวว่าง/ซ้ำ/ลิงก์อันตราย', () => {
    assert.deepEqual(normalizeSocials([
        { platform: 'TikTok', handle: '', url: 'https://www.instagram.com/baitoey' },     // วางลิงก์ IG ในแถว TikTok
        { platform: 'TikTok', handle: '@aom_chr', url: '' },                              // มีแต่ชื่อ
        { platform: 'X', handle: 'ชื่อเล่นที่โชว์', url: 'https://x.com/realname' },      // ชื่อที่พิมพ์เองชนะ
        { platform: 'อื่น ๆ', handle: 'LINE OA: @aom', url: '' },                         // ข้อความล้วน
        { platform: 'Facebook', handle: '', url: 'javascript:alert(1)' },                 // ลิงก์อันตราย + ไม่มีชื่อ = ทิ้ง
        { platform: 'Instagram', handle: '', url: 'instagram.com/baitoey' },              // ซ้ำแถวแรก
        { platform: 'ไม่มีจริง', handle: '', url: 'https://linktr.ee/aom' },               // แพลตฟอร์มแปลก → อื่น ๆ
        null, 'x', { platform: 'TikTok' }
    ]), [
        { platform: 'Instagram', handle: 'baitoey', url: 'https://www.instagram.com/baitoey' },
        { platform: 'TikTok', handle: 'aom_chr', url: 'https://www.tiktok.com/@aom_chr' },
        { platform: 'X', handle: 'ชื่อเล่นที่โชว์', url: 'https://x.com/realname' },
        { platform: 'อื่น ๆ', handle: 'LINE OA: @aom', url: '' },
        { platform: 'อื่น ๆ', handle: '', url: 'https://linktr.ee/aom' }
    ]);
    assert.deepEqual(normalizeSocials('ไม่ใช่รายการ'), []);
    assert.equal(normalizeSocials(Array.from({ length: 15 }, (_, i) => ({ platform: 'TikTok', handle: 'a' + i }))).length, S.SOCIALS_MAX);
});

test('แถวเก่ามีแค่ link (Account): socials ว่าง → แปลง link เป็น 1 ช่องทาง ไม่หาย · มี socials แล้วไม่สน link', () => {
    assert.deepEqual(normalizeSocials([], 'https://instagram.com/baitoey'), [{ platform: 'Instagram', handle: 'baitoey', url: 'https://www.instagram.com/baitoey' }]);
    assert.deepEqual(normalizeSocials(null, 'https://www.tiktok.com/@dao'), [{ platform: 'TikTok', handle: 'dao', url: 'https://www.tiktok.com/@dao' }]);
    // พิมพ์เป็นข้อความเฉย ๆ (ไม่ใช่ลิงก์) — เก็บข้อความไว้ทั้งก้อนเป็น "อื่น ๆ"
    assert.deepEqual(normalizeSocials([], 'IG @baitoey'), [{ platform: 'อื่น ๆ', handle: 'IG @baitoey', url: '' }]);
    assert.deepEqual(normalizeSocials([], 'javascript:alert(1)'), [{ platform: 'อื่น ๆ', handle: 'javascript:alert(1)', url: '' }], 'ข้อความอันตรายไม่กลายเป็นลิงก์');
    assert.deepEqual(normalizeSocials([], ''), []);
    assert.deepEqual(normalizeSocials([], null), []);
    assert.deepEqual(normalizeSocials([{ platform: 'X', handle: 'a', url: '' }], 'https://instagram.com/old'), [{ platform: 'X', handle: 'a', url: 'https://x.com/a' }]);
});

test('validateSocials: ข้อความ error ภาษาไทย · แถวว่างข้าม · เกิน 10 ช่องทางไม่ได้', () => {
    const err = list => validateSocials(list).error;
    assert.equal(err('x'), 'ช่องทาง Social ไม่ถูกต้อง');
    assert.equal(err([1]), 'ช่องทาง Social ไม่ถูกต้อง');
    assert.equal(err([['a']]), 'ช่องทาง Social ไม่ถูกต้อง');
    assert.equal(err([{ platform: 'MySpace', url: 'https://myspace.com/a' }]), 'แพลตฟอร์มไม่ถูกต้อง');
    assert.equal(err([{ platform: 'TikTok', url: 'www.example.com/a' }]), 'ลิงก์ช่องทาง Social ต้องขึ้นต้นด้วย http:// หรือ https://');
    assert.equal(err([{ platform: 'TikTok', url: 'javascript:alert(1)' }]), 'ลิงก์ช่องทาง Social ต้องขึ้นต้นด้วย http:// หรือ https://');
    assert.equal(err([{ platform: 'TikTok', url: 'https://x.com/' + 'a'.repeat(1000) }]), 'ลิงก์ช่องทาง Social ยาวเกิน 1000 ตัวอักษร');
    assert.equal(err([{ platform: 'TikTok', handle: 'a'.repeat(101) }]), 'ชื่อช่องยาวเกิน 100 ตัวอักษร');
    assert.equal(err(Array.from({ length: 11 }, (_, i) => ({ platform: 'TikTok', handle: 'a' + i }))), 'ใส่ช่องทาง Social ได้ไม่เกิน 10 ช่องทาง');
    assert.deepEqual(validateSocials([]), { socials: [] });
    assert.deepEqual(validateSocials([{ platform: 'TikTok', handle: '', url: '' }, { platform: '', handle: ' ', url: ' ' }]), { socials: [] });
    // ไม่เลือกแพลตฟอร์ม + วางลิงก์ = รู้เอง · ซ้ำกันตัดทิ้ง
    assert.deepEqual(validateSocials([
        { platform: '', url: 'https://www.tiktok.com/@aom_chr?lang=th' },
        { platform: 'TikTok', handle: '@aom_chr' }
    ]), { socials: [{ platform: 'TikTok', handle: 'aom_chr', url: 'https://www.tiktok.com/@aom_chr' }] });
});

test('ข้อความ Account แบบเก่า (ช่อง "อื่น ๆ") ยาวได้ 1000 ตัว เก็บตามที่พิมพ์ — ไม่ตัดที่ 100 ไม่ยุบบรรทัด · ช่องทางอื่นยังจำกัด 100', () => {
    const LONG = 'IG: daokao_official / TikTok: @daokao.th / FB: Dao Kao Official Page / LINE: @daokao / โทร 081-234-5678 ติดต่อผ่านพี่นก';
    const MULTI = 'IG: dao.ig\nTikTok:  @dao_tt\n\nผู้จัดการ พี่นก';
    assert.ok(LONG.length > 100);
    assert.deepEqual(normalizeSocials([], LONG), [{ platform: 'อื่น ๆ', handle: LONG, url: '' }]);
    assert.deepEqual(normalizeSocials([], MULTI), [{ platform: 'อื่น ๆ', handle: MULTI, url: '' }]);
    assert.equal(linkFromSocials(normalizeSocials([], LONG)), LONG, 'เขียนกลับลง link ได้ตรงทุกตัวอักษร');
    assert.equal(linkFromSocials(normalizeSocials([], MULTI)), MULTI);
    assert.equal(normalizeSocials([], ' ' + 'ก'.repeat(1200) + ' ')[0].handle.length, 1000, 'เพดาน 1000 เท่าช่อง link เดิม');
    assert.deepEqual(validateSocials([{ platform: 'อื่น ๆ', handle: LONG, url: '' }]), { socials: [{ platform: 'อื่น ๆ', handle: LONG, url: '' }] });
    assert.equal(validateSocials([{ platform: 'อื่น ๆ', handle: 'a'.repeat(1001) }]).error, 'ชื่อช่องยาวเกิน 1000 ตัวอักษร');
    assert.equal(validateSocials([{ platform: '', handle: 'a'.repeat(150) }]).error, undefined, 'ไม่เลือกช่องทาง + ไม่มีลิงก์ = "อื่น ๆ"');
    assert.equal(validateSocials([{ platform: 'Instagram', handle: 'a'.repeat(101) }]).error, 'ชื่อช่องยาวเกิน 100 ตัวอักษร');
    // แพลตฟอร์มที่รู้จักยังยุบช่องว่าง + ตัด @ ตามเดิม
    assert.deepEqual(normalizeSocials([{ platform: 'TikTok', handle: '  @@aom  chr ' }]), [{ platform: 'TikTok', handle: 'aom chr', url: '' }]);
});

test('isProfilePage / avatarPage: ดึงรูปได้เฉพาะหน้าช่องจริงของ TikTok / YouTube / X (https · โดเมนหลัก)', () => {
    const yes = [['TikTok', 'https://www.tiktok.com/@aom_chr'], ['TikTok', 'https://tiktok.com/@a/'], ['TikTok', 'tiktok.com/@a'],
        ['YouTube', 'https://www.youtube.com/@YouTube'], ['YouTube', 'https://m.youtube.com/channel/UCabc_-1'], ['YouTube', 'https://www.youtube.com/c/Old'],
        ['YouTube', 'https://www.youtube.com/user/Old'], ['X', 'https://x.com/nong'], ['X', 'https://twitter.com/nong/']];
    for (const [p, u] of yes) assert.equal(S.isProfilePage(p, u), true, `${p} ${u}`);
    const no = [['TikTok', 'https://www.tiktok.com/@a/video/1'], ['TikTok', 'https://www.tiktok.com/tag/a'], ['TikTok', 'https://www.tiktok.com/music/a-1'],
        ['TikTok', 'https://vt.tiktok.com/ZS1/'], ['TikTok', 'http://www.tiktok.com/@a'], ['TikTok', 'https://www.tiktok.com:8443/@a'],
        ['TikTok', 'https://u:p@www.tiktok.com/@a'], ['TikTok', 'https://www.youtube.com/@a'], ['YouTube', 'https://www.youtube.com/watch?v=x'],
        ['YouTube', 'https://www.youtube.com/shorts/x'], ['YouTube', 'https://www.youtube.com/results?search_query=a'], ['YouTube', 'https://www.youtube.com/channel/abc'],
        ['YouTube', 'https://youtu.be/x'], ['YouTube', 'https://www.youtube.com/'], ['X', 'https://x.com/i/status/1'], ['X', 'https://x.com/nong/status/1'],
        ['X', 'https://x.com/home'], ['X', 'https://x.com/'], ['Instagram', 'https://www.instagram.com/a'], ['อื่น ๆ', 'https://linktr.ee/a'], ['TikTok', ''], ['TikTok', null]];
    for (const [p, u] of no) assert.equal(S.isProfilePage(p, u), false, `${p} ${u}`);
    assert.equal(S.avatarPage({ platform: 'YouTube', handle: 'aom', url: 'https://www.youtube.com/watch?v=x' }), 'https://www.youtube.com/@aom');
    assert.equal(S.avatarPage({ platform: 'YouTube', handle: '', url: 'https://www.youtube.com/watch?v=x' }), '');
    assert.equal(S.avatarPage({ platform: 'Instagram', handle: 'a', url: 'https://www.instagram.com/a' }), '');
    assert.equal(S.avatarPage({ platform: 'X', handle: 'search', url: '' }), '', 'ชื่อที่เป็นหน้าระบบของ X');
    assert.equal(S.avatarPage(null), '');
});

test('linkFromSocials / socialHandleText', () => {
    assert.equal(linkFromSocials([{ platform: 'อื่น ๆ', handle: 'LINE', url: '' }, { platform: 'X', handle: 'a', url: 'https://x.com/a' }]), 'https://x.com/a');
    assert.equal(linkFromSocials([{ platform: 'อื่น ๆ', handle: 'LINE OA', url: '' }]), 'LINE OA');
    assert.equal(linkFromSocials([]), null);
    assert.equal(linkFromSocials(null), null);
    assert.equal(socialHandleText({ platform: 'TikTok', handle: 'aom_chr' }), '@aom_chr');
    assert.equal(socialHandleText({ platform: 'อื่น ๆ', handle: 'LINE OA: @aom' }), 'LINE OA: @aom');
    assert.equal(socialHandleText({ platform: 'YouTube', handle: '' }), '');
    assert.equal(socialHandleText(null), '');
});

// ---------------------------------------------------------------- เทียบกับสำเนาฝั่งหน้าเว็บ
const CLIENT = path.join(__dirname, '../client/src/data/talentSocials.js');
test('หน้าเว็บ (client/src/data/talentSocials.js) ให้ผลตรงกับ server ทุกกรณี', { skip: !fs.existsSync(CLIENT) && 'ยังไม่มีไฟล์ฝั่งหน้าเว็บ' }, async () => {
    const C = await import(pathToFileURL(CLIENT).href);
    for (const k of ['SOCIAL_PLATFORMS', 'SOCIAL_OTHER', 'AVATAR_PLATFORMS', 'SOCIALS_MAX', 'SOCIAL_OTHER_MAX']) assert.deepEqual(C[k], S[k], k);
    const URLS = ['https://www.tiktok.com/@aom_chr?is_from_webapp=1', 'tiktok.com/@aom_chr', 'https://vt.tiktok.com/ZSabc/', 'https://www.instagram.com/baitoey/?igsh=1',
        'https://www.instagram.com/p/C9/', 'https://www.instagram.com/stories/baitoey/1/', 'https://www.facebook.com/profile.php?id=1', 'https://fb.me/page.a',
        'https://www.youtube.com/@YouTube', 'https://www.youtube.com/c/Old', 'https://youtu.be/x', 'https://twitter.com/jack/status/1', 'https://x.com/i/flow',
        'https://www.lemon8-app.com/@mint', 'https://linktr.ee/a', 'IG @baitoey', '@a', 'javascript:alert(1)', '', null,
        'https://www.youtube.com/@%E0%B8%AA', 'https://www.tiktok.com/@a%2Fb'];
    for (const u of URLS) {
        assert.deepEqual(C.detectSocial(u), S.detectSocial(u), `detectSocial ${u}`);
        assert.deepEqual(C.normalizeSocials([], u), S.normalizeSocials([], u), `normalizeSocials legacy ${u}`);
    }
    for (const p of SOCIAL_PLATFORMS) for (const h of ['@a.b', 'สมชาย', 'a b', '']) assert.equal(C.profileUrl(p, h), S.profileUrl(p, h), `${p} ${h}`);
    const LISTS = [
        [{ platform: 'TikTok', url: 'https://www.instagram.com/baitoey' }, { platform: 'TikTok', handle: '@aom' }, { platform: 'อื่น ๆ', handle: 'LINE' }],
        [{ platform: 'MySpace', url: 'https://a.b' }], [{ platform: 'TikTok', url: 'www.example.com' }], 'x', [],
        Array.from({ length: 11 }, (_, i) => ({ platform: 'X', handle: 'h' + i }))
    ];
    for (const l of LISTS) {
        assert.deepEqual(C.validateSocials(l), S.validateSocials(l), JSON.stringify(l));
        assert.deepEqual(C.normalizeSocials(l, 'https://x.com/old'), S.normalizeSocials(l, 'https://x.com/old'), JSON.stringify(l));
        const ok = S.validateSocials(l).socials;
        if (ok) assert.equal(C.linkFromSocials(ok), S.linkFromSocials(ok));
    }
    for (const s of [{ platform: 'TikTok', handle: 'a' }, { platform: 'อื่น ๆ', handle: 'x' }, null]) assert.equal(C.socialHandleText(s), S.socialHandleText(s));
});
