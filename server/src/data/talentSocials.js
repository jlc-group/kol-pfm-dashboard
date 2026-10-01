/**
 * ช่องทาง Social ของคนใน Talent Book (ผู้ใช้สั่ง 1 ต.ค. 2026) — คนหนึ่งมีได้หลายช่องทาง
 *   socials = [{ platform, handle, url }]
 *     platform = หนึ่งใน SOCIAL_PLATFORMS ('อื่น ๆ' = เว็บอื่น / ข้อความที่ไม่ใช่ลิงก์)
 *     handle   = ชื่อช่อง ไม่มี @ นำหน้า (หน้าเว็บเติม @ ให้เองเวลาโชว์ — socialHandleText)
 *     url      = ลิงก์ http/https ('' ได้เฉพาะช่อง 'อื่น ๆ' ที่พิมพ์เป็นข้อความเฉย ๆ)
 *
 * ไฟล์นี้ไม่พึ่งอะไรเลย (ไม่มี require) — หน้าเว็บมีสำเนาที่ client/src/data/talentSocials.js
 * ต้องให้ผลตรงกันทุกฟังก์ชัน (tests/talent-socials.test.cjs เทียบสองฝั่งให้) — แก้ที่หนึ่งต้องแก้อีกที่ด้วย
 *
 * ข้อมูลเก่ามีแค่ช่อง link (Account) ช่องเดียว — normalizeSocials(socials, link) แปลง link เป็น 1 ช่องทางให้เมื่อ socials ว่าง
 * (ไม่ทำให้ของเดิมหาย) · ตอนบันทึก server เขียน link = ลิงก์ของช่องทางแรก (linkFromSocials) ให้โค้ดเก่าที่อ่าน link ยังใช้ได้
 */
const SOCIAL_OTHER = 'อื่น ๆ';
const SOCIAL_PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'YouTube', 'X', 'Lemon8', SOCIAL_OTHER];
// ดึงรูปโปรไฟล์อัตโนมัติได้ (server/src/services/talentAvatar.js) — Instagram / Facebook ดึงไม่ได้ ต้องวาง/อัปรูปเอง
const AVATAR_PLATFORMS = ['TikTok', 'YouTube', 'X'];
const SOCIALS_MAX = 10;
const SOCIAL_HANDLE_MAX = 100;
const SOCIAL_URL_MAX = 1000;
// ช่อง 'อื่น ๆ' เป็นข้อความอิสระ — ช่อง Account แบบเก่า (link) ยาวได้ 1000 ตัว (TALENT_MAX.link ใน routes/hires.js) และมักพิมพ์หลายช่องทาง/หลายบรรทัดรวมกัน
// จึงยาวได้เท่ากัน และเก็บตามที่พิมพ์ (ไม่ยุบช่องว่าง/บรรทัด) — ไม่งั้นแค่เปิดฟอร์มแล้วบันทึก ข้อความเดิมจะถูกตัดแล้วเขียนทับ link ถาวร
const SOCIAL_OTHER_MAX = 1000;

const str = v => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

// โดเมนของแต่ละแพลตฟอร์ม (รวม www. / m. / ลิงก์ย่อ)
const HOSTS = [
    { platform: 'TikTok', re: /(^|\.)tiktok\.com$/ },
    { platform: 'Instagram', re: /(^|\.)(instagram\.com|instagr\.am)$/ },
    { platform: 'Facebook', re: /(^|\.)(facebook\.com|fb\.com|fb\.me|fb\.watch)$/ },
    { platform: 'YouTube', re: /(^|\.)(youtube\.com|youtu\.be)$/ },
    { platform: 'X', re: /(^|\.)(x\.com|twitter\.com)$/ },
    { platform: 'Lemon8', re: /(^|\.)lemon8-app\.com$/ }
];
const platformOfHost = host => {
    const h = str(host).toLowerCase();
    const hit = HOSTS.find(p => p.re.test(h));
    return hit ? hit.platform : '';
};
// ส่วนแรกของ path ที่ไม่ใช่ชื่อบัญชี (หน้าโพสต์ / หน้าระบบของแพลตฟอร์มนั้น)
const RESERVED = {
    Instagram: ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'legal', 'developer', 'web', 's'],
    Facebook: ['profile.php', 'people', 'pages', 'groups', 'watch', 'share', 'sharer', 'sharer.php', 'photo', 'photo.php', 'photos', 'story.php',
        'permalink.php', 'events', 'reel', 'reels', 'login', 'login.php', 'home.php', 'hashtag', 'marketplace', 'gaming', 'videos', 'plugins', 'help'],
    X: ['i', 'home', 'intent', 'search', 'hashtag', 'explore', 'share', 'settings', 'messages', 'notifications', 'compose', 'login', 'signup', 'tos', 'privacy']
};

// เพดานความยาวชื่อช่องของแพลตฟอร์มนั้น ('อื่น ๆ' = ข้อความอิสระ ยาวได้เท่าช่อง Account เดิม)
const socialHandleMax = platform => (platform === SOCIAL_OTHER ? SOCIAL_OTHER_MAX : SOCIAL_HANDLE_MAX);
// ชื่อช่อง: แพลตฟอร์มที่รู้จักยุบช่องว่าง + ตัด @ นำหน้าออก (โชว์ทีหลังค่อยเติม) · 'อื่น ๆ' เก็บตามที่พิมพ์ (ตัดแค่หัวท้าย)
function cleanHandle(platform, raw) {
    if (platform === SOCIAL_OTHER) return str(raw).slice(0, SOCIAL_OTHER_MAX).trim();
    return str(raw).replace(/\s+/g, ' ').replace(/^@+/, '').trim().slice(0, SOCIAL_HANDLE_MAX);
}
// ชื่อช่องที่ประกอบเป็นลิงก์ได้ (ไม่มีช่องว่าง / / ? # @)
const handleOk = h => /^[^\s/?#@]+$/.test(h);

// ข้อความ → URL http/https (ลิงก์ที่ไม่มี http:// รับเฉพาะโดเมนของแพลตฟอร์มที่รู้จัก เช่น "tiktok.com/@aom") · ไม่ใช่ลิงก์ = null
function toUrl(raw) {
    let s = str(raw);
    if (!s || /\s/.test(s)) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
        const host = s.split(/[/?#]/)[0];
        if (!platformOfHost(host)) return null;
        s = 'https://' + s;
    }
    try {
        const u = new URL(s);
        return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? u : null;
    } catch { return null; }
}

// ลิงก์โปรไฟล์จากแพลตฟอร์ม + ชื่อช่อง ('' = ประกอบไม่ได้ เช่น 'อื่น ๆ' / ชื่อมีช่องว่าง)
function profileUrl(platform, handle) {
    const h = cleanHandle(platform, handle);
    if (!h || !handleOk(h)) return '';
    const e = encodeURIComponent(h);
    switch (platform) {
        case 'TikTok': return `https://www.tiktok.com/@${e}`;
        case 'Instagram': return `https://www.instagram.com/${e}`;
        case 'Facebook': return `https://www.facebook.com/${e}`;
        case 'YouTube': return `https://www.youtube.com/@${e}`;
        case 'X': return `https://x.com/${e}`;
        case 'Lemon8': return `https://www.lemon8-app.com/@${e}`;
        default: return '';
    }
}

const decodeSeg = s => { try { return decodeURIComponent(s); } catch { return s; } };

// วางลิงก์ → { platform, handle, url } (ไม่ใช่ลิงก์ = null)
// เจอชื่อช่องแล้ว url = ลิงก์โปรไฟล์มาตรฐาน (ตัด ?is_from_webapp= / ?igsh= และลิงก์คลิปกลายเป็นลิงก์ช่อง)
// เช่น https://www.tiktok.com/@aom_chr → { platform: 'TikTok', handle: 'aom_chr', url: 'https://www.tiktok.com/@aom_chr' }
function detectSocial(raw) {
    const u = toUrl(raw);
    if (!u) return null;
    const platform = platformOfHost(u.hostname);
    if (!platform) return { platform: SOCIAL_OTHER, handle: '', url: u.href };
    const segs = u.pathname.split('/').filter(Boolean).map(decodeSeg);
    const host = u.hostname.toLowerCase();
    let handle = '';
    let canonical = true;   // false = เก็บลิงก์เดิม (ชื่อในลิงก์ไม่ใช่ @handle ประกอบกลับเป็นลิงก์เดิมไม่ได้)
    if (platform === 'TikTok' || platform === 'Lemon8') {
        if (segs[0] && segs[0].startsWith('@')) handle = segs[0];
    } else if (platform === 'YouTube') {
        if (/(^|\.)youtu\.be$/.test(host)) handle = '';
        else if (segs[0] && segs[0].startsWith('@')) handle = segs[0];
        else if ((segs[0] === 'c' || segs[0] === 'user') && segs[1]) { handle = segs[1]; canonical = false; }
    } else if (platform === 'Instagram') {
        if (segs[0] === 'stories' && segs[1]) handle = segs[1];
        else if (segs[0] && !RESERVED.Instagram.includes(segs[0].toLowerCase())) handle = segs[0];
    } else if (platform === 'Facebook') {
        if (/(^|\.)fb\.watch$/.test(host)) handle = '';
        else if (segs[0] && !RESERVED.Facebook.includes(segs[0].toLowerCase())) handle = segs[0];
    } else if (platform === 'X') {
        if (segs[0] && !RESERVED.X.includes(segs[0].toLowerCase())) handle = segs[0];
    }
    handle = cleanHandle(platform, handle);
    if (handle && !handleOk(handle)) handle = '';
    const url = handle && canonical ? profileUrl(platform, handle) : u.href;
    return { platform, handle, url: url || u.href };
}

// แพลตฟอร์มที่ใช้จริง: ลิงก์ของแพลตฟอร์มที่รู้จักชนะที่เลือกไว้ · เลือกไว้ไม่ถูก/ไม่ได้เลือก = ตามลิงก์ (ไม่มีลิงก์ = 'อื่น ๆ')
function platformFor(chosen, det) {
    let platform = str(chosen);
    if (det && det.platform !== SOCIAL_OTHER) platform = det.platform;
    if (!SOCIAL_PLATFORMS.includes(platform)) platform = det ? det.platform : SOCIAL_OTHER;
    return platform;
}

// ช่องทางเดียว (ข้อมูลในฐาน / จากฟอร์ม) → รูปมาตรฐาน · ใช้ไม่ได้ (ไม่มีทั้งลิงก์และชื่อ) = null
// ลิงก์เป็นตัวตัดสินแพลตฟอร์ม (วางลิงก์ IG แต่เลือก TikTok ไว้ = Instagram) · ชื่อที่พิมพ์เองชนะชื่อที่อ่านจากลิงก์
function normalizeSocial(item) {
    if (!item || typeof item !== 'object') return null;
    const rawUrl = str(item.url);
    const det = rawUrl ? detectSocial(rawUrl) : null;
    const platform = platformFor(item.platform, det);
    let handle = cleanHandle(platform, item.handle);
    if (!handle && det) handle = det.handle;
    let url = det ? det.url : '';
    if (!url && handle) url = profileUrl(platform, handle);
    if (!url && !handle) return null;
    return { platform, handle, url };
}

// ลิงก์ Account แบบเก่า (ช่อง link) → ช่องทาง 1 ช่อง · ข้อความที่ไม่ใช่ลิงก์ = 'อื่น ๆ' เก็บข้อความไว้ทั้งก้อน
// (ไม่ตัด ไม่ยุบบรรทัด — linkFromSocials เขียนกลับได้ตรงตัวอักษร · เปิดฟอร์มแล้วบันทึกช่องอื่น ข้อความเดิมต้องไม่หาย)
function socialFromLink(link) {
    const text = str(link);
    if (!text) return null;
    const det = detectSocial(text);
    if (det) return det;
    return { platform: SOCIAL_OTHER, handle: cleanHandle(SOCIAL_OTHER, text), url: '' };
}

const socialKey = s => (s.url ? 'u|' + s.url.toLowerCase() : 'h|' + s.platform + '|' + s.handle.toLowerCase());

// รายการช่องทาง (ข้อมูลในฐาน) → รายการที่ใช้ได้ ไม่ซ้ำ ไม่เกิน SOCIALS_MAX · ว่าง + มี link เก่า = แปลง link ให้ 1 ช่อง
function normalizeSocials(list, legacyLink) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(list) ? list : []) {
        const s = normalizeSocial(item);
        if (!s || seen.has(socialKey(s))) continue;
        seen.add(socialKey(s));
        out.push(s);
        if (out.length >= SOCIALS_MAX) break;
    }
    if (!out.length) {
        const legacy = socialFromLink(legacyLink);
        if (legacy) out.push(legacy);
    }
    return out;
}

// ตรวจค่าจากฟอร์ม → { socials } หรือ { error } (ข้อความไทย โชว์ในฟอร์มได้เลย) · แถวว่าง (ไม่มีลิงก์และชื่อ) ข้ามไป
function validateSocials(list) {
    if (!Array.isArray(list)) return { error: 'ช่องทาง Social ไม่ถูกต้อง' };
    const out = [];
    const seen = new Set();
    for (const item of list) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: 'ช่องทาง Social ไม่ถูกต้อง' };
        const platform = str(item.platform);
        const url = str(item.url);
        const handle = str(item.handle);
        if (!url && !handle) continue;
        if (platform && !SOCIAL_PLATFORMS.includes(platform)) return { error: 'แพลตฟอร์มไม่ถูกต้อง' };
        if (url.length > SOCIAL_URL_MAX) return { error: `ลิงก์ช่องทาง Social ยาวเกิน ${SOCIAL_URL_MAX} ตัวอักษร` };
        if (url && !toUrl(url)) return { error: 'ลิงก์ช่องทาง Social ต้องขึ้นต้นด้วย http:// หรือ https://' };
        // เพดานตามแพลตฟอร์มที่ใช้จริง ('อื่น ๆ' = ข้อความอิสระ ยาวได้เท่าช่อง Account เดิม)
        const max = socialHandleMax(platformFor(platform, url ? detectSocial(url) : null));
        if (handle.length > max) return { error: `ชื่อช่องยาวเกิน ${max} ตัวอักษร` };
        const s = normalizeSocial({ platform, url, handle });
        if (!s || seen.has(socialKey(s))) continue;
        seen.add(socialKey(s));
        out.push(s);
    }
    if (out.length > SOCIALS_MAX) return { error: `ใส่ช่องทาง Social ได้ไม่เกิน ${SOCIALS_MAX} ช่องทาง` };
    return { socials: out };
}

// ค่าที่เขียนลงช่อง link เดิม — ลิงก์ของช่องทางแรกที่มีลิงก์ · ไม่มีลิงก์เลย = ข้อความของช่องแรก · ว่าง = null
function linkFromSocials(list) {
    const arr = Array.isArray(list) ? list : [];
    const withUrl = arr.find(s => s && str(s.url));
    if (withUrl) return str(withUrl.url);
    const first = arr.find(s => s && str(s.handle));
    return first ? str(first.handle) : null;
}

// ชื่อช่องที่โชว์บนการ์ด: '@aom_chr' · 'อื่น ๆ' โชว์ตามที่พิมพ์ · ไม่มีชื่อ = ''
function socialHandleText(s) {
    const h = s && str(s.handle);
    if (!h) return '';
    return s.platform === SOCIAL_OTHER ? h : '@' + h;
}

// ===== หน้าโปรไฟล์ที่ดึงรูปได้ (server/src/services/talentAvatar.js ดึง · ฟอร์มใช้ตัดสินว่าโชว์ปุ่ม "ดึงรูปจากลิงก์" และส่งลิงก์ไหน) =====
// ต้องเป็นหน้าช่องจริง — ลิงก์คลิป / Shorts / โพสต์ / ค้นหา / แท็ก / เพลง ให้ og:image เป็นรูปปกคลิปหรือรูปของบัญชีอื่น ห้ามเอามาเป็นรูปการ์ด
//   https เท่านั้น · โดเมนหลักของแพลตฟอร์ม (+ www. / m.) · ไม่มี user:pass / port แปลก
const PROFILE_PAGE = {
    TikTok: { host: /^(?:(?:www|m)\.)?tiktok\.com$/, path: /^\/@[^/]+\/?$/ },
    YouTube: { host: /^(?:(?:www|m)\.)?youtube\.com$/, path: /^\/(?:@[^/]+|channel\/UC[\w-]+|c\/[^/]+|user\/[^/]+)\/?$/ },
    // X: ส่วนเดียวของ path ที่ไม่ใช่หน้าระบบ (RESERVED.X — /i/status/... /home /search ...)
    X: { host: /^(?:(?:www|m)\.)?(?:x|twitter)\.com$/, path: /^\/([^/]+)\/?$/ }
};
function isProfilePage(platform, url) {
    const spec = Object.prototype.hasOwnProperty.call(PROFILE_PAGE, platform) ? PROFILE_PAGE[platform] : null;
    const u = spec ? toUrl(url) : null;
    if (!u || u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
    if (!spec.host.test(u.hostname.toLowerCase())) return false;
    const m = spec.path.exec(u.pathname);
    if (!m) return false;
    return platform !== 'X' || !RESERVED.X.includes(decodeSeg(m[1]).toLowerCase());
}
// ช่องทาง → ลิงก์หน้าโปรไฟล์ที่ดึงรูปได้ ('' = ดึงไม่ได้)
//   ลิงก์ที่บันทึกไว้ถ้าเป็นหน้าช่อง (เก็บ /c/ /user/ /channel/ ตามเดิม — ประกอบใหม่เป็น /@ชื่อ อาจได้ช่องอื่น)
//   ไม่งั้นประกอบจากชื่อช่องที่พิมพ์ไว้ (เช่นพิมพ์ชื่อช่องแต่วางลิงก์คลิป) · ไม่มีทั้งสองอย่าง = ''
function avatarPage(social) {
    if (!social || typeof social !== 'object' || !AVATAR_PLATFORMS.includes(social.platform)) return '';
    // ลิงก์ http:// ของหน้าช่อง = หน้าเดียวกันบน https (ตัวดึงรับแต่ https)
    const u = str(social.url) ? toUrl(social.url) : null;
    if (u && u.protocol === 'http:') u.protocol = 'https:';
    if (u && isProfilePage(social.platform, u.href)) return u.href;
    const built = str(social.handle) ? profileUrl(social.platform, social.handle) : '';
    return built && isProfilePage(social.platform, built) ? built : '';
}

module.exports = {
    SOCIAL_PLATFORMS, SOCIAL_OTHER, AVATAR_PLATFORMS, SOCIALS_MAX, SOCIAL_HANDLE_MAX, SOCIAL_URL_MAX, SOCIAL_OTHER_MAX,
    detectSocial, profileUrl, normalizeSocial, normalizeSocials, validateSocials, linkFromSocials, socialHandleText, socialFromLink,
    socialHandleMax, isProfilePage, avatarPage
};
