// หาโพสต์ IG / FB ให้แถวที่ยังไม่มี ID POST จากรายการโพสต์ KOL ของ WeBoostX (26 ต.ค. 2026)
// สัญญา: docs/KOL_DASHBOARD_API.md ข้อ 2 ของ jlc-group/WeBoostX2 — GET /api/v1/integrations/kol-pfm/posts
// creator / post_date / sku_codes อ่านจาก "ชื่อแอด" ที่ทีมตั้ง → ใช้ช่วยเรียงตัวเลือกเท่านั้น
// ห้ามจับคู่และบันทึกเอง — คนต้องเปิดดูโพสต์แล้วกดยืนยัน (routes/ads.js · wx-confirm) ระบบถึงเก็บ id_post
// เรียกจาก server เท่านั้น (key อยู่ฝั่ง server · เบราว์เซอร์ได้แค่ผลที่คัดแล้ว)
const { platformOf } = require('./weboostxMetrics');
const sync = require('./weboostxPfmSync');

const PAGE = 2000;          // limit สูงสุดของ API
const MAX_PAGES = 5;        // กันวนไม่จบ (10,000 โพสต์ — ตอนนี้ทั้งบริษัทมีหลักร้อย)
const DAY = 86400000;

const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v))
    && new Date(v).toISOString().slice(0, 10) === v;
const dayOr = v => (isDay(v) ? v : null);
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
// ลิงก์ที่ส่งให้เบราว์เซอร์เปิด — https + โดเมน IG / FB เท่านั้น (กัน javascript: / เว็บอื่น)
function safeLink(v) {
    if (typeof v !== 'string' || v.length > 500) return null;
    try {
        const u = new URL(v);
        const host = u.hostname.toLowerCase();
        return u.protocol === 'https:' && /^((www|m|web)\.)?(instagram|facebook)\.com$/.test(host) ? u.href : null;
    } catch { return null; }
}

// แถวจาก API → ค่าที่ใช้ได้ (ผิดรูป = null ทั้งแถว / ทิ้งเฉพาะช่อง)
function sanitizePost(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const platform = platformOf(raw.platform);
    const id = String(raw.id_post ?? '');
    if (!platform || !/^\d{1,50}$/.test(id)) return null;
    const story = typeof raw.fb_story_id === 'string' && /^\d{1,50}_\d{1,50}$/.test(raw.fb_story_id) ? raw.fb_story_id : null;
    const skus = Array.isArray(raw.sku_codes)
        ? [...new Set(raw.sku_codes.filter(s => typeof s === 'string' && /^[A-Za-z0-9-]{1,20}$/.test(s.trim())).map(s => s.trim().toUpperCase()))].slice(0, 30)
        : [];
    return {
        platform, id_post: id, fb_story_id: platform === 'facebook' ? story : null,
        permalink: safeLink(raw.permalink),
        brand: text(raw.brand, 60), brand_code: text(raw.brand_code, 40),
        creator: text(raw.creator, 100),
        post_date: dayOr(raw.post_date), first_ad_date: dayOr(raw.first_ad_date), last_ad_date: dayOr(raw.last_ad_date),
        sku_codes: skus,
        ads_count: num(raw.ads_count), active_ads: num(raw.active_ads),
        ad_spend: num(raw.ad_spend), ad_reach: num(raw.ad_reach)
    };
}

// GET …/posts?platform=&since=&limit=&offset= — ทุกหน้าจนหมด (หรือครบ MAX_PAGES)
async function fetchPosts({ platform, since }, { fetchImpl = fetch, env = process.env } = {}) {
    const settings = sync.config(env);
    if (!settings.apiKey) throw new Error('WeBoostX key is not configured');
    if (!platformOf(platform)) throw new Error('platform must be instagram or facebook');
    const out = new Map();
    for (let page = 0; page < MAX_PAGES; page++) {
        const qs = new URLSearchParams({ platform, limit: String(PAGE), offset: String(page * PAGE) });
        if (isDay(since)) qs.set('since', since);
        const response = await fetchImpl(`${settings.baseUrl}/api/v1/integrations/kol-pfm/posts?${qs}`, {
            headers: { 'X-PFM-API-Key': settings.apiKey }, redirect: 'manual', signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw new Error(`WeBoostX posts returned HTTP ${response.status}`);
        const payload = await response.json();
        const data = payload && payload.status === 'success' ? payload.data : null;
        if (!data || !Array.isArray(data.rows)) throw new Error('WeBoostX posts returned an invalid response');
        for (const raw of data.rows) {
            const p = sanitizePost(raw);
            if (p && p.platform === platform && !out.has(p.id_post)) out.set(p.id_post, p);
        }
        if (data.has_more !== true || !data.rows.length) break;
    }
    return [...out.values()];
}

// เก็บผลไว้ชั่วคราว — เปิดหน้าต่างหาหลายแถวติดกันไม่ต้องถาม WeBoostX ทุกครั้ง · ล้มแล้วไม่จำ (ลองใหม่ได้ทันที)
function createPostsCache({ ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    const memo = new Map();
    return {
        async get(key, load) {
            // ทิ้งของที่หมดเวลาแล้วทุกครั้ง — คีย์เปลี่ยนตามวัน (since) ไม่งั้นค้างในหน่วยความจำจน restart (ผลรีวิว 26 ต.ค.)
            for (const [k, v] of memo) if (now() - v.at >= ttlMs) memo.delete(k);
            const hit = memo.get(key);
            if (hit && now() - hit.at < ttlMs) return hit.promise;
            const promise = Promise.resolve().then(load);
            memo.set(key, { at: now(), promise });
            promise.catch(() => { if (memo.get(key)?.promise === promise) memo.delete(key); });
            return promise;
        },
        clear() { memo.clear(); }
    };
}

// ดึงโพสต์ที่มีค่าแอด (หรือโพสต์) ตั้งแต่วันไหน: 180 วันก่อน หรือ 14 วันก่อนวันลงโพสต์ของแถว (ที่เก่ากว่า)
function sinceFor(postDate, today = new Date()) {
    const base = new Date(today.getTime() - 180 * DAY);
    const own = isDay(postDate) ? new Date(Date.parse(postDate) - 14 * DAY) : null;
    return (own && own < base ? own : base).toISOString().slice(0, 10);
}

// ===== เรียงตัวเลือก =====
// ชื่อเทียบกัน: ตัวเล็ก · ไม่มี @ / ช่องว่าง
const norm = v => String(v || '').toLowerCase().replace(/^@+/, '').replace(/\s+/g, '').trim();
// ชื่อบัญชีจากลิงก์โปรไฟล์ (instagram.com/<ชื่อ> · facebook.com/<ชื่อ>)
function handleOf(link) {
    try {
        const u = new URL(String(link || '').trim());
        if (!/(^|\.)(instagram|facebook)\.com$/.test(u.hostname.toLowerCase())) return null;
        const first = u.pathname.split('/').filter(Boolean)[0];
        return first && !['p', 'reel', 'reels', 'tv', 'profile.php', 'people', 'pages'].includes(first.toLowerCase()) ? norm(first) : null;
    } catch { return null; }
}
function distance(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}
const letters = v => String(v || '').toLowerCase().replace(/[^a-z0-9ก-๙]/g, '');
// โพสต์นี้เป็นของแบรนด์เดียวกับคลิปไหม (ชื่อหรือรหัสแบรนด์ใน WeBoostX เทียบตัวอักษรล้วน: "Jula's Herb" = "JULASHERB")
// ไม่รู้แบรนด์ (บัญชีโฆษณาที่ WeBoostX ยังไม่ผูกแบรนด์) = ไม่นับ — คนดูได้เฉพาะแบรนด์ที่มีสิทธิ์ ห้ามเห็นโพสต์/ค่าแอดของแบรนด์อื่น (ผลรีวิว 26 ต.ค.)
function brandMatches(brand, post) {
    const mine = letters(brand);
    return !!mine && [post.brand, post.brand_code].some(b => letters(b) === mine);
}
const codesOf = product => [...new Set(String(product || '').split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean))];
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);

// clip = { platform, brand, account_name, link_account, post_date, product } · คืน { score, level, reasons[{ text, ok }] }
function scorePost(clip, post) {
    let score = 0;
    const reasons = [];
    const names = [...new Set([norm(clip.account_name), handleOf(clip.link_account)].filter(Boolean))];
    const c = norm(post.creator);
    if (c && names.length) {
        if (names.includes(c)) { score += 60; reasons.push({ text: 'ชื่อ KOL ตรง', ok: true }); }
        else if (names.some(n => n.length >= 4 && c.length >= 4 && distance(n, c) <= 2)) { score += 35; reasons.push({ text: 'ชื่อ KOL ใกล้เคียง (สะกดต่างเล็กน้อย)', ok: true }); }
        else if (names.some(n => n.length >= 4 && c.length >= 4 && (n.includes(c) || c.includes(n)))) { score += 25; reasons.push({ text: 'ชื่อ KOL ใกล้เคียง', ok: true }); }
        else reasons.push({ text: 'ชื่อ KOL ไม่ตรง', ok: false });
    } else if (!c) reasons.push({ text: 'ชื่อแอดไม่มีชื่อ KOL', ok: false });
    if (isDay(clip.post_date) && post.post_date) {
        const d = Math.abs(dayDiff(post.post_date, clip.post_date));
        if (d === 0) { score += 25; reasons.push({ text: 'วันลงโพสต์ตรง', ok: true }); }
        else if (d <= 2) { score += 15; reasons.push({ text: `วันลงโพสต์ห่าง ${d} วัน`, ok: true }); }
        else if (d <= 7) { score += 5; reasons.push({ text: `วันลงโพสต์ห่าง ${d} วัน`, ok: false }); }
        else reasons.push({ text: `วันลงโพสต์ห่าง ${d} วัน`, ok: false });
    } else if (isDay(clip.post_date) && post.first_ad_date) {
        const d = dayDiff(post.first_ad_date, clip.post_date);
        if (d >= 0 && d <= 14) { score += 5; reasons.push({ text: `เริ่มยิงแอดหลังวันลงโพสต์ ${d} วัน`, ok: true }); }
    }
    const mine = codesOf(clip.product);
    if (mine.length && post.sku_codes.length) {
        const hit = post.sku_codes.filter(s => mine.includes(s));
        if (hit.length) { score += 15 + (hit.length === post.sku_codes.length ? 5 : 0); reasons.push({ text: `สินค้าตรง ${hit.join(', ')}`, ok: true }); }
        else reasons.push({ text: `สินค้าในแอด ${post.sku_codes.join(', ')} ไม่ตรง`, ok: false });
    }
    const level = score >= 85 ? 'high' : score >= 50 ? 'mid' : 'low';
    return { score, level, reasons };
}

// ตัวเลือกที่ส่งให้หน้าเว็บ: เฉพาะ Platform + แบรนด์เดียวกับคลิป · ไม่ค้น = คะแนน ≥ 25 สูงสุด 10 อัน · ค้นชื่อ/ID = ที่ตรงคำค้นสูงสุด 30 อัน
function rankPosts(clip, posts, { q = '' } = {}) {
    const query = norm(q);
    const list = (posts || []).filter(p => p.platform === platformOf(clip.platform) && brandMatches(clip.brand, p))
        .filter(p => !query || norm(p.creator).includes(query) || p.id_post === query || p.fb_story_id === query)
        .map(p => ({ ...p, ...scorePost(clip, p) }))
        .sort((a, b) => (b.score - a.score) || String(b.last_ad_date || '').localeCompare(String(a.last_ad_date || '')) || a.id_post.localeCompare(b.id_post));
    return query ? list.slice(0, 30) : list.filter(p => p.score >= 25).slice(0, 10);
}

module.exports = { sanitizePost, fetchPosts, createPostsCache, sinceFor, handleOf, brandMatches, scorePost, rankPosts, safeLink };
