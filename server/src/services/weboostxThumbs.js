// ================= รูปปกโพสต์ IG / FB จาก WeBoostX → สำเนาของเราเอง (คอลัมน์ IMAGE หน้า Ads) =================
// สัญญา WeBoostX (docs/KOL_DASHBOARD_API.md ของ jlc-group/WeBoostX2 ข้อ 4 + ขั้นตอนฝั่ง consumer ข้อ 7 · 19 ต.ค. 2026):
//   แถวจาก /metrics มี thumbnail_url = PATH (/api/v1/integrations/kol-pfm/thumbnail/<id>) · ดึงรูปได้ด้วย GET {BASE}{path} + X-PFM-API-Key
//   เบราว์เซอร์ห้ามเรียก WeBoostX ตรง ๆ (key จะหลุด) → server ดาวน์โหลดมาเก็บใน UPLOAD_DIR/weboostx-thumbs แล้วเสิร์ฟเองที่
//   GET /api/ads/:subId/thumb (ต้องล็อกอิน + สิทธิ์แบรนด์ เหมือนรูปปก TikTok)
// รูปของ path เดิมไม่เปลี่ยน (WeBoostX ไม่ลบ/ไม่เขียนทับ) → โหลดครั้งเดียวต่อ path · path เปลี่ยน = รูปใหม่ = โหลดใหม่
//
// กันไว้:
//   • สร้าง URL จาก BASE ที่ตั้งไว้ + path ที่ผ่านรูปแบบเท่านั้น (ข้อมูลจาก WeBoostX พา key ไปเครื่องอื่นไม่ได้) · ไม่ตาม redirect
//   • 200 + Content-Type image/* + ไม่เกิน 5MB + หัวไฟล์เป็น jpg/png/webp/gif จริง จึงเก็บ
//   • พร้อมกันไม่เกิน 4 รายการ · ไม่เกิน 200 path ต่อรอบ · timeout 20 วิ
//   • ล้ม (404 / timeout / 5xx) = จดสาเหตุไว้ที่ thumbnail_error แล้วลองใหม่รอบหน้า · ไม่ลบสำเนาเดิม
//   • ไม่ log / ไม่คืนค่า key หรือ URL ของ WeBoostX
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { THUMB_PATH_RE } = require('./weboostxMetrics');
const { resolveInside } = require('../store/logic');

const DIR_NAME = 'weboostx-thumbs';
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const MAX_PARALLEL = 4;
const MAX_PER_RUN = 200;
const EXTS = ['jpg', 'png', 'webp', 'gif'];
const NAME_RE = /^(wx[0-9a-f]{16})\.(jpg|png|webp|gif)$/;

let running = false;
let lastRun = null;

// path ของ WeBoostX → ชื่อไฟล์ (ไม่มีนามสกุล) · path เดียวกัน = ชื่อเดียวกัน (หลายคลิปของโพสต์เดียวใช้ไฟล์เดียว)
const keyOf = p => 'wx' + crypto.createHash('sha1').update(String(p)).digest('hex').slice(0, 16);
// ชื่อไฟล์ใน thumbnail_local → key (รูปแบบไม่ตรง = null — ไม่เปิดไฟล์อื่นให้ใคร)
const localKeyOf = name => {
    const m = typeof name === 'string' ? NAME_RE.exec(name) : null;
    return m ? m[1] : null;
};
// สำเนาที่มีอยู่ตรงกับ path ปัจจุบันไหม (ไม่ตรง / ยังไม่มี = ต้องโหลด)
const isCurrent = row => !!row && typeof row.weboostx_thumbnail_path === 'string'
    && localKeyOf(row.thumbnail_local) === keyOf(row.weboostx_thumbnail_path);

const thumbDir = uploadDir => path.join(uploadDir, DIR_NAME);
function defaultDir() {
    // โหลดตอนใช้จริง — require config/uploads สร้างโฟลเดอร์ทันที ไม่ต้องเกิดตอนแค่ require โมดูลนี้
    return thumbDir(require('../config/uploads').UPLOAD_DIR);
}

// path ที่หน้าเว็บใช้ขอรูป (ผ่าน route ของเราเท่านั้น) — ยังไม่มีสำเนา = null
const thumbPathFor = row => {
    const key = row && row.sub_id != null ? localKeyOf(row.thumbnail_local) : null;
    return key ? `/ads/${encodeURIComponent(row.sub_id)}/thumb?v=${key}` : null;
};
// ไฟล์สำเนาของแถวนี้ในเครื่อง (ไม่มี / ชื่อผิดรูป / หลุดโฟลเดอร์ = null)
function localFile(name, dir = defaultDir()) {
    if (!localKeyOf(name)) return null;
    const fp = resolveInside(dir, name);
    return fp && fs.existsSync(fp) ? fp : null;
}

// หัวไฟล์จริง → นามสกุล
function sniff(buf) {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
    if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
    return null;
}

// URL ของรูป = BASE ที่ตั้งไว้ + path ที่ผ่านรูปแบบ · ปลายทางต้องเป็นเครื่องเดียวกับ BASE เท่านั้น
function thumbUrl(baseUrl, p) {
    if (typeof p !== 'string' || !THUMB_PATH_RE.test(p)) return null;
    let base, url;
    try {
        base = new URL(String(baseUrl || ''));
        url = new URL(String(baseUrl).replace(/\/+$/, '') + p);
    } catch { return null; }
    if (!/^https?:$/.test(base.protocol) || base.username || base.password) return null;
    return url.origin === base.origin && url.pathname.endsWith(p) && !url.search && !url.hash ? url : null;
}

const fail = code => Object.assign(new Error('WeBoostX thumbnail: ' + code), { thumbCode: code });

async function readCapped(res, max) {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > max) {
        if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
        throw fail('too_large');
    }
    if (!res.body || !res.body.getReader) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > max) throw fail('too_large');
        return buf;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    let finished = false;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) { finished = true; break; }
            size += value.byteLength;
            if (size > max) throw fail('too_large');
            chunks.push(Buffer.from(value));
        }
    } catch (e) {
        if (e && e.thumbCode) throw e;
        throw fail(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network');
    } finally {
        if (!finished) reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks);
}

// ดาวน์โหลดรูป 1 path → { buf, ext } · ไม่ผ่านด่าน = throw (thumbCode บอกสาเหตุสั้น ๆ ไม่มี key / URL)
async function download(p, { baseUrl, apiKey, fetchImpl }) {
    const url = thumbUrl(baseUrl, p);
    if (!url) throw fail('bad_path');
    let res;
    try {
        res = await fetchImpl(url.href, {
            headers: { 'X-PFM-API-Key': apiKey, Accept: 'image/*' },
            redirect: 'manual',   // ไม่ตาม redirect — header key ติดไปกับคำขอถัดไปได้
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
    } catch (e) {
        throw fail(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network');
    }
    if (res.status !== 200) {
        if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
        throw fail('http_' + res.status);
    }
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) {
        if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
        throw fail('not_image');
    }
    const buf = await readCapped(res, MAX_BYTES);
    if (!buf.length) throw fail('empty');
    const ext = sniff(buf);
    if (!ext) throw fail('unsupported_image');
    return { buf, ext };
}

function existingFile(dir, key) {
    for (const ext of EXTS) {
        const name = `${key}.${ext}`;
        const fp = resolveInside(dir, name);
        if (fp && fs.existsSync(fp)) return name;
    }
    return null;
}

async function writeAtomic(dir, name, buf) {
    fs.mkdirSync(dir, { recursive: true });
    const fp = resolveInside(dir, name);
    if (!fp) throw fail('write_failed');
    // เขียนไฟล์ชั่วคราวแล้วค่อยเปลี่ยนชื่อ — ไม่มีใครได้รูปครึ่ง ๆ กลาง ๆ
    const tmp = `${fp}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
        await fs.promises.writeFile(tmp, buf);
        await fs.promises.rename(tmp, fp);
    } catch {
        await fs.promises.rm(tmp, { force: true }).catch(() => {});
        throw fail('write_failed');
    }
}

// ทำทีละไม่เกิน limit งาน
async function eachLimit(items, limit, fn) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const item = items[next++];
            await fn(item);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// 1 รอบ: หา path ที่ยังไม่มีสำเนา (หรือ path เปลี่ยน) → ดาวน์โหลด → บันทึก · คืนสรุปตัวเลข (ไม่มี key / URL)
async function runThumbs({ storeImpl, fetchImpl = fetch, settings = {}, dir } = {}) {
    if (!settings.apiKey) return { skipped: true, reason: 'unconfigured' };
    if (running) return { skipped: true, reason: 'already_running' };
    running = true;
    const startedAt = new Date().toISOString();
    try {
        const st = storeImpl || require('../store/pg/weboostxSync');
        const rows = await st.thumbRows();
        if (rows === null) {
            lastRun = { status: 'skipped', reason: 'columns_missing', started_at: startedAt };
            return { skipped: true, reason: 'columns_missing' };
        }
        const where = dir || defaultDir();
        // จัดกลุ่มตาม path — ต้องโหลดเมื่อมีสักแถวของ path นั้นที่ยังไม่มีสำเนาที่ตรง
        // หรือฐานบอกว่ามีแต่ไฟล์ไม่อยู่ในเครื่องแล้ว (ย้ายเครื่อง / กู้ข้อมูล / มีคนลบโฟลเดอร์) — ไม่งั้นช่องรูปว่างถาวร
        const byPath = new Map();
        const onDisk = new Map();   // ชื่อไฟล์ → มีจริงไหม (เช็คครั้งเดียวต่อชื่อ)
        const fileThere = name => {
            if (!onDisk.has(name)) onDisk.set(name, !!localFile(name, where));
            return onDisk.get(name);
        };
        for (const r of rows) {
            const p = r.weboostx_thumbnail_path;
            if (typeof p !== 'string' || !THUMB_PATH_RE.test(p)) continue;
            const g = byPath.get(p) || { path: p, stale: false, tried: false };
            if (!isCurrent(r) || !fileThere(r.thumbnail_local)) g.stale = true;
            if (r.thumbnail_error) g.tried = true;
            byPath.set(p, g);
        }
        // ที่ยังไม่เคยลองขึ้นก่อน · ที่เคยล้ม (เช่น 404 ยังไม่มีรูป) สลับลำดับแบบสุ่มทุกรอบ
        // — มี path ที่ล้มถาวรเกิน 200 ตัวก็ไม่บังตัวอื่นไปตลอด (ทุกตัวได้ลองใหม่เรื่อย ๆ)
        const stale = [...byPath.values()].filter(g => g.stale);
        const retry = stale.filter(g => g.tried);
        for (let i = retry.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [retry[i], retry[j]] = [retry[j], retry[i]];
        }
        const todo = [...stale.filter(g => !g.tried), ...retry];
        const batch = todo.slice(0, MAX_PER_RUN);
        const result = { paths: byPath.size, pending: todo.length, attempted: batch.length,
            saved: 0, reused: 0, failed: 0, errors: {}, started_at: startedAt };
        await eachLimit(batch, MAX_PARALLEL, async g => {
            const key = keyOf(g.path);
            try {
                // มีไฟล์ของ path นี้แล้ว (อีกแถวโหลดไว้ / รอบก่อนเขียนไฟล์ได้แต่บันทึกฐานไม่ทัน) — ไม่ต้องโหลดซ้ำ
                const have = existingFile(where, key);
                if (have) {
                    await st.thumbSaved(g.path, have);
                    result.reused++;
                    return;
                }
                const { buf, ext } = await download(g.path, { baseUrl: settings.baseUrl, apiKey: settings.apiKey, fetchImpl });
                const name = `${key}.${ext}`;
                await writeAtomic(where, name, buf);
                await st.thumbSaved(g.path, name);
                result.saved++;
            } catch (e) {
                const code = (e && e.thumbCode) || 'error';
                result.failed++;
                result.errors[code] = (result.errors[code] || 0) + 1;
                await Promise.resolve().then(() => st.thumbFailed(g.path, code)).catch(() => {});
            }
        });
        result.finished_at = new Date().toISOString();
        lastRun = { status: 'success', ...result };
        return result;
    } catch (error) {
        lastRun = { status: 'error', started_at: startedAt, finished_at: new Date().toISOString(), message: String(error && error.message || error).slice(0, 200) };
        throw error;
    } finally {
        running = false;
    }
}

// สรุปเป็นบรรทัดเดียวสำหรับ log ของ server (ไม่มี key / URL)
function thumbSummaryLine(r) {
    if (!r) return 'WeBoostX thumbnails: no result';
    if (r.skipped) return `WeBoostX thumbnails skipped: ${r.reason}`;
    const errs = Object.entries(r.errors || {}).map(([k, n]) => `${k} ${n}`).join(', ');
    return `WeBoostX thumbnails: saved ${r.saved} · reused ${r.reused} · failed ${r.failed}`
        + ` · pending ${r.pending - r.attempted} more of ${r.paths} paths` + (errs ? ` (${errs})` : '');
}

const getThumbStatus = () => ({ running, last_run: lastRun });

module.exports = {
    runThumbs, thumbSummaryLine, getThumbStatus, thumbPathFor, localFile, localKeyOf, keyOf, isCurrent, thumbUrl, sniff,
    thumbDir, DIR_NAME, MAX_BYTES, TIMEOUT_MS, MAX_PARALLEL, MAX_PER_RUN
};
