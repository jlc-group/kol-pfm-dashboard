// ช่องทาง Social ของคนใน Talent Book — คนหนึ่งมีได้หลายช่องทาง (ผู้ใช้สั่ง 1 ต.ค. 2026)
//   socials = [{ platform, handle, url }]
//     platform = หนึ่งใน SOCIAL_PLATFORMS ('อื่น ๆ' = เว็บอื่น / ข้อความที่ไม่ใช่ลิงก์)
//     handle   = ชื่อช่อง ไม่มี @ นำหน้า (โชว์ค่อยเติม @ — socialHandleText)
//     url      = ลิงก์ http/https ('' ได้เฉพาะช่อง 'อื่น ๆ' ที่พิมพ์เป็นข้อความเฉย ๆ)
// ส่วนบน (ถึง avatarPage) = สำเนาของ server/src/data/talentSocials.js — ต้องให้ผลตรงกันทุกฟังก์ชัน แก้ที่หนึ่งต้องแก้อีกที่
//   (tests/talent-socials-client.test.cjs เทียบสองฝั่งให้) · ส่วนล่าง = ตัวช่วยของหน้าเว็บอย่างเดียว (การ์ด / ค้นหา / ฟอร์ม)
// ข้อมูลเก่ามีแค่ช่อง link ช่องเดียว — normalizeSocials(socials, link) แปลง link เป็น 1 ช่องทางเมื่อ socials ว่าง (ของเดิมไม่หาย)
// ไฟล์นี้ต้องเป็น JS ล้วน (ไม่มี JSX / window) — เทสต์ import ตรงผ่าน node ได้
export const SOCIAL_OTHER = 'อื่น ๆ';
export const SOCIAL_PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'YouTube', 'X', 'Lemon8', SOCIAL_OTHER];
// ดึงรูปโปรไฟล์อัตโนมัติได้ (server ดึงจากหน้าโปรไฟล์) — Instagram / Facebook ดึงไม่ได้ ต้องวาง/อัปรูปเอง
export const AVATAR_PLATFORMS = ['TikTok', 'YouTube', 'X'];
export const NO_AVATAR_PLATFORMS = ['Instagram', 'Facebook'];
export const SOCIALS_MAX = 10;
export const SOCIAL_HANDLE_MAX = 100;
export const SOCIAL_URL_MAX = 1000;
// ช่อง 'อื่น ๆ' เป็นข้อความอิสระ — ช่อง Account แบบเก่า (link) ยาวได้ 1000 ตัว และมักพิมพ์หลายช่องทาง/หลายบรรทัดรวมกัน
// จึงยาวได้เท่ากัน และเก็บตามที่พิมพ์ (ไม่ยุบช่องว่าง/บรรทัด) — ไม่งั้นแค่เปิดฟอร์มแล้วบันทึก ข้อความเดิมจะถูกตัดแล้วเขียนทับ link ถาวร
export const SOCIAL_OTHER_MAX = 1000;

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
// แพลตฟอร์มที่รู้จักโดเมน — ใช้เช็คว่าลิงก์โพสต์ตรงกับ Platform ของแถวไหม (ตาราง On Process)
export const KNOWN_LINK_PLATFORMS = HOSTS.map(p => p.platform);
// โดเมนทางการที่มีแต่ลิงก์โพสต์ (ไม่ใช่หน้าโปรไฟล์ — จึงไม่ใส่ใน HOSTS ที่หน้า Talent ใช้แยกบัญชี) · รีวิว 6 ต.ค. 2026
// X ย่อลิงก์เป็น t.co · TikTok แชร์คลิปผ่าน tiktokv.com
const POST_ONLY_HOSTS = [
    { platform: 'TikTok', re: /(^|\.)tiktokv\.com$/ },
    { platform: 'X', re: /(^|\.)t\.co$/ }
];
// ลิงก์โพสต์ http/https → ชื่อแพลตฟอร์มจากโดเมน ('' = ไม่ใช่ลิงก์ / โดเมนที่ไม่รู้จัก) · ตาราง On Process ใช้เช็คลิงก์ผิด Platform
export function platformOfUrl(raw) {
    try {
        const u = new URL(str(raw));
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        const h = u.hostname.toLowerCase().replace(/\.$/, '');   // www.tiktok.com. (ลงท้ายจุด) = โดเมนเดียวกัน
        const extra = POST_ONLY_HOSTS.find(p => p.re.test(h));
        return platformOfHost(h) || (extra ? extra.platform : '');
    } catch { return ''; }
}
// ส่วนแรกของ path ที่ไม่ใช่ชื่อบัญชี (หน้าโพสต์ / หน้าระบบของแพลตฟอร์มนั้น)
const RESERVED = {
    Instagram: ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'legal', 'developer', 'web', 's'],
    Facebook: ['profile.php', 'people', 'pages', 'groups', 'watch', 'share', 'sharer', 'sharer.php', 'photo', 'photo.php', 'photos', 'story.php',
        'permalink.php', 'events', 'reel', 'reels', 'login', 'login.php', 'home.php', 'hashtag', 'marketplace', 'gaming', 'videos', 'plugins', 'help'],
    X: ['i', 'home', 'intent', 'search', 'hashtag', 'explore', 'share', 'settings', 'messages', 'notifications', 'compose', 'login', 'signup', 'tos', 'privacy']
};

// เพดานความยาวชื่อช่องของแพลตฟอร์มนั้น ('อื่น ๆ' = ข้อความอิสระ ยาวได้เท่าช่อง Account เดิม) — ฟอร์มใช้ตั้ง maxLength ของช่องชื่อบัญชี
export const socialHandleMax = platform => (platform === SOCIAL_OTHER ? SOCIAL_OTHER_MAX : SOCIAL_HANDLE_MAX);
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
export function profileUrl(platform, handle) {
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
export function detectSocial(raw) {
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
export function normalizeSocial(item) {
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
export function socialFromLink(link) {
    const text = str(link);
    if (!text) return null;
    const det = detectSocial(text);
    if (det) return det;
    return { platform: SOCIAL_OTHER, handle: cleanHandle(SOCIAL_OTHER, text), url: '' };
}

const socialKey = s => (s.url ? 'u|' + s.url.toLowerCase() : 'h|' + s.platform + '|' + s.handle.toLowerCase());

// รายการช่องทาง (ข้อมูลในฐาน) → รายการที่ใช้ได้ ไม่ซ้ำ ไม่เกิน SOCIALS_MAX · ว่าง + มี link เก่า = แปลง link ให้ 1 ช่อง
export function normalizeSocials(list, legacyLink) {
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

// ตรวจค่าจากฟอร์ม → { socials } หรือ { error } (ข้อความไทย) · แถวว่าง (ไม่มีลิงก์และชื่อ) ข้ามไป — server ตรวจซ้ำด้วยชุดเดียวกัน
export function validateSocials(list) {
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
export function linkFromSocials(list) {
    const arr = Array.isArray(list) ? list : [];
    const withUrl = arr.find(s => s && str(s.url));
    if (withUrl) return str(withUrl.url);
    const first = arr.find(s => s && str(s.handle));
    return first ? str(first.handle) : null;
}

// ชื่อช่องที่โชว์บนการ์ด: '@aom_chr' · 'อื่น ๆ' โชว์ตามที่พิมพ์ · ไม่มีชื่อ = ''
export function socialHandleText(s) {
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
export function isProfilePage(platform, url) {
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
export function avatarPage(social) {
    if (!social || typeof social !== 'object' || !AVATAR_PLATFORMS.includes(social.platform)) return '';
    // ลิงก์ http:// ของหน้าช่อง = หน้าเดียวกันบน https (ตัวดึงรับแต่ https)
    const u = str(social.url) ? toUrl(social.url) : null;
    if (u && u.protocol === 'http:') u.protocol = 'https:';
    if (u && isProfilePage(social.platform, u.href)) return u.href;
    const built = str(social.handle) ? profileUrl(social.platform, social.handle) : '';
    return built && isProfilePage(social.platform, built) ? built : '';
}

// ===================== ตัวช่วยของหน้าเว็บอย่างเดียว (ไม่มีใน server) =====================

// ป้ายสั้นบนการ์ด (พื้นที่แคบ) — ในหน้ารายละเอียดใช้ชื่อเต็ม
export const SOCIAL_SHORT = { TikTok: 'TikTok', Instagram: 'IG', Facebook: 'FB', YouTube: 'YouTube', X: 'X', Lemon8: 'Lemon8', [SOCIAL_OTHER]: 'ลิงก์' };

// ลิงก์ทั่วไป (เช่นลิงก์งาน/โพสต์ของงานที่จ้าง): http/https เท่านั้น · ไม่มี http:// เติมให้เฉพาะโดเมนของแพลตฟอร์มที่รู้จัก · ไม่ใช่ = ''
export function webUrl(raw) {
    const u = toUrl(raw);
    return u ? u.href : '';
}

// ข้อความของช่องทาง: ชื่อช่อง → (ไม่มี) โดเมน/ส่วนแรกของลิงก์ → ชื่อแพลตฟอร์ม
export function socialLabel(s) {
    if (!s) return '';
    const h = socialHandleText(s);
    if (h) return h;
    const u = s.url ? toUrl(s.url) : null;
    if (u) {
        const seg = decodeSeg(u.pathname.split('/').filter(Boolean)[0] || '');
        return u.hostname.replace(/^www\./, '') + (seg ? '/' + seg : '');
    }
    return str(s.platform);
}

// ข้อความไว้ค้นหา (ชื่อช่องทั้งแบบมี/ไม่มี @ · แพลตฟอร์ม · ลิงก์)
export const socialsSearchText = socials => (Array.isArray(socials) ? socials : [])
    .flatMap(s => (s ? [s.platform, SOCIAL_SHORT[s.platform], s.handle, socialHandleText(s), s.url] : [])).filter(Boolean).join('\n');

// ลิงก์หน้าโปรไฟล์ช่องแรกที่ระบบดึงรูปได้ (ตามลำดับในฟอร์ม — เลือกแบบเดียวกับที่ server ดึงเองหลังบันทึก: sourcesOf / pageFor)
// ลิงก์คลิป / Shorts / ลิงก์ย่อ / เว็บอื่นที่เลือกช่องทางเป็น TikTok ไว้ = ข้าม (ใช้ชื่อช่องประกอบแทนถ้ามี) · ไม่มีเลย = ''
export const avatarSource = socials => (Array.isArray(socials) ? socials : []).map(avatarPage).find(Boolean) || '';
// มีช่องทางที่ระบบดึงรูปโปรไฟล์ได้ไหม (โชว์ปุ่ม "ดึงรูปจากลิงก์" / ข้อความ "ระบบดึงรูปให้เอง")
export const canFetchAvatar = socials => !!avatarSource(socials);
// แพลตฟอร์มตามโดเมนของลิงก์จริง (ไม่ใช่ช่องทางที่เลือก)
const urlPlatform = s => {
    const d = s && s.url ? detectSocial(s.url) : null;
    return d ? d.platform : '';
};
// ใส่ลิงก์ TikTok / YouTube / X ไว้ แต่ไม่ใช่หน้าช่อง (ลิงก์คลิป / Shorts / ลิงก์ย่อ) และไม่มีช่องไหนดึงรูปได้ → แพลตฟอร์มนั้น (ฟอร์มบอกให้ใส่ลิงก์หน้าช่อง) · ไม่มี = ''
export const notProfilePlatform = socials => {
    const list = Array.isArray(socials) ? socials : [];
    if (canFetchAvatar(list)) return '';
    const hit = list.find(s => AVATAR_PLATFORMS.includes(urlPlatform(s)));
    return hit ? urlPlatform(hit) : '';
};
// มีแต่ลิงก์ IG / Facebook (ดึงรูปเองไม่ได้) → บอกให้วาง/อัปรูปแทน
export const onlyNoAvatarLinks = socials => {
    const list = Array.isArray(socials) ? socials : [];
    return !canFetchAvatar(list) && list.some(s => NO_AVATAR_PLATFORMS.includes(urlPlatform(s)));
};

// ===== แถวในฟอร์ม — autoHandle = ชื่อช่องที่ระบบเติมให้รอบล่าสุด (ไม่ทับชื่อที่ผู้ใช้พิมพ์เอง) =====
export const emptySocialRow = (platform = '') => ({ platform, handle: '', url: '', autoHandle: '' });
// ช่องทางที่บันทึกไว้ → แถวในฟอร์ม
export const socialRowsOf = socials => (Array.isArray(socials) ? socials : [])
    .filter(Boolean).map(s => ({ platform: str(s.platform), handle: str(s.handle), url: str(s.url), autoHandle: '' }));

// พิมพ์/วางลิงก์ในแถว → เลือกแพลตฟอร์มและเติมชื่อช่องให้ (ลิงก์ของแพลตฟอร์มที่รู้จักชนะที่เลือกไว้ — server ก็ตัดสินแบบนี้)
// ลิงก์เว็บอื่น: เปลี่ยนเป็น "อื่น ๆ" เฉพาะตอนยังไม่ได้เลือก · ช่องลิงก์เก็บตามที่พิมพ์ (บันทึกแล้ว server จัดรูปลิงก์ให้)
export function fillFromUrl(row, text) {
    const r = row || emptySocialRow();
    const next = { ...r, url: text };
    const det = detectSocial(text);
    if (!det) return next;
    if (det.platform !== SOCIAL_OTHER || !r.platform) next.platform = det.platform;
    const typed = !!r.handle && r.handle !== r.autoHandle;
    if (!typed) { next.handle = det.handle; next.autoHandle = det.handle; }
    return next;
}
// วางในช่องชื่อช่อง: ถ้าเป็นลิงก์ (แพลตฟอร์มที่รู้จัก หรือขึ้นต้น http) ย้ายไปช่องลิงก์แล้วอ่านชื่อช่องให้ · ไม่ใช่ลิงก์ = ใส่ตามที่วาง
export function fillFromHandle(row, text) {
    const r = row || emptySocialRow();
    const det = detectSocial(text);
    if (det && (det.platform !== SOCIAL_OTHER || /^https?:\/\//i.test(str(text)))) {
        return fillFromUrl({ ...r, handle: r.handle === r.autoHandle ? '' : r.handle }, str(text));
    }
    return { ...r, handle: text };
}

// ตรวจแถวก่อนบันทึก → ข้อความ error ('' = ผ่าน) · แถวว่างทั้งแถว = ไม่นับ (ตัดทิ้งตอนบันทึก)
// มีชื่อช่องแต่ไม่มีลิงก์ ต้องเลือกช่องทาง (ไม่งั้นกลายเป็น "อื่น ๆ" และประกอบลิงก์โปรไฟล์ให้ไม่ได้)
export function socialRowError(row) {
    if (!row) return '';
    const url = str(row.url);
    const handle = str(row.handle);
    if (!url && !handle) return '';
    if (url && !toUrl(url)) return 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://';
    if (url.length > SOCIAL_URL_MAX) return `ลิงก์ยาวเกิน ${SOCIAL_URL_MAX} ตัวอักษร`;
    // เพดานเดียวกับ validateSocials ของ server ('อื่น ๆ' = ข้อความอิสระ ยาวได้เท่าช่อง Account เดิม)
    const max = socialHandleMax(platformFor(row.platform, url ? detectSocial(url) : null));
    if (handle.length > max) return `ชื่อช่องยาวเกิน ${max} ตัวอักษร`;
    if (!url && !SOCIAL_PLATFORMS.includes(str(row.platform))) return 'เลือกช่องทางก่อน (TikTok / Instagram / ...)';
    return '';
}
// แถวในฟอร์ม → socials ที่ส่งไปบันทึก (ตัดแถวว่าง / ซ้ำ · ไม่มี autoHandle) — รูปเดียวกับที่ server เก็บ
export const socialsForSave = rows => normalizeSocials((Array.isArray(rows) ? rows : [])
    .map(r => ({ platform: str(r && r.platform), handle: r && r.handle, url: r && r.url })));
