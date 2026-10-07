import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import SideDrawer from './SideDrawer.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { visibleBrands } from '../data/brands.js';
import { pickableProducts, targetsForProducts, allTargetsForProducts } from '../data/products.js';
import { useCatalogVersion } from '../data/useCatalog.js';
import { contentTypesFor, CAMPAIGN_TYPES, SOCIAL_CAMPAIGNS, campaignIsCtype, needCampaign, needTarget } from '../data/adGroups.js';
import { CONTENT_FORMATS } from '../data/contentFormats.js';
import {
    SOLO_PLATFORMS, SOLO_TIERS, SOLO_MEDIA, SOLO_CODE_EXPIRE, SOLO_MAX_CLIPS,
    tierFromFollowers, baht, soloPlatformOrder, soloAccountsOf, soloPlatformsOf, soloDuplicateAccounts, isOldServerError, OLD_SERVER_TEXT
} from '../data/soloKol.js';

// ฟอร์ม "เพิ่ม KOL รายคน" — จ้าง KOL เดี่ยวโดยไม่ต้องสร้างแคมเปญ (ผู้ใช้สั่ง 30 ก.ย. 2026)
// ส่งไป POST /api/projects/solo — server สร้างรายการ + กลุ่มโฆษณา + แถวคลิปให้เอง (ตรวจค่าซ้ำฝั่ง server: server/src/store/soloKol.js)
// รอบ 4 (1 ต.ค. 2026): เลือกได้หลาย Platform — บัญชี / ค่าตัว / ข้อมูลยิงแอด แยกต่อ Platform · จำนวนคลิปเท่ากันทุก Platform
// ค่าตัวบังคับทุก Platform (ได้ฟรีใส่ 0) · ไม่มีวันที่จ้าง / กำหนดลงงานแล้ว (server ตั้งวันที่เพิ่มให้เอง)
// "บันทึกแล้วเพิ่มอีกคน" จำ Platform / แบรนด์ / สินค้า / งาน / ค่าตัว / ผู้ดูแล / ข้อมูลยิงแอด / บรีฟ ไว้ ล้างแค่บัญชี
// 5 ต.ค. 2026 (ผู้ใช้สั่ง):
// - ปุ่ม "+ Account" = ใส่หลาย KOL ในฟอร์มเดียว — ทุก KOL ใช้ Platform / งาน / ค่าตัว / ข้อมูลยิงแอด / บรีฟ ชุดเดียวกัน
//   บันทึกแล้วได้ 1 รายการต่อ 1 KOL (ยิง POST /projects/solo ทีละคน — server ไม่ต้องแก้) · ค่าตัวรายคนแก้ทีหลังในหน้า KOL
// - เอาช่อง "ช่องทางติดต่อ" ออก — เพิ่มใหม่ = ติดต่อเอง (ผู้รับเงิน = บัญชี KOL) · แก้ไขส่งค่าเดิมของการจ้างกลับ (Agency เดิมไม่หาย)
// - ลิงก์บรีฟ + รายละเอียดบรีฟ กลับมา (เก็บที่ brief_link / objective เหมือนเดิม · ไม่บังคับ)
const LAST_OWNER = 'solo.lastOwner';
const readLastOwner = () => { try { return localStorage.getItem(LAST_OWNER) || ''; } catch { return ''; } };
const saveLastOwner = v => { try { localStorage.setItem(LAST_OWNER, v); } catch { /* โหมดส่วนตัว — ไม่จำก็ได้ */ } };
const MAX_FEE = 10000000;   // เท่ากับ SOLO_FEE_MAX ฝั่ง server
// ค่าตัวที่พิมพ์ → ตัวเลข (ปัดเป็นสตางค์) · ว่าง = null (ยังไม่ใส่ — ไม่นับเป็น 0 ได้ฟรีต้องพิมพ์ 0 เอง) · รูปแบบผิด = NaN
const feeVal = v => {
    const t = String(v == null ? '' : v).replace(/,/g, '').trim();
    if (t === '') return null;
    if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
    return Math.round(Number(t) * 100) / 100;
};
const isWeb = v => /^https?:\/\/\S+$/i.test(v);
// server รุ่นเก่า (ยังไม่รีสตาร์ตหลัง deploy) — ข้อความที่ใช้แยกรุ่นอยู่ใน data/soloKol.js (OLD_SERVER_MSGS / isOldServerError)
const LINK_PH = {
    TikTok: 'https://www.tiktok.com/@...', Instagram: 'https://www.instagram.com/...', Facebook: 'https://www.facebook.com/...',
    Lemon8: 'https://www.lemon8-app.com/@...', X: 'https://x.com/...', YouTube: 'https://www.youtube.com/@...'
};

// ค่าต่อ Platform เก็บเป็น map ตามชื่อ Platform — เอาติ๊กออกแล้วติ๊กกลับ ค่าที่กรอกไว้ยังอยู่ · ตรวจ/ส่งเฉพาะ Platform ที่เลือก
const ACC_EMPTY = { account_name: '', link_account: '', followers: '', tier: '', tierTouched: false };
const AD_EMPTY = { content_type: '', campaign: '', media_type: '', content_format: '', target: [] };
// 1 การ์ด = 1 KOL — เลือก Platform ในการ์ดของตัวเอง (ผู้ใช้สั่ง 5 ต.ค. 2026: เดิมเลือกครั้งเดียวด้านบน + Account แล้วติด TikTok เปลี่ยนไม่ได้)
// platforms = Platform ของ KOL คนนี้ · acc = บัญชีต่อ Platform (เอาติ๊กออกแล้วติ๊กกลับ ค่าที่กรอกไว้ยังอยู่ · ตรวจ/ส่งเฉพาะที่เลือก)
// key ไว้ผูกการ์ดกับ React และเอาคนที่บันทึกแล้วออกจากฟอร์ม
const KOL_MAX = 20;   // + Account ได้สูงสุดต่อการบันทึก 1 ครั้ง
let kolSeq = 0;
const newKol = (platforms = ['TikTok'], acc = {}) => ({ key: 'kol' + (++kolSeq), platforms: [...platforms], acc });
const KOL_EMPTY = (platforms = ['TikTok']) => ({ kols: [newKol(platforms)], contact_mode: 'self', agency: '' });
const JOB_EMPTY = brand => ({
    brand, products: [], clips: 1, clip_names: ['', '', '', '', ''], fee: {}, owner: readLastOwner(),
    ad: {}, code_expire: 60, no_gencode: false, concept: '', brief_link: '', note: ''
});
// Facebook / Instagram เลือก Campaign (Awareness / Engagement / Reels) ที่ช่อง Content Type
const ctypeOptionsOf = p => (campaignIsCtype(p) ? SOCIAL_CAMPAIGNS : contentTypesFor(p));

function Field({ label, req, opt, hint, err, htmlFor, labelId, children }) {
    const head = (
        <>
            {label}
            {req && <span className="qf-req" aria-hidden="true"> *</span>}
            {opt && <span className="qf-opt"> ({opt})</span>}
        </>
    );
    return (
        <div className={'qf-field' + (err ? ' has-err' : '')}>
            {htmlFor
                ? <label className="qf-label" htmlFor={htmlFor}>{head}</label>
                : <div className="qf-label" id={labelId}>{head}</div>}
            {children}
            {err && <div className="qf-err" role="alert">{err}</div>}
            {hint && <div className="qf-hint">{hint}</div>}
        </div>
    );
}
// ปุ่มเลือก (ตัวเดียว = radio · หลายตัว = checkbox) · disabled = ล็อกไว้ (แก้ไม่ได้) — ส่งเป็นฟังก์ชันได้ ล็อกเฉพาะบางตัว
function Chips({ options, value, onPick, multi = false, labelId, render = o => o, disabled = false }) {
    const on = o => (multi ? (value || []).includes(o) : value === o);
    const off = o => (typeof disabled === 'function' ? disabled(o) : disabled);
    return (
        <div className="qf-chips" role={multi ? 'group' : 'radiogroup'} aria-labelledby={labelId}>
            {options.map(o => (
                <button type="button" key={o} role={multi ? 'checkbox' : 'radio'} aria-checked={on(o)} disabled={off(o)}
                    className={'qf-chip' + (on(o) ? ' on' : '')} onClick={() => onPick(o)}>{render(o)}</button>
            ))}
        </div>
    );
}

// ค่าในฟอร์มจากการจ้างที่มีอยู่ (โหมดแก้ไข) — บัญชีจาก solo_summary.accounts · ข้อมูลยิงแอดจากบล็อกของแต่ละ Platform ในกลุ่มโฆษณา
// clipNames = ชื่อคลิปตามลำดับคลิป (clip_no - 1) ใช้ร่วมกันทุก Platform
function fromProject(p, clipNames) {
    const s = p.solo_summary || {};
    const g = (p.ad_groups || [])[0] || {};
    const blocks = Array.isArray(g.blocks) ? g.blocks : [];
    const accounts = soloAccountsOf(p);
    const platforms = soloPlatformsOf(p);
    const clips = Math.max(1, Math.min(SOLO_MAX_CLIPS, Number(s.clip_count) || clipNames.length || 1));
    const acc = {};
    const ad = {};
    platforms.forEach(pl => {
        const a = accounts.find(x => x && x.platform === pl) || {};
        const b = blocks.find(x => x && x.platform === pl) || {};
        const set = (b.sets || [])[0] || {};
        const social = campaignIsCtype(pl);
        acc[pl] = {
            account_name: a.account_name || '', link_account: a.link_account || '',
            followers: a.followers ? String(a.followers) : '', tier: a.tier || ((set.tiers || [])[0] || {}).tier || '', tierTouched: true
        };
        ad[pl] = {
            // Facebook / Instagram: Campaign = Content Type (เก็บไว้ทั้งสองช่องของชุด)
            content_type: set.content_type || (social ? set.campaign : '') || '', campaign: social ? '' : (set.campaign || ''),
            media_type: set.media_type || '', content_format: set.content_format || '',
            target: needTarget(pl) && Array.isArray(b.target) ? [...b.target] : []
        };
    });
    // ช่องทางติดต่อไม่อยู่ในฟอร์มแล้ว — เก็บค่าเดิมไว้ส่งกลับ (server เขียนทุกครั้ง · Agency เดิมต้องไม่กลายเป็นติดต่อเอง)
    const k = {
        kols: [newKol(platforms.length ? platforms : ['TikTok'], acc)],
        contact_mode: s.contact_mode === 'agency' ? 'agency' : 'self', agency: s.contact_mode === 'agency' ? (s.agency || s.payee || '') : ''
    };
    const j = {
        brand: p.brand || '', products: [...(g.products || s.products || [])],
        clips, clip_names: [0, 1, 2, 3, 4].map(i => (clips > 1 ? String(clipNames[i] || '') : '')),
        fee: {}, owner: p.owner || '', ad,
        code_expire: Number(g.code_expire) || 60, no_gencode: g.no_gencode === true,
        concept: g.concept || '', brief_link: p.brief_link || '', note: p.objective || ''
    };
    return { k, j, existing: platforms };
}

// project = แก้การจ้างที่มีอยู่ (PUT /projects/:id/solo) · clipNames = ชื่อคลิปตามลำดับคลิป
// lockedPlatforms = Platform ที่มีคลิปไม่ว่าง (ดราฟ / Gencode / ID Post / ลงงาน / ยิงแอด — clipEmpty) เอาออกไม่ได้
// minClips = จำนวนคลิปต่ำสุดที่ลดได้ (คลิปไม่ว่างลำดับสูงสุด) · ทั้งสองค่าเกณฑ์เดียวกับ updateSolo ฝั่ง server (server กันซ้ำ)
// brandLocked = มีคลิปเริ่มงานแล้ว (ลงงาน / ยิงแอด / สแตมป์) แบรนด์แก้ไม่ได้ (server กันซ้ำ)
export default function SoloKolForm({ onClose, onSaved, project = null, clipNames = [], lockedPlatforms = [], minClips = 1, brandLocked = false }) {
    const editing = !!project;
    const uid = useId();
    const id = s => `${uid}-${s}`;
    const { user } = useAuth();
    const mine = visibleBrands(user);
    // แบรนด์เดิมของการจ้างต้องอยู่ในตัวเลือกเสมอ (ไม่งั้นช่องว่าง บันทึกไม่ผ่าน)
    const brands = editing && project.brand && !mine.includes(project.brand) ? [...mine, project.brand] : mine;
    const [init] = useState(() => (editing ? fromProject(project, clipNames) : null));
    const existing = init ? init.existing : [];
    const [k, setK] = useState(() => (init ? init.k : KOL_EMPTY()));
    const [j, setJ] = useState(() => (init ? init.j : JOB_EMPTY(brands.length === 1 ? brands[0] : '')));
    const [owners, setOwners] = useState([]);
    const [tried, setTried] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const [done, setDone] = useState([]);   // ชื่อที่เพิ่มไปแล้วในรอบนี้ (บันทึกแล้วเพิ่มอีกคน / + Account)
    const [progress, setProgress] = useState('');   // หลาย KOL: "2/3" ระหว่างบันทึกทีละคน
    const wrapRef = useRef(null);
    const clean = useRef(null);
    useEffect(() => {
        let alive = true;
        api('/users/options')
            .then(res => { if (alive) setOwners((res.data || []).map(u => u.name).filter(Boolean)); })
            .catch(() => { if (alive) setOwners([]); });
        return () => { alive = false; };
    }, []);
    useEffect(() => { clean.current = JSON.stringify({ k, j }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

    // Platform ของ KOL แต่ละคน (เลือกในการ์ด) · plats = ทุก Platform ที่มีคนเลือก → ช่องค่าตัว / ข้อมูลยิงแอดต่อ Platform (ใช้ร่วมกันทุกคนที่เลือก Platform นั้น)
    const platsOf = ki => soloPlatformOrder((k.kols[ki] && k.kols[ki].platforms) || []);
    const plats = soloPlatformOrder(k.kols.flatMap(x => x.platforms));
    const multi = plats.length > 1;
    const nKol = k.kols.length;
    const kolsOn = p => k.kols.filter(x => x.platforms.includes(p)).length;   // จำนวน KOL ที่เลือก Platform นี้
    const accOf = (ki, p) => (k.kols[ki] && k.kols[ki].acc[p]) || ACC_EMPTY;
    const adOf = p => j.ad[p] || AD_EMPTY;
    const isLocked = p => editing && lockedPlatforms.includes(p);
    // แก้ไข: ลดจำนวนคลิปได้ไม่ต่ำกว่าคลิปที่มีงานแล้วลำดับสูงสุด (เพิ่มใหม่ = เลือกได้ทุกตัว)
    const clipFloor = editing ? Math.max(1, Math.min(SOLO_MAX_CLIPS, Number(minClips) || 1)) : 1;
    // แก้ไข: ค่าตัวของ Platform เดิมแก้ที่ช่องค่าตัวในหน้า KOL — ฟอร์มถามเฉพาะ Platform ที่เพิ่มใหม่ (ยังไม่มีคลิป)
    const feeNeeded = p => !editing || !existing.includes(p);
    const feePlats = plats.filter(feeNeeded);
    // คลังเปลี่ยนได้จากหน้า Products & Targets (7 ต.ค. 2026) — version อยู่ใน deps · สินค้าที่ซ่อนไม่ขึ้นให้เลือก
    // ยกเว้นที่เลือกไว้แล้ว / การจ้างนี้บันทึกไว้ตอนเปิดฟอร์ม (เผลอติ๊กออกยังติ๊กกลับได้)
    const catalogVersion = useCatalogVersion();
    const productOptions = useMemo(() => (j.brand ? pickableProducts(j.brand, [...((init && init.j.products) || []), ...(j.products || [])]) : []), [init, j.brand, j.products, catalogVersion]);
    const productTargets = useMemo(() => targetsForProducts(j.products), [j.products, catalogVersion]);
    const targetOptionsOf = p => (needTarget(p) ? productTargets : []);
    const ownerOptions = j.owner && !owners.includes(j.owner) ? [...owners, j.owner] : owners;
    const tag = (p, m) => (multi ? `${p}: ${m}` : m);   // หลาย Platform — บอกว่าช่องของ Platform ไหน

    const upJ = (key, v) => setJ(s => ({ ...s, [key]: v }));
    // แก้บัญชีของ KOL ลำดับ ki ใน Platform p
    const upKolAcc = (ki, p, fn) => setK(s => ({
        ...s, kols: s.kols.map((x, i) => (i === ki ? { ...x, acc: { ...x.acc, [p]: fn(x.acc[p] || ACC_EMPTY) } } : x))
    }));
    const upAcc = (ki, p, patch) => upKolAcc(ki, p, a => ({ ...a, ...patch }));
    const upAd = (p, patch) => setJ(s => ({ ...s, ad: { ...s.ad, [p]: { ...(s.ad[p] || AD_EMPTY), ...patch } } }));
    const focusKol = key => setTimeout(() => {
        const el = wrapRef.current && wrapRef.current.querySelector(`[data-kol="${key}"] input`);
        if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); }
    }, 0);
    function addKol() {
        if (nKol >= KOL_MAX) return;
        // การ์ดใหม่เริ่มที่ Platform เดียวกับการ์ดล่าสุด (มักจ้างช่องทางเดียวกันทั้งชุด) — เปลี่ยนในการ์ดได้
        const last = k.kols[k.kols.length - 1];
        const x = newKol(last && last.platforms.length ? last.platforms : ['TikTok']);
        setK(s => ({ ...s, kols: [...s.kols, x] }));
        focusKol(x.key);
    }
    function removeKol(ki) {
        const x = k.kols[ki];
        const typed = x && Object.values(x.acc).some(a => a && (a.account_name.trim() || a.link_account.trim() || a.followers));
        if (typed && !window.confirm(`เอา KOL ${ki + 1} ออกจากฟอร์มนี้ไหม?`)) return;
        setK(s => ({ ...s, kols: s.kols.filter((_, i) => i !== ki) }));
        // ปุ่มที่กดหายไปกับการ์ด — ย้ายโฟกัสไปการ์ดถัดไป (ไม่มี = ปุ่ม + Account) ไม่ให้หลุดไปที่ body
        const next = k.kols[ki + 1];
        if (next) focusKol(next.key);
        else setTimeout(() => { const b = wrapRef.current && wrapRef.current.querySelector('.solo-add-kol'); if (b) b.focus(); }, 0);
    }

    // เลือก/เอาออก Platform ของ KOL ลำดับ ki (แก้ไข: Platform ที่มีงานแล้วเอาออกไม่ได้)
    function togglePlatform(ki, p) {
        const cur = platsOf(ki);
        const on = !cur.includes(p);
        if (!on && isLocked(p)) return;
        setK(s => ({
            ...s, kols: s.kols.map((x, i) => (i === ki ? { ...x, platforms: SOLO_PLATFORMS.filter(y => (y === p ? on : x.platforms.includes(y))) } : x))
        }));
        // Platform ที่ใช้ Target และสินค้ามี Target ให้เลือกตัวเดียว = เลือกให้เลย
        if (on && needTarget(p) && productTargets.length === 1) {
            setJ(s => {
                const d = s.ad[p] || AD_EMPTY;
                return d.target.length ? s : { ...s, ad: { ...s.ad, [p]: { ...d, target: [productTargets[0]] } } };
            });
        }
    }
    function pickBrand(b) {
        // เปลี่ยนแบรนด์ = สินค้า/Target ชุดใหม่ (ล้าง Target ทุก Platform)
        setJ(s => {
            if (s.brand === b) return s;
            const ad = {};
            Object.keys(s.ad).forEach(p => { ad[p] = { ...s.ad[p], target: [] }; });
            return { ...s, brand: b, products: [], ad };
        });
    }
    function toggleProduct(code) {
        setJ(s => {
            const products = s.products.includes(code) ? s.products.filter(x => x !== code) : [...s.products, code];
            const opts = targetsForProducts(products);
            const kept = allTargetsForProducts(products);   // Target ที่เลือกไว้แล้วแต่ถูกซ่อน ยังเก็บไว้ (ไม่หายเงียบ ๆ)
            // Target ที่ไม่อยู่ในตัวเลือกใหม่ล้างทิ้ง · มีตัวเลือกเดียว = เลือกให้เลย (ทุก Platform ที่ใช้ Target)
            const ad = { ...s.ad };
            soloPlatformOrder([...Object.keys(s.ad), ...plats]).filter(needTarget).forEach(p => {
                const d = s.ad[p] || AD_EMPTY;
                let target = d.target.filter(t => opts.includes(t) || kept.includes(t));
                if (!target.length && opts.length === 1) target = [opts[0]];
                ad[p] = { ...d, target };
            });
            return { ...s, products, ad };
        });
    }
    function toggleTarget(p, t) {
        const cur = adOf(p).target;
        upAd(p, { target: cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t] });
    }
    function setFollowers(ki, p, v) {
        const digits = v.replace(/[^0-9]/g, '');
        upKolAcc(ki, p, a => ({ ...a, followers: digits, tier: a.tierTouched ? a.tier : tierFromFollowers(digits) }));
    }

    const feeTotalOf = p => {
        const f = feeVal(j.fee[p]);
        return Number.isFinite(f) && f > 0 ? Math.round(f * j.clips * 100) / 100 : 0;
    };
    function feeHint(p) {
        const f = feeVal(j.fee[p]);
        if (f === 0) return 'ได้ฟรี (ไม่มีค่าใช้จ่าย)';
        if (Number.isFinite(f) && f > 0) {
            const one = `${baht(f)} × ${j.clips} คลิป = ${baht(feeTotalOf(p))}`;
            const n = kolsOn(p);
            return n > 1 ? `${one} ต่อ KOL · ${n} KOL รวม ${baht(Math.round(feeTotalOf(p) * n * 100) / 100)}` : one;
        }
        return 'ได้ฟรีใส่ 0';
    }

    function errors() {
        const e = {};
        const dup = soloDuplicateAccounts(k.kols, plats);
        // หลาย KOL — ข้อความบอกเลขการ์ดด้วย (ป้ายช่องเหมือนกันทุกใบ โปรแกรมอ่านหน้าจอต้องรู้ว่าเป็นของคนไหน)
        // ชื่อ Platform นำหน้าเมื่อการ์ดนั้นเลือกหลาย Platform
        const who = (ki, p, m) => {
            const t = platsOf(ki).length > 1 ? `${p}: ${m}` : m;
            return nKol > 1 ? `KOL ${ki + 1} · ${t}` : t;
        };
        k.kols.forEach((x, ki) => {
            if (!platsOf(ki).length) e['plat_' + ki] = nKol > 1 ? `KOL ${ki + 1} · เลือก Platform อย่างน้อย 1 ตัว` : 'เลือก Platform อย่างน้อย 1 ตัว';
        });
        k.kols.forEach((x, ki) => platsOf(ki).forEach(p => {
            const a = accOf(ki, p);
            const at = `${ki}_${p}`;
            if (!a.account_name.trim().replace(/^@+/, '').trim()) e['acc_' + at] = who(ki, p, 'ใส่ชื่อบัญชี KOL');
            else if (dup[`${ki}|${p}`] !== undefined) e['acc_' + at] = who(ki, p, `ชื่อบัญชีซ้ำกับ KOL ${dup[`${ki}|${p}`] + 1}`);
            if (a.link_account.trim() && !isWeb(a.link_account.trim())) e['link_' + at] = who(ki, p, 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');
            if (!a.tier) e['tier_' + at] = who(ki, p, 'เลือก Tier');
        }));
        if (!j.brand) e.brand = 'เลือกแบรนด์';
        if (!j.products.length) e.products = 'เลือกสินค้าอย่างน้อย 1 ตัว';
        if (j.clips > 1) {
            const names = j.clip_names.slice(0, j.clips).map((n, i) => n.trim() || `คลิป ${i + 1}`);
            if (new Set(names).size !== names.length) e.clips = 'ชื่อคลิปซ้ำกัน';
        }
        if (j.clips < clipFloor) e.clips = `ลดเหลือน้อยกว่า ${clipFloor} คลิปไม่ได้ — คลิปที่ ${clipFloor} มีงานแล้ว`;
        feePlats.forEach(p => {
            const f = feeVal(j.fee[p]);
            if (f === null) e['fee_' + p] = tag(p, 'ใส่ค่าตัวต่อคลิป (ได้ฟรีใส่ 0)');
            else if (!Number.isFinite(f)) e['fee_' + p] = tag(p, 'ค่าตัวต้องเป็นตัวเลข');
            else if (f > MAX_FEE) e['fee_' + p] = tag(p, 'ค่าตัวสูงเกินไป (ไม่เกิน 10,000,000 บาทต่อคลิป)');
        });
        if (!j.owner) e.owner = 'เลือกผู้ดูแล';
        if (j.brief_link.trim() && !isWeb(j.brief_link.trim())) e.brief_link = 'ลิงก์บรีฟต้องขึ้นต้นด้วย http:// หรือ https://';
        plats.forEach(p => {
            const d = adOf(p);
            // ต้องเป็นตัวเลือกของ Platform นี้ — กันค่าแปลกที่มองไม่เห็นในปุ่มหลุดไปบันทึก
            if (!d.content_type || !ctypeOptionsOf(p).includes(d.content_type)) e['ct_' + p] = tag(p, campaignIsCtype(p) ? 'เลือก Campaign' : 'เลือก Content Type');
            if (targetOptionsOf(p).length && !d.target.length) e['tg_' + p] = tag(p, 'เลือก Target อย่างน้อย 1 กลุ่ม (หน้า Ads และระบบยิงแอดใช้ค่านี้)');
        });
        return e;
    }
    const errs = errors();
    const E = tried ? errs : {};
    const dirty = clean.current !== null && JSON.stringify({ k, j }) !== clean.current;

    function requestClose() {
        if (saving) return;
        if (dirty && !window.confirm('ยังไม่ได้บันทึก — ปิดฟอร์มนี้เลยไหม?')) return;
        onClose(done.length > 0);
    }
    const toTop = () => {
        const s = wrapRef.current && wrapRef.current.closest('.side-drawer-body');
        if (s) s.scrollTo({ top: 0, behavior: 'smooth' });
    };

    async function save(again) {
        setTried(true);
        if (Object.keys(errs).length) {
            setErr('');
            setTimeout(() => {
                const el = wrapRef.current && wrapRef.current.querySelector('.qf-field.has-err');
                if (el) {
                    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    const input = el.querySelector('input:not([type=file]), textarea, select, button');
                    if (input) input.focus({ preventScroll: true });
                }
            }, 0);
            return;
        }
        // ค่าตัว 0 = ได้ฟรี — ถามก่อนทุกครั้ง กันพิมพ์ 0 เผลอ
        const free = feePlats.filter(p => feeVal(j.fee[p]) === 0);
        if (free.length && !window.confirm(`ค่าตัว 0 = ได้ฟรี (ไม่มีค่าใช้จ่าย) ใช่ไหม?\n${free.join(', ')}`)) return;
        setSaving(true); setErr('');
        // บัญชีของ KOL ลำดับ ki + ข้อมูลยิงแอด / ค่าตัวต่อ Platform (ชุดเดียวกันทุก KOL)
        const platformsOf = ki => platsOf(ki).map(p => {
            const a = accOf(ki, p);
            const d = adOf(p);
            const social = campaignIsCtype(p);
            const item = {
                platform: p, account_name: a.account_name.trim(), link_account: a.link_account.trim(),
                followers: a.followers ? Number(a.followers) : 0, tier: a.tier
            };
            // แก้ไข: ส่งค่าตัวเฉพาะ Platform ที่เพิ่มใหม่ — Platform เดิมแก้ที่ช่องค่าตัวในหน้า KOL (เส้นค่าตัวที่เดียว)
            if (feeNeeded(p)) item.fee = feeVal(j.fee[p]);
            return {
                ...item, content_type: d.content_type,
                // Facebook/Instagram: Campaign = Content Type · TikTok: Campaign แยกช่อง (ไม่บังคับ) · Platform อื่นไม่มี Campaign
                campaign: social ? d.content_type : (needCampaign(p) ? d.campaign : ''),
                media_type: d.media_type, content_format: d.content_format,
                target: needTarget(p) ? d.target : []
            };
        });
        const shared = {
            // ไม่มีช่องทางติดต่อในฟอร์มแล้ว: เพิ่มใหม่ = ติดต่อเอง · แก้ไข = ค่าเดิมของการจ้าง (server เขียนทุกครั้ง ไม่ส่ง = 400)
            contact_mode: k.contact_mode === 'agency' && k.agency.trim() ? 'agency' : 'self',
            agency: k.contact_mode === 'agency' ? k.agency.trim() : '',
            brand: j.brand, products: j.products,
            clips: j.clips, clip_names: j.clip_names.slice(0, j.clips).map(n => n.trim()),
            owner: j.owner, code_expire: j.code_expire, no_gencode: j.no_gencode,
            concept: j.concept.trim(),
            // ลิงก์บรีฟ / รายละเอียดบรีฟ (เก็บที่ projects.brief_link / objective) — server เขียนทุกครั้งที่บันทึก
            brief_link: j.brief_link.trim(), note: j.note.trim()
        };
        const whoOf = body => [...new Set(body.platforms.map(x => '@' + x.account_name.replace(/^@+/, '')))].join(' / ');
        if (editing) {
            try {
                // server ตัดสินเพิ่ม/ลดคลิปและ Platform เอง และล็อกแบรนด์/Platform ที่เริ่มงานแล้ว
                const res = await api(`/projects/${encodeURIComponent(project.id)}/solo`, { method: 'PUT', body: { platforms: platformsOf(0), ...shared } });
                saveLastOwner(j.owner);
                onSaved && onSaved(res && res.data, { again: false });
            } catch (e) {
                // server ยังเป็นรุ่นเก่า: ไม่มีเส้นนี้ (404 "API route not found" เท่านั้น) หรือยังรับแบบ Platform เดียว (ดู OLD_SERVER_MSGS)
                // 404 อื่น (เช่นรายการถูกลบไปแล้ว) / 409 (หน้าเว็บรุ่นเก่า มีงานแล้ว) โชว์ข้อความของ server ตามจริง
                setErr(isOldServerError(e) ? OLD_SERVER_TEXT : (e.message || 'บันทึกไม่สำเร็จ'));
                toTop();
            } finally {
                setSaving(false);
            }
            return;
        }

        // เพิ่มใหม่: 1 KOL = 1 รายการ — บันทึกทีละคนตามลำดับการ์ด · คนที่บันทึกแล้วเอาออกจากฟอร์มทันที
        // พลาดกลางทาง = หยุดตรงนั้น คนที่เหลือ (รวมคนที่พลาด) ยังอยู่ในฟอร์มให้แก้แล้วกดบันทึกต่อ (ไม่บันทึกซ้ำคนที่ผ่านแล้ว)
        const queue = k.kols.map((x, ki) => ({ key: x.key, body: { platforms: platformsOf(ki), ...shared } }));
        const saved = [];
        let created = null;
        let fail = null;
        for (let i = 0; i < queue.length; i++) {
            if (queue.length > 1) setProgress(`${i + 1}/${queue.length}`);
            try {
                const res = await api('/projects/solo', { method: 'POST', body: queue[i].body });
                // ห้ามชื่อ project — ซ้ำกับค่าที่ส่งเข้าฟอร์ม (โหมดแก้ไข) แล้วกลายเป็นตัวแปรที่ยังไม่ถูกตั้งค่า (TDZ)
                created = (res && res.data && res.data.project) || created;
                saved.push(queue[i]);
            } catch (e) {
                fail = { e, who: whoOf(queue[i].body) };
                break;
            }
        }
        setProgress('');
        setSaving(false);
        if (saved.length) {
            saveLastOwner(j.owner);
            setDone(d => [...d, ...saved.map(q => whoOf(q.body))]);
        }
        if (fail) {
            const keys = new Set(saved.map(q => q.key));
            if (keys.size) setK(s => ({ ...s, kols: s.kols.filter(x => !keys.has(x.key)) }));
            const msg = isOldServerError(fail.e) ? OLD_SERVER_TEXT : (fail.e.message || 'บันทึกไม่สำเร็จ');
            setErr(queue.length > 1
                ? `${fail.who}: ${msg}${saved.length ? ` — เพิ่มสำเร็จแล้ว ${saved.length} คน (เอาออกจากฟอร์มแล้ว) ที่เหลือยังไม่ได้บันทึก` : ''}`
                : msg);
            // มีคนที่บันทึกแล้ว — ให้หน้ารายการโหลดใหม่ แต่ฟอร์มยังเปิดอยู่
            if (saved.length) onSaved && onSaved(created, { again: true });
            toTop();
            return;
        }
        if (again) {
            // เก็บ Platform / งาน / แบรนด์ / ค่าตัว / ผู้ดูแล / ข้อมูลยิงแอด / บรีฟ ไว้ ล้างแค่บัญชี (เหลือการ์ด KOL ว่าง 1 ใบ)
            const nextK = KOL_EMPTY(platsOf(k.kols.length - 1).length ? platsOf(k.kols.length - 1) : ['TikTok']);
            setK(nextK);
            setTried(false);
            clean.current = JSON.stringify({ k: nextK, j });
            onSaved && onSaved(created, { again: true });
            toTop();
            focusKol(nextK.kols[0].key);
        } else {
            onSaved && onSaved(created, { again: false });
        }
    }

    const footer = (
        <>
            <button type="button" className="btn-ghost" onClick={requestClose} disabled={saving}>ยกเลิก</button>
            {!editing && <button type="button" className="btn-ghost" onClick={() => save(true)} disabled={saving}>บันทึกแล้วเพิ่มอีกคน</button>}
            <button type="button" className="btn-primary" onClick={() => save(false)} disabled={saving}>
                {saving ? `กำลังบันทึก${progress ? ` ${progress}` : ''}...` : (!editing && nKol > 1 ? `บันทึก ${nKol} KOL` : 'บันทึก')}
            </button>
        </>
    );

    const feeFields = feePlats.map(p => (
        <Field key={p} label={multi ? `ค่าตัวต่อคลิป · ${p}` : 'ค่าตัวต่อคลิป (บาท)'} req err={E['fee_' + p]} htmlFor={id('fee-' + p)}
            hint={feeHint(p)}>
            <input id={id('fee-' + p)} inputMode="decimal" value={j.fee[p] || ''} autoComplete="off"
                onChange={e => { const v = e.target.value.replace(/[^0-9.,]/g, ''); setJ(s => ({ ...s, fee: { ...s.fee, [p]: v } })); }}
                placeholder="เช่น 5000" />
        </Field>
    ));
    const feeSum = feePlats.reduce((n, p) => n + feeTotalOf(p), 0);
    const anyTarget = plats.some(needTarget);

    return (
        <SideDrawer title={editing ? 'แก้ข้อมูล KOL รายคน' : 'เพิ่ม KOL รายคน'}
            subtitle={editing ? 'ค่าตัวของ Platform เดิมแก้ที่ช่อง "ค่าตัวต่อคลิป" ในหน้านี้ · ลดจำนวนคลิปได้เฉพาะคลิปที่ยังไม่เริ่มงาน'
                : 'จ้าง KOL เดี่ยว ไม่ต้องสร้างแคมเปญ · ติดตามงาน / Gencode / ยิงแอด / ทำจ่าย ได้เหมือนแคมเปญ'}
            onClose={requestClose} footer={footer} width={640} busy={saving} className="qf-drawer solo-drawer">
            <div className="qf" ref={wrapRef}>
                {err && <div className="alert-error" role="alert">{err}</div>}
                {done.length > 0 && <div className="solo-added" role="status">เพิ่มแล้ว {done.length} คน: {done.join(', ')}</div>}

                {/* ระหว่างบันทึก (หลาย KOL = ทีละคน) ล็อกทุกช่อง — ค่าที่ส่งคือค่าตอนกดบันทึก แก้ระหว่างนั้นจะไม่ถูกส่ง */}
                <fieldset className="solo-fs" disabled={saving}>
                    <section className="qf-sec">
                        <h3 className="qf-sec-head"><span className="qf-num">1</span>KOL</h3>
                        {k.kols.map((x, ki) => {
                            const kp = platsOf(ki);
                            const kmulti = kp.length > 1;
                            return (
                                <div className="solo-plat solo-kcard" key={x.key} data-kol={x.key} role="group" aria-labelledby={id('kh-' + x.key)}>
                                    <div className="solo-kcard-head">
                                        <span className="solo-plat-head" id={id('kh-' + x.key)}>{editing ? 'บัญชี KOL' : `KOL ${ki + 1}`}</span>
                                        {nKol > 1 && (
                                            <button type="button" className="solo-kcard-del" onClick={() => removeKol(ki)} disabled={saving}
                                                aria-label={`ลบ KOL ${ki + 1}`}>ลบ</button>
                                        )}
                                    </div>
                                    {/* Platform ของ KOL คนนี้ (เดิมเลือกครั้งเดียวด้านบนให้ทุกคน — 5 ต.ค. ย้ายมาไว้ในการ์ด) */}
                                    <Field label="Platform" req err={E['plat_' + ki]} labelId={id('plat-' + x.key)}
                                        hint={editing && lockedPlatforms.length > 0
                                            ? 'Platform ที่มีงานแล้ว (ดราฟ/Gencode/ID Post/ลงงาน/ยิงแอด) เอาออกไม่ได้'
                                            : 'เลือกได้หลาย Platform — กรอกบัญชีแยกของแต่ละ Platform ด้านล่าง'}>
                                        <Chips options={SOLO_PLATFORMS} value={kp} multi onPick={p => togglePlatform(ki, p)} labelId={id('plat-' + x.key)}
                                            disabled={p => isLocked(p) && kp.includes(p)} />
                                    </Field>
                                    {kp.map(p => {
                                        const a = accOf(ki, p);
                                        const at = `${ki}_${p}`;
                                        const fid = s => id(`${s}-${x.key}-${p}`);
                                        return (
                                            <div className="solo-kcard-acc" key={p} role={kmulti ? 'group' : undefined} aria-label={kmulti ? p : undefined}>
                                                <div className="solo-kcard-plat" aria-hidden="true">{p}</div>
                                                <div className="qf-row2">
                                                    <Field label="ชื่อบัญชี" req err={E['acc_' + at]} htmlFor={fid('acc')}>
                                                        <input id={fid('acc')} value={a.account_name} maxLength={200} autoComplete="off"
                                                            autoFocus={ki === 0 && p === kp[0]}
                                                            onChange={e => upAcc(ki, p, { account_name: e.target.value })} placeholder="@ชื่อบัญชี" />
                                                    </Field>
                                                    <Field label="ลิงก์ช่อง" err={E['link_' + at]} htmlFor={fid('link')}>
                                                        <input id={fid('link')} value={a.link_account} maxLength={1000} autoComplete="off"
                                                            onChange={e => upAcc(ki, p, { link_account: e.target.value })} placeholder={LINK_PH[p] || 'https://...'} />
                                                    </Field>
                                                </div>
                                                <div className="qf-row2">
                                                    <Field label="ผู้ติดตาม" htmlFor={fid('fol')} hint="ใส่แล้ว Tier จะเลือกให้อัตโนมัติ">
                                                        <input id={fid('fol')} inputMode="numeric" value={a.followers} autoComplete="off"
                                                            onChange={e => setFollowers(ki, p, e.target.value)} placeholder="เช่น 85000" />
                                                    </Field>
                                                    <Field label="Tier" req err={E['tier_' + at]} htmlFor={fid('tier')}>
                                                        <select id={fid('tier')} value={a.tier} onChange={e => upAcc(ki, p, { tier: e.target.value, tierTouched: true })}>
                                                            <option value="">— เลือก —</option>
                                                            {SOLO_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                                                        </select>
                                                    </Field>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                        {!editing && (
                            <div className="solo-add-kol-wrap">
                                <button type="button" className="solo-add-kol" onClick={addKol} disabled={saving || nKol >= KOL_MAX}>+ Account</button>
                                <div className="qf-hint">
                                    {nKol >= KOL_MAX
                                        ? `ใส่ได้สูงสุด ${KOL_MAX} KOL ต่อการบันทึก 1 ครั้ง`
                                        : 'เพิ่ม KOL คนอื่น (เลือก Platform ในการ์ดของแต่ละคน) ที่ใช้งาน / แบรนด์ / สินค้า / ค่าตัว ชุดเดียวกัน — บันทึกแล้วได้ 1 รายการต่อ 1 KOL'}
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="qf-sec">
                        <h3 className="qf-sec-head"><span className="qf-num">2</span>งาน</h3>
                        <Field label="แบรนด์" req err={E.brand} htmlFor={id('brand')} hint={editing && brandLocked ? 'ล็อกแล้ว — มีคลิปที่ลงงาน/ยิงแอดแล้ว' : ''}>
                            {brands.length ? (
                                <select id={id('brand')} value={j.brand} disabled={editing && brandLocked} onChange={e => pickBrand(e.target.value)}>
                                    <option value="">— เลือก —</option>
                                    {brands.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                            ) : <p className="muted">บัญชีนี้ยังไม่ได้รับสิทธิ์แบรนด์ไหน — ติดต่อผู้ดูแลระบบ</p>}
                        </Field>
                        {j.brand && (
                            <Field label="สินค้า" req err={E.products} labelId={id('prod')} hint="เลือกได้หลายตัว">
                                <div className="qf-chips solo-products" role="group" aria-labelledby={id('prod')}>
                                    {productOptions.map(p => (
                                        <button type="button" key={p.code} role="checkbox" aria-checked={j.products.includes(p.code)} title={p.name}
                                            className={'qf-chip' + (j.products.includes(p.code) ? ' on' : '')} onClick={() => toggleProduct(p.code)}>
                                            {p.code}<span className="solo-prod-name"> {p.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </Field>
                        )}
                        <Field label="จำนวนคลิป" req err={E.clips} labelId={id('clips')}
                            hint={[
                                clipFloor > 1 && `ลดได้ไม่ต่ำกว่า ${clipFloor} คลิป — คลิปที่ ${clipFloor} มีงานแล้ว (ดราฟ/Gencode/ID Post/ลงงาน/ยิงแอด)`,
                                (() => {
                                    // โพสต์ทั้งหมด = จำนวนคลิป × Platform ของแต่ละ KOL รวมกัน
                                    const posts = k.kols.reduce((n, x, i) => n + j.clips * platsOf(i).length, 0);
                                    if (nKol > 1) return `ทุก KOL ทุก Platform ได้จำนวนเท่ากัน — รวม ${posts} โพสต์ (${nKol} KOL)`;
                                    return multi ? `ทุก Platform ได้จำนวนเท่ากัน — รวม ${posts} โพสต์ (${j.clips} คลิป × ${plats.length} Platform)` : 'ถ้าเลือกหลาย Platform ทุก Platform ได้จำนวนคลิปเท่ากัน';
                                })()
                            ].filter(Boolean).join(' · ')}>
                            <Chips options={Array.from({ length: SOLO_MAX_CLIPS }, (_, i) => i + 1)} value={j.clips}
                                onPick={v => upJ('clips', v)} labelId={id('clips')} render={v => `${v} คลิป`}
                                disabled={v => v < clipFloor} />
                            {j.clips > 1 && (
                                <div className="solo-clip-names">
                                    {Array.from({ length: j.clips }, (_, i) => (
                                        <input key={i} value={j.clip_names[i]} maxLength={100} aria-label={`ชื่อคลิป ${i + 1}`}
                                            placeholder={`คลิป ${i + 1}`}
                                            onChange={e => setJ(s => ({ ...s, clip_names: s.clip_names.map((n, x) => (x === i ? e.target.value : n)) }))} />
                                    ))}
                                </div>
                            )}
                        </Field>
                        {editing && feePlats.length > 0 && (
                            <div className="qf-hint solo-fee-note">Platform ที่เพิ่มใหม่ต้องใส่ค่าตัว · Platform เดิมแก้ค่าตัวที่ช่อง "ค่าตัวต่อคลิป" ในหน้า KOL</div>
                        )}
                        {feeFields.length > 1 ? <div className="qf-row2">{feeFields}</div> : feeFields}
                        {feePlats.length > 1 && (
                            <div className="qf-hint solo-fee-note">รวมค่าตัวทุก Platform {feeSum > 0 ? baht(feeSum) : 'ได้ฟรี'}{nKol > 1 && feeSum > 0 ? ' ต่อ KOL' : ''}</div>
                        )}
                        {!editing && nKol > 1 && (
                            <div className="qf-hint solo-fee-note">KOL ที่เลือก Platform เดียวกันได้ค่าตัวเท่ากัน — ค่าตัวรายคนแก้ทีหลังได้ที่ช่อง "ค่าตัวต่อคลิป" ในหน้า KOL</div>
                        )}
                        <Field label="ผู้ดูแล" req err={E.owner} htmlFor={id('owner')}>
                            <select id={id('owner')} value={j.owner} onChange={e => upJ('owner', e.target.value)}>
                                <option value="">— เลือก —</option>
                                {ownerOptions.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </Field>
                        <Field label="ลิงก์บรีฟ" opt="ไม่บังคับ" err={E.brief_link} htmlFor={id('bl')}>
                            <input id={id('bl')} value={j.brief_link} maxLength={1000} autoComplete="off" inputMode="url"
                                onChange={e => upJ('brief_link', e.target.value)} placeholder="https://drive.google.com/..." />
                        </Field>
                        <Field label="รายละเอียดบรีฟ" opt="ไม่บังคับ" htmlFor={id('bd')}
                            hint={j.note.length >= 800 ? `${j.note.length.toLocaleString('th-TH')}/1,000 ตัวอักษร` : ''}>
                            <textarea id={id('bd')} rows={4} value={j.note} maxLength={1000} onChange={e => upJ('note', e.target.value)}
                                placeholder="สิ่งที่ต้องการให้ KOL ทำ / จุดที่ต้องพูดถึง / ข้อห้าม" />
                        </Field>
                    </section>

                    <section className="qf-sec">
                        <h3 className="qf-sec-head"><span className="qf-num">3</span>ข้อมูลยิงแอด
                            <span className="qf-sec-sub">
                                {anyTarget ? 'Content Type / Campaign และ Target บังคับ (ระบบยิงแอดใช้)' : 'Content Type / Campaign บังคับ'} · ที่เหลือไม่บังคับ
                            </span></h3>
                        {plats.map(p => {
                            const d = adOf(p);
                            const social = campaignIsCtype(p);
                            const tOpts = targetOptionsOf(p);
                            // ตัวเลือก + ค่าที่เลือกไว้แล้วแต่ถูกซ่อน (ให้เห็นและกดเอาออกได้)
                            const tChips = [...tOpts, ...adOf(p).target.filter(t => !tOpts.includes(t))];
                            return (
                                <div className="solo-plat" key={p}>
                                    <div className="solo-plat-head">{p}{nKol > 1 && <span className="solo-plat-count"> · ใช้กับ {kolsOn(p)} KOL</span>}</div>
                                    <Field label={social ? 'Campaign' : 'Content Type'} req err={E['ct_' + p]} labelId={id('ct-' + p)}>
                                        <Chips options={ctypeOptionsOf(p)} value={d.content_type} onPick={v => upAd(p, { content_type: v })} labelId={id('ct-' + p)} />
                                    </Field>
                                    {needTarget(p) && (
                                        <Field label="Target" req={tOpts.length > 0} err={E['tg_' + p]} labelId={id('tg-' + p)}
                                            hint={j.products.length ? (tOpts.length ? '' : 'สินค้าที่เลือกไม่มี Target ให้เลือก') : 'เลือกสินค้าก่อน'}>
                                            {tChips.length > 0 && <Chips options={tChips} value={d.target} onPick={t => toggleTarget(p, t)} multi labelId={id('tg-' + p)} />}
                                        </Field>
                                    )}
                                    {needCampaign(p) && !social && (
                                        <Field label="Campaign" opt="ไม่บังคับ" labelId={id('cp-' + p)}>
                                            <Chips options={CAMPAIGN_TYPES} value={d.campaign} onPick={v => upAd(p, { campaign: d.campaign === v ? '' : v })} labelId={id('cp-' + p)} />
                                        </Field>
                                    )}
                                    <div className="qf-row2">
                                        <Field label="Photo / VDO" labelId={id('mt-' + p)}>
                                            <Chips options={SOLO_MEDIA} value={d.media_type} onPick={v => upAd(p, { media_type: d.media_type === v ? '' : v })} labelId={id('mt-' + p)} />
                                        </Field>
                                        <Field label="Format / Style" htmlFor={id('cf-' + p)}>
                                            <select id={id('cf-' + p)} value={d.content_format} onChange={e => upAd(p, { content_format: e.target.value })}>
                                                <option value="">— ไม่ระบุ —</option>
                                                {CONTENT_FORMATS.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </Field>
                                    </div>
                                </div>
                            );
                        })}
                        <div className="qf-row2">
                            <Field label="อายุ Gencode" htmlFor={id('ce')}>
                                <select id={id('ce')} value={j.code_expire} disabled={j.no_gencode} onChange={e => upJ('code_expire', Number(e.target.value))}>
                                    {SOLO_CODE_EXPIRE.map(n => <option key={n} value={n}>{n} วัน</option>)}
                                </select>
                            </Field>
                            <Field label=" " labelId={id('ng')}>
                                <label className="solo-check">
                                    <input type="checkbox" checked={j.no_gencode} onChange={e => upJ('no_gencode', e.target.checked)} /> ไม่ใช้ Gencode
                                </label>
                            </Field>
                        </div>
                        <Field label="Concept" opt="ไม่บังคับ" htmlFor={id('cc')}>
                            <textarea id={id('cc')} rows={2} value={j.concept} maxLength={1000} onChange={e => upJ('concept', e.target.value)} />
                        </Field>
                    </section>
                </fieldset>
            </div>
        </SideDrawer>
    );
}
