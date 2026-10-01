// ================= รูปโปรไฟล์จากลิงก์ Social สำหรับการ์ด Talent Book (ผู้ใช้สั่ง 1 ต.ค. 2026) =================
// การ์ดที่ยังไม่มีรูป + มีลิงก์ TikTok / YouTube / X → ดึงรูปโปรไฟล์จากหน้าโปรไฟล์สาธารณะ แล้วเก็บเป็นไฟล์รูปของคนนั้น
// (ที่เดียวกับรูปที่อัปเอง: UPLOAD_DIR + talents.image) — ลิงก์รูปบน CDN มีลายเซ็นและหมดอายุ จึงต้องเก็บไฟล์ไว้เอง
//   • TikTok: หน้า https://www.tiktok.com/@ชื่อ มี "avatarLarger":"<ลิงก์>" ในข้อมูลของหน้า (ไม่ใช่ API ทางการ — เปลี่ยนเมื่อไรก็ได้ ต้องพังแบบเงียบ)
//   • YouTube / X: meta og:image ของหน้าโปรไฟล์
//   • Instagram / Facebook ดึงไม่ได้ (ต้องล็อกอิน) — ให้ผู้ใช้ก๊อปรูปมาวาง (Ctrl+V) หรืออัปโหลดเอง
//
// กันไว้ (ข้อมูลพาไปเครื่องอื่นไม่ได้ — SSRF):
//   • หน้าโปรไฟล์: https เท่านั้น · โดเมน tiktok.com / youtube.com / x.com / twitter.com (+ www. / m.) ตามแพลตฟอร์มของช่องนั้น
//   • รูป: https เท่านั้น · โดเมน CDN รูปของแพลตฟอร์มนั้นเท่านั้น · ห้ามมี user:pass / port แปลก
//   • ไม่ตาม redirect เอง (redirect: 'manual') — ตามให้ไม่เกิน 3 ทอด และทุกทอดต้องผ่านด่านโดเมนเดิม
//   • หมดเวลา 8 วินาทีต่อคำขอ (รวมทั้งหมดไม่เกิน 20 วินาที) · หน้าเว็บอ่านไม่เกิน 4MB · รูปไม่เกิน 3MB
//   • รูปต้องเป็น image/* และไฟล์จริงเป็น JPEG / PNG / WEBP (เช็คหัวไฟล์ ไม่เชื่อ content-type อย่างเดียว)
//   • ห้ามแทนรูปที่ผู้ใช้อัป/วางเอง (เว้นแต่ผู้ใช้กดปุ่ม "ดึงรูปจากลิงก์" เอง — force)
//   • ดึงไม่ได้ = ไม่ขวางการบันทึก (เส้น API บันทึกก่อน ดึงทีหลัง) · ดึงอัตโนมัติไม่ได้ = พัก 20 นาทีก่อนลองลิงก์เดิมใหม่
// ใช้แนวเดียวกับ services/adThumbs.js (เขียนไฟล์ชั่วคราวแล้วเปลี่ยนชื่อ · ลบไฟล์ชั่วคราวเมื่อพัง · จำกัดจำนวนที่ดึงพร้อมกัน)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AVATAR_PLATFORMS, normalizeSocials, avatarPage } = require('../data/talentSocials');

const TIMEOUT_MS = 8000;
const TOTAL_MS = 20000;
const PAGE_MAX_BYTES = 4 * 1024 * 1024;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FAIL_TTL_MS = 20 * 60 * 1000;
const MAX_PARALLEL = 3;
// หน้าโปรไฟล์ของ TikTok / X ตอบหน้าเต็ม (มีรูปโปรไฟล์) ให้เบราว์เซอร์ทั่วไป
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const PAGE_HOST = {
    TikTok: /^(?:(?:www|m)\.)?tiktok\.com$/i,
    YouTube: /^(?:(?:www|m)\.)?youtube\.com$/i,
    X: /^(?:(?:www|m)\.)?(?:x|twitter)\.com$/i
};
// ต้องเป็นโดเมนย่อยของ CDN (มีจุดนำหน้า) — โดเมนอื่น / IP / localhost ไม่ผ่าน
const IMAGE_HOST = {
    TikTok: /\.(?:tiktokcdn|tiktokcdn-us|ttwstatic)\.com$/i,
    YouTube: /\.(?:googleusercontent|ggpht|ytimg)\.com$/i,
    X: /^pbs\.twimg\.com$/i
};
// หัวไฟล์จริง → นามสกุล (ชุดเดียวกับรูปที่อัปเองได้ในเส้น /talents/:id/image)
function sniff(buf) {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
    return null;
}

// ลิงก์ที่ผ่านด่าน (https + โดเมนตามที่กำหนด + ไม่มี user:pass + port ปกติ) → URL · ไม่ผ่าน = null
function safeUrl(raw, hostRe) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
    return hostRe && hostRe.test(u.hostname) ? u : null;
}

// ช่องทาง → ลิงก์หน้าโปรไฟล์ที่ดึงได้ · ดึงไม่ได้ = null
// เฉพาะหน้าช่องจริง (avatarPage ใน data/talentSocials.js — ฟอร์มใช้ตัวเดียวกันเลือกลิงก์ที่ส่งมา):
//   ลิงก์ที่บันทึกไว้ถ้าเป็นหน้าช่อง → ไม่งั้นประกอบจากชื่อช่อง (พิมพ์ชื่อไว้แต่วางลิงก์คลิป) → ไม่มีทั้งคู่ = null (ตอบ 'not-profile')
//   ลิงก์คลิป / Shorts / โพสต์ / ค้นหา / แท็ก / เพลง ห้ามใช้ — og:image เป็นรูปปกคลิป หรือ avatarLarger ตัวแรกเป็นของบัญชีอื่น
// ผ่านด่านโดเมน (safeUrl) อีกชั้นก่อนยิงจริง
function pageFor(social) {
    if (!social || !AVATAR_PLATFORMS.includes(social.platform)) return null;
    const page = avatarPage(social);
    const u = page ? safeUrl(page, PAGE_HOST[social.platform]) : null;
    return u ? u.href : null;
}
// ไฟล์รูปของแถว (เทียบว่ารูปเปลี่ยนไปหรือยังระหว่างที่กำลังดึง) — ไม่มีรูป = null
const imageKey = img => (img && typeof img === 'object' && img.filename ? String(img.filename) : null);
// ช่องทางทั้งหมดของแถว talents ที่ดึงรูปได้ (ตามลำดับในฟอร์ม) — [{ social, page }]
function sourcesOf(row) {
    return normalizeSocials(row && row.socials, row && row.link)
        .map(social => ({ social, page: pageFor(social) }))
        .filter(x => x.page);
}

const HTML_ENT = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const decodeEntities = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return HTML_ENT[e.toLowerCase()] ?? m;
});
const attrOf = (tag, name) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
    return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
};
function ogImage(html) {
    for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
        const key = attrOf(m[0], 'property') || attrOf(m[0], 'name');
        if (!/^og:image(?::(?:url|secure_url))?$/i.test(key)) continue;
        const content = decodeEntities(attrOf(m[0], 'content')).trim();
        if (content) return content;
    }
    return null;
}
// TikTok: ค่าในข้อมูล JSON ของหน้า — / ถูกเข้ารหัสเป็น / ต้องถอดแบบสตริง JSON
function tiktokAvatar(html) {
    for (const key of ['avatarLarger', 'avatarMedium', 'avatarThumb']) {
        const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.){1,4000})"`).exec(html);
        if (!m) continue;
        try { const v = JSON.parse(`"${m[1]}"`); if (v) return v; } catch { /* ค่าเสีย — ลองช่องถัดไป */ }
    }
    return null;
}
const MARKER = { TikTok: '"avatar', YouTube: 'og:image', X: 'og:image' };
const extract = (platform, html) => (platform === 'TikTok' ? tiktokAvatar(html) : ogImage(html));

// เหตุที่ดึงไม่ได้ → ข้อความที่ผู้ใช้อ่านแล้วรู้ว่าต้องทำอะไรต่อ
function failMessage(code, platform) {
    const p = platform || 'ลิงก์นี้';
    if (code === 'unsupported') return `ดึงรูปจาก ${p} อัตโนมัติไม่ได้ — ก๊อปรูปแล้วกด Ctrl+V ที่ช่องรูป หรืออัปโหลดเอง`;
    if (code === 'no-link') return 'ยังไม่มีลิงก์ TikTok / YouTube / X ให้ดึงรูป — ใส่ลิงก์ช่องทางก่อน หรือก๊อปรูปแล้วกด Ctrl+V ที่ช่องรูป';
    if (code === 'not-profile') return `ลิงก์ ${p} นี้ไม่ใช่หน้าช่อง (เช่นลิงก์คลิป) — ใส่ลิงก์หน้าโปรไฟล์ (เช่น https://www.tiktok.com/@ชื่อช่อง) แล้วลองดึงรูปอีกครั้ง หรือก๊อปรูปแล้วกด Ctrl+V ที่ช่องรูป`;
    if (code === 'timeout') return `${p} ตอบช้าเกินไป — ลองกดดึงรูปอีกครั้ง หรือก๊อปรูปแล้วกด Ctrl+V ที่ช่องรูปแทน`;
    if (code === 'kept') return 'มีรูปที่อัปโหลดไว้แล้ว — ไม่ได้แทนที่';
    if (code === 'stale') return 'รูปหรือลิงก์ถูกเปลี่ยนระหว่างที่กำลังดึง — ไม่ได้ใช้รูปที่ดึงมา (กด "ดึงรูปจากลิงก์" อีกครั้งได้)';
    if (code === 'gone') return 'ไม่พบคนนี้ใน Talent Book';
    if (code === 'cooldown') return `เพิ่งดึงรูปจาก ${p} ไม่สำเร็จ — รอสักครู่ หรือกด "ดึงรูปจากลิงก์" เพื่อลองใหม่`;
    return `ดึงรูปจาก ${p} ไม่สำเร็จ — บัญชีอาจเป็นส่วนตัว ลิงก์ไม่ถูก หรือ ${p} ไม่ให้ดึงตอนนี้ ลองใหม่ภายหลัง หรือก๊อปรูปแล้วกด Ctrl+V ที่ช่องรูปแทน`;
}
const failure = code => Object.assign(new Error(code), { code, avatarFailure: true });

function createTalentAvatars({
    dir, setFile, removeFile = () => {},
    fetchImpl = (...a) => fetch(...a), now = () => Date.now(),
    timeoutMs = TIMEOUT_MS, totalMs = TOTAL_MS
}) {
    const failedAt = new Map();   // ลิงก์หน้าโปรไฟล์ -> เวลาที่ดึงอัตโนมัติไม่ได้ล่าสุด
    const pending = new Map();    // `${id}|${force}|${หน้าโปรไฟล์}` -> Promise (กดซ้ำ / บันทึกซ้อนลิงก์เดิม = ดึงครั้งเดียว · ลิงก์ใหม่ = งานใหม่)
    let running = 0;
    const queue = [];
    const slot = () => new Promise(resolve => {
        if (running < MAX_PARALLEL) { running++; resolve(); } else queue.push(resolve);
    });
    const release = () => { const next = queue.shift(); if (next) next(); else running--; };

    // GET แบบไม่ตาม redirect เอง — ตามให้ไม่เกิน MAX_REDIRECTS ทอด ทุกทอดต้องผ่าน safeUrl(hostRe)
    async function get(url, hostRe, accept, deadline) {
        let cur = url;
        for (let hop = 0; ; hop++) {
            const left = deadline - now();
            if (left <= 0) throw failure('timeout');
            let res;
            try {
                res = await fetchImpl(cur, {
                    redirect: 'manual',
                    headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8' },
                    signal: AbortSignal.timeout(Math.min(timeoutMs, left))
                });
            } catch (e) {
                throw failure(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'fetch');
            }
            if (res.status >= 300 && res.status < 400) {
                const loc = res.headers.get('location');
                if (res.body) res.body.cancel().catch(() => {});
                if (!loc || hop >= MAX_REDIRECTS) throw failure('redirect');
                let next = null;
                try { next = safeUrl(new URL(loc, cur).href, hostRe); } catch { next = null; }
                if (!next) throw failure('blocked');
                cur = next.href;
                continue;
            }
            if (res.status !== 200) {
                if (res.body) res.body.cancel().catch(() => {});
                throw failure('status');
            }
            return res;
        }
    }

    // อ่าน body ไม่เกิน max ไบต์ · done(buffers) = เจอของที่ต้องการแล้ว หยุดอ่านได้เลย
    async function readCapped(res, max, done) {
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > max) {
            if (res.body) res.body.cancel().catch(() => {});
            throw failure('too-big');
        }
        if (!res.body) return Buffer.alloc(0);
        const reader = res.body.getReader();
        const chunks = [];
        let size = 0;
        let finished = false;
        try {
            for (;;) {
                const { done: end, value } = await reader.read();
                if (end) { finished = true; break; }
                size += value.byteLength;
                if (size > max) throw failure('too-big');
                chunks.push(Buffer.from(value));
                if (done && done(chunks)) break;
            }
        } catch (e) {
            if (e && e.avatarFailure) throw e;
            throw failure(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'fetch');
        } finally {
            if (!finished) reader.cancel().catch(() => {});
        }
        return Buffer.concat(chunks);
    }

    // หน้าโปรไฟล์ → { buf, ext, src } (src = ลิงก์รูปบน CDN)
    async function download(page, platform) {
        const pageHost = PAGE_HOST[platform];
        const imgHost = IMAGE_HOST[platform];
        if (!pageHost || !safeUrl(page, pageHost)) throw failure('blocked');
        const deadline = now() + totalMs;
        const res = await get(page, pageHost, 'text/html,application/xhtml+xml', deadline);
        const type = String(res.headers.get('content-type') || '').toLowerCase();
        if (type && !type.includes('html')) { if (res.body) res.body.cancel().catch(() => {}); throw failure('not-html'); }
        // ถอดเป็นข้อความทีละก้อน — เจอลิงก์รูปแล้วหยุดอ่าน (หน้า YouTube ยาว ~2MB แต่ og:image อยู่ต้นหน้า)
        const decoder = new TextDecoder('utf-8');
        let text = '';
        let used = 0;
        let src = null;
        await readCapped(res, PAGE_MAX_BYTES, chunks => {
            for (; used < chunks.length; used++) text += decoder.decode(chunks[used], { stream: true });
            if (!text.includes(MARKER[platform])) return false;
            src = extract(platform, text);
            return !!src;
        });
        if (!src) src = extract(platform, text + decoder.decode());
        if (!src) throw failure('no-image');
        const imgUrl = safeUrl(src, imgHost);
        if (!imgUrl) throw failure('blocked');
        const img = await get(imgUrl.href, imgHost, 'image/webp,image/jpeg,image/png;q=0.9,*/*;q=0.1', deadline);
        const imgType = String(img.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!imgType.startsWith('image/')) { if (img.body) img.body.cancel().catch(() => {}); throw failure('not-image'); }
        const buf = await readCapped(img, MAX_BYTES);
        const ext = buf.length ? sniff(buf) : null;
        if (!ext) throw failure('not-image');
        return { buf, ext, src: imgUrl.href };
    }

    async function writeFile(talentId, buf, ext) {
        fs.mkdirSync(dir, { recursive: true });
        // ชื่อขึ้นต้น talent_<id>_ แบบเดียวกับรูปที่อัปเอง (ลบ/แทนที่ด้วยโค้ดชุดเดียวกัน)
        const filename = `talent_${Number(talentId) || 0}_${Date.now()}${crypto.randomBytes(3).toString('hex')}.${ext}`;
        const fp = path.join(dir, filename);
        const tmp = `${fp}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        try {
            await fs.promises.writeFile(tmp, buf);
            await fs.promises.rename(tmp, fp);
        } catch (e) {
            await fs.promises.rm(tmp, { force: true }).catch(() => {});
            throw e;
        }
        return filename;
    }

    // แผนดึงอัตโนมัติหลังบันทึก → { social, page } หรือ null (ไม่ต้องดึง)
    //  • มีรูปที่ผู้ใช้อัป/วางเอง (หรือ PDF คอมการ์ด) = ห้ามแตะ
    //  • มีรูปที่ดึงอัตโนมัติไว้แล้วจากช่องทางที่ยังอยู่ = ไม่ต้องดึงซ้ำ · ช่องทางนั้นถูกเปลี่ยน/ลบ = ดึงใหม่จากช่องทางแรกที่ดึงได้
    function planAuto(row) {
        if (!row) return null;
        const img = row.image && typeof row.image === 'object' ? row.image : null;
        if (img && img.source !== 'auto') return null;
        const sources = sourcesOf(row);
        if (!sources.length) return null;
        if (img && sources.some(s => s.page === img.from)) return null;
        return sources[0];
    }

    // ดึง + เก็บไฟล์ + ผูกกับแถว → { ok: true, row, platform } | { ok: false, code, message, platform }
    // force = ผู้ใช้กดปุ่มเอง: แทนรูปเดิมได้ทุกแบบ และไม่สนช่วงพักหลังดึงไม่สำเร็จ
    // expect = ไฟล์รูปของแถวตอนเริ่มดึง (imageKey · null = ยังไม่มีรูป · ไม่ส่ง = ไม่เช็ค)
    // ตอนจะเขียนเช็คซ้ำในล็อกแถว (setFile → stillWanted) — ดึงช้า ๆ แล้วระหว่างนั้น:
    //   • รูปเปลี่ยนไปแล้ว (ผู้ใช้อัป/วางเอง · งานดึงที่ใหม่กว่าเสร็จก่อน) = ไม่ทับ
    //   • ดึงอัตโนมัติ: ลิงก์ถูกเปลี่ยน/ลบ (แผนตอนนี้ไม่ใช่หน้านี้แล้ว) = ไม่ทับ
    //   → { ok: false, code: 'stale' } และลบไฟล์ที่ดึงมาทิ้ง
    function run(talentId, source, { force = false, expect } = {}) {
        const key = `${talentId}|${force ? 1 : 0}|${(source && source.page) || ''}`;
        if (pending.has(key)) return pending.get(key);
        const platform = source && source.social ? source.social.platform : null;
        const stillWanted = cur => {
            if (!cur) return false;
            if (expect !== undefined && imageKey(cur.image) !== expect) return false;
            if (force) return true;
            const plan = planAuto(cur);
            return !!plan && plan.page === source.page;
        };
        const job = (async () => {
            if (!source || !source.page) return { ok: false, code: 'no-link', platform, message: failMessage('no-link', platform) };
            const last = failedAt.get(source.page);
            if (!force && last && now() - last < FAIL_TTL_MS) return { ok: false, code: 'cooldown', platform, message: failMessage('cooldown', platform) };
            await slot();
            let filename = null;
            try {
                const { buf, ext } = await download(source.page, platform);
                filename = await writeFile(talentId, buf, ext);
                const handle = source.social.handle ? `-${source.social.handle}` : '';
                const meta = {
                    filename, original: `${platform}${handle}.${ext}`, size: buf.length, uploaded_at: new Date(now()).toISOString(),
                    source: 'auto', from: source.page
                };
                const out = await setFile(talentId, 'image', meta, { keepUserFile: !force, stillWanted });
                if (!out) { removeFile({ filename }); return { ok: false, code: 'gone', platform, message: failMessage('gone', platform) }; }
                if (out.stale) { removeFile({ filename }); return { ok: false, code: 'stale', platform, message: failMessage('stale', platform), row: out.row }; }
                if (out.kept) { removeFile({ filename }); return { ok: false, code: 'kept', platform, message: failMessage('kept', platform), row: out.row }; }
                if (out.old) removeFile(out.old);
                failedAt.delete(source.page);
                return { ok: true, platform, row: out.row };
            } catch (e) {
                if (filename) removeFile({ filename });
                const code = e && e.avatarFailure ? e.code : 'fetch';
                failedAt.set(source.page, now());
                if (failedAt.size > 5000) failedAt.clear();
                return { ok: false, code, platform, message: failMessage(code === 'timeout' ? 'timeout' : 'fetch', platform) };
            } finally {
                release();
            }
        })();
        pending.set(key, job);
        job.finally(() => pending.delete(key)).catch(() => {});
        return job;
    }

    return { planAuto, run, download, sourcesOf };
}

// รอผลได้ไม่เกิน ms — ช้ากว่านั้นคืน null (งานยังทำต่อเบื้องหลัง)
function within(promise, ms) {
    let t;
    return Promise.race([promise, new Promise(resolve => { t = setTimeout(() => resolve(null), ms); })])
        .finally(() => clearTimeout(t));
}

module.exports = {
    createTalentAvatars, within, pageFor, sourcesOf, imageKey, safeUrl, failMessage, tiktokAvatar, ogImage, sniff,
    PAGE_HOST, IMAGE_HOST, MAX_BYTES, PAGE_MAX_BYTES, TIMEOUT_MS, FAIL_TTL_MS
};
