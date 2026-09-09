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
const { now, maybeStamp } = require('../logic');

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
    'approved', 'draft_status', 'post_url', 'post_date', 'id_post', 'code_expire',
    'ad_status', 'ad_spend', 'ad_reach', 'ad_start', 'ad_end', 'ad_note',
    'team_note', 'agency_note', 'content_type',
    'views', 'likes', 'comments', 'saves', 'shares', 'reposts',
    'content_format', 'perf_synced_at'
];

// คอลัมน์ตัวเลข NOT NULL — ฟอร์มส่ง '' มาได้ ต้องกลายเป็น 0 ไม่งั้น PostgreSQL ปฏิเสธ
const NUM_COLS = new Set(['followers', 'budget', 'ad_spend', 'ad_reach',
                          'views', 'likes', 'comments', 'saves', 'shares', 'reposts']);

const coerceCol = (k, v) => {
    if (NUM_COLS.has(k)) return asNum(v, 0);
    if (k === 'code_expire') return asNum(v, 60);
    if (k === 'approved') return asBool(v);
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
                  group_key, tier, content_type, agency_token, code_expire, person_key, clip_no, clip_name },
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
        status: 'submitted',                  // submitted | confirmed | rejected
        draft_link: null, draft_link2: null, draft_link3: null, draft_link4: null, draft_link5: null,
        gencode: null, feedback: null, feedback2: null, feedback3: null, feedback4: null, feedback5: null,
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
        submitted_at: at, decided_at: null, decided_by: null,
        list_updated_at: at, work_updated_at: null, draft_updated_at: null  // ใช้ทำแจ้งเตือนแท็บ + per-KOL ดราฟใหม่
    };
}

/**
 * แก้ 1 แถว ภายใน transaction ที่เปิดค้างไว้แล้ว
 * แยกออกมาเพื่อให้ updatePerson แก้พี่น้องหลายแถวได้ใน transaction เดียว
 */
async function updateOne(client, subId, projectId, fields, byName) {
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

    // ช่องที่บันทึกว่าใครแก้ล่าสุดเมื่อไหร่
    // post_date อยู่ในนี้ด้วย เพราะต้องรู้ว่า "แจ้งวันลงงานเข้าระบบตอนไหน"
    // เทียบกับวันที่ลงงานจริง จะได้แยกออกว่ายิงแอดช้าเพราะเราช้า หรือเพราะเพิ่งได้รับแจ้ง
    const STAMP_F = ['post_url', 'gencode', 'id_post', 'post_date'];
    // ล็อกหลังยิงแอดเฉพาะ 3 ช่องนี้ — post_date ไม่ล็อก เผื่อแจ้งวันผิดแล้วต้องแก้ให้ตรงความจริง
    const LOCK_F = ['post_url', 'gencode', 'id_post'];
    const filled = v => !!(v !== null && v !== undefined && String(v).trim());
    const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

    // ยิงแอดไปแล้ว = ล็อกข้อมูลชุดนี้ ห้ามแก้ เพราะเป็นข้อมูลที่ใช้อ้างอิงกับแอดที่ยิงไปแล้ว
    if (s.ad_status === 'ยิงแล้ว') {
        const blocked = LOCK_F.filter(f => fields[f] !== undefined && !same(fields[f], s[f]));
        if (blocked.length) {
            const LABEL = { post_url: 'ลิงก์คลิป', gencode: 'Gencode', id_post: 'ID Post' };
            const e = new Error(`ยิงแอดไปแล้ว จึงแก้ ${blocked.map(f => LABEL[f]).join(' / ')} ไม่ได้ — ถ้าต้องแก้จริง ให้กดสถานะกลับเป็น "ยังไม่ยิง" ก่อน`);
            e.status = 409;
            throw e;
        }
    }
    // perf_stamp ห้ามเซ็ตจากภายนอกเด็ดขาด ระบบเป็นคนสแตมป์เองเท่านั้น
    delete fields.perf_stamp;

    const patch = {};                       // คอลัมน์ที่จะเขียนกลับลง DB
    const before = {};
    STAMP_F.forEach(f => { before[f] = s[f]; });
    for (const k of UPDATABLE) {
        if (fields[k] !== undefined) { s[k] = fields[k]; patch[k] = coerceCol(k, fields[k]); }
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

    // ปรับ timestamp ตามหมวดของข้อมูลที่แก้ (ใช้ทำแจ้งเตือนแท็บ)
    const LIST_F = ['account_name', 'followers', 'platform', 'product', 'agency', 'budget', 'link_account', 'tier', 'content_type', 'group_key', 'status'];
    const WORK_F = ['draft_link', 'draft_link2', 'draft_link3', 'draft_link4', 'draft_link5', 'draft_status', 'feedback', 'feedback2', 'feedback3', 'feedback4', 'feedback5', 'gencode', 'post_url', 'post_date', 'id_post', 'code_expire', 'approved', 'concept', 'gen_date'];
    const DRAFT_F = ['draft_link', 'draft_link2', 'draft_link3', 'draft_link4', 'draft_link5', 'draft_status', 'feedback', 'feedback2', 'feedback3', 'feedback4', 'feedback5'];
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
    const stamped = maybeStamp(s);
    if (stamped) patch.perf_stamp = asJson(stamped);

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
    // แก้ข้อมูล "ตัวคน" ให้ทุกคลิปพร้อมกัน (ชื่อ/ยอดฟอล/Platform/สินค้า/ลิงก์ช่อง/ผู้ติดต่อ)
    async updatePerson(subId, projectId, fields, byName) {
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
            let head = null;
            for (const sib of sibs) {
                const r = await updateOne(client, sib.id, projectId, fields, byName);
                if (sib.id === target.id) head = r;
            }
            return head;
        });
    },
    // อัปเดตได้ทั้งสถานะคัดเลือก + ข้อมูลดราฟงาน
    async update(subId, projectId, fields, byName) {
        return withTransaction(client => updateOne(client, subId, projectId, fields, byName));
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
