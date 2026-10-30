/**
 * submissions (รายชื่อ KOL ที่ Agency ส่งเข้ามา) — เวอร์ชัน PostgreSQL
 *
 * พอร์ตมาจาก jsonStore.js บรรทัด 1310-1476 แบบตรงตัว
 * กฎธุรกิจทุกข้อ (การล็อกช่องหลังยิงแอด, การสแตมป์ *_at/*_by, timestamp ต่อหมวด,
 * การแตกแถวต่อคลิป, การลบทั้งคนตาม person_key) ต้องเหมือนเดิมเป๊ะ
 * เพราะหน้าเว็บ 102 endpoint อ่านรูปผลลัพธ์ชุดนี้อยู่
 *
 * 1 แถว = 1 คลิป ของ 1 คน — คนเดียวกันผูกกันด้วย person_key
 */
const { query, withTransaction, insertRow, updateRow, asNum, asBool, asText, asJson } = require('./_base');
const { now, maybeStamp, stampAtFor, AD_STAMP_AT, AD_STAMP_BY_BRAND, nextPostCheck, postCheckDecision, POST_CHECK_OPEN, sameInstant } = require('../logic');

const { METRIC_KEYS, manualEvidence, apiSelection, recordApi } = require('../performanceSources');
const { selectable: isolatedSelectable } = require('../tiktokEvidence');
const { itemIdFor: wxItemIdFor, idKeyOf: wxIdKeyOf, platformOf: wxPlatformOf } = require('../../services/weboostxMetrics');
// คอลัมน์ข้อมูลจาก WeBoostX KOL Studio ของโพสต์ (คะแนน / เกรด / รูปปก) — ล้างเมื่อตัวตนโพสต์เปลี่ยน (ดู updateOne)
const STUDIO_DATA = ['weboostx_pfm', 'weboostx_pfm_grade', 'weboostx_thumbnail_path', 'thumbnail_local', 'thumbnail_fetched_at', 'thumbnail_error'];

// เกณฑ์ต่ำสุดของทุกแบรนด์ — ค่าแอดยังไม่ถึงเท่านี้ก็ไม่มีทางสแตมป์ ไม่ต้องเสียเวลาไปหาแบรนด์
// (การแก้ข้อมูลส่วนใหญ่เป็นแถวที่ยังไม่ได้ยิงแอดเลย)
const MIN_STAMP_AT = Math.min(AD_STAMP_AT, ...Object.values(AD_STAMP_BY_BRAND));

// id ที่แปลงเป็นตัวเลขไม่ได้ = ไม่มีวันเจอแถว (jsonStore เทียบ x.id === NaN ได้ false เสมอ)
// ต้องดักไว้ก่อนยิง SQL ไม่งั้น PostgreSQL จะโยน error แทนที่จะคืน null เหมือนเดิม
const numOr = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

// ---- ช่องที่ update() ยอมให้แก้ (ลำดับตามของเดิมเป๊ะ) ----
const UPDATABLE = [
    'account_name', 'followers', 'platform', 'product', 'agency', 'budget', 'link_account',
    'concept', 'gen_date', 'group_key', 'tier', 'clip_name', 'status',
    'draft_link', 'draft_link2', 'draft_link3', 'draft_link4', 'draft_link5',
    'gencode', 'feedback', 'feedback2', 'feedback3', 'feedback4', 'feedback5',
    'draft_remark', 'draft_remark2', 'draft_remark3', 'draft_remark4', 'draft_remark5',
    // Caption ของ KOL 1 ช่องต่อคลิป (30 ต.ค. 2026) — ฐานที่ยังไม่มีคอลัมน์ = ตัดทิ้งใน updateOne
    'kol_caption',
    'approved', 'draft_status', 'post_url', 'post_date', 'id_post', 'code_expire',
    'ad_status', 'ad_spend', 'ad_reach', 'ad_start', 'ad_end', 'ad_note',
    'team_note', 'agency_note', 'content_type',
    'views', 'likes', 'comments', 'saves', 'shares', 'reposts',
    'content_format', 'perf_synced_at',
    // ได้มาฟรี / ไม่มีค่าตัว (27 ต.ค. 2026) — เขียนได้ทางเดียวกับค่าตัว (allowFee: setFees / setFeeFree) · ฐานที่ยังไม่มีคอลัมน์ = ตัดทิ้งใน updateOne
    'fee_free'
];

// คอลัมน์ตัวเลข NOT NULL — ฟอร์มส่ง '' มาได้ ต้องกลายเป็น 0 ไม่งั้น PostgreSQL ปฏิเสธ
const NUM_COLS = new Set(['followers', 'budget', 'ad_spend', 'ad_reach',
                          'views', 'likes', 'comments', 'saves', 'shares', 'reposts']);

const coerceCol = (k, v) => {
    if (NUM_COLS.has(k)) return asNum(v, 0);
    if (k === 'code_expire') return asNum(v, 60);
    if (k === 'approved' || k === 'fee_free') return asBool(v);
    return v === undefined ? null : v;
};

/**
 * แถวใหม่ 1 คลิป — ค่าเริ่มต้นทุกช่องตรงกับที่ jsonStore เคยสร้าง
 *
 * at = เวลาที่ใช้ร่วมกันทั้งชุด (ส่งมาจาก addPerson)
 * ต้องมีพารามิเตอร์นี้เพราะการเพิ่ม KOL 1 คนที่มีหลายคลิป = เหตุการณ์เดียว ทุกคลิปต้องมีเวลาเท่ากัน
 * ถ้าปล่อยให้แต่ละแถวเรียก now() เอง เวลาจะต่างกันเล็กน้อย (แต่ละ INSERT วิ่งข้ามเครือข่ายไปฐานข้อมูล)
 * แล้วรายการจะเรียงกลับหัว — คลิป 2 ขึ้นก่อนคลิป 1 เพราะหน้าจอเรียงจากใหม่ไปเก่า
 */
function newRow({ project_id, account_name, followers, platform, product, budget, agency, link_account,
                  group_key, tier, content_type, agency_token, code_expire, person_key, clip_no, clip_name,
                  status, decided_by },
                at = now()) {
    return {
        project_id: Number(project_id),
        account_name: asText(account_name),
        followers: asNum(followers || 0, 0),
        platform: platform || null,
        product: product || null,
        budget: asNum(budget || 0, 0),
        // Content Type ที่ KOL คนนี้รับผิดชอบ — 1 Platform อาจมีหลาย Content Type ในกลุ่มเดียว
        content_type: content_type || null,
        agency: agency || null,
        link_account: link_account || null,
        group_key: group_key || null,
        tier: tier || null,
        // แถวพี่น้อง = คนเดียวกัน แต่คนละคลิป (ผูกกันด้วย person_key)
        person_key: asText(person_key),
        clip_no: Number(clip_no) || 1,
        clip_name: clip_name || null,
        agency_token: agency_token || null,   // เจ้าของ (ลิงก์เอเจนซี่ที่ส่งเข้ามา)
        // submitted | confirmed | rejected — KOL รายคนเกิดมาเป็น confirmed (จ้างแล้ว ไม่มีขั้นคัดเลือก) ที่อื่นยังเป็น submitted
        status: status === 'confirmed' ? 'confirmed' : 'submitted',
        draft_link: null, draft_link2: null, draft_link3: null, draft_link4: null, draft_link5: null,
        gencode: null, feedback: null, feedback2: null, feedback3: null, feedback4: null, feedback5: null,
        // Remark ของแต่ละดราฟ — เอเจนซี่เขียน ทีมอ่านอย่างเดียว
        draft_remark: null, draft_remark2: null, draft_remark3: null, draft_remark4: null, draft_remark5: null,
        approved: false, draft_status: null,
        post_url: null, post_date: null, id_post: null, code_expire: Number(code_expire) || 60,
        ad_status: 'ยังไม่ยิง', ad_spend: 0, ad_reach: 0, ad_start: null, ad_end: null, ad_note: null,
        team_note: null,   // หมายเหตุจากทีมถึงเอเจนซี่ (เช่น ขอย้ายไปสินค้าอื่น)
        agency_note: null, // หมายเหตุจากเอเจนซี่ถึงทีม (คนละช่องกับ team_note ต่างฝ่ายต่างเขียนของตัวเอง)
        // ผลงานคอนเทนต์ (กรอกมือ หรือดึงจาก TikTok API ภายหลัง)
        views: 0, likes: 0, comments: 0, saves: 0, shares: 0,
        reposts: 0,   // เฉพาะ Instagram (แพลตฟอร์มอื่นไม่มีช่องนี้ให้กรอก)
        content_format: null, perf_synced_at: null,
        concept: null, gen_date: null,
        submitted_at: at, decided_at: status === 'confirmed' ? at : null, decided_by: status === 'confirmed' ? (decided_by || null) : null,
        list_updated_at: at, work_updated_at: null, draft_updated_at: null  // ใช้ทำแจ้งเตือนแท็บ + per-KOL ดราฟใหม่
    };
}

/**
 * แก้ 1 แถว ภายใน transaction ที่เปิดค้างไว้แล้ว
 * แยกออกมาเพื่อให้ updatePerson แก้พี่น้องหลายแถวได้ใน transaction เดียว
 *
 * opts.allowFee = true เท่านั้นที่เขียนค่าตัว (budget) ได้ — ส่งมาจาก setFees ที่เดียว
 * ทางอื่นทั้งหมด (update / updatePerson → หน้าเอเจนซี่ / หน้าแคมเปญ / หน้าแอด) ส่ง budget มาก็ไม่เขียน
 * กันค่าตัวถูกทับจากหน้าเว็บรุ่นเก่าที่ยังเปิดค้าง หรือ route ที่ลืมตัดช่องนี้ทิ้ง
 */
// เกณฑ์สแตมป์ของแคมเปญนี้ (บางแบรนด์ตั้งต่ำกว่าค่ากลาง) + ประเภทแคมเปญ (KOL รายคนค่าตัว 0 = ได้ฟรี ไม่ต้องรอค่าตัว)
// ตัวเรียกที่วนเขียนหลายแถว (setFees / updatePerson) หาไว้ครั้งเดียวแล้วส่งมาทาง opts.stampAt / opts.campaignType — จะได้ไม่ยิง query ซ้ำทุกแถว
async function stampCtxOf(client, projectId, opts) {
    if (opts && opts.stampAt != null) return { at: opts.stampAt, campaignType: opts.campaignType };
    const pid = numOr(projectId);
    if (pid === null) return { at: AD_STAMP_AT, campaignType: undefined };
    const r = await client.query('SELECT brand, campaign_type FROM projects WHERE id = $1', [pid]);
    const p = r.rows[0];
    return { at: stampAtFor(p && p.brand), campaignType: p ? p.campaign_type : undefined };
}

async function updateOne(client, subId, projectId, fields, byName, opts = {}) {
    // คัดลอกก่อนตัดคีย์ ไม่แก้อ็อบเจกต์ของผู้เรียก (updatePerson ส่งอ็อบเจกต์เดียวกันวนเขียนทุกคลิป)
    fields = { ...fields };
    if (!opts || opts.allowFee !== true) { delete fields.budget; delete fields.fee_free; }

    const id = numOr(subId);
    if (id === null) return null;
    const pid = projectId == null ? null : numOr(projectId);
    if (projectId != null && pid === null) return null;

    const r = await client.query(
        pid === null
            ? 'SELECT * FROM submissions WHERE id = $1 FOR UPDATE'
            : 'SELECT * FROM submissions WHERE id = $1 AND project_id = $2 FOR UPDATE',
        pid === null ? [id] : [id, pid]);
    const s = r.rows[0];
    if (!s) return null;
    if (!('fee_free' in s)) delete fields.fee_free;   // ยังไม่ได้ setup-db (27 ต.ค. 2026) — ไม่เขียนคอลัมน์ที่ไม่มี
    if (!('kol_caption' in s)) delete fields.kol_caption;   // เหมือนกัน (Caption ของ KOL · 30 ต.ค. 2026)

    // ช่องที่บันทึกว่าใครแก้ล่าสุดเมื่อไหร่
    // post_date อยู่ในนี้ด้วย เพราะต้องรู้ว่า "แจ้งวันลงงานเข้าระบบตอนไหน"
    // เทียบกับวันที่ลงงานจริง จะได้แยกออกว่ายิงแอดช้าเพราะเราช้า หรือเพราะเพิ่งได้รับแจ้ง
    const STAMP_F = ['post_url', 'gencode', 'id_post', 'post_date'];
    // ล็อกหลังยิงแอดเฉพาะ 3 ช่องนี้ — post_date ไม่ล็อก เผื่อแจ้งวันผิดแล้วต้องแก้ให้ตรงความจริง
    const LOCK_F = ['post_url', 'gencode', 'id_post'];
    const filled = v => !!(v !== null && v !== undefined && String(v).trim());
    const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

    // ยิงแอดไปแล้ว = ล็อกข้อมูลชุดนี้ ห้ามแก้ เพราะเป็นข้อมูลที่ใช้อ้างอิงกับแอดที่ยิงไปแล้ว
    // opts.adUnlock = คนแก้กดปุ่มปลดล็อก + ยืนยันคำเตือนในตาราง On Process แล้ว (ผู้ใช้สั่ง 22 ต.ค. 2026 — ทุกคนรวมเอเจนซี่ · ทั้ง 3 ช่อง)
    // TikTok กดสถานะกลับเป็น "ยังไม่ยิง" ไม่ได้ (สถานะมาจาก PFM) จึงต้องมีทางนี้ · เอเจนซี่แก้ = ป้าย "แก้หลังยิงแอด" ให้ทีมตรวจ (nextPostCheck)
    // opts.fillEmpty = ช่องที่ "เติมได้เฉพาะตอนยังว่าง" (หน้า Ads เก็บ ID POST ที่คนยืนยันจากรายการโพสต์ของ WeBoostX · 26 ต.ค. 2026)
    // มีค่าอยู่แล้ว (มีคนกรอก / ซิงก์เติมระหว่างเปิดหน้าต่าง) = 409 ไม่เขียนทับ · ยังว่าง = เติมได้แม้ยิงแอดแล้ว (แบบเดียวกับที่ซิงก์เติม ID POST ให้เอง)
    const fillEmpty = (opts && Array.isArray(opts.fillEmpty) ? opts.fillEmpty : []).filter(f => fields[f] !== undefined);
    const taken = fillEmpty.filter(f => filled(s[f]));
    if (taken.length) {
        const e = new Error('แถวนี้มี ID POST แล้ว (เพิ่งมีคนกรอกหรือระบบซิงก์เข้ามา) — โหลดหน้าใหม่แล้วดูอีกครั้ง');
        e.status = 409;
        throw e;
    }
    if (s.ad_status === 'ยิงแล้ว' && !(opts && opts.adUnlock === true)) {
        const blocked = LOCK_F.filter(f => fields[f] !== undefined && !same(fields[f], s[f]) && !fillEmpty.includes(f));
        if (blocked.length) {
            const LABEL = { post_url: 'ลิงก์คลิป', gencode: 'Gencode', id_post: 'ID Post' };
            const e = new Error(`ยิงแอดไปแล้ว จึงแก้ ${blocked.map(f => LABEL[f]).join(' / ')} ไม่ได้ — กดปุ่ม 🔓 ในตาราง On Process เพื่อปลดล็อกก่อน (หน้าที่เปิดค้างไว้ให้รีเฟรชก่อน)`);
            e.status = 409;
            throw e;
        }
    }
    // perf_stamp ห้ามเซ็ตจากภายนอกเด็ดขาด ระบบเป็นคนสแตมป์เองเท่านั้น
    delete fields.perf_stamp;

    for (const k of ['ad_spend', 'ad_reach']) {
        if (fields[k] !== undefined && fields[k + '_from'] !== undefined
            && Number(fields[k + '_from']) !== (Number(s[k]) || 0)) {
            const e = new Error('ค่าแอดหรือ Reach เปลี่ยนระหว่างแก้ไข กรุณาโหลดหน้าใหม่');
            e.status = 409; throw e;
        }
    }
    const performanceEdit = METRIC_KEYS.some(k => fields[k] !== undefined) || fields.perf_mode !== undefined;
    if (performanceEdit && fields.perf_from !== undefined) {
        const expected = fields.perf_from;
        if (!expected || typeof expected !== 'object' || METRIC_KEYS.some(k =>
            !Number.isFinite(Number(expected[k])) || Number(expected[k]) !== (Number(s[k]) || 0))) {
            const e = new Error('ผลงานเปลี่ยนระหว่างเปิดฟอร์ม กรุณาปิดแล้วเปิดใหม่ก่อนบันทึก');
            e.status = 409; throw e;
        }
    }
    if (fields.perf_mode !== undefined && !['api', 'isolated'].includes(fields.perf_mode)) {
        const e = new Error('รูปแบบแหล่งข้อมูลไม่ถูกต้อง'); e.status = 400; throw e;
    }
    if (fields.perf_mode === 'api') {
        const selection = apiSelection(s);
        if (!selection) {
            const e = new Error('ยังไม่มีข้อมูล API ที่พร้อมใช้ กรุณารอข้อมูลต้นทาง'); e.status = 409; throw e;
        }
        Object.assign(fields, selection);
    }
    if (fields.perf_mode === 'isolated') {
        if (fields.perf_from === undefined || !isolatedSelectable(s, fields.perf_evidence_from)) {
            const e = new Error('ยอด TikTok แยกยังไม่พร้อมหรือเปลี่ยนแล้ว กรุณาเปิดฟอร์มใหม่'); e.status = 409; throw e;
        }
        Object.assign(fields, s.perf_sources.tiktok_evidence.metrics);
    }
    for (const k of METRIC_KEYS) {
        if (fields[k] !== undefined && (!Number.isSafeInteger(Number(fields[k])) || Number(fields[k]) < 0)) {
            const e = new Error('ยอดผลงานต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป'); e.status = 400; throw e;
        }
    }
    const prevRow = { ...s };               // แถวก่อนแก้ — ใช้ตัดสินสถานะตรวจข้อมูลโพสต์
    const patch = {};                       // คอลัมน์ที่จะเขียนกลับลง DB
    const before = {};
    STAMP_F.forEach(f => { before[f] = s[f]; });
    for (const k of UPDATABLE) {
        if (fields[k] !== undefined) { s[k] = fields[k]; patch[k] = coerceCol(k, fields[k]); }
    }
    if (performanceEdit) {
        s.perf_sources = opts.performanceSource
            ? { ...recordApi(s.perf_sources, { ...fields, id_post: s.id_post, pfm_source: opts.performanceSource,
                source_updated_at: now(), organic_metrics_status: 'available' }, now()), mode: 'api' }
            : fields.perf_mode === 'api'
            ? { ...s.perf_sources, mode: 'api' }
            : manualEvidence(s, fields, byName, now());
        patch.perf_sources = asJson(s.perf_sources);
        if (fields.perf_mode === 'isolated') {
            // An explicit reviewed copy is frozen like manual data. Neither collector nor PFM can replace it.
            s.perf_sources.manual.origin = {
                source: 'kol-tiktok-evidence', evidence_id: s.perf_sources.tiktok_evidence.evidence_id,
                collected_at: s.perf_sources.tiktok_evidence.collected_at
            };
            patch.perf_sources = asJson(s.perf_sources);
        }
        if (fields.perf_mode === 'api') {
            s.perf_synced_at = s.perf_sources.api.source_updated_at;
            patch.perf_synced_at = s.perf_synced_at;
        }
    }
    // บันทึกว่า "ใครแก้ล่าสุดเมื่อไหร่" ของลิงก์คลิป / Gencode / ID Post
    // ขยับทุกครั้งที่ค่าเปลี่ยนจริง (ส่งค่าเดิมมาซ้ำไม่นับ) — ล้างทิ้งเมื่อลบค่าออก
    STAMP_F.forEach(f => {
        if (fields[f] === undefined) return;
        if (same(before[f], s[f])) return;          // ค่าไม่ได้เปลี่ยน ไม่ต้องขยับเวลา
        if (filled(s[f])) {
            s[f + '_at'] = now();
            s[f + '_by'] = byName || null;
        } else {
            s[f + '_at'] = null;
            s[f + '_by'] = null;
        }
        patch[f + '_at'] = s[f + '_at'];
        patch[f + '_by'] = s[f + '_by'];
    });

    // ใครตัดสินดราฟล่าสุด (27 ต.ค. 2026 — ป้าย "ตรวจโดย / แทน" ในตาราง On Process และหน้า "งานของฉัน")
    // ลงเฉพาะตอนทีมเปลี่ยนผลเป็น Approve / ขอแก้ไข (กดบันทึกผลเดิมซ้ำไม่นับ) · ฐานที่ยังไม่มีคอลัมน์ (ยังไม่ setup-db) = ข้าม
    if (opts && opts.actor === 'team' && 'draft_checked_at' in prevRow
        && ['approve', 'revise'].includes(s.draft_status) && !same(prevRow.draft_status, s.draft_status)) {
        s.draft_checked_by_id = Number.isSafeInteger(Number(opts.actorId)) && Number(opts.actorId) > 0 ? Number(opts.actorId) : null;
        s.draft_checked_by = byName || null;
        s.draft_checked_at = now();
        patch.draft_checked_by_id = s.draft_checked_by_id;
        patch.draft_checked_by = s.draft_checked_by;
        patch.draft_checked_at = s.draft_checked_at;
    }

    // ตัวตนโพสต์ IG / FB ที่ใช้ถาม WeBoostX เปลี่ยน (แก้ลิงก์ / ID Post / Gencode / Platform) — คะแนน KOL PFM / เกรด / รูปปก
    // เป็นของโพสต์เดิม ต้องไม่ค้างโชว์กับโพสต์ใหม่ (19 ต.ค. 2026) → ล้างทิ้ง รอบซิงก์ถัดไปเติมของโพสต์ใหม่ให้ (ถ้า WeBoostX รู้จัก)
    // path เดิมกลับมา = ไฟล์เดิมในเครื่องถูกใช้ซ้ำ ไม่ต้องโหลดใหม่ · ฐานที่ยังไม่มีคอลัมน์ (ยังไม่ setup-db) = ข้าม
    // ตั้งแต่ 26 ต.ค. 2026 ซิงก์ส่งทุกคีย์ (ลิงก์ → ID POST → Gencode) แล้วใช้ตัวแรกที่เจอ — แถวที่ลิงก์จับไม่ได้จะได้ข้อมูลผ่าน ID POST
    // จึงนับการแก้ ID POST ที่ใช้เป็นคีย์อยู่ (idKeyOf — ไม่นับ ID ที่ซิงก์เติมเองบนแถวที่มีลิงก์) เป็นตัวตนเปลี่ยนด้วย · เติม Gencode ทั้งที่มีลิงก์ = ไม่แตะ
    if ('weboostx_pfm' in prevRow && STUDIO_DATA.some(k => prevRow[k] != null)
        && (wxItemIdFor(prevRow) !== wxItemIdFor(s) || wxIdKeyOf(prevRow) !== wxIdKeyOf(s) || wxPlatformOf(prevRow.platform) !== wxPlatformOf(s.platform))) {
        STUDIO_DATA.forEach(k => { if (prevRow[k] != null) { s[k] = null; patch[k] = null; } });
    }

    // ปรับ timestamp ตามหมวดของข้อมูลที่แก้ (ใช้ทำแจ้งเตือนแท็บ)
    // budget ไม่อยู่ใน LIST_F — ทีมตั้งค่าตัวจากหน้า Dashboard ทีละหลายสิบแถว (หารเฉลี่ย/ล้างค่าตัว)
    // ถ้าขยับ list_updated_at ด้วย ป้าย "มีอัปเดตใหม่" ฝั่งเอเจนซี่จะเด้งทั้งแคมเปญทั้งที่รายชื่อไม่ได้เปลี่ยน
    const LIST_F = ['account_name', 'followers', 'platform', 'product', 'agency', 'link_account', 'tier', 'content_type', 'group_key', 'status'];
    const DRAFT_REMARK_F = ['draft_remark', 'draft_remark2', 'draft_remark3', 'draft_remark4', 'draft_remark5'];
    const WORK_F = ['draft_link', 'draft_link2', 'draft_link3', 'draft_link4', 'draft_link5', 'draft_status', 'feedback', 'feedback2', 'feedback3', 'feedback4', 'feedback5', ...DRAFT_REMARK_F, 'kol_caption', 'gencode', 'post_url', 'post_date', 'id_post', 'code_expire', 'approved', 'concept', 'gen_date'];
    const DRAFT_F = ['draft_link', 'draft_link2', 'draft_link3', 'draft_link4', 'draft_link5', 'draft_status', 'feedback', 'feedback2', 'feedback3', 'feedback4', 'feedback5', ...DRAFT_REMARK_F, 'kol_caption'];   // Caption ส่งมาในหน้าต่างดราฟ = นับเป็นอัปเดตดราฟ
    const keys = Object.keys(fields).filter(k => fields[k] !== undefined); // นับเฉพาะ field ที่ส่งมาจริง
    if (keys.some(k => LIST_F.includes(k))) { s.list_updated_at = now(); patch.list_updated_at = s.list_updated_at; }
    if (keys.some(k => WORK_F.includes(k))) { s.work_updated_at = now(); patch.work_updated_at = s.work_updated_at; }
    if (keys.some(k => DRAFT_F.includes(k))) { s.draft_updated_at = now(); patch.draft_updated_at = s.draft_updated_at; }
    if (fields.status !== undefined) {
        s.decided_at = now(); s.decided_by = byName || s.decided_by;
        patch.decided_at = s.decided_at; patch.decided_by = s.decided_by;
    }
    // เช็คทุกครั้งที่ข้อมูลขยับ — ค่าแอดถึงเกณฑ์แล้วและมีผลงานให้ตัดสิน ก็สแตมป์ทันที
    // (กรอกผลงานทีหลังก็สแตมป์ตอนนั้น ไม่ต้องรอให้ค่าแอดขยับอีกรอบ)
    let stamped = null;
    if (!s.perf_stamp && (Number(s.ad_spend) || 0) >= MIN_STAMP_AT) {
        const ctx = await stampCtxOf(client, s.project_id, opts);
        stamped = maybeStamp(s, ctx.at, ctx.campaignType);
    }
    if (stamped) patch.perf_stamp = asJson(stamped);
    // ข้อมูลโพสต์เปลี่ยน: เอเจนซี่แก้ = รอทีมตรวจก่อนขึ้นหน้า Ads · ทีมแก้เอง = นับว่าตรวจแล้ว (opts.actor บอกว่าใครแก้)
    const check = nextPostCheck(prevRow, s, opts && opts.actor, byName, now());
    if (check) {
        Object.assign(s, check);
        Object.assign(patch, check, { post_check_changes: check.post_check_changes ? asJson(check.post_check_changes) : null });
    }

    return updateRow('submissions', s.id, patch, client);
}

const submissions = {
    async listByProject(projectId) {
        const pid = numOr(projectId);
        if (pid === null) return [];
        // อ่านตามลำดับ id ก่อน แล้วค่อยเรียงด้วยตัวเปรียบเทียบเดิม
        // (Array.sort เสถียร — แถวที่ submitted_at เท่ากันจึงยังเรียงตาม id เหมือนของเดิมเป๊ะ)
        const rows = (await query('SELECT * FROM submissions WHERE project_id = $1 ORDER BY id', [pid])).rows;
        return rows.sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));
    },
    async get(subId) {
        const id = numOr(subId);
        if (id === null) return null;
        const r = await query('SELECT * FROM submissions WHERE id = $1', [id]);
        return r.rows[0] || null;
    },
    async add({ project_id, account_name, followers, platform, product, budget, agency, link_account, group_key, tier, content_type, agency_token, code_expire, person_key, clip_no, clip_name }) {
        const row = newRow({ project_id, account_name, followers, platform, product, budget, agency,
                             link_account, group_key, tier, content_type, agency_token, code_expire,
                             person_key, clip_no, clip_name });
        return insertRow('submissions', row);
    },
    // เพิ่ม KOL 1 คน = สร้างแถวให้ครบทุกคลิปที่กลุ่มนั้นกำหนดไว้
    // (ช่อง Gencode / โพสต์ / ยอดวิว / แอด ผูกกับคลิป จึงต้องแยกแถว)
    async addPerson(fields, clipNames = []) {
        const names = Array.isArray(clipNames) ? clipNames.filter(c => c && String(c).trim()) : [];
        const personKey = 'p' + Math.random().toString(36).slice(2, 10);
        // ทุกคลิปของคนเดียวกันคือการส่งครั้งเดียว จึงต้องใช้เวลาเดียวกันทั้งชุด
        const at = now();
        // หลายแถวต้องเกิดพร้อมกันทั้งชุด — พังกลางทางแล้วเหลือครึ่งชุดคือข้อมูลคนที่ขาดคลิป
        return withTransaction(async (client) => {
            if (names.length < 2) {
                return [await insertRow('submissions',
                    newRow({ ...fields, person_key: personKey, clip_no: 1, clip_name: names[0] || null }, at), client)];
            }
            const out = [];
            for (let i = 0; i < names.length; i++) {
                out.push(await insertRow('submissions',
                    newRow({ ...fields, person_key: personKey, clip_no: i + 1, clip_name: names[i] }, at), client));
            }
            return out;
        });
    },
    // ลบทั้งคน (ทุกคลิปของ person_key เดียวกัน)
    async removePerson(subId, projectId) {
        const id = numOr(subId), pid = numOr(projectId);
        if (id === null || pid === null) return null;
        return withTransaction(async (client) => {
            const t = await client.query(
                'SELECT * FROM submissions WHERE id = $1 AND project_id = $2 FOR UPDATE', [id, pid]);
            const target = t.rows[0];
            if (!target) return null;
            const key = target.person_key;
            const d = key
                ? await client.query(
                    'DELETE FROM submissions WHERE person_key = $1 AND project_id = $2 RETURNING id', [key, pid])
                : await client.query('DELETE FROM submissions WHERE id = $1 RETURNING id', [id]);
            return { removed: d.rowCount, account_name: target.account_name };
        });
    },
    // คัดเลือก / ไม่เลือก / คืนสถานะ "ทั้งคน" ทีเดียว (ผู้ใช้สั่ง 27 ต.ค. 2026 — คนทำ 10 คลิปเดิมต้องกดเลือกชื่อเดิม 10 รอบ)
    // แถวคลิปของคนนี้มีครบตามจำนวนคลิปที่แคมเปญกำหนดตั้งแต่ตอนเพิ่มคน (addPerson) — เปลี่ยนทุกคลิปที่ยังอยู่สถานะ fromStatus (สถานะที่หน้าเว็บเห็น)
    // คลิปที่อยู่สถานะอื่น (เช่นไม่เลือกไปแล้วบางคลิป) ไม่แตะ · ไม่มีคลิปในสถานะนั้นแล้ว (มีคนกดไปก่อน) = 409
    // ทรานแซกชันเดียว ล็อกทุกคลิปเรียง id ก่อนเขียน (สำเร็จทั้งคน หรือไม่เปลี่ยนเลย)
    async setPersonStatus(subId, projectId, status, fromStatus, byName, opts = {}) {
        const id = numOr(subId), pid = numOr(projectId);
        if (id === null || pid === null) return null;
        return withTransaction(async (client) => {
            const t = await client.query('SELECT id, person_key FROM submissions WHERE id = $1 AND project_id = $2', [id, pid]);
            const target = t.rows[0];
            if (!target) return null;
            const sibs = (await client.query(target.person_key
                ? 'SELECT id, status FROM submissions WHERE person_key = $1 AND project_id = $2 ORDER BY id FOR UPDATE'
                : 'SELECT id, status FROM submissions WHERE id = $1 AND project_id = $2 FOR UPDATE',
            [target.person_key || id, pid])).rows;
            const todo = sibs.filter(s => (s.status || 'submitted') === fromStatus);
            if (!todo.length) {
                const e = new Error('สถานะของคนนี้เพิ่งถูกเปลี่ยน (มีคนกดไปก่อน) — โหลดหน้าใหม่แล้วดูอีกครั้ง');
                e.status = 409;
                throw e;
            }
            const { at: stampAt, campaignType } = await stampCtxOf(client, pid, {});
            const out = [];
            for (const s of todo) out.push(await updateOne(client, s.id, projectId, { status }, byName, { actor: opts.actor, stampAt, campaignType }));
            return out;
        });
    },
    // แก้ข้อมูล "ตัวคน" ให้ทุกคลิปพร้อมกัน (ชื่อ/ยอดฟอล/Platform/สินค้า/ลิงก์ช่อง/ผู้ติดต่อ)
    // opts.actor = 'team' | 'agency' — ใครแก้ข้อมูลโพสต์ (ตัดสินว่าต้องให้ทีมตรวจก่อนขึ้นหน้า Ads ไหม)
    async updatePerson(subId, projectId, fields, byName, opts = {}) {
        const id = numOr(subId), pid = numOr(projectId);
        if (id === null || pid === null) return null;
        return withTransaction(async (client) => {
            const t = await client.query(
                'SELECT * FROM submissions WHERE id = $1 AND project_id = $2', [id, pid]);
            const target = t.rows[0];
            if (!target) return null;
            const sibs = target.person_key
                ? (await client.query(
                    'SELECT * FROM submissions WHERE person_key = $1 AND project_id = $2 ORDER BY id',
                    [target.person_key, pid])).rows
                : [target];
            // หาเกณฑ์สแตมป์ครั้งเดียวแล้วส่งต่อ — ทุกคลิปของคนนี้อยู่แคมเปญเดียวกัน เกณฑ์จึงเท่ากัน
            const { at: stampAt, campaignType } = await stampCtxOf(client, pid, {});
            let head = null;
            for (const sib of sibs) {
                const r = await updateOne(client, sib.id, projectId, fields, byName, { actor: opts.actor, stampAt, campaignType });
                if (sib.id === target.id) head = r;
            }
            return head;
        });
    },
    // อัปเดตได้ทั้งสถานะคัดเลือก + ข้อมูลดราฟงาน
    async update(subId, projectId, fields, byName, opts = {}) {
        // ส่งต่อเฉพาะ actor / adUnlock — allowFee เปิดได้ทางเดียวคือ setFees
        return withTransaction(client => updateOne(client, subId, projectId, fields, byName, { actor: opts.actor, actorId: opts.actorId, performanceSource: opts.performanceSource, adUnlock: opts.adUnlock === true,
            fillEmpty: Array.isArray(opts.fillEmpty) ? opts.fillEmpty : undefined }));
    },
    // ทีมตัดสินผลตรวจข้อมูลโพสต์ — action 'ok' ยืนยัน (ขึ้นหน้า Ads) | 'return' ส่งกลับให้เอเจนซี่แก้ (note = เหตุผล)
    // seenAt = post_check_at ที่หน้าเว็บเห็นตอนกด — เอเจนซี่แก้แทรกระหว่างนั้น (เวลาไม่ตรง) = 409 ห้ามยืนยันค่าที่ทีมยังไม่เห็น
    async setPostCheck(subId, projectId, action, note, byName, seenAt) {
        const id = numOr(subId), pid = numOr(projectId);
        const patch = postCheckDecision(action, note, byName, now());
        if (id === null || pid === null || !patch) return null;
        return withTransaction(async (client) => {
            const r = await client.query('SELECT id, post_check, post_check_at FROM submissions WHERE id = $1 AND project_id = $2 FOR UPDATE', [id, pid]);
            const cur = r.rows[0];
            if (!cur) return null;
            if (!POST_CHECK_OPEN.includes(cur.post_check) || !sameInstant(cur.post_check_at, seenAt)) {
                const e = new Error('ข้อมูลโพสต์เพิ่งถูกแก้หรือมีคนตรวจไปแล้ว — โหลดค่าล่าสุดแล้วตรวจอีกครั้ง');
                e.status = 409;
                throw e;
            }
            if (action === 'return' && cur.post_check === 'changed') {
                const e = new Error('โพสต์นี้ยิงแอดแล้ว ส่งกลับไม่ได้ (จะหลุดจากหน้า Ads) — ถ้าค่าผิดให้กดแก้ไขในแถวนี้เอง');
                e.status = 409;
                throw e;
            }
            // ส่งกลับให้แก้ = งานเปลี่ยน → จุดแจ้งเตือนแท็บ On Process ฝั่งเอเจนซี่ขึ้น
            if (action === 'return') patch.work_updated_at = now();
            if ('post_check_changes' in patch) patch.post_check_changes = patch.post_check_changes ? asJson(patch.post_check_changes) : null;
            return updateRow('submissions', id, patch, client);
        });
    },
    /**
     * ตั้งค่าตัว (ต่อคลิป) หลายแถวในคำขอเดียว — กรอกรายคน / หารเฉลี่ย / ล้างค่าตัว จากหน้า Dashboard
     *
     * items = [{ sub_id, budget, from? }] · from = ค่าตัวที่หน้าเว็บเห็นก่อนแก้
     * ทั้งชุดอยู่ใน transaction เดียว: ผ่านครบถึงบันทึก ไม่งั้นไม่บันทึกอะไรเลย
     * (หารเฉลี่ยทั้งกลุ่มแล้วพังกลางทาง = ยอดรวมไม่ตรงงบ ซึ่งแย่กว่าไม่บันทึก)
     * แต่ละแถวเขียนผ่าน updateOne ตามเดิม เพื่อให้สแตมป์ผลงาน (maybeStamp) ทำงานทันทีที่ใส่ค่าตัว
     *
     * คืน { rows: แถวล่าสุดเรียงตามที่ส่งมา, changed: เฉพาะแถวที่ค่าตัวเปลี่ยนจริง }
     * error ที่ตั้งใจโยน: status 400 = มีแถวที่ไม่ใช่ของแคมเปญนี้ · 409 = มีคนแก้ค่าตัวแทรกไปแล้ว
     */
    // opts.protectFree = หาร / ล้างค่าตัวของกลุ่ม — คนที่ยืนยันว่าได้มาฟรีแล้วห้ามโดนทับ (หน้าเว็บที่เปิดค้างยังไม่เห็นว่าฟรี · ผลรีวิว 27 ต.ค.)
    async setFees(projectId, items, byName, opts = {}) {
        const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };
        const pid = numOr(projectId);
        const list = Array.isArray(items) ? items : [];
        if (pid === null || !list.length) throw fail(400, 'ไม่มีรายการค่าตัวที่จะบันทึก');
        const ids = list.map(it => numOr(it && it.sub_id));
        // numOr(null) ได้ 0 จึงต้องกัน id <= 0 ด้วย ไม่งั้นรายการว่างจะหลุดไปถึง SQL
        if (ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
            throw fail(400, 'รายการค่าตัวไม่ถูกต้อง');
        }
        // ปัดทีละสตางค์ให้ตรงกับคอลัมน์ NUMERIC(18,2) — ตัวเลขเท่านั้น ห้ามเดา '' / null เป็น 0 เงียบ ๆ
        const fees = list.map(it => (typeof it.budget === 'number' ? Math.round(it.budget * 100) / 100 : NaN));
        if (fees.some(b => !Number.isFinite(b) || b < 0)) throw fail(400, 'ค่าตัวไม่ถูกต้อง');
        const cents = v => Math.round((Number(v) || 0) * 100);   // เทียบเป็นสตางค์ กันทศนิยมลอยของ JS

        return withTransaction(async (client) => {
            // ล็อกทุกแถวก่อนเทียบค่าเดิม — กันทีมอีกคนแก้ค่าตัวแทรกระหว่างทาง
            // เรียงตาม id เสมอ สองคำขอที่ล็อกแถวชุดเดียวกันจะได้ไม่รอกันเองจนค้าง (deadlock)
            const r = await client.query(
                'SELECT * FROM submissions WHERE project_id = $1 AND id = ANY($2::int[]) ORDER BY id FOR UPDATE',
                [pid, ids]);
            const locked = new Map(r.rows.map(s => [s.id, s]));
            if (locked.size !== ids.length) throw fail(400, 'มีรายการที่ไม่ได้อยู่ในแคมเปญนี้ กรุณารีเฟรช');
            list.forEach((it, i) => {
                if (it.from === undefined) return;
                if (cents(locked.get(ids[i]).budget) !== cents(it.from)) {
                    throw fail(409, 'มีคนแก้ค่าตัวนี้ไปแล้ว กรุณารีเฟรช');
                }
            });
            // ค่าตัว 0 เท่าเดิม แต่มีคนยืนยันว่าได้มาฟรีไปแล้ว — ตัวกันข้างบนเทียบแค่ค่าตัวจึงไม่เห็น
            if (opts.protectFree && r.rows.some(s => s.fee_free === true)) {
                throw fail(409, 'มีคนตั้งว่าได้มาฟรีไปแล้ว (ไม่หาร / ล้างค่าตัวให้คนที่ได้ฟรี) กรุณารีเฟรช');
            }

            // หาเกณฑ์สแตมป์ครั้งเดียวต่อคำขอ — ทุกแถวในชุดนี้อยู่แคมเปญเดียวกัน
            const { at: stampAt, campaignType } = await stampCtxOf(client, pid, {});
            const after = new Map();      // id -> แถวหลังบันทึก
            const diff = new Map();       // id -> รายการที่เปลี่ยนจริง
            const order = ids.map((_, i) => i).sort((a, b) => ids[a] - ids[b]);   // เขียนตามลำดับเดียวกับที่ล็อก
            for (const i of order) {
                const cur = locked.get(ids[i]);
                // ค่าเท่าเดิมไม่ต้องเขียน — ไม่งั้นประวัติจะมีรายการ "เปลี่ยน" ที่ไม่ได้เปลี่ยนอะไร
                if (cents(cur.budget) === cents(fees[i])) { after.set(cur.id, cur); continue; }
                // ทางเดียวที่เขียนค่าตัวได้ (allowFee) — ดูคำอธิบายที่ updateOne
                // ใส่ค่าตัว > 0 ให้คนที่เคยยืนยันว่าได้มาฟรี = ไม่ฟรีแล้ว (27 ต.ค. 2026)
                const set = { budget: fees[i] };
                if (fees[i] > 0 && cur.fee_free === true) set.fee_free = false;
                const row = await updateOne(client, cur.id, pid, set, byName, { allowFee: true, stampAt, campaignType });
                after.set(cur.id, row);
                diff.set(cur.id, {
                    id: cur.id, account_name: cur.account_name, clip_no: cur.clip_no,
                    from: Number(cur.budget) || 0, to: Number(row.budget) || 0
                });
            }
            return {
                rows: ids.map(id => after.get(id)),
                changed: ids.filter(id => diff.has(id)).map(id => diff.get(id))
            };
        });
    },
    // ได้มาฟรี / ไม่มีค่าตัว (27 ต.ค. 2026 — แคมเปญ KOL) · items = [{ sub_id, from? }] ทุกคลิปของคนนั้น
    // free = true → ค่าตัว 0 + fee_free (ไม่ขึ้น "ยังไม่ใส่ค่าตัว" · CPM/CPE ไม่มีตัวเลขให้ตัดสิน เหมือน KOL รายคนที่ได้ฟรี)
    // free = false → เอาป้ายได้ฟรีออก (ค่าตัวคง 0 = กลับไปเป็น "ยังไม่ใส่ค่าตัว")
    // from = ค่าตัวที่หน้าเว็บเห็น · ในฐานไม่ตรงแล้ว (มีคนใส่ค่าตัวแทรก) = 409 ไม่ทับ · ทรานแซกชันเดียว ล็อกเรียง id
    async setFeeFree(projectId, items, free, byName) {
        const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };
        const pid = numOr(projectId);
        const list = Array.isArray(items) ? items : [];
        if (pid === null || !list.length || typeof free !== 'boolean') throw fail(400, 'รายการไม่ถูกต้อง');
        const ids = list.map(it => numOr(it && it.sub_id));
        if (ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw fail(400, 'รายการไม่ถูกต้อง');
        const cents = v => Math.round((Number(v) || 0) * 100);
        return withTransaction(async (client) => {
            const r = await client.query('SELECT * FROM submissions WHERE project_id = $1 AND id = ANY($2::int[]) ORDER BY id FOR UPDATE', [pid, ids]);
            const locked = new Map(r.rows.map(s => [s.id, s]));
            if (locked.size !== ids.length) throw fail(400, 'มีรายการที่ไม่ได้อยู่ในแคมเปญนี้ กรุณารีเฟรช');
            if (r.rows.some(s => !('fee_free' in s))) throw fail(503, 'ยังไม่ได้เพิ่มคอลัมน์ "ได้มาฟรี" ในฐานข้อมูล — ต้องรัน setup-db ก่อน');
            list.forEach((it, i) => {
                if (it.from !== undefined && cents(locked.get(ids[i]).budget) !== cents(it.from)) throw fail(409, 'มีคนแก้ค่าตัวนี้ไปแล้ว กรุณารีเฟรช');
            });
            const { at: stampAt, campaignType } = await stampCtxOf(client, pid, {});
            const rows = [], changed = [];
            for (const id of [...ids].sort((a, b) => a - b)) {
                const cur = locked.get(id);
                const set = free ? { budget: 0, fee_free: true } : { fee_free: false };
                if (cur.fee_free === free && (!free || cents(cur.budget) === 0)) { rows.push(cur); continue; }
                const row = await updateOne(client, id, pid, set, byName, { allowFee: true, stampAt, campaignType });
                rows.push(row);
                changed.push({ id, account_name: cur.account_name, clip_no: cur.clip_no, from: Number(cur.budget) || 0 });
            }
            return { rows, changed };
        });
    },
    async countPending(projectId) {
        const pid = numOr(projectId);
        if (pid === null) return 0;
        const r = await query(
            "SELECT COUNT(*) AS n FROM submissions WHERE project_id = $1 AND status = 'submitted'", [pid]);
        return Number(r.rows[0].n) || 0;
    },
    // ลบรายชื่อทั้งหมดที่ส่งเข้ามาผ่านลิงก์เอเจนซี่หนึ่ง ๆ (ใช้ตอนลบลิงก์)
    async removeByAgencyToken(token, projectId) {
        const pid = numOr(projectId);
        if (pid === null) return 0;
        const r = await query(
            'DELETE FROM submissions WHERE agency_token = $1 AND project_id = $2', [token ?? null, pid]);
        return r.rowCount;
    },
    // คนตรวจเฉพาะคลิป (27 ต.ค. 2026 — submissions.reviewer_id) · reviewerId null = กลับไปตามกลุ่ม / แคมเปญ
    // เขียนคอลัมน์เดียว ไม่ขยับ *_updated_at (ไม่ใช่งานของเอเจนซี่ ไม่ต้องเด้งป้ายอัปเดตใหม่) · ทุกแถวต้องอยู่ในแคมเปญนี้
    async setReviewer(projectId, subIds, reviewerId) {
        const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };
        const pid = numOr(projectId);
        const ids = (Array.isArray(subIds) ? subIds : []).map(numOr);
        if (pid === null || !ids.length || ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
            throw fail(400, 'รายการคลิปไม่ถูกต้อง');
        }
        return withTransaction(async (client) => {
            const r = await client.query('SELECT id FROM submissions WHERE project_id = $1 AND id = ANY($2::int[]) ORDER BY id FOR UPDATE', [pid, ids]);
            if (r.rows.length !== ids.length) throw fail(400, 'มีคลิปที่ไม่ได้อยู่ในแคมเปญนี้ กรุณารีเฟรช');
            const u = await client.query('UPDATE submissions SET reviewer_id = $1 WHERE project_id = $2 AND id = ANY($3::int[]) RETURNING *', [reviewerId || null, pid, ids]);
            return u.rows;
        });
    },
    // งานตรวจดราฟข้ามแคมเปญ (หน้า "งานของฉัน" + เลขแดงเมนูที่ถามทุกนาที) — คลิปที่คัดเลือกแล้วของแคมเปญ KOL / KOL รายคน ที่ไม่ได้ยกเลิก
    // อ่านแคมเปญครั้งเดียวต่อแคมเปญ (เฉพาะรหัสกลุ่ม ไม่ลาก ad_groups ทั้งก้อน) + เฉพาะช่องของคลิปที่ใช้ — ไม่ใช่ s.* JOIN ที่ซ้ำข้อมูลแคมเปญทุกแถว
    // คืน { projects: [{ id, name, brand, campaign_type, review_assign, group_keys }], rows } · ตัดสิทธิ์แบรนด์ / คนตรวจที่ routes/myWork.js
    async reviewRows(columns) {
        const p = await query(`SELECT p.id, p.name, p.brand, p.campaign_type, p.review_assign,
                COALESCE((SELECT jsonb_agg(t.g->>'key' ORDER BY t.ord) FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(p.ad_groups) = 'array' THEN p.ad_groups ELSE '[]'::jsonb END) WITH ORDINALITY AS t(g, ord)), '[]'::jsonb) AS group_keys
            FROM projects p
            WHERE coalesce(p.campaign_type, 'kol') <> 'other' AND coalesce(p.status, '') <> 'Cancelled'`);
        if (!p.rows.length) return { projects: [], rows: [] };
        // ชื่อคอลัมน์มาจากรายการคงที่ในโค้ด (routes/myWork.js) — กันพิมพ์ผิด/แทรก SQL ด้วยการรับเฉพาะชื่อที่เป็นตัวอักษรล้วน
        const cols = (columns || []).filter(c => /^[a-z_0-9]+$/.test(c));
        const list = ['id', 'project_id', 'status', 'group_key', ...cols.filter(c => !['id', 'project_id', 'status', 'group_key'].includes(c))];
        const read = names => query(`SELECT ${names.map(c => `s."${c}"`).join(', ')} FROM submissions s
            WHERE s.status = 'confirmed' AND s.project_id = ANY($1::int[]) ORDER BY s.id`, [p.rows.map(x => x.id)]);
        let r;
        try {
            r = await read(list);
        } catch (err) {
            // คอลัมน์ใหม่ที่ฐานยังไม่มี (ยังไม่ setup-db เช่น kol_caption · 30 ต.ค. 2026) — ตัดคอลัมน์ที่ไม่มีออกแล้วอ่านใหม่ หน้างานของฉันไม่ล่ม
            if (err.code !== '42703') throw err;
            const have = new Set((await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'submissions'`)).rows.map(x => x.column_name));
            r = await read(list.filter(c => have.has(c)));
        }
        return { projects: p.rows, rows: r.rows };
    },

    // ลบทิ้งถาวร — ใช้ตอนเอารายชื่อออกจากแคมเปญ (ยกเลิก/ไม่เลือก แค่เปลี่ยนสถานะ แถวยังอยู่)
    async remove(subId, projectId) {
        const id = numOr(subId), pid = numOr(projectId);
        if (id === null || pid === null) return null;
        const r = await query(
            'DELETE FROM submissions WHERE id = $1 AND project_id = $2 RETURNING *', [id, pid]);
        return r.rows[0] || null;
    }
};

module.exports = submissions;
// createSolo (pg/projects.js) สร้างแถวคลิปในทรานแซกชันเดียวกับแถวแคมเปญ — ใช้ตัวสร้างแถวชุดเดียวกัน
module.exports.newRow = newRow;
