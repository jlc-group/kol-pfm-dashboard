/**
 * KOL รายคน — จ้าง KOL เดี่ยวโดยไม่ต้องสร้างแคมเปญ (ผู้ใช้สั่ง 30 ก.ย. 2026)
 *
 * 1 การจ้าง = projects 1 แถว (campaign_type 'solo') + แถวคลิปใน submissions (1 แถว / Platform / คลิป)
 * กลุ่มโฆษณา 1 กลุ่มสร้างที่ server เท่านั้น (buildSoloGroup) — โครงเดียวกับที่ฟอร์มแคมเปญบันทึก (ProjectForm handleSubmit)
 * ส่วนอื่นของระบบ (หน้า Ads / PFM / ฟีด Beauterry / ค่าตัว / สแตมป์ / รายงาน) จึงอ่านได้เหมือนแคมเปญ KOL ทุกอย่าง
 *
 * ผู้ใช้ตัดสินใจ 30 ก.ย.: แท็บแยกในหน้าแคมเปญ · 1 การจ้าง = 1 รายการ · นับรวมใน Dashboard/รายงานแต่มีป้ายแยก
 * รอบ 4 (1 ต.ค.): เลือกได้หลาย Platform — จำนวนคลิปเท่ากันทุก Platform · ชื่อบัญชี / ค่าตัว / ข้อมูลแอดแยกต่อ Platform
 *   ค่าตัว 0 = ได้ฟรี (ว่างยังไม่ได้) · ไม่มีวันที่จ้าง/กำหนดลงงาน (server ตั้งวันที่ของรายการเป็นวันที่สร้าง)
 *   1 การจ้าง = 1 คน (person_key เดียวทุกแถว) · ผู้รับเงิน = Agency หรือบัญชีของ Platform แรกตอนเพิ่ม (แก้ไขแล้วคง Platform เดิม)
 * ไฟล์นี้เป็นตรรกะล้วน ไม่แตะฐานข้อมูล
 */
const {
    TARGET_PLATFORMS, CAMPAIGN_PLATFORMS, CAMPAIGN_AS_CTYPE, SOCIAL_CAMPAIGNS,
    groupNoGencode, effectiveAdStatus
} = require('./logic');

// ตัวเลือกต้องตรงกับฟอร์มฝั่งหน้าเว็บ (client/src/components/SoloKolForm.jsx · ProjectForm.jsx)
// ลำดับของ SOLO_PLATFORMS = ลำดับของ Platform ในการจ้าง (ตัวแรก = Platform หลัก)
const SOLO_PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'Lemon8', 'X', 'YouTube'];
const SOLO_TIERS = ['Nano 1k - 10k', 'Micro 10k - 100k', 'Macro 100k - 1M', 'Mega 1M+'];
const SOLO_CAMPAIGNS = ['VDO View', 'Reach', 'Consideration Ads'];   // TikTok (FB/IG ใช้ SOCIAL_CAMPAIGNS เป็นทั้ง Campaign และ Content Type)
const SOLO_MEDIA = ['Photo', 'VDO'];
const SOLO_CODE_EXPIRE = [7, 30, 60, 180, 365];
const SOLO_MAX_CLIPS = 5;
const SOLO_FEE_MAX = 10000000;    // เท่ากับ FEE_MAX ของ PUT /projects/:id/fees (เส้นแก้ค่าตัวต่อคลิป) — กันพิมพ์ศูนย์เกิน
const SOLO_NAME_MAX = 500;        // projects.name เป็น VARCHAR(500)
const CONTACT_MODES = ['self', 'agency'];
// หน้าเว็บก่อนรอบ 4 (แท็บที่เปิดค้าง) ส่งข้อมูล Platform เดียวแบบแบน — คีย์ชุดนี้ห่อเป็นรายการ 1 Platform
const LEGACY_PLATFORM_KEYS = ['platform', 'account_name', 'link_account', 'followers', 'tier', 'fee',
    'content_type', 'campaign', 'media_type', 'content_format', 'target'];

const text = (v, max) => {
    const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    return s.length > max ? null : s;   // null = ยาวเกิน
};
const isWeb = v => /^https?:\/\/\S+$/i.test(v);
const money = v => Math.round((Number(v) || 0) * 100) / 100;

// ค่าตัวต่อคลิป: ตัวเลข 0 ขึ้นไป (0 = ได้ฟรี) · รับคอมมา · ปัดเป็นสตางค์
// ว่าง = undefined (ผู้เรียกตัดสินว่าบังคับไหม) · ไม่ใช่ตัวเลข / ติดลบ = NaN
function feeOf(v) {
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return undefined;
    const n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v.replace(/,/g, '').trim()) : NaN);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.round(n * 100) / 100 || 0;   // || 0 กัน -0
}

// ตรวจค่าจากฟอร์ม "เพิ่ม KOL รายคน" → { input } | { error } — ข้อความภาษาไทยแสดงตรง ๆ ในฟอร์ม
// ข้อผิดพลาดของช่องที่แยกต่อ Platform ขึ้นต้นด้วยชื่อ Platform ("Instagram: เลือก Campaign ...")
// opts.editing = แก้การจ้างที่มีอยู่ (PUT /projects/:id/solo) — ค่าตัวไม่บังคับ (ว่าง = null)
//   หน้าเว็บส่งค่าตัวมาเฉพาะ Platform ที่เพิ่งเพิ่ม · Platform ที่มีคลิปอยู่แล้วแก้ค่าตัวที่ช่องค่าตัว (PUT /:id/fees) ที่เดียว
// ห้ามคืนข้อความ 'ใส่Platformก่อนนะ' เด็ดขาด — หน้าเว็บรุ่นใหม่ใช้ข้อความนี้ของ server รุ่นเก่าดูว่า server ยังไม่รีสตาร์ต
function soloInput(body, opts = {}) {
    const b = body && typeof body === 'object' ? body : {};
    const editing = opts.editing === true;
    const err = error => ({ error });
    const t = (src, k, max, label, req = false) => {
        const v = text(src[k], max);
        if (v === null) return { bad: `${label}ยาวเกิน ${max} ตัวอักษร` };
        if (req && !v) return { bad: `ใส่${label}ก่อนนะ` };
        return { v };
    };
    const pick = (k, max, label, req) => { const r = t(b, k, max, label, req); if (r.bad) throw r.bad; return r.v; };

    // ข้อมูลของ Platform เดียว (ชื่อบัญชี / ผู้ติดตาม / Tier / ค่าตัว / ข้อมูลแอด)
    const onePlatform = (src, P) => {
        const at = msg => `${P}: ${msg}`;
        const pk = (k, max, label, req) => { const r = t(src, k, max, label, req); if (r.bad) throw at(r.bad); return r.v; };
        const account_name = pk('account_name', 200, 'ชื่อบัญชี KOL', true).replace(/^@+/, '').trim();
        if (!account_name) throw at('ใส่ชื่อบัญชี KOL ก่อนนะ');
        const link_account = pk('link_account', 1000, 'ลิงก์ช่อง');
        if (link_account && !isWeb(link_account)) throw at('ลิงก์ช่องต้องขึ้นต้นด้วย http:// หรือ https://');
        const followers = src.followers === undefined || src.followers === null || src.followers === '' ? 0 : Number(src.followers);
        if (!Number.isFinite(followers) || followers < 0 || followers > 1e10) throw at('จำนวนผู้ติดตามไม่ถูกต้อง');
        const tier = pk('tier', 60, 'Tier', true);
        if (!SOLO_TIERS.includes(tier)) throw at('เลือก Tier');

        // ค่าตัวต่อคลิปบังคับตอนเพิ่ม (ผู้ใช้เลือก 30 ก.ย.) — 0 = ได้ฟรี (รอบ 4) · ว่างยังไม่ได้ ต้องตั้งใจใส่ 0
        const fee = feeOf(src.fee);
        if (fee === undefined) { if (!editing) throw at('ใส่ค่าตัวต่อคลิป (ได้ฟรีใส่ 0)'); }
        else if (Number.isNaN(fee)) throw at('ค่าตัวต่อคลิปต้องเป็นตัวเลข 0 ขึ้นไป (ได้ฟรีใส่ 0)');
        else if (fee > SOLO_FEE_MAX) throw at('ค่าตัวสูงเกินไป (ไม่เกิน 10,000,000 บาทต่อคลิป)');

        const socialCampaign = CAMPAIGN_AS_CTYPE.includes(P);
        const content_type = pk('content_type', 60, socialCampaign ? 'Campaign' : 'Content Type', true);
        if (socialCampaign && !SOCIAL_CAMPAIGNS.includes(content_type)) throw at(`เลือก Campaign (${SOCIAL_CAMPAIGNS.join(' / ')})`);
        // TikTok: Campaign แยกช่อง (ไม่บังคับ) · Facebook/Instagram: Campaign = Content Type · Platform อื่นไม่มี Campaign
        let campaign = null;
        if (socialCampaign) campaign = content_type;
        else if (CAMPAIGN_PLATFORMS.includes(P)) {
            const c = pk('campaign', 60, 'Campaign');
            if (c && !SOLO_CAMPAIGNS.includes(c)) throw at('Campaign ไม่ถูกต้อง');
            campaign = c || null;
        }
        const media_type = pk('media_type', 20, 'Photo/VDO');
        if (media_type && !SOLO_MEDIA.includes(media_type)) throw at('Photo/VDO ไม่ถูกต้อง');
        const content_format = pk('content_format', 200, 'Format');
        // Target (เฉพาะ Platform ที่ใช้ Target) — รายการชื่อกลุ่ม · ฟอร์มบังคับเมื่อสินค้ามีตัวเลือก
        let target = [];
        if (TARGET_PLATFORMS.includes(P) && src.target !== undefined && src.target !== null) {
            if (!Array.isArray(src.target)) throw at('Target ไม่ถูกต้อง');
            target = [...new Set(src.target.map(x => text(x, 100)).filter(Boolean))].slice(0, 30);
        }
        return {
            platform: P, account_name, link_account: link_account || null, followers, tier,
            fee: fee === undefined ? null : fee,
            content_type, campaign, media_type: media_type || null, content_format: content_format || null, target
        };
    };

    try {
        let raw = b.platforms;
        if (!Array.isArray(raw)) {
            const legacy = b.platform !== undefined && b.platform !== null && b.platform !== '';
            raw = legacy ? [Object.fromEntries(LEGACY_PLATFORM_KEYS.map(k => [k, b[k]]))] : [];
        }
        if (!raw.length) throw 'เลือก Platform อย่างน้อย 1 ตัว';
        // ชื่อ Platform ก่อน (ไม่รู้จัก / ซ้ำ) แล้วเรียงตามลำดับมาตรฐาน — ข้อผิดพลาดของช่องอื่นจะขึ้นตามลำดับเดียวกับฟอร์ม
        const seen = new Set();
        const named = raw.map(p => {
            const src = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
            const P = typeof src.platform === 'string' ? src.platform.trim() : '';
            if (!SOLO_PLATFORMS.includes(P)) throw 'เลือก Platform';
            if (seen.has(P)) throw `เลือก ${P} ซ้ำกัน`;
            seen.add(P);
            return { src, P };
        }).sort((x, y) => SOLO_PLATFORMS.indexOf(x.P) - SOLO_PLATFORMS.indexOf(y.P));
        const platforms = named.map(({ src, P }) => onePlatform(src, P));

        // ช่องทางติดต่อ + ชื่อ Agency ใช้ร่วมทุก Platform (1 การจ้าง = 1 ผู้รับเงิน)
        const contact_mode = pick('contact_mode', 10, 'ช่องทางติดต่อ', true);
        if (!CONTACT_MODES.includes(contact_mode)) throw 'เลือกช่องทางติดต่อ (ติดต่อเอง / ผ่าน Agency)';
        const agency = contact_mode === 'agency' ? pick('agency', 200, 'ชื่อ Agency', true) : '';

        const brand = pick('brand', 255, 'แบรนด์', true);
        if (!Array.isArray(b.products)) throw 'เลือกสินค้าอย่างน้อย 1 ตัว';
        const products = [...new Set(b.products.map(p => text(p, 60)).filter(Boolean))];
        if (!products.length) throw 'เลือกสินค้าอย่างน้อย 1 ตัว';
        if (products.length > 30) throw 'เลือกสินค้าได้ไม่เกิน 30 ตัว';

        // จำนวนคลิปเท่ากันทุก Platform · ชื่อคลิป (มากกว่า 1 คลิป) ใช้ร่วมกันตามลำดับคลิป — ว่าง = "คลิป 1", "คลิป 2", ...
        const clips = Number(b.clips);
        if (!Number.isInteger(clips) || clips < 1 || clips > SOLO_MAX_CLIPS) throw `จำนวนคลิปต้องเป็น 1-${SOLO_MAX_CLIPS}`;
        const names = Array.isArray(b.clip_names) ? b.clip_names : [];
        const clip_names = clips > 1 ? Array.from({ length: clips }, (_, i) => {
            const n = text(names[i], 100);
            if (n === null) throw 'ชื่อคลิปยาวเกิน 100 ตัวอักษร';
            return n || `คลิป ${i + 1}`;
        }) : [];
        if (new Set(clip_names).size !== clip_names.length) throw 'ชื่อคลิปซ้ำกัน';

        const owner = pick('owner', 200, 'ผู้ดูแล', true);
        const code = b.code_expire === undefined || b.code_expire === null || b.code_expire === '' ? 60 : Number(b.code_expire);
        if (!SOLO_CODE_EXPIRE.includes(code)) throw 'อายุ Gencode ไม่ถูกต้อง';
        const concept = pick('concept', 1000, 'Concept');
        const brief_link = pick('brief_link', 1000, 'ลิงก์บรีฟ');
        if (brief_link && !isWeb(brief_link)) throw 'ลิงก์บรีฟต้องขึ้นต้นด้วย http:// หรือ https://';
        const note = pick('note', 1000, 'หมายเหตุ');

        return { input: {
            platforms, contact_mode, agency: agency || null,
            brand, products, clips, clip_names, owner,
            code_expire: code, no_gencode: b.no_gencode === true,
            concept: concept || null, brief_link: brief_link || null, note: note || null
        } };
    } catch (e) {
        if (typeof e === 'string') return err(e);
        throw e;
    }
}

// Platform ที่บัญชีของมันเป็นผู้รับเงิน (ติดต่อเอง) · ผ่าน Agency = null
// เพิ่มใหม่ = Platform แรก · แก้ไข (prev = กลุ่มเดิม) และยังติดต่อเองเหมือนเดิม = คง Platform เดิมไว้ถ้ายังเลือกอยู่
//   (payee_platform → บัญชีใน solo.accounts ที่ชื่อตรงกับ payee → Platform ของกลุ่ม — กลุ่มรุ่นก่อนรอบ 4 มีแค่ Platform เดียว)
// งวดจ่ายผูกกับชื่อผู้รับเงิน — เพิ่ม Platform ที่เรียงมาก่อนต้องไม่ย้ายผู้รับเงิน (ไม่งั้นงวดย้ายชื่อ หรือมีงวดจ่ายแล้วแก้ไม่ได้เลย)
// ถอยไป Platform แรกเฉพาะตอน Platform เดิมถูกเอาออก หรือเปลี่ยนช่องทางติดต่อ
function soloPayeePlatform(i, prev) {
    if (i.contact_mode !== 'self') return null;
    const plats = i.platforms.map(p => p.platform);
    const s = prev && prev.solo;
    if (s && s.contact_mode === 'self') {
        const named = Array.isArray(s.accounts) && s.payee ? s.accounts.find(a => a && a.account_name === s.payee) : null;
        const was = s.payee_platform || (named && named.platform) || prev.platform;
        if (was && plats.includes(was)) return was;
    }
    return plats[0];
}
// ผู้รับเงินของการจ้าง — Agency ที่ระบุ หรือบัญชี (ชื่อล่าสุด) ของ Platform ผู้รับเงิน (ติดต่อเอง)
function soloPayee(i, prev) {
    if (i.contact_mode === 'agency') return i.agency;
    const P = soloPayeePlatform(i, prev);
    return (i.platforms.find(p => p.platform === P) || i.platforms[0]).account_name;
}

// กลุ่มโฆษณา 1 กลุ่มของการจ้าง — รูปเดียวกับที่ ProjectForm.handleSubmit บันทึกกลุ่มหลาย Platform
// (1 บล็อก / Platform → sets → tiers แล้วแบนเป็น allocations) ไม่งั้น resolveGroupTarget/Ctype/Media/Campaign ฝั่ง server
// และ quotaOf × clipCountFor ฝั่งหน้าเว็บจะอ่านไม่ออก · solo = ข้อมูลเสริมของ KOL รายคน (โค้ดส่วนอื่นอ่านแค่ payee)
// prev = กลุ่มเดิมตอนแก้ไข (PUT /projects/:id/solo) — ใช้คง Platform ของผู้รับเงินไว้ (soloPayeePlatform)
function buildSoloGroup(i, key, prev = null) {
    const clips = i.clips > 1 ? [...i.clip_names] : [];
    const blocks = i.platforms.map(p => {
        const useTarget = TARGET_PLATFORMS.includes(p.platform);
        const product_targets = {};
        i.products.forEach(c => { product_targets[c] = useTarget ? [...p.target] : []; });
        return {
            platform: p.platform, target: useTarget ? [...p.target] : [], product_targets,
            // แก้ไข (fee = null): งบตั้งใหม่หลังบันทึกจากค่าตัวจริงของคลิป (updateSolo / syncSoloBudget) — ที่นี่ใส่ 0 ไว้ก่อน
            budget: p.fee == null ? 0 : money(p.fee * i.clips),
            budget_mode: 'total', product_budgets: {}, concept_split: false, product_concepts: {},
            products: [...i.products], clips: [...clips],
            sets: [{
                campaign: p.campaign || '', content_type: p.content_type,
                media_type: p.media_type || '', content_format: p.content_format || '',
                tiers: [{ tier: p.tier, kols: 1 }]
            }]
        };
    });
    const allocations = i.platforms.map(p => ({
        platform: p.platform, tier: p.tier, kols: 1, campaign: p.campaign || null,
        content_type: p.content_type, media_type: p.media_type || null, content_format: p.content_format || null
    }));
    // ค่าระดับกลุ่มแบบเดิม (ตัวอ่านเก่า) — เอาจากบล็อก/ชุดแรก · Target เอาจาก Platform แรกที่ใช้ Target
    // Photo/VDO + Format ระดับกลุ่ม: หลาย Platform = null — resolveGroupMedia / mediaFor ถอยมาอ่านค่าระดับกลุ่มเมื่อ Platform นั้นไม่ได้เลือก
    // ถ้าใส่ของ Platform แรกไว้ Platform อื่นที่เว้นว่างจะได้ค่าของ Platform แรกไปผิด ๆ (หน้า Ads / ฟีด / รายงาน)
    const s0 = blocks[0].sets[0];
    const one = blocks.length === 1;
    const tp = i.platforms.find(p => TARGET_PLATFORMS.includes(p.platform));
    const payeePlatform = soloPayeePlatform(i, prev);
    return {
        key, platform: i.platforms[0].platform, platforms: i.platforms.map(p => p.platform), blocks,
        concept: i.concept || null, target: tp ? [...tp.target] : [],
        content_type: s0.content_type,
        media_type: one ? (s0.media_type || null) : null, content_format: one ? (s0.content_format || null) : null,
        clips: [...clips], brief: null, products: [...i.products],
        allocations, kol_count: allocations.reduce((n, a) => n + a.kols, 0),
        budget: money(blocks.reduce((s, x) => s + x.budget, 0)),
        code_expire: i.code_expire, no_gencode: i.no_gencode === true,
        solo: {
            contact_mode: i.contact_mode, payee: soloPayee(i, prev), payee_platform: payeePlatform,
            account_name: i.platforms[0].account_name,
            accounts: i.platforms.map(p => ({ platform: p.platform, account_name: p.account_name }))
        }
    };
}

// ข้อมูลแถวคลิปของแต่ละ Platform (createSolo / updateSolo) — ลำดับเดียวกับ Platform ในการจ้าง
// fee = ค่าตัวต่อคลิป (แก้ไข: null = Platform ที่มีคลิปอยู่แล้ว ใช้ค่าตัวของคลิปเดิม)
function soloPersons(i, groupKey) {
    const product = i.products.join(', ');
    return i.platforms.map(p => ({
        platform: p.platform, account_name: p.account_name, link_account: p.link_account, followers: p.followers,
        tier: p.tier, content_type: p.content_type, fee: p.fee,
        product, agency: i.agency, group_key: groupKey, code_expire: i.code_expire
    }));
}

// งบจากค่าตัวจริงของคลิป — per = { Platform: ผลรวมค่าตัวของคลิปที่ไม่ถูกปฏิเสธ }
// งบของแต่ละบล็อก = ของ Platform นั้น · งบกลุ่ม / งบรายการ = ผลรวม · platform_budgets ครบทุก Platform ของกลุ่ม
function withSoloBudgets(g, per) {
    const sums = per || {};
    const group = { ...(g || {}) };
    const plats = Array.isArray(group.blocks) ? group.blocks.map(x => x.platform) : (group.platform ? [group.platform] : []);
    const platform_budgets = {};
    plats.forEach(p => { if (p) platform_budgets[p] = money(sums[p]); });
    Object.keys(sums).forEach(p => { if (!(p in platform_budgets)) platform_budgets[p] = money(sums[p]); });
    const total = money(Object.values(platform_budgets).reduce((a, x) => a + x, 0));
    if (Array.isArray(group.blocks)) group.blocks = group.blocks.map(x => ({ ...x, budget: platform_budgets[x.platform] || 0 }));
    group.budget = total;
    return { group, total, platform_budgets };
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

// ค่าตัวของชุดคลิป: รวม / ต่อคลิป (null = แต่ละคลิปไม่เท่ากัน) — เทียบเป็นสตางค์ กันทศนิยมลอยของ JS
function feeStats(list) {
    const fees = list.map(s => Number(s.budget) || 0);
    const cents = fees.map(f => Math.round(f * 100));
    const even = cents.every(c => c === cents[0]);
    return {
        fee_per_clip: fees.length && even ? fees[0] : null,
        fee_total: money(fees.reduce((a, f) => a + f, 0)),
        fee_uneven: fees.length > 0 && !even
    };
}

// สรุปของการจ้าง 1 รายการ (แถวในแท็บ KOL รายคน) — คิดจากแถวคลิปที่ยังไม่ถูกปฏิเสธ
// เรียงตาม Platform ในกลุ่ม (ตัวแรก = หลัก) แล้วตามลำดับคลิป · ไม่มีกำหนดลงงานแล้ว (รอบ 4)
function soloSummary(subs, group) {
    const g = group || null;
    const solo = (g && g.solo) || {};
    const order = g && Array.isArray(g.platforms) && g.platforms.length ? [...g.platforms] : (g && g.platform ? [g.platform] : []);
    const list = (subs || []).filter(s => s && s.status !== 'rejected');
    list.forEach(s => { if (s.platform && !order.includes(s.platform)) order.push(s.platform); });
    const rank = p => { const x = order.indexOf(p); return x < 0 ? order.length : x; };
    list.sort((a, b) => rank(a.platform) - rank(b.platform)
        || (Number(a.clip_no) || 1) - (Number(b.clip_no) || 1) || (a.id - b.id));
    const steps = list.map(s => soloClipStep(s, g));
    // ขั้นถัดไป = คลิปที่ช้าสุด (ยังไม่มีคลิป = รอส่งดราฟ)
    const next = steps.length ? SOLO_STEPS[Math.min(...steps.map(x => SOLO_STEPS.indexOf(x)))] : 'todo';
    const posted = rows => rows.filter(s => filled(s.post_url)).length;
    const fired = rows => rows.filter(s => effectiveAdStatus(s) === 'ยิงแล้ว').length;
    const named = Array.isArray(solo.accounts) ? solo.accounts : [];
    const accounts = order.map(p => {
        const rows = list.filter(s => s.platform === p);
        const r0 = rows[0] || {};
        const a0 = named.find(a => a && a.platform === p) || {};
        const { fee_per_clip, fee_total, fee_uneven } = feeStats(rows);
        return {
            platform: p, account_name: r0.account_name || a0.account_name || null, link_account: r0.link_account || null,
            followers: Number(r0.followers) || 0, tier: r0.tier || null,
            clips: rows.length, posted: posted(rows), ad_fired: fired(rows), fee_per_clip, fee_total, fee_uneven
        };
    });
    const first = list[0] || {};
    const main = accounts[0] || {};
    const { fee_per_clip, fee_total } = feeStats(list);
    return {
        // บัญชีของ Platform หลัก — คงชื่อช่องเดิมไว้ให้ตัวอ่านรุ่นก่อน (ค้นหา / ป้ายในหน้าอื่น)
        account_name: main.account_name || solo.account_name || null,
        platform: main.platform || (g && g.platform) || null,
        followers: main.followers || 0,
        tier: main.tier || null,
        link_account: main.link_account || null,
        platforms: order,
        accounts,
        contact_mode: solo.contact_mode || (first.agency ? 'agency' : 'self'),
        payee: solo.payee || first.agency || first.account_name || null,
        agency: first.agency || null,
        products: (g && Array.isArray(g.products)) ? g.products : [],
        clip_count: new Set(list.map(s => Number(s.clip_no) || 1)).size,   // คลิปต่อ Platform
        clips: list.length,                                                 // โพสต์ทั้งหมด = Platform × คลิป
        posted: posted(list),
        ad_fired: fired(list),
        fee_per_clip, fee_total,
        // ค่าตัว 0 ของ KOL รายคน = ได้ฟรี ไม่ใช่ "รอค่าตัว"
        fee_missing: false,
        fee_free: list.length > 0 && list.every(s => (Number(s.budget) || 0) <= 0),
        steps,
        next_step: next
    };
}

// คลิปที่ "เริ่มงานแล้ว" — ลงงาน / ยิงแอด / สแตมป์ผล (ล็อกแบรนด์: เกณฑ์สแตมป์ ฟีดยิงแอด และค่าแอดผูกกับแบรนด์)
const soloClipLive = s => !!s && (filled(s.post_url) || effectiveAdStatus(s) === 'ยิงแล้ว' || !!s.perf_stamp);
// คลิปที่ลดออกได้ตอนแก้จำนวนคลิป / เอา Platform ออก — ยังไม่มีอะไรเกิดขึ้นเลย (ไม่มีดราฟ / โพสต์ / Gencode / ID Post / ค่าแอด / ยอดวิว / สแตมป์)
const soloClipEmpty = s => !!s && ![s.draft_link, s.draft_link2, s.draft_link3, s.draft_link4, s.draft_link5, s.post_url, s.gencode, s.id_post].some(filled)
    && !(Number(s.ad_spend) > 0) && !(Number(s.views) > 0) && !s.perf_stamp && s.ad_status !== 'ยิงแล้ว';

// ลบการจ้างได้ไหม — มีงานเกิดขึ้นแล้ว (ลงงาน / ยิงแอด / สแตมป์ผล / ตั้งงวดจ่าย) = ห้ามลบ ให้ตั้งเป็น "ยกเลิก" แทน
function soloDeleteBlock(subs, installments) {
    const list = subs || [];
    if (list.some(s => filled(s.post_url))) return 'มีคลิปที่ลงงานแล้ว';
    if (list.some(s => effectiveAdStatus(s) === 'ยิงแล้ว')) return 'มีคลิปที่ยิงแอดแล้ว';
    if (list.some(s => s.perf_stamp)) return 'มีคลิปที่สแตมป์ผลแล้ว';
    if ((installments || []).length) return 'ตั้งงวดจ่ายไว้แล้ว';
    return null;
}

// บัญชีของการจ้างแบบอ่านง่าย — ชื่อเดียวกันทุก Platform: "@a (TikTok, Instagram)" · ต่างกัน: "@a (TikTok) · @b (Instagram)"
function soloAccountsText(list) {
    const names = [...new Set(list.map(p => p.account_name))];
    return names.length === 1
        ? `@${names[0]} (${list.map(p => p.platform).join(', ')})`
        : list.map(p => `@${p.account_name} (${p.platform})`).join(' · ');
}

// ชื่อรายการอัตโนมัติ — ขึ้นในคอลัมน์ Project ของหน้า Ads / Dashboard / รายงาน ให้อ่านรู้เรื่อง
// ตัดที่ 500 ตัวอักษร (นับเป็นตัวอักษรจริง ไม่ผ่าครึ่งอีโมจิ) — ชื่อบัญชียาว ๆ หลาย Platform เกินคอลัมน์ได้
function soloName(i) {
    const s = `KOL รายคน · ${soloAccountsText(i.platforms)}`;
    const chars = Array.from(s);
    return chars.length > SOLO_NAME_MAX ? chars.slice(0, SOLO_NAME_MAX - 1).join('') + '…' : s;
}

module.exports = {
    SOLO_PLATFORMS, SOLO_TIERS, SOLO_CAMPAIGNS, SOLO_MEDIA, SOLO_CODE_EXPIRE, SOLO_MAX_CLIPS, SOLO_STEPS, CONTACT_MODES,
    soloInput, buildSoloGroup, soloPayeePlatform, soloPersons, withSoloBudgets, soloClipStep, soloSummary, soloDeleteBlock,
    soloAccountsText, soloName, soloClipLive, soloClipEmpty
};
