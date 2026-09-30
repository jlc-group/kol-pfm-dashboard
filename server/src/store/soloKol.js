/**
 * KOL รายคน — จ้าง KOL เดี่ยวโดยไม่ต้องสร้างแคมเปญ (ผู้ใช้สั่ง 30 ก.ย. 2026)
 *
 * 1 การจ้าง = projects 1 แถว (campaign_type 'solo') + แถวคลิปใน submissions (1 แถว / คลิป)
 * กลุ่มโฆษณา 1 กลุ่มสร้างที่ server เท่านั้น (buildSoloGroup) — โครงเดียวกับที่ฟอร์มแคมเปญบันทึก (ProjectForm handleSubmit)
 * ส่วนอื่นของระบบ (หน้า Ads / PFM / ฟีด Beauterry / ค่าตัว / สแตมป์ / รายงาน) จึงอ่านได้เหมือนแคมเปญ KOL ทุกอย่าง
 *
 * ผู้ใช้ตัดสินใจ 30 ก.ย.: แท็บแยกในหน้าแคมเปญ · 1 การจ้าง = 1 รายการ · นับรวมใน Dashboard/รายงานแต่มีป้ายแยก · ค่าตัวบังคับทุกครั้ง
 * ไฟล์นี้เป็นตรรกะล้วน ไม่แตะฐานข้อมูล
 */
const {
    TARGET_PLATFORMS, CAMPAIGN_PLATFORMS, CAMPAIGN_AS_CTYPE, SOCIAL_CAMPAIGNS,
    isDateStr, groupNoGencode, effectiveAdStatus
} = require('./logic');

// ตัวเลือกต้องตรงกับฟอร์มฝั่งหน้าเว็บ (client/src/components/SoloKolForm.jsx · ProjectForm.jsx)
const SOLO_PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'Lemon8', 'X', 'YouTube'];
const SOLO_TIERS = ['Nano 1k - 10k', 'Micro 10k - 100k', 'Macro 100k - 1M', 'Mega 1M+'];
const SOLO_CAMPAIGNS = ['VDO View', 'Reach', 'Consideration Ads'];   // TikTok (FB/IG ใช้ SOCIAL_CAMPAIGNS เป็นทั้ง Campaign และ Content Type)
const SOLO_MEDIA = ['Photo', 'VDO'];
const SOLO_CODE_EXPIRE = [7, 30, 60, 180, 365];
const SOLO_MAX_CLIPS = 5;
const SOLO_FEE_MAX = 10000000;    // เท่ากับ FEE_MAX ของ PUT /projects/:id/fees (เส้นแก้ค่าตัวต่อคลิป) — กันพิมพ์ศูนย์เกิน
const CONTACT_MODES = ['self', 'agency'];

const text = (v, max) => {
    const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    return s.length > max ? null : s;   // null = ยาวเกิน
};
const isWeb = v => /^https?:\/\/\S+$/i.test(v);

// ตรวจค่าจากฟอร์ม "เพิ่ม KOL รายคน" → { input } | { error } — ข้อความภาษาไทยแสดงตรง ๆ ในฟอร์ม
function soloInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const err = error => ({ error });
    const t = (k, max, label, req = false) => {
        const v = text(b[k], max);
        if (v === null) return { bad: `${label}ยาวเกิน ${max} ตัวอักษร` };
        if (req && !v) return { bad: `ใส่${label}ก่อนนะ` };
        return { v };
    };
    const pick = (k, max, label, req) => { const r = t(k, max, label, req); if (r.bad) throw r.bad; return r.v; };
    try {
        const account_name = pick('account_name', 200, 'ชื่อบัญชี KOL', true).replace(/^@+/, '').trim();
        if (!account_name) throw 'ใส่ชื่อบัญชี KOL ก่อนนะ';
        const platform = pick('platform', 40, 'Platform', true);
        if (!SOLO_PLATFORMS.includes(platform)) throw 'เลือก Platform';
        const link_account = pick('link_account', 1000, 'ลิงก์ช่อง');
        if (link_account && !isWeb(link_account)) throw 'ลิงก์ช่องต้องขึ้นต้นด้วย http:// หรือ https://';
        const followers = b.followers === undefined || b.followers === null || b.followers === '' ? 0 : Number(b.followers);
        if (!Number.isFinite(followers) || followers < 0 || followers > 1e10) throw 'จำนวนผู้ติดตามไม่ถูกต้อง';
        const tier = pick('tier', 60, 'Tier', true);
        if (!SOLO_TIERS.includes(tier)) throw 'เลือก Tier';
        const contact_mode = pick('contact_mode', 10, 'ช่องทางติดต่อ', true);
        if (!CONTACT_MODES.includes(contact_mode)) throw 'เลือกช่องทางติดต่อ (ติดต่อเอง / ผ่าน Agency)';
        const agency = contact_mode === 'agency' ? pick('agency', 200, 'ชื่อ Agency', true) : '';

        const brand = pick('brand', 255, 'แบรนด์', true);
        if (!Array.isArray(b.products)) throw 'เลือกสินค้าอย่างน้อย 1 ตัว';
        const products = [...new Set(b.products.map(p => text(p, 60)).filter(Boolean))];
        if (!products.length) throw 'เลือกสินค้าอย่างน้อย 1 ตัว';
        if (products.length > 30) throw 'เลือกสินค้าได้ไม่เกิน 30 ตัว';

        const socialCampaign = CAMPAIGN_AS_CTYPE.includes(platform);
        const content_type = pick('content_type', 60, socialCampaign ? 'Campaign' : 'Content Type', true);
        if (socialCampaign && !SOCIAL_CAMPAIGNS.includes(content_type)) throw `เลือก Campaign (${SOCIAL_CAMPAIGNS.join(' / ')})`;
        // TikTok: Campaign แยกช่อง (ไม่บังคับ) · Facebook/Instagram: Campaign = Content Type · Platform อื่นไม่มี Campaign
        let campaign = null;
        if (socialCampaign) campaign = content_type;
        else if (CAMPAIGN_PLATFORMS.includes(platform)) {
            const c = pick('campaign', 60, 'Campaign');
            if (c && !SOLO_CAMPAIGNS.includes(c)) throw 'Campaign ไม่ถูกต้อง';
            campaign = c || null;
        }
        const media_type = pick('media_type', 20, 'Photo/VDO');
        if (media_type && !SOLO_MEDIA.includes(media_type)) throw 'Photo/VDO ไม่ถูกต้อง';
        const content_format = pick('content_format', 200, 'Format');

        const clips = Number(b.clips);
        if (!Number.isInteger(clips) || clips < 1 || clips > SOLO_MAX_CLIPS) throw `จำนวนคลิปต้องเป็น 1-${SOLO_MAX_CLIPS}`;
        // ชื่อคลิป (มากกว่า 1 คลิป) — ว่าง = "คลิป 1", "คลิป 2", ...
        const names = Array.isArray(b.clip_names) ? b.clip_names : [];
        const clip_names = clips > 1 ? Array.from({ length: clips }, (_, i) => {
            const n = text(names[i], 100);
            if (n === null) throw 'ชื่อคลิปยาวเกิน 100 ตัวอักษร';
            return n || `คลิป ${i + 1}`;
        }) : [];
        if (new Set(clip_names).size !== clip_names.length) throw 'ชื่อคลิปซ้ำกัน';

        // ค่าตัวบังคับทุกครั้ง (ผู้ใช้เลือก 30 ก.ย.) — ต่อคลิป มากกว่า 0
        const fee = typeof b.fee === 'number' ? b.fee : Number(String(b.fee == null ? '' : b.fee).replace(/,/g, '').trim());
        const feePerClip = Number.isFinite(fee) ? Math.round(fee * 100) / 100 : NaN;   // ปัดเป็นสตางค์ก่อนเช็ค (0.004 = 0)
        if (!Number.isFinite(feePerClip) || feePerClip <= 0) throw 'ใส่ค่าตัวต่อคลิป (มากกว่า 0)';
        if (feePerClip > SOLO_FEE_MAX) throw 'ค่าตัวสูงเกินไป (ไม่เกิน 10,000,000 บาทต่อคลิป)';

        const owner = pick('owner', 200, 'ผู้ดูแล', true);
        const hire_date = pick('hire_date', 10, 'วันที่จ้าง', true);
        if (!isDateStr(hire_date)) throw 'วันที่จ้างไม่ถูกต้อง';
        const due_date = pick('due_date', 10, 'กำหนดลงงาน');
        if (due_date && !isDateStr(due_date)) throw 'กำหนดลงงานไม่ถูกต้อง';
        if (due_date && due_date < hire_date) throw 'กำหนดลงงานต้องไม่ก่อนวันที่จ้าง';

        // Target (เฉพาะ Platform ที่ใช้ Target) — รายการชื่อกลุ่ม · ฟอร์มบังคับเมื่อสินค้ามีตัวเลือก
        let target = [];
        if (TARGET_PLATFORMS.includes(platform) && b.target !== undefined && b.target !== null) {
            if (!Array.isArray(b.target)) throw 'Target ไม่ถูกต้อง';
            target = [...new Set(b.target.map(x => text(x, 100)).filter(Boolean))].slice(0, 30);
        }
        const code = b.code_expire === undefined || b.code_expire === null || b.code_expire === '' ? 60 : Number(b.code_expire);
        if (!SOLO_CODE_EXPIRE.includes(code)) throw 'อายุ Gencode ไม่ถูกต้อง';
        const concept = pick('concept', 1000, 'Concept');
        const brief_link = pick('brief_link', 1000, 'ลิงก์บรีฟ');
        if (brief_link && !isWeb(brief_link)) throw 'ลิงก์บรีฟต้องขึ้นต้นด้วย http:// หรือ https://';
        const note = pick('note', 1000, 'หมายเหตุ');

        return { input: {
            account_name, platform, link_account: link_account || null, followers, tier, contact_mode, agency: agency || null,
            brand, products, content_type, campaign, media_type: media_type || null, content_format: content_format || null,
            clips, clip_names, fee: feePerClip, owner, hire_date, due_date: due_date || null,
            target, code_expire: code, no_gencode: b.no_gencode === true,
            concept: concept || null, brief_link: brief_link || null, note: note || null
        } };
    } catch (e) {
        if (typeof e === 'string') return err(e);
        throw e;
    }
}

// กลุ่มโฆษณา 1 กลุ่มของการจ้าง — รูปเดียวกับที่ ProjectForm.handleSubmit บันทึก
// (blocks → sets → tiers แล้วแบนเป็น allocations) ไม่งั้น resolveGroupTarget/Ctype/Media/Campaign ฝั่ง server
// และ quotaOf × clipCountFor ฝั่งหน้าเว็บจะอ่านไม่ออก · solo = ข้อมูลเสริมของ KOL รายคน (โค้ดส่วนอื่นไม่อ่าน)
function buildSoloGroup(i, key) {
    const useTarget = TARGET_PLATFORMS.includes(i.platform);
    const target = useTarget ? [...i.target] : [];
    const product_targets = {};
    if (useTarget) i.products.forEach(c => { product_targets[c] = [...i.target]; });
    const clips = i.clips > 1 ? [...i.clip_names] : [];
    const budget = Math.round(i.fee * i.clips * 100) / 100;
    const set = {
        campaign: i.campaign || '', content_type: i.content_type, media_type: i.media_type || '', content_format: i.content_format || '',
        tiers: [{ tier: i.tier, kols: 1 }]
    };
    return {
        key, platform: i.platform, platforms: [i.platform],
        blocks: [{
            platform: i.platform, target, product_targets, budget, budget_mode: 'total', product_budgets: {},
            concept_split: false, product_concepts: {}, products: [...i.products], clips, sets: [set]
        }],
        concept: i.concept || null, target,
        content_type: i.content_type, media_type: i.media_type || null, content_format: i.content_format || null,
        clips, brief: null, products: [...i.products],
        allocations: [{
            platform: i.platform, tier: i.tier, kols: 1, campaign: i.campaign || null,
            content_type: i.content_type, media_type: i.media_type || null, content_format: i.content_format || null
        }],
        kol_count: 1, budget, code_expire: i.code_expire, no_gencode: i.no_gencode === true,
        // due_date = กำหนดลงงานจริง (ว่าง = ไม่มีกำหนด) — projects.end_date ถอยไปเป็นวันจ้างเพื่อให้ตัวกรองปี/เดือนทำงาน จึงใช้บอกกำหนดไม่ได้
        solo: { contact_mode: i.contact_mode, payee: i.contact_mode === 'agency' ? i.agency : i.account_name, account_name: i.account_name, due_date: i.due_date || null }
    };
}

// ขั้นของงาน 1 คลิป — ต่อจาก workStage (client/src/data/workStage.js) ไปถึงหลังลงงาน
// todo → review → approved → gencode → idpost → ad → done
// ID Post ใช้ยิงแอด/จับคู่ค่าแอดของ TikTok เท่านั้น · กลุ่ม "ไม่ใช้ Gencode" ข้ามขั้น Gencode
const SOLO_STEPS = ['todo', 'review', 'approved', 'gencode', 'idpost', 'ad', 'done'];
const filled = v => !!(v && String(v).trim());
function soloClipStep(s, g) {
    if (!filled(s.post_url)) {
        if (s.draft_status === 'approve') return 'approved';
        if ([s.draft_link, s.draft_link2, s.draft_link3, s.draft_link4, s.draft_link5].some(filled)) return 'review';
        return 'todo';
    }
    if (!groupNoGencode(g) && !filled(s.gencode)) return 'gencode';
    if (s.platform === 'TikTok' && !filled(s.id_post)) return 'idpost';
    if (effectiveAdStatus(s) !== 'ยิงแล้ว') return 'ad';
    return 'done';
}

// สรุปของการจ้าง 1 รายการ (แถวในแท็บ KOL รายคน) — คิดจากแถวคลิปที่ยังไม่ถูกปฏิเสธ
function soloSummary(subs, group) {
    const list = (subs || []).filter(s => s && s.status !== 'rejected')
        .sort((a, b) => (Number(a.clip_no) || 1) - (Number(b.clip_no) || 1) || (a.id - b.id));
    const g = group || null;
    const first = list[0] || {};
    const steps = list.map(s => soloClipStep(s, g));
    // ขั้นถัดไป = คลิปที่ช้าสุด (ยังไม่มีคลิป = รอส่งดราฟ)
    const next = steps.length ? SOLO_STEPS[Math.min(...steps.map(x => SOLO_STEPS.indexOf(x)))] : 'todo';
    const fees = list.map(s => Number(s.budget) || 0);
    const solo = (g && g.solo) || {};
    return {
        account_name: first.account_name || solo.account_name || null,
        platform: first.platform || (g && g.platform) || null,
        followers: Number(first.followers) || 0,
        tier: first.tier || null,
        link_account: first.link_account || null,
        contact_mode: solo.contact_mode || (first.agency ? 'agency' : 'self'),
        payee: solo.payee || first.agency || first.account_name || null,
        due_date: solo.due_date || null,
        agency: first.agency || null,
        products: (g && Array.isArray(g.products)) ? g.products : [],
        clips: list.length,
        posted: list.filter(s => filled(s.post_url)).length,
        ad_fired: list.filter(s => effectiveAdStatus(s) === 'ยิงแล้ว').length,
        fee_per_clip: fees.length ? fees[0] : 0,
        fee_total: Math.round(fees.reduce((a, b) => a + b, 0) * 100) / 100,
        fee_missing: fees.some(f => f <= 0),
        steps,
        next_step: next
    };
}

// ลบการจ้างได้ไหม — มีงานเกิดขึ้นแล้ว (ลงงาน / ยิงแอด / สแตมป์ผล / ตั้งงวดจ่าย) = ห้ามลบ ให้ตั้งเป็น "ยกเลิก" แทน
function soloDeleteBlock(subs, installments) {
    const list = subs || [];
    if (list.some(s => filled(s.post_url))) return 'มีคลิปที่ลงงานแล้ว';
    if (list.some(s => effectiveAdStatus(s) === 'ยิงแล้ว')) return 'มีคลิปที่ยิงแอดแล้ว';
    if (list.some(s => s.perf_stamp)) return 'มีคลิปที่สแตมป์ผลแล้ว';
    if ((installments || []).length) return 'ตั้งงวดจ่ายไว้แล้ว';
    return null;
}

// ชื่อรายการอัตโนมัติ — ขึ้นในคอลัมน์ Project ของหน้า Ads / Dashboard / รายงาน ให้อ่านรู้เรื่อง
const soloName = i => `KOL รายคน · @${i.account_name} (${i.platform})`;

module.exports = {
    SOLO_PLATFORMS, SOLO_TIERS, SOLO_CAMPAIGNS, SOLO_MEDIA, SOLO_CODE_EXPIRE, SOLO_MAX_CLIPS, SOLO_STEPS, CONTACT_MODES,
    soloInput, buildSoloGroup, soloClipStep, soloSummary, soloDeleteBlock, soloName
};
