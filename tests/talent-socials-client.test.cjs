const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ช่องทาง Social หลายช่องของคนใน Talent Book (1 ต.ค. 2026) — ตรรกะฝั่งหน้าเว็บ (client/src/data/talentSocials.js)
// ส่วนที่เป็นสำเนาของ server/src/data/talentSocials.js ต้องให้ผลตรงกันทุกตัว (หน้าเว็บโชว์/เทียบแบบเดียวกับที่ server เก็บ)
// + ตัวช่วยของฟอร์ม/การ์ด: วางลิงก์แล้วเลือกช่องทาง+ชื่อช่องให้ · แถวรุ่นเก่า (link ช่องเดียว) ไม่หาย · ป้าย/ค้นหา · ดึงรูปได้ไหม
const server = require(path.join(__dirname, '../server/src/data/talentSocials'));
let c;
before(async () => {
    c = await import(pathToFileURL(path.join(__dirname, '../client/src/data/talentSocials.js')).href);
});

// ลิงก์/ข้อความหลายแบบที่ทีมวางจริง (โปรไฟล์ / คลิป / ลิงก์ย่อ / ไม่มี https / ตัวพิมพ์ใหญ่ / เข้ารหัส / ลิงก์อันตราย)
const INPUTS = [
    'https://www.tiktok.com/@aom_chr', 'https://www.tiktok.com/@aom_chr?is_from_webapp=1&sender_device=pc',
    'https://www.tiktok.com/@aom_chr/video/7400000000000000000', 'https://vt.tiktok.com/ZSabc123/', 'tiktok.com/@nong.a',
    'https://m.tiktok.com/@Mixed.Case', 'https://www.tiktok.com/@%E0%B8%99%E0%B9%89%E0%B8%AD%E0%B8%87',
    'https://www.instagram.com/baitoey/', 'https://instagram.com/p/Cabc123/', 'https://www.instagram.com/stories/baitoey/123/',
    'https://www.instagram.com/reel/xyz/?igsh=abc', 'https://instagr.am/someone',
    'https://www.facebook.com/nongaofficial', 'https://www.facebook.com/profile.php?id=1000123', 'https://fb.watch/abc/',
    'https://m.facebook.com/people/Some-Name/1000/', 'https://www.youtube.com/@YouTube', 'https://www.youtube.com/c/SomeChannel',
    'https://www.youtube.com/channel/UCabcdef', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=abc',
    'https://x.com/nong_a', 'https://twitter.com/nong_a/status/1', 'https://x.com/i/flow/login', 'https://x.com/home',
    'https://www.lemon8-app.com/@lemon.girl?region=th', 'https://example.com/portfolio', 'http://example.com',
    'javascript:alert(1)', 'data:text/html,hi', 'ftp://tiktok.com/@a', '@aom_chr', 'IG @baitoey', 'baitoey',
    '', '   ', 'https://exa mple.com', 'example.com/x', 'https://user:pw@tiktok.com/@a',
    // หน้าที่ไม่ใช่หน้าช่อง (ดึงรูปโปรไฟล์ไม่ได้) / หน้าช่องแบบอื่น
    'https://www.youtube.com/shorts/abc123', 'https://www.youtube.com/results?search_query=a', 'https://www.youtube.com/playlist?list=PL1',
    'https://www.youtube.com/user/OldName', 'http://www.youtube.com/c/Old', 'https://www.youtube.com/', 'https://x.com/i/status/123',
    'https://twitter.com/search?q=a', 'https://www.tiktok.com/tag/skincare', 'https://www.tiktok.com/music/song-1', 'https://www.tiktok.com/',
    'https://www.tiktok.com:8443/@a', 'https://m.youtube.com/@abc',
    // ข้อความ Account แบบเก่ายาวเกิน 100 ตัว / หลายบรรทัด / ช่องว่างซ้อน (ต้องไม่ถูกตัด)
    'IG: daokao_official / TikTok: @daokao.th / FB: Dao Kao Official Page / LINE: @daokao / โทร 081-234-5678 ติดต่อผ่านพี่นก',
    'https://www.tiktok.com/@dao_tt\nhttps://www.instagram.com/dao.ig\nผู้จัดการ: พี่นก  081-234-5678',
    'x'.repeat(150), 'ก'.repeat(1001), '@' + 'a'.repeat(120), '  LINE OA:   @aom  '
];

test('ค่าคงที่ฝั่งหน้าเว็บตรงกับ server', () => {
    for (const k of ['SOCIAL_PLATFORMS', 'SOCIAL_OTHER', 'AVATAR_PLATFORMS', 'SOCIALS_MAX', 'SOCIAL_HANDLE_MAX', 'SOCIAL_URL_MAX', 'SOCIAL_OTHER_MAX']) {
        assert.deepEqual(c[k], server[k], k);
    }
    assert.deepEqual(c.SOCIAL_PLATFORMS, ['TikTok', 'Instagram', 'Facebook', 'YouTube', 'X', 'Lemon8', 'อื่น ๆ']);
    // ทุกช่องทางมีป้ายสั้นบนการ์ด
    for (const p of c.SOCIAL_PLATFORMS) assert.ok(c.SOCIAL_SHORT[p], p);
});

test('ฟังก์ชันที่ก๊อปจาก server ให้ผลตรงกันทุกตัว (ลิงก์ / ข้อความหลายแบบ)', () => {
    for (const s of INPUTS) {
        assert.deepEqual(c.detectSocial(s), server.detectSocial(s), 'detectSocial ' + s);
        assert.deepEqual(c.socialFromLink(s), server.socialFromLink(s), 'socialFromLink ' + s);
        for (const p of [...c.SOCIAL_PLATFORMS, '', 'Myspace']) {
            assert.equal(c.profileUrl(p, s), server.profileUrl(p, s), `profileUrl ${p} ${s}`);
            const item = { platform: p, handle: s, url: '' };
            assert.deepEqual(c.normalizeSocial(item), server.normalizeSocial(item), `normalizeSocial handle ${p} ${s}`);
            const item2 = { platform: p, handle: '', url: s };
            assert.deepEqual(c.normalizeSocial(item2), server.normalizeSocial(item2), `normalizeSocial url ${p} ${s}`);
            // หน้าโปรไฟล์ที่ดึงรูปได้ (ฟอร์มเลือกลิงก์ที่ส่ง = server เลือกตอนดึงเอง)
            assert.equal(c.isProfilePage(p, s), server.isProfilePage(p, s), `isProfilePage ${p} ${s}`);
            for (const it of [item, item2, { platform: p, handle: 'aom', url: s }]) {
                assert.equal(c.avatarPage(it), server.avatarPage(it), `avatarPage ${JSON.stringify(it).slice(0, 80)}`);
                const n = server.normalizeSocial(it);
                if (n) assert.equal(c.avatarPage(n), server.avatarPage(n), `avatarPage normalized ${JSON.stringify(n).slice(0, 80)}`);
            }
            assert.equal(c.socialHandleMax(p), server.socialHandleMax(p), `socialHandleMax ${p}`);
        }
    }
    const lists = [
        [], null, 'x', [null, 1, 'a', []],
        INPUTS.map(url => ({ platform: '', handle: '', url })),
        [{ platform: 'TikTok', handle: '@aom', url: '' }, { platform: 'TikTok', handle: 'aom', url: 'https://www.tiktok.com/@aom' }],
        [{ platform: 'Myspace', handle: 'a', url: '' }], [{ platform: 'X', handle: 'a'.repeat(101), url: '' }],
        [{ platform: 'X', handle: '', url: 'https://x.com/' + 'a'.repeat(1000) }], [{ platform: 'TikTok', handle: '', url: 'notalink' }],
        Array.from({ length: 12 }, (_, i) => ({ platform: 'TikTok', handle: 'kol' + i, url: '' })),
        // ช่อง "อื่น ๆ" ยาวได้ 1000 ตัว (เกิน = error) · ช่องทางอื่นยังจำกัด 100 · ไม่เลือกช่องทาง + ไม่มีลิงก์ = "อื่น ๆ"
        [{ platform: 'อื่น ๆ', handle: 'a'.repeat(150), url: '' }], [{ platform: 'อื่น ๆ', handle: 'a'.repeat(1001), url: '' }],
        [{ platform: '', handle: 'ข้อความยาว '.repeat(20), url: '' }], [{ platform: 'TikTok', handle: 'a'.repeat(150), url: '' }],
        [{ platform: 'อื่น ๆ', handle: 'บรรทัด 1\nบรรทัด 2\n\nบรรทัด  4', url: '' }],
        [{ platform: 'อื่น ๆ', handle: 'x'.repeat(500), url: 'https://linktr.ee/a' }],
        [{ platform: 'อื่น ๆ', handle: 'x'.repeat(500), url: 'https://www.tiktok.com/@a' }]
    ];
    for (const l of lists) {
        assert.deepEqual(c.normalizeSocials(l, 'https://instagram.com/legacy'), server.normalizeSocials(l, 'https://instagram.com/legacy'));
        assert.deepEqual(c.normalizeSocials(l), server.normalizeSocials(l));
        assert.deepEqual(c.validateSocials(l), server.validateSocials(l), 'validateSocials ' + JSON.stringify(l).slice(0, 80));
        const ok = Array.isArray(l) ? c.normalizeSocials(l) : [];
        assert.deepEqual(c.linkFromSocials(ok), server.linkFromSocials(ok));
        ok.forEach(s => assert.equal(c.socialHandleText(s), server.socialHandleText(s)));
    }
});

test('วางลิงก์โปรไฟล์ → ช่องทาง + ชื่อช่อง (ตัวอย่างของผู้ใช้ + ลิงก์คลิปกลายเป็นลิงก์ช่อง)', () => {
    assert.deepEqual(c.detectSocial('https://www.tiktok.com/@aom_chr'), { platform: 'TikTok', handle: 'aom_chr', url: 'https://www.tiktok.com/@aom_chr' });
    assert.deepEqual(c.detectSocial('https://www.tiktok.com/@aom_chr/video/123?lang=th'), { platform: 'TikTok', handle: 'aom_chr', url: 'https://www.tiktok.com/@aom_chr' });
    assert.deepEqual(c.detectSocial('tiktok.com/@nong.a'), { platform: 'TikTok', handle: 'nong.a', url: 'https://www.tiktok.com/@nong.a' });
    assert.equal(c.detectSocial('https://vt.tiktok.com/ZSabc/').handle, '', 'ลิงก์ย่อไม่รู้ชื่อช่อง');
    assert.deepEqual(c.detectSocial('https://www.instagram.com/baitoey/?igsh=x'), { platform: 'Instagram', handle: 'baitoey', url: 'https://www.instagram.com/baitoey' });
    assert.equal(c.detectSocial('https://www.instagram.com/p/Cabc/').handle, '', 'ลิงก์โพสต์ไม่ใช่ชื่อช่อง');
    assert.equal(c.detectSocial('https://www.facebook.com/profile.php?id=1').handle, '');
    assert.deepEqual(c.detectSocial('https://www.youtube.com/@YouTube'), { platform: 'YouTube', handle: 'YouTube', url: 'https://www.youtube.com/@YouTube' });
    assert.equal(c.detectSocial('https://twitter.com/nong_a/status/1').platform, 'X');
    assert.equal(c.detectSocial('https://twitter.com/nong_a/status/1').handle, 'nong_a');
    assert.equal(c.detectSocial('https://x.com/i/flow/login').handle, '');
    assert.equal(c.detectSocial('https://www.lemon8-app.com/@lemon.girl').platform, 'Lemon8');
    assert.deepEqual(c.detectSocial('https://example.com/portfolio'), { platform: 'อื่น ๆ', handle: '', url: 'https://example.com/portfolio' });
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '@aom_chr', 'baitoey', 'example.com/x', '']) {
        assert.equal(c.detectSocial(bad), null, bad);
    }
});

test('แถวรุ่นเก่า (link ช่องเดียว) แสดงเป็น 1 ช่องทาง — ไม่หาย · มี socials แล้วไม่ใช้ link', () => {
    assert.deepEqual(c.normalizeSocials([], 'https://instagram.com/baitoey'),
        [{ platform: 'Instagram', handle: 'baitoey', url: 'https://www.instagram.com/baitoey' }]);
    assert.deepEqual(c.normalizeSocials(null, 'IG @baitoey'), [{ platform: 'อื่น ๆ', handle: 'IG @baitoey', url: '' }], 'ข้อความเฉย ๆ เก็บทั้งก้อน');
    assert.deepEqual(c.normalizeSocials(undefined, ''), []);
    assert.deepEqual(c.normalizeSocials([{ platform: 'TikTok', handle: 'a', url: '' }], 'https://instagram.com/old'),
        [{ platform: 'TikTok', handle: 'a', url: 'https://www.tiktok.com/@a' }]);
    // ชื่อที่โชว์: แพลตฟอร์ม Social เติม @ · "อื่น ๆ" ตามที่พิมพ์
    assert.equal(c.socialHandleText({ platform: 'TikTok', handle: 'aom' }), '@aom');
    assert.equal(c.socialHandleText({ platform: 'อื่น ๆ', handle: 'IG @baitoey' }), 'IG @baitoey');
    assert.equal(c.socialLabel({ platform: 'อื่น ๆ', handle: '', url: 'https://www.example.com/me/x' }), 'example.com/me');
    assert.equal(c.socialLabel({ platform: 'TikTok', handle: '', url: 'https://vt.tiktok.com/ZS1/' }), 'vt.tiktok.com/ZS1');
    assert.equal(c.socialLabel({ platform: 'Facebook', handle: '', url: '' }), 'Facebook');
    // ลิงก์ที่เขียนลงช่อง link เดิม = ลิงก์ช่องทางแรก
    assert.equal(c.linkFromSocials([{ platform: 'อื่น ๆ', handle: 'x', url: '' }, { platform: 'X', handle: 'a', url: 'https://x.com/a' }]), 'https://x.com/a');
    assert.equal(c.linkFromSocials([]), null);
});

test('ค้นหา / ดึงรูปได้ไหม', () => {
    const s = c.normalizeSocials([{ url: 'https://www.tiktok.com/@aom_chr' }, { url: 'https://www.instagram.com/baitoey' }]);
    const hay = c.socialsSearchText(s);
    for (const w of ['@aom_chr', 'aom_chr', 'TikTok', 'IG', 'Instagram', 'https://www.instagram.com/baitoey']) assert.ok(hay.includes(w), w);
    assert.equal(c.socialsSearchText(null), '');
    assert.equal(c.canFetchAvatar(s), true);
    assert.equal(c.onlyNoAvatarLinks(s), false);
    const ig = c.normalizeSocials([{ url: 'https://www.instagram.com/baitoey' }, { url: 'https://www.facebook.com/nong' }]);
    assert.equal(c.canFetchAvatar(ig), false);
    assert.equal(c.onlyNoAvatarLinks(ig), true, 'มีแต่ IG / FB = บอกให้วางรูปเอง');
    assert.equal(c.onlyNoAvatarLinks(c.normalizeSocials([{ url: 'https://example.com/a' }])), false);
    for (const u of ['https://www.youtube.com/@YouTube', 'https://x.com/nong', 'https://twitter.com/nong']) {
        assert.equal(c.canFetchAvatar(c.normalizeSocials([{ url: u }])), true, u);
    }
    // ลิงก์เว็บอื่นไม่ถูกส่งไปดึงเด็ดขาด — เลือก TikTok + พิมพ์ชื่อช่องไว้ = ประกอบหน้าโปรไฟล์ TikTok จากชื่อ (แบบเดียวกับที่ server ดึงเอง)
    assert.equal(c.canFetchAvatar([{ platform: 'TikTok', handle: '', url: 'https://evil.example/@a' }]), false);
    assert.equal(c.avatarSource([{ platform: 'TikTok', handle: 'a', url: 'https://evil.example/@a' }]), 'https://www.tiktok.com/@a');
    assert.equal(c.canFetchAvatar(null), false);
    assert.equal(c.avatarSource(null), '');
});

test('ปุ่ม "ดึงรูปจากลิงก์": เฉพาะหน้าช่องจริง (ลิงก์คลิป / Shorts / โพสต์ X / แท็ก-เพลง TikTok ไม่โชว์ปุ่ม) · ส่งลิงก์ที่ server ดึงได้จริง', () => {
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/shorts/abc123', 'https://www.youtube.com/playlist?list=PL1',
        'https://x.com/i/status/123', 'https://www.tiktok.com/music/song-1', 'https://www.tiktok.com/tag/a', 'https://vt.tiktok.com/ZS1/', 'https://youtu.be/x']) {
        const list = c.normalizeSocials([{ url: u }]);
        assert.equal(c.canFetchAvatar(list), false, u);
        assert.equal(c.avatarSource(list), '', u);
    }
    // มีแต่ลิงก์ที่ไม่ใช่หน้าช่อง → ฟอร์มบอกว่าแพลตฟอร์มไหน (ให้ใส่ลิงก์หน้าช่อง / ชื่อบัญชี)
    assert.equal(c.notProfilePlatform(c.normalizeSocials([{ url: 'https://www.youtube.com/shorts/abc' }])), 'YouTube');
    assert.equal(c.notProfilePlatform(c.normalizeSocials([{ url: 'https://www.instagram.com/a' }])), '');
    assert.equal(c.notProfilePlatform(c.normalizeSocials([{ url: 'https://www.youtube.com/shorts/abc' }, { url: 'https://x.com/nong' }])), '', 'มีช่องที่ดึงได้ = ไม่ต้องบอก');
    // พิมพ์ชื่อช่องไว้ แต่วางลิงก์คลิป → ส่งหน้าช่องที่ประกอบจากชื่อ (ไม่ส่งลิงก์คลิป)
    const typed = c.socialsForSave([{ platform: 'YouTube', handle: 'aom', url: 'https://www.youtube.com/watch?v=x' }]);
    assert.equal(c.avatarSource(typed), 'https://www.youtube.com/@aom');
    assert.equal(c.notProfilePlatform(typed), '');
    // เลือก TikTok แต่วางลิงก์เว็บอื่น (linktr.ee) + มีช่อง YouTube จริงอีกแถว → ส่ง YouTube (ไม่ส่ง linktr.ee ที่ server ตีกลับ)
    const rows = [{ platform: 'TikTok', handle: '', url: 'https://linktr.ee/aom', autoHandle: '' },
        { platform: '', handle: '', url: 'https://www.youtube.com/@abc', autoHandle: '' }];
    const form = c.socialsForSave(rows);
    assert.equal(form[0].platform, 'TikTok', 'ช่องทางที่เลือกไว้ยังเป็น TikTok');
    assert.equal(c.avatarSource(form), 'https://www.youtube.com/@abc');
    assert.equal(c.avatarSource(form), server.normalizeSocials(form).map(server.avatarPage).find(Boolean), 'เลือกแบบเดียวกับ server');
    // หน้าช่องแบบ /channel/UC… /c/ /user/ ส่งตามเดิม · http:// ส่งเป็น https://
    assert.equal(c.avatarSource(c.normalizeSocials([{ url: 'https://www.youtube.com/channel/UCabc' }])), 'https://www.youtube.com/channel/UCabc');
    assert.equal(c.avatarSource(c.normalizeSocials([{ url: 'http://www.youtube.com/c/Old' }])), 'https://www.youtube.com/c/Old');
    assert.equal(c.avatarSource(c.normalizeSocials([{ url: 'https://twitter.com/nong/status/1' }])), 'https://x.com/nong');
});

test('ข้อความ Account แบบเก่ายาวเกิน 100 ตัว / หลายบรรทัด: โหลดเข้าฟอร์มแล้วบันทึกกลับ link ได้ตรงทุกตัวอักษร · ช่อง "อื่น ๆ" ยาวได้ 1000', () => {
    for (const legacy of [
        'IG: daokao_official / TikTok: @daokao.th / FB: Dao Kao Official Page / LINE: @daokao / โทร 081-234-5678 ติดต่อผ่านพี่นก',
        'https://www.tiktok.com/@dao_tt\nhttps://www.instagram.com/dao.ig\nผู้จัดการ: พี่นก  081-234-5678\nรับงานรีวิวสกินแคร์ / เครื่องสำอาง',
        'ช่องทาง: ' + 'ก'.repeat(500) + '   จบ'
    ]) {
        assert.ok(legacy.length > 100);
        const shown = c.normalizeSocials([], legacy);
        assert.deepEqual(shown, [{ platform: 'อื่น ๆ', handle: legacy, url: '' }], 'ไม่ตัด ไม่ยุบบรรทัด');
        assert.deepEqual(server.normalizeSocials([], legacy), shown);
        const formRows = c.socialRowsOf(shown);
        assert.equal(c.socialRowError(formRows[0]), '', 'ฟอร์มไม่ฟ้องยาวเกิน');
        const sent = c.socialsForSave(formRows);
        assert.equal(c.linkFromSocials(sent), legacy, 'link ที่ส่ง = ข้อความเดิม');
        const v = server.validateSocials(sent);
        assert.deepEqual(v, { socials: shown }, 'server รับและเก็บแบบเดียวกัน');
        assert.equal(server.linkFromSocials(v.socials), legacy);
    }
    assert.equal(c.socialHandleMax('อื่น ๆ'), 1000);
    assert.equal(c.socialHandleMax('TikTok'), 100);
    assert.equal(c.socialHandleMax(''), 100);
    assert.equal(c.socialRowError({ platform: 'อื่น ๆ', handle: 'a'.repeat(1000), url: '' }), '');
    assert.match(c.socialRowError({ platform: 'อื่น ๆ', handle: 'a'.repeat(1001), url: '' }), /ยาวเกิน 1000/);
    assert.match(c.socialRowError({ platform: 'Instagram', handle: 'a'.repeat(101), url: '' }), /ยาวเกิน 100/);
    // วางลิงก์ TikTok ในแถว "อื่น ๆ" = กลายเป็น TikTok → ชื่อช่องจำกัด 100 (ตรงกับ server)
    assert.match(c.socialRowError({ platform: 'อื่น ๆ', handle: 'a'.repeat(150), url: 'https://www.tiktok.com/@a' }), /ยาวเกิน 100/);
    assert.match(server.validateSocials([{ platform: 'อื่น ๆ', handle: 'a'.repeat(150), url: 'https://www.tiktok.com/@a' }]).error, /ยาวเกิน 100/);
});

test('ฟอร์ม: พิมพ์/วางลิงก์ → เลือกช่องทาง + ใส่ชื่อช่องให้ · ไม่ทับชื่อที่พิมพ์เอง', () => {
    let r = c.emptySocialRow();
    assert.deepEqual(r, { platform: '', handle: '', url: '', autoHandle: '' });
    r = c.fillFromUrl(r, 'https://www.tiktok.com/@aom_chr');
    assert.deepEqual([r.platform, r.handle, r.url], ['TikTok', 'aom_chr', 'https://www.tiktok.com/@aom_chr']);
    // แก้ลิงก์ต่อ (ยังไม่ได้พิมพ์ชื่อเอง) → ชื่อช่องตามลิงก์ใหม่
    r = c.fillFromUrl(r, 'https://www.tiktok.com/@aom_new');
    assert.equal(r.handle, 'aom_new');
    // ผู้ใช้พิมพ์ชื่อเอง → เปลี่ยนลิงก์แล้วชื่อไม่ถูกทับ
    r = { ...r, handle: 'อ้อม' };
    r = c.fillFromUrl(r, 'https://www.tiktok.com/@other');
    assert.equal(r.handle, 'อ้อม');
    // ลิงก์ของแพลตฟอร์มอื่นชนะช่องทางที่เลือกไว้ (server ก็ตัดสินแบบนี้)
    r = c.fillFromUrl({ ...c.emptySocialRow('TikTok') }, 'https://www.instagram.com/baitoey');
    assert.deepEqual([r.platform, r.handle], ['Instagram', 'baitoey']);
    // เว็บอื่น: เลือกไว้แล้วไม่เปลี่ยน · ยังไม่เลือก = "อื่น ๆ"
    assert.equal(c.fillFromUrl(c.emptySocialRow('YouTube'), 'https://example.com/a').platform, 'YouTube');
    assert.equal(c.fillFromUrl(c.emptySocialRow(), 'https://example.com/a').platform, 'อื่น ๆ');
    // ยังพิมพ์ไม่จบ (ไม่ใช่ลิงก์) = เก็บตามที่พิมพ์ ไม่เดา
    assert.deepEqual(c.fillFromUrl(c.emptySocialRow(), 'https://'), { platform: '', handle: '', url: 'https://', autoHandle: '' });
    // วางลิงก์ในช่องชื่อช่อง → ย้ายไปช่องลิงก์
    const h = c.fillFromHandle(c.emptySocialRow(), 'https://www.tiktok.com/@aom_chr');
    assert.deepEqual([h.platform, h.handle, h.url], ['TikTok', 'aom_chr', 'https://www.tiktok.com/@aom_chr']);
    assert.equal(c.fillFromHandle(c.emptySocialRow(), 'tiktok.com/@nong').url, 'tiktok.com/@nong');
    // ข้อความธรรมดา / โดเมนที่ไม่รู้จักแบบไม่มี https = ชื่อช่อง
    assert.deepEqual(c.fillFromHandle(c.emptySocialRow('Instagram'), 'baitoey.official'),
        { platform: 'Instagram', handle: 'baitoey.official', url: '', autoHandle: '' });
});

test('ฟอร์ม: ตรวจแถว / แถว → socials ที่บันทึก / socials → แถว', () => {
    assert.equal(c.socialRowError(c.emptySocialRow()), '', 'แถวว่าง = ไม่นับ');
    assert.equal(c.socialRowError({ platform: 'TikTok', handle: 'a', url: '' }), '');
    assert.match(c.socialRowError({ platform: '', handle: 'aom', url: '' }), /เลือกช่องทาง/);
    assert.match(c.socialRowError({ platform: 'TikTok', handle: '', url: 'javascript:alert(1)' }), /http/);
    assert.match(c.socialRowError({ platform: 'TikTok', handle: '', url: 'www.example.com' }), /http/);
    assert.equal(c.socialRowError({ platform: '', handle: '', url: 'tiktok.com/@a' }), '', 'โดเมนที่รู้จักไม่ต้องมี https');
    assert.match(c.socialRowError({ platform: 'X', handle: 'a'.repeat(101), url: '' }), /ยาวเกิน/);
    assert.match(c.socialRowError({ platform: 'X', handle: '', url: 'https://x.com/' + 'a'.repeat(1000) }), /ยาวเกิน/);
    // ทุกแถวที่ผ่าน socialRowError ต้องผ่าน validateSocials ของ server ด้วย (ไม่มีกรณีหน้าเว็บผ่าน แต่ server ตีกลับ)
    const rows = [
        { platform: 'TikTok', handle: '', url: 'https://www.tiktok.com/@aom_chr', autoHandle: 'aom_chr' },
        { platform: 'Instagram', handle: '@baitoey', url: '', autoHandle: '' },
        c.emptySocialRow(),
        { platform: 'อื่น ๆ', handle: 'LINE OA: @nong', url: '', autoHandle: '' },
        { platform: 'TikTok', handle: 'aom_chr', url: '', autoHandle: '' }
    ];
    rows.forEach(r => assert.equal(c.socialRowError(r), ''));
    const out = c.socialsForSave(rows);
    assert.deepEqual(out, [
        { platform: 'TikTok', handle: 'aom_chr', url: 'https://www.tiktok.com/@aom_chr' },
        { platform: 'Instagram', handle: 'baitoey', url: 'https://www.instagram.com/baitoey' },
        { platform: 'อื่น ๆ', handle: 'LINE OA: @nong', url: '' }
    ], 'ตัดแถวว่าง + ช่องทางซ้ำ · ไม่มี autoHandle · ประกอบลิงก์จากชื่อช่อง');
    assert.deepEqual(server.validateSocials(rows), { socials: out }, 'server เก็บรูปเดียวกับที่หน้าเว็บเทียบ');
    assert.deepEqual(c.socialRowsOf(out)[0], { platform: 'TikTok', handle: 'aom_chr', url: 'https://www.tiktok.com/@aom_chr', autoHandle: '' });
    assert.deepEqual(c.socialRowsOf(null), []);
    // ลิงก์ทั่วไป (ลิงก์งาน/โพสต์): http/https เท่านั้น
    assert.equal(c.webUrl('https://drive.google.com/x'), 'https://drive.google.com/x');
    assert.equal(c.webUrl('tiktok.com/@a/video/1'), 'https://tiktok.com/@a/video/1');
    assert.equal(c.webUrl('javascript:alert(1)'), '');
    assert.equal(c.webUrl('drive.google.com/x'), '');
});
