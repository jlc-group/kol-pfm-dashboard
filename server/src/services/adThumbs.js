// ================= รูปปกคลิป TikTok สำหรับคอลัมน์ IMAGE ในหน้า Ads =================
// ดึงผ่าน TikTok oEmbed (สาธารณะ ไม่ต้องใช้คีย์) → ได้ลิงก์รูปปกบน CDN ของ TikTok
// ลิงก์นั้นมีลายเซ็นและหมดอายุในไม่กี่วัน จึงโหลดรูปมาเก็บไว้ใน UPLOAD_DIR/ads-thumbs แล้วเสิร์ฟจากเราเอง
// (ใช้ได้ตลอด แม้ลิงก์ของ TikTok หมดอายุหรือคลิปถูกลบทีหลัง)
//
// กันไว้:
//   • เรียกออกไปแค่ www.tiktok.com/oembed กับโดเมน CDN รูปของ TikTok เท่านั้น (ข้อมูลพาไปเครื่องอื่นไม่ได้)
//   • รูปต้องเป็น jpeg/png/webp/gif ไม่เกิน 3MB · ไม่ตาม redirect ของรูป
//   • คลิปเดียวกันขอพร้อมกันหลายคน = ดึงครั้งเดียว · ดึงไม่ได้ = พักไว้ 20 นาทีก่อนลองใหม่ (ไม่ยิง TikTok รัว ๆ)
//   • ดึงพร้อมกันได้ไม่เกิน 3 คลิป
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OEMBED = 'https://www.tiktok.com/oembed?url=';
const TIMEOUT_MS = 8000;
const MAX_BYTES = 3 * 1024 * 1024;
const FAIL_TTL_MS = 20 * 60 * 1000;
const MAX_PARALLEL = 3;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const EXTS = Object.values(TYPES);

const TIKTOK_HOST = /(^|\.)tiktok\.com$/i;
// โดเมนรูปของ TikTok (p16-common-sign.tiktokcdn.com / p19-...-sign.tiktokcdn-us.com / ...ibyteimg.com)
const CDN_HOST = /(^|\.)(tiktokcdn(-[a-z0-9]+)?\.com|ibyteimg\.com)$/i;

function parseHttp(raw) {
    try {
        const u = new URL(String(raw || '').trim());
        return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
    } catch { return null; }
}

// ลิงก์โพสต์ TikTok → ชื่อไฟล์แคช (ไม่ใช่ TikTok = null)
// มีเลขคลิปในลิงก์ (/video/<id> /photo/<id> /v/<id>.html) ใช้เลขคลิป · ลิงก์ย่อ (vt.tiktok.com/xxx) ใช้แฮชของลิงก์
// เปลี่ยนลิงก์โพสต์ = ชื่อใหม่ = ดึงรูปใหม่ (ชื่อนี้ต่อท้าย ?v= ให้หน้าเว็บด้วย แคชของเบราว์เซอร์จึงไม่ค้างรูปเก่า)
function thumbKey(postUrl) {
    const u = parseHttp(postUrl);
    if (!u || !TIKTOK_HOST.test(u.hostname)) return null;
    const m = /\/(?:video|photo|v)\/(\d{8,25})(?:\.html)?(?:\/|$)/.exec(u.pathname);
    if (m) return 'tt' + m[1];
    return 'tu' + crypto.createHash('sha1').update(u.href).digest('hex').slice(0, 24);
}

// path ที่หน้าเว็บใช้ขอรูปของแถวนี้ (null = ไม่มีรูปปกให้ดึง เช่นโพสต์ IG)
const thumbPath = row => {
    const key = row && row.sub_id != null ? thumbKey(row.post_url) : null;
    return key ? `/ads/${encodeURIComponent(row.sub_id)}/thumb?v=${key}` : null;
};

const cdnOk = raw => {
    const u = parseHttp(raw);
    return !!u && u.protocol === 'https:' && CDN_HOST.test(u.hostname);
};

function createThumbCache({ dir, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
    const pending = new Map();   // key -> Promise (คลิปเดียวกันขอพร้อมกัน = ดึงครั้งเดียว)
    const failedAt = new Map();  // key -> เวลาที่ดึงไม่ได้ล่าสุด
    let running = 0;
    const queue = [];
    const slot = () => new Promise(resolve => {
        if (running < MAX_PARALLEL) { running++; resolve(); } else queue.push(resolve);
    });
    const release = () => { const next = queue.shift(); if (next) next(); else running--; };

    const fileOf = key => {
        for (const ext of EXTS) {
            const fp = path.join(dir, `${key}.${ext}`);
            if (fs.existsSync(fp)) return fp;
        }
        return null;
    };

    async function download(postUrl) {
        const meta = await fetchImpl(OEMBED + encodeURIComponent(postUrl), {
            headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (!meta.ok) throw new Error('oembed ' + meta.status);
        const info = await meta.json();
        const src = info && info.thumbnail_url;
        if (!cdnOk(src)) throw new Error('thumbnail_url ไม่ใช่โดเมนรูปของ TikTok');
        const img = await fetchImpl(src, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (img.status !== 200) throw new Error('image ' + img.status);
        const type = String(img.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!TYPES[type]) throw new Error('ไม่ใช่ไฟล์รูป: ' + type);
        const declared = Number(img.headers.get('content-length'));
        if (declared > MAX_BYTES) throw new Error('รูปใหญ่เกิน');
        const buf = Buffer.from(await img.arrayBuffer());
        if (!buf.length || buf.length > MAX_BYTES) throw new Error('ขนาดรูปไม่ถูกต้อง');
        return { buf, ext: TYPES[type] };
    }

    // คืน path ไฟล์รูปในเครื่อง หรือ null (ไม่ใช่ TikTok / ดึงไม่ได้)
    async function get(postUrl) {
        const key = thumbKey(postUrl);
        if (!key) return null;
        const have = fileOf(key);
        if (have) return have;
        const lastFail = failedAt.get(key);
        if (lastFail && now() - lastFail < FAIL_TTL_MS) return null;
        if (pending.has(key)) return pending.get(key);
        const job = (async () => {
            await slot();
            try {
                const again = fileOf(key);   // อีกคำขอเพิ่งเขียนเสร็จระหว่างรอคิว
                if (again) return again;
                const { buf, ext } = await download(postUrl);
                fs.mkdirSync(dir, { recursive: true });
                const fp = path.join(dir, `${key}.${ext}`);
                // เขียนไฟล์ชั่วคราวแล้วค่อยเปลี่ยนชื่อ — ไม่มีใครได้รูปครึ่ง ๆ กลาง ๆ
                const tmp = `${fp}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
                try {
                    await fs.promises.writeFile(tmp, buf);
                    await fs.promises.rename(tmp, fp);
                } catch (e) {
                    // เขียนไม่ครบ / เปลี่ยนชื่อไม่ได้ (Windows: แอนตี้ไวรัสจับไฟล์อยู่) — ลบไฟล์ชั่วคราวทิ้ง ไม่ให้ค้างสะสม
                    await fs.promises.rm(tmp, { force: true }).catch(() => {});
                    throw e;
                }
                failedAt.delete(key);
                return fp;
            } catch {
                failedAt.set(key, now());
                if (failedAt.size > 5000) failedAt.clear();
                return null;
            } finally {
                release();
            }
        })();
        pending.set(key, job);
        try { return await job; } finally { pending.delete(key); }
    }

    return { get };
}

module.exports = { thumbKey, thumbPath, cdnOk, createThumbCache, MAX_BYTES, FAIL_TTL_MS };
