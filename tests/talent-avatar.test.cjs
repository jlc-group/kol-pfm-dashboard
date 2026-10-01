const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// รูปการ์ด Talent Book ดึงจากลิงก์ TikTok / YouTube / X เอง (ผู้ใช้สั่ง 1 ต.ค. 2026) — server/src/services/talentAvatar.js
// ไม่เรียกเว็บจริงเลย: fetch จำลองทั้งหมด (ตัวดึงรับ fetchImpl) · ไม่แตะฐานข้อมูล (setFile จำลอง)
const SRC = path.join(__dirname, '../server/src');
const A = require(path.join(SRC, 'services/talentAvatar'));
const { createTalentAvatars, within, pageFor, safeUrl, tiktokAvatar, ogImage, sniff, PAGE_HOST, IMAGE_HOST, MAX_BYTES } = A;

const made = [];
const tmpDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-talent-avatar-')); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), crypto.randomBytes(300)]);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a40000000049454e44ae426082', 'hex');
const TT_IMG = 'https://p16-common-sign.tiktokcdn.com/tos-maliva-avt-0068/ba67~tplv-tiktokx-cropcenter:1080:1080.jpeg?dr=14579&x-expires=1790000000&x-signature=a%2Fb';
// หน้า TikTok จริงเข้ารหัส / เป็น \u002F ในข้อมูล JSON ของหน้า
const ttEscaped = u => u.replace(/\//g, '\\u002F').replace(/&/g, '\\u0026');
const ttPage = (img = TT_IMG) => `<html><head><title>x</title></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">`
    + `{"user":{"uniqueId":"aom_chr","avatarLarger":"${ttEscaped(img)}","avatarMedium":"https:\\u002F\\u002Fp16-common-sign.tiktokcdn.com\\u002Fmed.jpeg"}}</script></body></html>`;
const YT_IMG = 'https://yt3.googleusercontent.com/3s6evp=s900-c-k-c0x00ffffff-no-rj';
const ytPage = `<html><head><meta name="title" content="YouTube"><meta content="https://yt3.googleusercontent.com/3s6evp=s900-c-k-c0x00ffffff-no-rj&amp;x=1" property="og:image"></head><body>${'x'.repeat(5000)}</body></html>`;
const X_IMG = 'https://pbs.twimg.com/profile_images/1955359038532653056/OSHY3ewP_200x200.jpg';
const xPage = `<html><head><meta property="og:image" content="${X_IMG}" nonce="abc"/><meta name="twitter:image" content="https://pbs.twimg.com/profile_banners/783214/1690175171"/></head></html>`;

const html = (body, extra = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...extra } });
const image = (buf = JPEG, type = 'image/jpeg', extra = {}) => new Response(buf, { status: 200, headers: { 'content-type': type, ...extra } });
const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });

// fetch จำลอง: routes = { url: () => Response } · ไม่มีใน routes = เครือข่ายล่ม (โยน error) — ห้ามหลุดไปเรียกเว็บจริง
function fakeFetch(routes) {
    const calls = [];
    const impl = async (url, opts = {}) => {
        calls.push({ url: String(url), opts });
        const r = routes[String(url)];
        if (!r) throw new TypeError('fetch failed (ไม่มีในข้อมูลจำลอง): ' + url);
        return typeof r === 'function' ? r(opts) : r;
    };
    return { impl, calls };
}
const svc = (fetchImpl, extra = {}) => createTalentAvatars({ dir: tmpDir(), setFile: async () => null, fetchImpl, ...extra });
const TT_PAGE = 'https://www.tiktok.com/@aom_chr';
const YT_PAGE = 'https://www.youtube.com/@YouTube';
const X_PAGE = 'https://x.com/X';
const code = async p => { try { await p; return 'ok'; } catch (e) { return e.code; } };

// ---------------------------------------------------------------- ตรรกะล้วน
test('อ่านลิงก์รูปจากหน้า: TikTok (avatarLarger ถอด \\u002F) · YouTube / X (og:image ถอด &amp; ไม่เอา twitter:image)', () => {
    assert.equal(tiktokAvatar(ttPage()), TT_IMG);
    // avatarLarger เสีย/ไม่มี → avatarMedium
    assert.equal(tiktokAvatar('{"avatarLarger":"\\uZZZZ","avatarMedium":"https:\\u002F\\u002Fa.tiktokcdn.com\\u002Fm.jpg"}'), 'https://a.tiktokcdn.com/m.jpg');
    assert.equal(tiktokAvatar('<html>ไม่มีรูป</html>'), null);
    assert.equal(ogImage(ytPage), YT_IMG + '&x=1');
    assert.equal(ogImage(xPage), X_IMG);
    assert.equal(ogImage(`<meta property='og:image:secure_url' content='https://pbs.twimg.com/a.jpg'>`), 'https://pbs.twimg.com/a.jpg');
    assert.equal(ogImage('<meta name="twitter:image" content="https://pbs.twimg.com/banner">'), null);
    assert.equal(ogImage('<meta property="og:image" content="">'), null);
});

test('หัวไฟล์จริง: JPEG / PNG / WEBP เท่านั้น', () => {
    assert.equal(sniff(JPEG), 'jpg');
    assert.equal(sniff(PNG), 'png');
    assert.equal(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'webp');
    assert.equal(sniff(Buffer.from('GIF89a......')), null);
    assert.equal(sniff(Buffer.from('<html>')), null);
    assert.equal(sniff(Buffer.alloc(0)), null);
});

test('ด่านโดเมน (SSRF): หน้าโปรไฟล์เฉพาะ tiktok / youtube / x / twitter (+www. m.) · รูปเฉพาะ CDN ของแพลตฟอร์มนั้น · https เท่านั้น', () => {
    const okPage = (u, p) => !!safeUrl(u, PAGE_HOST[p]);
    assert.ok(okPage('https://www.tiktok.com/@a', 'TikTok'));
    assert.ok(okPage('https://m.tiktok.com/@a', 'TikTok'));
    assert.ok(okPage('https://tiktok.com/@a', 'TikTok'));
    assert.ok(okPage('https://www.youtube.com/@a', 'YouTube'));
    assert.ok(okPage('https://m.youtube.com/@a', 'YouTube'));
    assert.ok(okPage('https://twitter.com/a', 'X'));
    assert.ok(okPage('https://x.com/a', 'X'));
    for (const [u, p] of [
        ['http://www.tiktok.com/@a', 'TikTok'],                // ไม่ใช่ https
        ['https://vt.tiktok.com/ZS1/', 'TikTok'],              // โดเมนย่ออื่น
        ['https://tiktok.com.evil.test/@a', 'TikTok'],
        ['https://eviltiktok.com/@a', 'TikTok'],
        ['https://user:pass@www.tiktok.com/@a', 'TikTok'],
        ['https://www.tiktok.com:8443/@a', 'TikTok'],
        ['https://127.0.0.1/@a', 'TikTok'],
        ['https://consent.youtube.com/m', 'YouTube'],
        ['https://youtu.be/x', 'YouTube'],
        ['https://www.youtube.com/@a', 'TikTok'],              // ข้ามแพลตฟอร์ม
        ['https://mobile.twitter.com/a', 'X'],
        ['javascript:alert(1)', 'X'], ['', 'X'], [null, 'X']
    ]) assert.equal(okPage(u, p), false, `${p} ${u}`);

    const okImg = (u, p) => !!safeUrl(u, IMAGE_HOST[p]);
    assert.ok(okImg(TT_IMG, 'TikTok'));
    assert.ok(okImg('https://p19-sign.tiktokcdn-us.com/a.jpeg', 'TikTok'));
    assert.ok(okImg(YT_IMG, 'YouTube'));
    assert.ok(okImg('https://yt3.ggpht.com/a', 'YouTube'));
    assert.ok(okImg('https://i.ytimg.com/a.jpg', 'YouTube'));
    assert.ok(okImg(X_IMG, 'X'));
    for (const [u, p] of [
        ['http://p16-common-sign.tiktokcdn.com/a.jpeg', 'TikTok'],
        ['https://tiktokcdn.com/a.jpeg', 'TikTok'],            // ต้องเป็นโดเมนย่อย
        ['https://p16.tiktokcdn.com.evil.test/a.jpeg', 'TikTok'],
        ['https://p16.ibyteimg.com/a.jpeg', 'TikTok'],
        ['https://169.254.169.254/latest/meta-data', 'TikTok'],
        ['https://localhost/a.png', 'YouTube'],
        ['https://googleusercontent.com/a', 'YouTube'],
        ['https://pbs.twimg.com/a.jpg', 'YouTube'],            // ข้ามแพลตฟอร์ม
        ['https://abs.twimg.com/a.jpg', 'X'],
        ['https://pbs.twimg.com:444/a.jpg', 'X']
    ]) assert.equal(okImg(u, p), false, `${p} ${u}`);
});

test('pageFor: ช่องทาง → หน้าโปรไฟล์ที่ดึงได้ (Instagram / Facebook / Lemon8 / อื่น ๆ / ลิงก์ย่อ = null)', () => {
    assert.equal(pageFor({ platform: 'TikTok', handle: 'aom_chr', url: 'https://www.tiktok.com/@aom_chr' }), TT_PAGE);
    assert.equal(pageFor({ platform: 'TikTok', handle: 'aom_chr', url: '' }), TT_PAGE, 'มีแต่ชื่อ = ประกอบลิงก์');
    assert.equal(pageFor({ platform: 'YouTube', handle: 'Old', url: 'https://www.youtube.com/c/Old' }), 'https://www.youtube.com/c/Old');
    assert.equal(pageFor({ platform: 'X', handle: 'X', url: 'https://x.com/X' }), X_PAGE);
    assert.equal(pageFor({ platform: 'TikTok', handle: '', url: 'https://vt.tiktok.com/ZS1/' }), null);
    assert.equal(pageFor({ platform: 'Instagram', handle: 'a', url: 'https://www.instagram.com/a' }), null);
    assert.equal(pageFor({ platform: 'Facebook', handle: 'a', url: 'https://www.facebook.com/a' }), null);
    assert.equal(pageFor({ platform: 'Lemon8', handle: 'a', url: 'https://www.lemon8-app.com/@a' }), null);
    assert.equal(pageFor({ platform: 'อื่น ๆ', handle: '', url: 'https://linktr.ee/a' }), null);
    assert.equal(pageFor(null), null);
});

test('pageFor: ลิงก์คลิป / Shorts / ค้นหา / เพลย์ลิสต์ / โพสต์ X / แท็ก-เพลง TikTok / หน้าแรก ไม่ใช่หน้าช่อง = null (ไม่เอารูปปกคลิปมาเป็นรูปการ์ด)', () => {
    const { detectSocial } = require(path.join(SRC, 'data/talentSocials'));
    const NOT_PROFILE = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/shorts/abc123', 'https://m.youtube.com/watch?v=x',
        'https://www.youtube.com/results?search_query=aom', 'https://www.youtube.com/playlist?list=PL123', 'https://www.youtube.com/',
        'https://x.com/i/status/123', 'https://x.com/home', 'https://twitter.com/search?q=a', 'https://x.com/',
        'https://www.tiktok.com/tag/skincare', 'https://www.tiktok.com/music/song-7300000000000000000', 'https://www.tiktok.com/',
        'https://www.tiktok.com/discover/aom', 'https://vt.tiktok.com/ZS1/', 'https://youtu.be/dQw4w9WgXcQ'
    ];
    for (const u of NOT_PROFILE) {
        const det = detectSocial(u);
        assert.ok(det, u);
        assert.equal(pageFor(det), null, 'ลิงก์ที่วาง ' + u);
        assert.equal(pageFor({ platform: det.platform, handle: '', url: u }), null, 'ช่องทางที่บันทึก ' + u);
    }
    // พิมพ์ชื่อช่องไว้แต่วางลิงก์คลิป → ใช้หน้าโปรไฟล์ที่ประกอบจากชื่อช่อง
    assert.equal(pageFor({ platform: 'YouTube', handle: 'aom', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }), 'https://www.youtube.com/@aom');
    assert.equal(pageFor({ platform: 'YouTube', handle: 'aom', url: 'https://www.youtube.com/shorts/abc123' }), 'https://www.youtube.com/@aom');
    assert.equal(pageFor({ platform: 'X', handle: 'nong', url: 'https://x.com/i/status/123' }), 'https://x.com/nong');
    assert.equal(pageFor({ platform: 'TikTok', handle: 'aom', url: 'https://www.tiktok.com/music/song-1' }), 'https://www.tiktok.com/@aom');
    // หน้าช่องจริงแบบอื่น: /channel/UC… /c/ /user/ เก็บตามเดิม (ไม่ประกอบใหม่เป็น /@ชื่อ ที่อาจเป็นช่องอื่น) · http:// = หน้าเดียวกันบน https
    assert.equal(pageFor(detectSocial('https://www.youtube.com/channel/UCabc-_123')), 'https://www.youtube.com/channel/UCabc-_123');
    assert.equal(pageFor({ platform: 'YouTube', handle: 'Old', url: 'http://www.youtube.com/user/Old' }), 'https://www.youtube.com/user/Old');
    assert.equal(pageFor(detectSocial('https://twitter.com/nong_a/status/1')), 'https://x.com/nong_a', 'ลิงก์โพสต์ของบัญชี = หน้าบัญชีนั้น');
    // ชื่อช่องที่เป็นหน้าระบบของ X ประกอบเป็นหน้าโปรไฟล์ไม่ได้
    assert.equal(pageFor({ platform: 'X', handle: 'home', url: '' }), null);
    // แผนดึงอัตโนมัติ: มีแต่ลิงก์คลิป = ไม่ดึง (route ตอบ 'none' + ข้อความให้ใส่ลิงก์หน้าช่อง / วางรูปเอง)
    const s = svc(async () => { throw new Error('ไม่ควรเรียก'); });
    for (const u of NOT_PROFILE) assert.equal(s.planAuto({ id: 1, socials: [{ platform: '', url: u }], image: null }), null, 'planAuto ' + u);
    assert.equal(s.planAuto({ id: 1, socials: [], link: 'https://www.youtube.com/watch?v=x', image: null }), null, 'แถวเก่า link เป็นลิงก์คลิป');
    assert.equal(s.planAuto({ id: 1, socials: [{ platform: 'YouTube', handle: 'aom', url: 'https://www.youtube.com/watch?v=x' }], image: null }).page,
        'https://www.youtube.com/@aom');
    assert.match(A.failMessage('not-profile', 'YouTube'), /ไม่ใช่หน้าช่อง[\s\S]*Ctrl\+V/);
});

// ---------------------------------------------------------------- ดึงรูป
test('ดึงสำเร็จทั้ง 3 แพลตฟอร์ม · ไม่ตาม redirect เอง · ส่ง User-Agent แบบเบราว์เซอร์', async () => {
    const f = fakeFetch({
        [TT_PAGE]: () => html(ttPage()), [TT_IMG]: () => image(JPEG),
        [YT_PAGE]: () => html(ytPage), [YT_IMG + '&x=1']: () => image(PNG, 'image/png'),
        [X_PAGE]: () => html(xPage), [X_IMG]: () => image(JPEG, 'image/jpeg; charset=binary')
    });
    const s = svc(f.impl);
    const tt = await s.download(TT_PAGE, 'TikTok');
    assert.equal(tt.ext, 'jpg');
    assert.deepEqual(tt.buf, JPEG);
    assert.equal(tt.src, TT_IMG);
    const yt = await s.download(YT_PAGE, 'YouTube');
    assert.equal(yt.ext, 'png');
    assert.equal(yt.src, YT_IMG + '&x=1');
    assert.equal((await s.download(X_PAGE, 'X')).src, X_IMG);
    assert.ok(f.calls.every(c => c.opts.redirect === 'manual'), 'ทุกคำขอ redirect: manual');
    assert.ok(f.calls.every(c => /Mozilla\/5\.0/.test(c.opts.headers['User-Agent'])));
    assert.ok(f.calls.every(c => c.opts.signal instanceof AbortSignal), 'ทุกคำขอมีเวลาหมด');
});

test('โดเมนต้องห้าม: ไม่ยิงคำขอไปเลย (หน้าโปรไฟล์ / ลิงก์รูปในหน้า)', async () => {
    const f = fakeFetch({});
    const s = svc(f.impl);
    assert.equal(await code(s.download('https://127.0.0.1/@a', 'TikTok')), 'blocked');
    assert.equal(await code(s.download('http://www.tiktok.com/@a', 'TikTok')), 'blocked');
    assert.equal(await code(s.download('https://www.instagram.com/a', 'Instagram')), 'blocked');
    assert.equal(f.calls.length, 0);

    for (const bad of ['https://169.254.169.254/latest/meta-data/', 'https://evil.test/a.jpg', 'http://p16-common-sign.tiktokcdn.com/a.jpeg',
        'https://pbs.twimg.com/a.jpg', 'file:///etc/passwd']) {
        const g = fakeFetch({ [TT_PAGE]: () => html(ttPage(bad)) });
        assert.equal(await code(svc(g.impl).download(TT_PAGE, 'TikTok')), 'blocked', bad);
        assert.deepEqual(g.calls.map(c => c.url), [TT_PAGE], 'ไม่ยิงไปที่ลิงก์รูปต้องห้าม ' + bad);
    }
});

test('redirect: ตามให้เฉพาะโดเมนที่อนุญาต (ไม่เกิน 3 ทอด) · พาไปที่อื่น = ไม่ตาม', async () => {
    // หน้าโปรไฟล์ → www.tiktok.com?lang=th (ลิงก์สัมพัทธ์) → ผ่าน
    let f = fakeFetch({
        'https://tiktok.com/@aom_chr': () => redirect('https://www.tiktok.com/@aom_chr', 301),
        [TT_PAGE]: () => redirect('/@aom_chr?lang=th'),
        [TT_PAGE + '?lang=th']: () => html(ttPage()),
        [TT_IMG]: () => image()
    });
    assert.equal((await svc(f.impl).download('https://tiktok.com/@aom_chr', 'TikTok')).ext, 'jpg');
    assert.deepEqual(f.calls.map(c => c.url), ['https://tiktok.com/@aom_chr', TT_PAGE, TT_PAGE + '?lang=th', TT_IMG]);

    // พาไปโดเมนอื่น / http / IP ภายใน → หยุด ไม่ยิงต่อ
    for (const loc of ['https://evil.test/', 'http://www.tiktok.com/@aom_chr', 'https://127.0.0.1:8080/', 'https://www.youtube.com/@x', '']) {
        f = fakeFetch({ [TT_PAGE]: () => (loc ? redirect(loc) : new Response(null, { status: 302 })) });
        const c = await code(svc(f.impl).download(TT_PAGE, 'TikTok'));
        assert.ok(c === 'blocked' || c === 'redirect', loc + ' → ' + c);
        assert.equal(f.calls.length, 1, loc);
    }
    // วนไม่จบ
    f = fakeFetch({ [TT_PAGE]: () => redirect(TT_PAGE) });
    assert.equal(await code(svc(f.impl).download(TT_PAGE, 'TikTok')), 'redirect');
    assert.equal(f.calls.length, 4, '1 + ตามได้ 3 ทอด');
    // รูป redirect ไปเครื่องภายใน
    f = fakeFetch({ [TT_PAGE]: () => html(ttPage()), [TT_IMG]: () => redirect('http://127.0.0.1/secret') });
    assert.equal(await code(svc(f.impl).download(TT_PAGE, 'TikTok')), 'blocked');
    assert.equal(f.calls.length, 2);
});

test('รูปใหญ่เกิน 3MB (ทั้งบอกขนาดมาและไม่บอก) · ไม่ใช่รูป · หัวไฟล์ไม่ตรง · หน้าเว็บไม่พบรูป / สถานะไม่ใช่ 200', async () => {
    const run = async (imgRes, page = ttPage()) => code(svc(fakeFetch({ [TT_PAGE]: () => html(page), [TT_IMG]: imgRes }).impl).download(TT_PAGE, 'TikTok'));
    assert.equal(await run(() => image(JPEG, 'image/jpeg', { 'content-length': String(MAX_BYTES + 1) })), 'too-big');
    let pulled = 0;
    const endless = () => new Response(new ReadableStream({
        pull(c) { pulled++; c.enqueue(pulled === 1 ? new Uint8Array(JPEG) : new Uint8Array(512 * 1024)); }
    }), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    assert.equal(await run(endless), 'too-big');
    assert.ok(pulled <= 8, 'หยุดอ่านทันทีที่เกิน ไม่อ่านจนหมด');
    assert.equal(await run(() => image(Buffer.from('<html>login</html>'), 'text/html')), 'not-image');
    assert.equal(await run(() => image(Buffer.from('<html>login</html>'), 'image/jpeg')), 'not-image', 'บอกว่าเป็นรูปแต่ไม่ใช่');
    assert.equal(await run(() => image(Buffer.from('GIF89a' + 'x'.repeat(50)), 'image/gif')), 'not-image');
    assert.equal(await run(() => image(Buffer.alloc(0))), 'not-image');
    assert.equal(await run(() => new Response('x', { status: 403 })), 'status');
    assert.equal(await run(() => image(), '<html>บัญชีส่วนตัว / หน้าล็อกอิน</html>'), 'no-image');
    assert.equal(await code(svc(fakeFetch({ [TT_PAGE]: () => new Response('nf', { status: 404 }) }).impl).download(TT_PAGE, 'TikTok')), 'status');
    assert.equal(await code(svc(fakeFetch({ [TT_PAGE]: () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) }).impl)
        .download(TT_PAGE, 'TikTok')), 'not-html');
});

test('หน้าเว็บยาว: เจอลิงก์รูปแล้วหยุดอ่าน · ไม่เจอเลยและยาวเกิน 4MB = หยุด', async () => {
    let pulled = 0;
    const long = head => () => new Response(new ReadableStream({
        pull(c) { pulled++; c.enqueue(new TextEncoder().encode(pulled === 1 ? head : 'y'.repeat(256 * 1024))); }
    }), { status: 200, headers: { 'content-type': 'text/html' } });
    const f = fakeFetch({ [YT_PAGE]: long(ytPage.slice(0, ytPage.indexOf('<body>'))), [YT_IMG + '&x=1']: () => image() });
    assert.equal((await svc(f.impl).download(YT_PAGE, 'YouTube')).ext, 'jpg');
    assert.ok(pulled <= 2, 'ไม่อ่านหน้าทั้งหน้า: ' + pulled);
    pulled = 0;
    const g = fakeFetch({ [YT_PAGE]: long('<html><head>') });
    assert.equal(await code(svc(g.impl).download(YT_PAGE, 'YouTube')), 'too-big');
});

test('หมดเวลา: แพลตฟอร์มไม่ตอบ → timeout (ไม่ค้าง) · ข้อความบอกให้ลองใหม่/วางรูปเอง', async () => {
    const hang = (url, opts) => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true });
    });
    const s = createTalentAvatars({ dir: tmpDir(), setFile: async () => { throw new Error('ต้องไม่ถูกเรียก'); }, fetchImpl: hang, timeoutMs: 40 });
    const t0 = Date.now();
    assert.equal(await code(s.download(TT_PAGE, 'TikTok')), 'timeout');
    assert.ok(Date.now() - t0 < 2000);
    const out = await s.run(7, { social: { platform: 'TikTok', handle: 'aom_chr', url: TT_PAGE }, page: TT_PAGE });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'timeout');
    assert.match(out.message, /TikTok ตอบช้าเกินไป/);
    // เวลารวมทั้งหมดก็มีเพดาน (redirect หลายทอดช้า ๆ)
    const slowHop = (url, opts) => new Promise(resolve => setTimeout(() => resolve(redirect(TT_PAGE)), 30));
    const s2 = createTalentAvatars({ dir: tmpDir(), setFile: async () => null, fetchImpl: slowHop, timeoutMs: 1000, totalMs: 50 });
    assert.equal(await code(s2.download(TT_PAGE, 'TikTok')), 'timeout');
});

// ---------------------------------------------------------------- เก็บไฟล์ + ผูกกับแถว
function memoryStore(dir, row) {
    const calls = [];
    const removed = [];
    return {
        calls, removed,
        setFile: async (id, field, meta, opts = {}) => {
            calls.push({ id, field, meta, opts });
            if (!row) return null;
            const have = row[field];
            if (opts.keepUserFile && have && have.source !== 'auto') return { row: { ...row }, old: null, kept: true };
            // แบบเดียวกับ pg/talents.setFile: เช็คในล็อกแถวว่างานดึงนี้ยังควรเขียนไหม
            if (typeof opts.stillWanted === 'function' && !opts.stillWanted({ ...row })) return { row: { ...row }, old: null, kept: true, stale: true };
            const old = row[field];
            row[field] = meta;
            return { row: { ...row }, old };
        },
        removeFile: meta => { removed.push(meta.filename); fs.rmSync(path.join(dir, meta.filename), { force: true }); }
    };
}
const TT_SOURCE = { social: { platform: 'TikTok', handle: 'aom_chr', url: TT_PAGE }, page: TT_PAGE };
const ttRoutes = () => fakeFetch({ [TT_PAGE]: () => html(ttPage()), [TT_IMG]: () => image() });

test('run: ดึงแล้วเก็บไฟล์ใน UPLOAD_DIR แบบเดียวกับรูปที่อัป (talent_<id>_…) · meta บอกว่ามาจากลิงก์ · ลบรูปเดิมที่ดึงไว้', async () => {
    const dir = tmpDir();
    const row = { id: 7, name: 'ออม', socials: [TT_SOURCE.social], image: { filename: 'talent_7_old.jpg', source: 'auto', from: 'https://www.tiktok.com/@old' } };
    fs.writeFileSync(path.join(dir, 'talent_7_old.jpg'), JPEG);
    const m = memoryStore(dir, row);
    const s = createTalentAvatars({ dir, setFile: m.setFile, removeFile: m.removeFile, fetchImpl: ttRoutes().impl });
    const out = await s.run(7, TT_SOURCE);
    assert.equal(out.ok, true);
    assert.equal(out.platform, 'TikTok');
    const meta = m.calls[0].meta;
    assert.equal(m.calls[0].opts.keepUserFile, true, 'ดึงอัตโนมัติห้ามทับรูปที่ผู้ใช้อัปเอง');
    assert.equal(typeof m.calls[0].opts.stillWanted, 'function', 'เช็คซ้ำในล็อกแถวว่ายังควรเขียนไหม');
    assert.match(meta.filename, /^talent_7_\d+[0-9a-f]{6}\.jpg$/);
    assert.equal(meta.original, 'TikTok-aom_chr.jpg');
    assert.equal(meta.size, JPEG.length);
    assert.equal(meta.source, 'auto');
    assert.equal(meta.from, TT_PAGE);
    assert.ok(Number.isFinite(Date.parse(meta.uploaded_at)));
    assert.deepEqual(fs.readFileSync(path.join(dir, meta.filename)), JPEG);
    assert.deepEqual(m.removed, ['talent_7_old.jpg'], 'รูปเดิมที่ดึงไว้ถูกลบ');
    assert.deepEqual(fs.readdirSync(dir), [meta.filename], 'ไม่มีไฟล์ชั่วคราวค้าง');
});

test('run: ผู้ใช้อัปรูปเองระหว่างที่กำลังดึง → ไม่ทับ ลบไฟล์ที่เพิ่งดึงทิ้ง · กดปุ่มเอง (force) = แทนได้', async () => {
    const dir = tmpDir();
    const row = { id: 8, socials: [TT_SOURCE.social], image: { filename: 'talent_8_mine.png', original: 'ของฉัน.png' } };
    const m = memoryStore(dir, row);
    const s = createTalentAvatars({ dir, setFile: m.setFile, removeFile: m.removeFile, fetchImpl: ttRoutes().impl });
    const out = await s.run(8, TT_SOURCE);
    assert.equal(out.ok, false);
    assert.equal(out.code, 'kept');
    assert.equal(row.image.filename, 'talent_8_mine.png', 'รูปของผู้ใช้อยู่ครบ');
    assert.deepEqual(fs.readdirSync(dir), [], 'ไฟล์ที่ดึงมาถูกลบทิ้ง');

    const forced = await s.run(8, TT_SOURCE, { force: true });
    assert.equal(forced.ok, true);
    assert.equal(m.calls.at(-1).opts.keepUserFile, false);
    assert.equal(row.image.source, 'auto');
    assert.deepEqual(m.removed.at(-1), 'talent_8_mine.png', 'กดเองแล้วรูปเดิมถูกแทน');
});

test('run: แถวถูกลบระหว่างดึง → ไม่มีไฟล์ค้าง · ดึงไม่สำเร็จ = ไม่มีไฟล์ค้าง', async () => {
    const dir = tmpDir();
    const m = memoryStore(dir, null);
    const out = await createTalentAvatars({ dir, setFile: m.setFile, removeFile: m.removeFile, fetchImpl: ttRoutes().impl }).run(9, TT_SOURCE);
    assert.equal(out.code, 'gone');
    assert.deepEqual(fs.readdirSync(dir), []);
    const bad = fakeFetch({ [TT_PAGE]: () => html(ttPage()), [TT_IMG]: () => image(Buffer.from('nope'), 'image/jpeg') });
    const out2 = await createTalentAvatars({ dir, setFile: m.setFile, removeFile: m.removeFile, fetchImpl: bad.impl }).run(9, TT_SOURCE);
    assert.equal(out2.ok, false);
    assert.match(out2.message, /ดึงรูปจาก TikTok ไม่สำเร็จ .*Ctrl\+V/);
    assert.deepEqual(fs.readdirSync(dir), []);
});

test('run: ดึงอัตโนมัติไม่ได้ = พัก 20 นาที (ไม่ยิงซ้ำ) · กดเองไม่ต้องรอ · ขอพร้อมกันหลายครั้ง = ดึงครั้งเดียว', async () => {
    let clock = 1_000_000;
    const dir = tmpDir();
    const m = memoryStore(dir, { id: 5, socials: [TT_SOURCE.social], image: null });
    const down = fakeFetch({ [TT_PAGE]: () => new Response('busy', { status: 429 }) });
    const s = createTalentAvatars({ dir, setFile: m.setFile, removeFile: m.removeFile, fetchImpl: down.impl, now: () => clock });
    assert.equal((await s.run(5, TT_SOURCE)).code, 'status');
    assert.equal((await s.run(5, TT_SOURCE)).code, 'cooldown');
    assert.equal(down.calls.length, 1, 'ช่วงพักไม่ยิงซ้ำ');
    await s.run(5, TT_SOURCE, { force: true });
    assert.equal(down.calls.length, 2, 'กดเองลองใหม่ได้เลย');
    clock += A.FAIL_TTL_MS + 1;
    await s.run(5, TT_SOURCE);
    assert.equal(down.calls.length, 3, 'พ้นช่วงพักแล้วลองใหม่');

    const f = ttRoutes();
    const s2 = createTalentAvatars({ dir, setFile: m.setFile, removeFile: m.removeFile, fetchImpl: f.impl });
    const [a, b] = await Promise.all([s2.run(5, TT_SOURCE), s2.run(5, TT_SOURCE)]);
    assert.equal(a, b);
    assert.equal(f.calls.length, 2, 'หน้า + รูป ครั้งเดียว');
});

// ---------------------------------------------------------------- ดึงช้า แล้วระหว่างนั้นลิงก์ / รูปเปลี่ยน
// หน้า TikTok ของ @ชื่อ ที่ตอบเมื่อสั่งปล่อย (จำลองแพลตฟอร์มตอบช้ากว่า AUTO_WAIT_MS)
const IMG_OF = h => `https://p16-common-sign.tiktokcdn.com/tos-avt/${h}.jpeg`;
function gatedTikTok(handles) {
    const gates = {};
    const routes = {};
    for (const h of handles) {
        let open;
        const wait = new Promise(r => { open = r; });
        gates[h] = open;
        routes[`https://www.tiktok.com/@${h}`] = async () => { await wait; return html(ttPage(IMG_OF(h))); };
        routes[IMG_OF(h)] = () => image(JPEG);
    }
    return { ...fakeFetch(routes), gates };
}
const ttSocial = h => ({ platform: 'TikTok', handle: h, url: `https://www.tiktok.com/@${h}` });

test('run: ดึง A ช้า → ผู้ใช้เปลี่ยนลิงก์เป็น B → งาน B แยก ได้รูป B · A ดึงเสร็จทีหลังไม่ทับ (เช็คในล็อกแถว) ไฟล์ของ A ถูกลบ', async () => {
    const dir = tmpDir();
    const row = { id: 5, socials: [ttSocial('aaa')], link: 'https://www.tiktok.com/@aaa', image: null };
    const m = memoryStore(dir, row);
    const f = gatedTikTok(['aaa', 'bbb']);
    const s = createTalentAvatars({ dir, setFile: m.setFile, removeFile: m.removeFile, fetchImpl: f.impl });
    const jobA = s.run(5, s.planAuto(row), { expect: null });
    // บันทึกรอบสอง (ลิงก์ใหม่) ระหว่างที่ A ยังดึงไม่เสร็จ
    row.socials = [ttSocial('bbb')];
    row.link = 'https://www.tiktok.com/@bbb';
    const planB = s.planAuto(row);
    assert.equal(planB.page, 'https://www.tiktok.com/@bbb');
    const jobB = s.run(5, planB, { expect: null });
    assert.notEqual(jobA, jobB, 'ลิงก์ใหม่ = งานใหม่ ไม่รับผลของงานลิงก์เก่า');
    f.gates.bbb();
    const outB = await jobB;
    assert.equal(outB.ok, true);
    assert.equal(row.image.from, 'https://www.tiktok.com/@bbb');
    f.gates.aaa();
    const outA = await jobA;
    assert.equal(outA.ok, false);
    assert.equal(outA.code, 'stale');
    assert.match(outA.message, /ถูกเปลี่ยนระหว่างที่กำลังดึง/);
    assert.equal(row.image.from, 'https://www.tiktok.com/@bbb', 'รูปของลิงก์เก่าไม่ทับรูปของลิงก์ใหม่');
    assert.deepEqual(fs.readdirSync(dir), [row.image.filename], 'ไฟล์ที่ดึงจากลิงก์เก่าถูกลบ');
});

test('run: A ดึงเสร็จหลังลิงก์ถูกเปลี่ยน (B ยังไม่เสร็จ / เปลี่ยนเป็น IG) → ไม่เก็บรูปของ A เลย', async () => {
    // ลำดับกลับ: A เสร็จก่อน B
    let dir = tmpDir();
    let row = { id: 6, socials: [ttSocial('aaa')], image: null };
    let m = memoryStore(dir, row);
    let f = gatedTikTok(['aaa', 'bbb']);
    let s = createTalentAvatars({ dir, setFile: m.setFile, removeFile: m.removeFile, fetchImpl: f.impl });
    const jobA = s.run(6, s.planAuto(row), { expect: null });
    row.socials = [ttSocial('bbb')];
    const jobB = s.run(6, s.planAuto(row), { expect: null });
    f.gates.aaa();
    assert.equal((await jobA).code, 'stale');
    assert.equal(row.image, null, 'ยังไม่มีรูปของใคร (A ไม่ถูกเก็บ)');
    f.gates.bbb();
    assert.equal((await jobB).ok, true);
    assert.equal(row.image.from, 'https://www.tiktok.com/@bbb');
    assert.equal(fs.readdirSync(dir).length, 1);

    // เปลี่ยนเป็นช่องทางที่ดึงรูปไม่ได้ (Instagram) ระหว่างดึง
    dir = tmpDir();
    row = { id: 7, socials: [ttSocial('aaa')], image: null };
    m = memoryStore(dir, row);
    f = gatedTikTok(['aaa']);
    s = createTalentAvatars({ dir, setFile: m.setFile, removeFile: m.removeFile, fetchImpl: f.impl });
    const job = s.run(7, s.planAuto(row), { expect: null });
    row.socials = [{ platform: 'Instagram', handle: 'aaa', url: 'https://www.instagram.com/aaa' }];
    f.gates.aaa();
    assert.equal((await job).code, 'stale');
    assert.equal(row.image, null);
    assert.deepEqual(fs.readdirSync(dir), []);
});

test('run: กดดึงเอง (force) แล้วผู้ใช้อัปรูปใหม่ระหว่างดึง → รูปที่อัปชนะ ไม่ถูกทับ ไม่ถูกลบ', async () => {
    const dir = tmpDir();
    const row = { id: 8, socials: [ttSocial('aaa')], image: { filename: 'talent_8_old.png', original: 'old.png' } };
    fs.writeFileSync(path.join(dir, 'talent_8_old.png'), PNG);
    const m = memoryStore(dir, row);
    const f = gatedTikTok(['aaa']);
    const s = createTalentAvatars({ dir, setFile: m.setFile, removeFile: m.removeFile, fetchImpl: f.impl });
    const job = s.run(8, { social: ttSocial('aaa'), page: 'https://www.tiktok.com/@aaa' }, { force: true, expect: A.imageKey(row.image) });
    // อัปรูปใหม่ (เส้นอัปโหลดแทนไฟล์เดิม) ระหว่างที่ปุ่มยังดึงอยู่
    row.image = { filename: 'talent_8_new.png', original: 'new.png' };
    fs.writeFileSync(path.join(dir, 'talent_8_new.png'), PNG);
    f.gates.aaa();
    const out = await job;
    assert.equal(out.code, 'stale');
    assert.equal(row.image.filename, 'talent_8_new.png');
    assert.ok(!m.removed.includes('talent_8_new.png'), 'ไม่ลบรูปที่ผู้ใช้เพิ่งอัป');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['talent_8_new.png', 'talent_8_old.png'], 'ไฟล์ที่ดึงมาถูกลบ (ไฟล์เดิมเป็นหน้าที่ของเส้นอัปโหลด)');
    // ไม่ได้ส่ง expect (ผู้เรียกแบบเดิม) = แทนได้ตามเดิม
    const f2 = fakeFetch({ 'https://www.tiktok.com/@aaa': () => html(ttPage(IMG_OF('aaa'))), [IMG_OF('aaa')]: () => image(JPEG) });
    const s2 = createTalentAvatars({ dir, setFile: m.setFile, removeFile: m.removeFile, fetchImpl: f2.impl });
    assert.equal((await s2.run(8, { social: ttSocial('aaa'), page: 'https://www.tiktok.com/@aaa' }, { force: true })).ok, true);
    assert.equal(A.imageKey(null), null);
    assert.equal(A.imageKey({ filename: 'x.png' }), 'x.png');
});

test('planAuto: ดึงเมื่อไม่มีรูป · ห้ามแตะรูป/PDF ที่ผู้ใช้อัปเอง · รูปที่ดึงไว้จากช่องทางเดิม = ไม่ดึงซ้ำ · ช่องทางเปลี่ยน = ดึงใหม่', () => {
    const s = svc(async () => { throw new Error('ไม่ควรเรียก'); });
    const tt = [{ platform: 'TikTok', handle: 'aom_chr', url: TT_PAGE }];
    assert.equal(s.planAuto({ id: 1, socials: tt, image: null }).page, TT_PAGE);
    assert.equal(s.planAuto({ id: 1, socials: tt, image: { filename: 'talent_1_a.png', original: 'a.png' } }), null);
    assert.equal(s.planAuto({ id: 1, socials: tt, image: { filename: 'talent_1_a.pdf' } }), null, 'PDF คอมการ์ด');
    assert.equal(s.planAuto({ id: 1, socials: tt, image: { filename: 'x.jpg', source: 'auto', from: TT_PAGE } }), null);
    assert.equal(s.planAuto({ id: 1, socials: tt, image: { filename: 'x.jpg', source: 'auto', from: 'https://www.tiktok.com/@old' } }).page, TT_PAGE);
    // ดึงเองจากช่องทางที่สองไว้ → ยังอยู่ในรายการ = ไม่ดึงทับ
    const two = [...tt, { platform: 'X', handle: 'X', url: X_PAGE }];
    assert.equal(s.planAuto({ id: 1, socials: two, image: { filename: 'x.jpg', source: 'auto', from: X_PAGE } }), null);
    // Instagram / Facebook อย่างเดียว = ดึงไม่ได้ · ช่องแรกดึงไม่ได้ ใช้ช่องถัดไปที่ดึงได้
    assert.equal(s.planAuto({ id: 1, socials: [{ platform: 'Instagram', handle: 'a', url: 'https://www.instagram.com/a' }], image: null }), null);
    assert.equal(s.planAuto({ id: 1, socials: [{ platform: 'Instagram', handle: 'a', url: 'https://www.instagram.com/a' }, ...two], image: null }).page, TT_PAGE);
    // แถวเก่า: มีแค่ link
    assert.equal(s.planAuto({ id: 1, socials: [], link: 'https://www.youtube.com/@YouTube', image: null }).page, YT_PAGE);
    assert.equal(s.planAuto({ id: 1, link: null, image: null }), null);
    assert.equal(s.planAuto(null), null);
});

test('within: ช้ากว่ากำหนด = null (งานยังทำต่อ) · เร็วกว่า = ผลจริง', async () => {
    assert.equal(await within(new Promise(r => setTimeout(() => r('late'), 80)), 10), null);
    assert.equal(await within(Promise.resolve('now'), 1000), 'now');
});
