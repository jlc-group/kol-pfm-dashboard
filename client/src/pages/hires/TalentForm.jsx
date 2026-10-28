import { useEffect, useId, useRef, useState } from 'react';
import { api, uploadFile } from '../../api/client.js';
import SideDrawer from '../../components/SideDrawer.jsx';
import KindPicker from '../../components/KindPicker.jsx';
import DatePicker from '../../components/DatePicker.jsx';
import ProductMultiSelect from '../../components/ProductMultiSelect.jsx';
import useLazyImage from '../../utils/useLazyImage.js';
import { kindError, kindValue } from '../../data/hireKinds.js';
import { BRANDS } from '../../data/brands.js';
import { PRODUCT_CATALOG, productsByBrand, splitProductList } from '../../data/products.js';
import {
    SOCIAL_PLATFORMS, SOCIAL_OTHER, SOCIALS_MAX, SOCIAL_URL_MAX, avatarSource, canFetchAvatar, emptySocialRow, fillFromHandle, fillFromUrl,
    linkFromSocials, normalizeSocials, notProfilePlatform, onlyNoAvatarLinks, socialHandleMax, socialRowError, socialRowsOf, socialsForSave
} from '../../data/talentSocials.js';
import { clipboardImage, pasteFileName } from '../../data/talentJobs.js';

// ฟอร์มเพิ่ม / แก้คนใน Talent Book เอง — ไม่ต้องมีงาน (ผู้ใช้สั่ง 29 ก.ย. 2026)
// talentId = null → เพิ่มใหม่ (POST /hires/talents) · มีค่า → แก้ (GET แล้ว PUT) และลบได้
// ทุกคนในทีมเห็นการ์ดนี้ (ไม่ผูกแบรนด์) · แก้/ลบได้เฉพาะคนที่เพิ่ม และ admin (server ตัดสิน)
// ไฟล์รูป / คลิปอัปหลังบันทึกข้อมูลแล้ว (ต้องมี id ก่อน) — อัปพลาด: ข้อมูลเก็บแล้ว ฟอร์มค้างอยู่ให้กดบันทึกซ้ำเพื่อลองอัปใหม่
// 1 ต.ค. 2026: ช่องทาง Social หลายช่องทาง (เพิ่ม/ลบแถวได้ · วางลิงก์โปรไฟล์แล้วเลือกช่องทาง + ใส่ชื่อบัญชีให้เอง)
//   ส่งทั้ง socials และ link = ลิงก์ช่องทางแรก (ของเดิมที่อ่าน link ใช้ต่อได้ — server เขียนซ้ำให้อยู่แล้ว) · แถวรุ่นเก่าที่มีแค่ link → โหลดเป็น 1 ช่องทาง
//   รูปการ์ด: ก๊อปรูปแล้วกด Ctrl+V ในฟอร์มได้ (อัปเหมือนเลือกไฟล์) · ปุ่ม "ดึงรูปจากลิงก์" ให้ server ดึงรูปโปรไฟล์ TikTok / YouTube / X
//   (ยังไม่มีรูป server ดึงให้เองหลังบันทึก — ปุ่มนี้ใช้ตอนอยากได้รูปใหม่ทับรูปเดิม · ส่งลิงก์ในฟอร์มไปด้วย ไม่ต้องบันทึกลิงก์ก่อน)
//   มีรูปที่เลือก/วางรออัป หรือสั่งเอารูปเดิมออก → ส่ง auto_image: false (ไม่ให้ server ดึงรูปมาชนกับรูปที่ผู้ใช้เลือกเอง)
//   กำลังดึงรูปจากลิงก์อยู่ = ยังเลือก/วางรูป และกดบันทึกไม่ได้ (รูปที่ดึงเสร็จทีหลังจะทับรูปที่ผู้ใช้เพิ่งเลือก)
//   ช่องทาง "อื่น ๆ" = ข้อความอิสระ ยาวได้ 1000 ตัว · ข้อความ Account เดิมที่มีหลายบรรทัด โชว์เป็นกล่องหลายบรรทัด (ช่องบรรทัดเดียวจะตัดบรรทัดทิ้ง)
// 2 ต.ค. 2026 (ผู้ใช้สั่ง):
//   • เอาช่องหน่วยเรท (ต่องาน / ต่อวัน ...) ออก — ไม่ส่ง rate_unit (ค่าเดิมในฐานไม่ล้าง แต่การ์ด/หน้ารายละเอียดไม่โชว์แล้ว)
//   • ช่องสินค้า (ไม่บังคับ · หลายตัว) — เลือกจากคลังสินค้าของแบรนด์ที่ติ๊กไว้ · แบรนด์ที่ยังไม่มีคลัง = พิมพ์ชื่อเอง คั่นด้วย ,
//     เก็บรวมเป็น products = [รหัสในคลัง..., ชื่อที่พิมพ์เอง...] · เอาแบรนด์ออก = รหัสของแบรนด์นั้นหลุดจากที่เลือกด้วย
//   • ช่วงเวลาที่จ้าง (ตั้งแต่ – ถึง) ไม่บังคับ · มีด้านเดียวได้ · ถึง ต้องไม่ก่อน ตั้งแต่
//   • server รุ่นก่อน (หน้าเว็บขึ้นแล้วแต่ server ยังไม่รีสตาร์ต) ทิ้งสินค้า/ช่วงเวลาเงียบ ๆ — คำตอบไม่มีคีย์ products / hire_from
//     = บอกผู้ใช้ให้ลองใหม่ ไม่ปิดฟอร์มเหมือนบันทึกครบ
// ช่องทางติดต่อ — ติ๊กเลือกก่อน แล้วช่องที่ต้องกรอกเปลี่ยนตามแบบ (ผู้ใช้สั่ง 30 ก.ย. 2026) · ค่าต้องตรงกับ CONTACT_MODES ใน server
//   ติดต่อเอง = ชื่อผู้ติดต่อ + เบอร์/LINE · ผ่าน Agency = ชื่อเอเจนซี่ + ชื่อผู้ติดต่อของเอเจนซี่ (ไม่มีช่องเบอร์/LINE)
export const CONTACT_MODES = [['self', 'ติดต่อเอง'], ['agency', 'ผ่าน Agency']];
const EMPTY = { name: '', brands: [], products: [], products_text: '', hire_from: '', hire_to: '', kind: '', socials: [emptySocialRow()], contact_mode: '', contact_name: '', contact: '', agency: '', rate: '', scope: '', image_link: '', clip_link: '', note: '' };
const MAX = { name: 200, contact_name: 200, contact: 200, agency: 200, scope: 2000, image_link: 1000, clip_link: 1000, note: 1000 };
// สินค้า — เพดานเดียวกับ server (TALENT_PRODUCTS_MAX / TALENT_PRODUCT_LEN ใน routes/hires.js)
const PRODUCTS_MAX = 100;
const PRODUCT_LEN = 100;
const CATALOG_ORDER = PRODUCT_CATALOG.map(p => p.code);
const CATALOG_CODES = new Set(CATALOG_ORDER);
// เรียงรหัสตามคลังเสมอ (เลือกสลับลำดับไม่ทำให้ฟอร์มดูว่าแก้แล้ว) · ค่าที่ไม่อยู่ในคลังต่อท้ายตามเดิม
const sortCodes = list => [...CATALOG_ORDER.filter(c => list.includes(c)), ...list.filter(c => !CATALOG_CODES.has(c))];
const codesOfBrands = brands => brands.flatMap(b => productsByBrand(b).map(p => p.code));
// แถวที่บันทึกก่อนมีตัวเลือกนี้ (contact_mode ว่าง) — เดาจากข้อมูลที่มี: มีสังกัด = ผ่านเอเจนซี่ · มีเบอร์/ชื่อ = ติดต่อเอง
// มีทั้งเบอร์และสังกัด (ฟอร์มรุ่นเก่า) = ไม่เดา ปล่อยให้คนเลือกเอง — เดาแล้วช่องที่ถูกซ่อนจะหายตอนกดบันทึกโดยไม่รู้ตัว
const modeOf = t => (t.contact_mode === 'self' || t.contact_mode === 'agency') ? t.contact_mode
    : (t.agency && t.contact) ? ''
    : t.agency ? 'agency' : (t.contact || t.contact_name) ? 'self' : '';
const FILES = {
    image: { exts: ['.png', '.jpg', '.jpeg', '.webp', '.pdf'], mb: 10, accept: '.png,.jpg,.jpeg,.webp,.pdf', word: 'รูป/คอมการ์ด' },
    clip: { exts: ['.mp4', '.mov', '.m4v', '.webm'], mb: 95, accept: '.mp4,.mov,.m4v,.webm,video/*', word: 'คลิปผลงาน' }
};
const isWeb = v => /^https?:\/\/\S+$/i.test(v);
const extOf = name => { const m = /\.[^.]+$/.exec(String(name || '').toLowerCase()); return m ? m[0] : ''; };
const rateNum = v => Number(String(v).replace(/,/g, '').trim());
const RATE_MAX = 1e9;   // เพดานเดียวกับ server
const S = v => (v == null ? '' : String(v));
const fileErr = (file, field) => {
    if (!file) return '';
    const spec = FILES[field];
    if (!spec.exts.includes(extOf(file.name))) return `รองรับเฉพาะ ${spec.exts.join(' / ').toUpperCase().replace(/\./g, '')}`;
    if (file.size > spec.mb * 1024 * 1024) return `ไฟล์ใหญ่เกิน ${spec.mb}MB`;
    return '';
};

// รูปตัวอย่างในช่องรูป: รูปที่เพิ่งเลือก/วาง (ยังไม่อัป) หรือรูปที่บันทึกไว้แล้ว · PDF / โหลดไม่ได้ = ไม่โชว์รูป (บอกเป็นข้อความ)
function ImageThumb({ file, path, pdf = false }) {
    const [local, setLocal] = useState('');
    useEffect(() => {
        if (!file || !/^image\//.test(file.type || '')) { setLocal(''); return undefined; }
        const u = URL.createObjectURL(file);
        setLocal(u);
        return () => URL.revokeObjectURL(u);
    }, [file]);
    const [box, img] = useLazyImage(file ? '' : path);
    const src = file ? local : img.url;
    return (
        <div className={'tf-thumb' + (src ? '' : ' empty')} ref={box} aria-hidden="true">
            {src ? <img src={src} alt="" draggable="false" />
                : <span>{pdf || (file && /\.pdf$/i.test(file.name || '')) ? 'ไฟล์ PDF' : path && !img.failed ? 'กำลังโหลด...' : 'ยังไม่มีรูป'}</span>}
        </div>
    );
}

function Field({ label, req, hint, err, htmlFor, labelId, children }) {
    return (
        <div className={'qf-field' + (err ? ' has-err' : '')}>
            {htmlFor
                ? <label className="qf-label" htmlFor={htmlFor}>{label}{req && <span className="qf-req" aria-hidden="true"> *</span>}</label>
                : <div className="qf-label" id={labelId}>{label}{req && <span className="qf-req" aria-hidden="true"> *</span>}</div>}
            {children}
            {err && <div className="qf-err" role="alert">{err}</div>}
            {hint && <div className="qf-hint">{hint}</div>}
        </div>
    );
}

export default function TalentForm({ talentId = null, onClose, onSaved }) {
    const uid = useId();
    const id = s => `${uid}-${s}`;
    // เพิ่มสำเร็จแล้วแต่อัปไฟล์ไม่ผ่าน → ฟอร์มกลายเป็นโหมดแก้ไขของแถวนั้น (กดบันทึกซ้ำจะไม่สร้างคนซ้ำ)
    const [rowId, setRowId] = useState(talentId);
    const [f, setF] = useState(EMPTY);
    const [orig, setOrig] = useState(null);
    const [loading, setLoading] = useState(!!talentId);
    const [loadErr, setLoadErr] = useState('');
    const [imageFile, setImageFile] = useState(null);
    const [clipFile, setClipFile] = useState(null);
    const [dropImage, setDropImage] = useState(false);
    const [dropClip, setDropClip] = useState(false);
    const [tried, setTried] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const [pasteErr, setPasteErr] = useState('');     // วางรูปชนิดที่ไม่รับ
    const [fetching, setFetching] = useState(false);  // กำลังดึงรูปจากลิงก์
    const [fetchMsg, setFetchMsg] = useState(null);   // { ok, text } ผลการดึงรูปจากลิงก์
    const clean = useRef(JSON.stringify(EMPTY));
    const wrapRef = useRef(null);
    const imageBox = useRef(null);
    // บันทึกข้อมูลไปแล้วอย่างน้อยครั้งหนึ่ง (แม้ไฟล์ยังอัปไม่ขึ้น) — ปิดฟอร์มแล้วหน้าแม่ต้องโหลดการ์ดใหม่
    const savedAny = useRef(false);
    // ข้อความ error อยู่บนสุดของฟอร์ม — เลื่อนขึ้นไปให้เห็น (กดบันทึกจากท้ายฟอร์ม ข้อความจะพ้นจอ)
    const toTop = () => {
        const s = wrapRef.current && wrapRef.current.closest('.side-drawer-body');
        if (s) s.scrollTo({ top: 0, behavior: 'smooth' });
    };

    useEffect(() => {
        if (!talentId) return undefined;
        let on = true;
        api(`/hires/talents/${encodeURIComponent(talentId)}`)
            .then(res => {
                if (!on) return;
                const t = res.data || {};
                // สินค้าที่บันทึกไว้: รหัสในคลัง → ช่องเลือก · ที่เหลือ (พิมพ์เอง) → ช่องพิมพ์ คั่นด้วย ,
                // รหัสนับเฉพาะของแบรนด์ที่เลือกไว้ — ข้อความที่พิมพ์เองที่บังเอิญตรงรหัสแบรนด์อื่น (เช่น "C1") ยังอยู่ในช่องพิมพ์
                const prods = Array.isArray(t.products) ? t.products.map(S).map(x => x.trim()).filter(Boolean) : [];
                const brands = Array.isArray(t.brands) ? t.brands.map(S).filter(Boolean) : [];
                const own = new Set(codesOfBrands(brands));
                const next = {
                    name: S(t.name), brands,
                    products: sortCodes(prods.filter(x => own.has(x))), products_text: prods.filter(x => !own.has(x)).join(', '),
                    hire_from: S(t.hire_from).slice(0, 10), hire_to: S(t.hire_to).slice(0, 10),
                    // socials ว่าง (แถวรุ่นเก่า) → ใช้ link ช่องเดียวเป็น 1 ช่องทาง · ไม่มีอะไรเลย = แถวว่าง 1 แถวให้กรอก
                    // ข้อความหลายบรรทัด (Account เดิม) → multi = ใช้กล่องหลายบรรทัดตลอดการแก้ (ลบบรรทัดหมดแล้วช่องไม่สลับกลับ ไม่หลุดโฟกัส)
                    kind: S(t.kind), socials: socialRowsOf(normalizeSocials(t.socials, t.link))
                        .map(r => (r.platform === SOCIAL_OTHER && /[\r\n]/.test(r.handle) ? { ...r, multi: true } : r)),
                    contact_mode: modeOf(t), contact_name: S(t.contact_name), contact: S(t.contact), agency: S(t.agency),
                    rate: t.rate == null ? '' : String(t.rate), scope: S(t.scope),
                    image_link: S(t.image_link), clip_link: S(t.clip_link), note: S(t.note)
                };
                if (!next.socials.length) next.socials = [emptySocialRow()];
                setF(next); setOrig(t); clean.current = JSON.stringify(next);
            })
            .catch(e => { if (on) setLoadErr(e.message || 'โหลดข้อมูลไม่สำเร็จ'); })
            .finally(() => { if (on) setLoading(false); });
        return () => { on = false; };
    }, [talentId]);

    const up = (k, v) => setF(s => ({ ...s, [k]: v }));
    // แบรนด์เลือกได้หลายอัน — เรียงตามรายชื่อแบรนด์เสมอ (กดสลับลำดับไม่ทำให้ฟอร์มดูว่าแก้แล้ว)
    // เอาแบรนด์ออก = รหัสสินค้าของแบรนด์นั้นหลุดจากที่เลือกด้วย (รหัสอื่น / ชื่อที่พิมพ์เองไม่แตะ)
    const toggleBrand = b => setF(s => {
        const off = s.brands.includes(b);
        const on = off ? s.brands.filter(x => x !== b) : [...s.brands, b];
        const drop = new Set(off ? codesOfBrands([b]) : []);
        return { ...s, brands: [...BRANDS.filter(x => on.includes(x)), ...on.filter(x => !BRANDS.includes(x))],
            products: s.products.filter(c => !drop.has(c)) };
    });
    // ===== สินค้า: ตัวเลือก = คลังของแบรนด์ที่ติ๊ก · แบรนด์ที่ยังไม่มีคลัง → ช่องพิมพ์เอง =====
    const productOptions = codesOfBrands(f.brands);
    const noCatalog = f.brands.filter(b => !productsByBrand(b).length);
    // ช่องพิมพ์เอง: ขึ้นแล้วอยู่ต่อจนปิดฟอร์ม (ลบข้อความจนว่างระหว่างพิมพ์ ช่องหายแล้วโฟกัสหลุด)
    const [textOn, setTextOn] = useState(false);
    const showText = textOn || noCatalog.length > 0 || f.products_text.trim() !== '';
    useEffect(() => { if (showText && !textOn) setTextOn(true); }, [showText, textOn]);
    const typedProducts = splitProductList(f.products_text);
    const allProducts = [...new Set([...f.products, ...typedProducts])];
    const editing = rowId != null;

    // ===== ช่องทาง Social (หลายแถว) =====
    const setRow = (i, row) => setF(s => ({ ...s, socials: s.socials.map((r, k) => (k === i ? row : r)) }));
    const addRow = () => setF(s => (s.socials.length >= SOCIALS_MAX ? s : { ...s, socials: [...s.socials, emptySocialRow()] }));
    // เอาแถวสุดท้ายออก = เหลือแถวว่าง 1 แถว (ช่องไม่หายไปทั้งช่อง)
    const removeRow = i => setF(s => {
        const rest = s.socials.filter((_, k) => k !== i);
        return { ...s, socials: rest.length ? rest : [emptySocialRow()] };
    });
    // วางลิงก์ในช่องชื่อบัญชี → ย้ายไปช่องลิงก์ แล้วอ่านช่องทาง/ชื่อบัญชีให้ (พิมพ์ทีละตัวไม่ย้าย — กำลังพิมพ์อยู่)
    const pasteHandle = (i, e) => {
        const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
        const row = f.socials[i];
        const next = fillFromHandle(row, text);
        if (text && next.url !== row.url) { e.preventDefault(); setRow(i, next); }
    };

    // ===== วางรูป (Ctrl+V) — อัปแบบเดียวกับเลือกไฟล์ (นามสกุล/ขนาดตรวจชุดเดียวกัน) =====
    const takePasted = blob => {
        // กำลังดึงรูปจากลิงก์ — ดึงเสร็จแล้วรูปที่วางจะถูกทิ้ง/ถูกทับ ให้รอก่อน
        if (fetching) { setPasteErr('รอดึงรูปจากลิงก์เสร็จก่อน แล้วค่อยวางรูป'); return; }
        const name = pasteFileName(blob.type);
        if (!name) { setPasteErr('รูปที่วางเป็นชนิดที่ไม่รองรับ — ใช้ PNG / JPG / WEBP'); return; }
        setPasteErr('');
        setFetchMsg(null);
        setImageFile(new File([blob], name, { type: blob.type }));
        setDropImage(false);
        if (imageBox.current) imageBox.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    const takeRef = useRef(takePasted);
    takeRef.current = takePasted;
    // ฟังทั้งหน้าต่างตอนฟอร์มเปิด: วางในกล่องรูป = ใช้เป็นรูปเสมอ · วางที่อื่นที่ไม่ใช่ช่องพิมพ์ (หรือคลิปบอร์ดมีแต่รูป) = ใช้เป็นรูป
    // วางข้อความลงช่องพิมพ์อื่น (ชื่อ / หมายเหตุ ...) ปล่อยให้วางตามปกติ
    useEffect(() => {
        const onPaste = e => {
            if (e.defaultPrevented || loading) return;
            const img = clipboardImage(e.clipboardData);
            if (!img) return;
            const t = e.target;
            const inBox = !!(imageBox.current && t instanceof Node && imageBox.current.contains(t));
            const typing = !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')));
            const hasText = Array.from((e.clipboardData && e.clipboardData.types) || []).includes('text/plain');
            if (!inBox && typing && hasText) return;
            e.preventDefault();
            takeRef.current(img);
        };
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, [loading]);

    function fieldErrors() {
        const e = {};
        if (!f.name.trim()) e.name = 'ใส่ชื่อก่อนนะ';
        if (!f.brands.length) e.brands = 'เลือกแบรนด์อย่างน้อย 1 แบรนด์';
        const ke = kindError(f.kind);
        if (ke) e.kind = ke;
        const se = f.socials.map(socialRowError);
        if (se.some(Boolean)) { e.socials = 'แก้ช่องทาง Social ที่ขึ้นสีแดงก่อน'; e.socialRows = se; }
        if (f.image_link.trim() && !isWeb(f.image_link.trim())) e.image = 'ลิงก์รูปต้องขึ้นต้นด้วย http:// หรือ https://';
        if (f.clip_link.trim() && !isWeb(f.clip_link.trim())) e.clip = 'ลิงก์คลิปต้องขึ้นต้นด้วย http:// หรือ https://';
        if (typedProducts.some(x => x.length > PRODUCT_LEN)) e.products = `ชื่อสินค้าแต่ละตัวยาวไม่เกิน ${PRODUCT_LEN} ตัวอักษร`;
        else if (allProducts.length > PRODUCTS_MAX) e.products = `สินค้าเยอะเกินไป (ไม่เกิน ${PRODUCTS_MAX} รายการ)`;
        if (f.hire_from && f.hire_to && f.hire_to < f.hire_from) e.hire = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม';
        if (f.rate.trim()) {
            const n = rateNum(f.rate);
            // ต้องมีตัวเลขจริง (พิมพ์แค่ "," จะกลายเป็น 0 เงียบ ๆ)
            if (!/\d/.test(f.rate) || !Number.isFinite(n) || n < 0) e.rate = 'ใส่เป็นตัวเลข เช่น 5000';
            else if (n > RATE_MAX) e.rate = 'สูงเกินไป (ไม่เกิน 1,000,000,000 บาท)';
        }
        const ie = fileErr(imageFile, 'image');
        if (ie) e.image = ie;
        const ce = fileErr(clipFile, 'clip');
        if (ce) e.clip = ce;
        return e;
    }
    const errs = fieldErrors();
    // ยังไม่เลือกช่องทางติดต่อ: คนใหม่ = บอกให้เลือก · แถวเก่าที่มีข้อมูลอยู่แล้ว = โชว์ของเดิมให้เห็น (ช่องยังซ่อนอยู่จนกว่าจะเลือก)
    const legacy = [f.agency.trim() && `สังกัด ${f.agency.trim()}`, f.contact.trim() && `เบอร์/LINE ${f.contact.trim()}`,
        f.contact_name.trim() && `ผู้ติดต่อ ${f.contact_name.trim()}`].filter(Boolean);
    const modeHint = f.contact_mode ? ''
        : legacy.length ? `ข้อมูลเดิม: ${legacy.join(' · ')} — เลือกแบบด้านบนเพื่อแก้ (ไม่เลือกก็เก็บไว้ตามเดิม)`
        : 'เลือกก่อนว่าติดต่อคนนี้เอง หรือติดต่อผ่านเอเจนซี่ แล้วจะมีช่องให้กรอก';
    const E = tried ? errs : {};
    const dirty = JSON.stringify(f) !== clean.current || !!imageFile || !!clipFile || dropImage || dropClip;
    // ดึงรูปจากลิงก์: หน้าโปรไฟล์ TikTok / YouTube / X ช่องแรกในฟอร์ม (ส่งไปกับคำขอ — แก้ลิงก์แล้วไม่ต้องบันทึกก่อน)
    // เลือกแบบเดียวกับที่ server ดึงเองหลังบันทึก (avatarSource) — ลิงก์คลิป / Shorts / ลิงก์ย่อ / เว็บอื่นข้ามไป (ใช้ชื่อช่องประกอบแทนถ้ามี)
    const formSocials = socialsForSave(f.socials);
    const fetchFrom = avatarSource(formSocials);
    const fetchable = canFetchAvatar(formSocials);
    const hasImage = !!(orig && orig.image && !dropImage) || !!imageFile;
    const autoImg = !!(orig && orig.image && orig.image.source === 'auto' && !dropImage && !imageFile);

    function requestClose() {
        if (saving) return;
        // ข้อมูลบันทึกแล้วแต่ไฟล์ยังค้าง = บอกตรง ๆ ว่าอะไรยังไม่ขึ้น (ไม่ใช่ "ยังไม่ได้บันทึก")
        const fileOnly = savedAny.current && JSON.stringify(f) === clean.current;
        if (dirty && !window.confirm(fileOnly ? 'ข้อมูลบันทึกแล้ว แต่ไฟล์ยังไม่ขึ้น — ปิดฟอร์มเลยไหม?' : 'ยังไม่ได้บันทึก — ปิดฟอร์มนี้เลยไหม?')) return;
        onClose(savedAny.current);
    }

    async function save() {
        if (fetching) return;   // รอดึงรูปจากลิงก์เสร็จก่อน (ปุ่มบันทึกปิดอยู่แล้ว — กันกด Enter / เรียกซ้ำ)
        setTried(true);
        if (Object.keys(errs).length) {
            setErr('');
            // เลื่อนไปช่องแรกที่ยังไม่ครบ
            setTimeout(() => {
                const el = wrapRef.current && wrapRef.current.querySelector('.qf-field.has-err');
                if (el) {
                    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    const input = el.querySelector('.kind-other') || el.querySelector('.tf-prod-text')
                        || el.querySelector('input:not([type=file]), textarea, select, button');
                    if (input) input.focus({ preventScroll: true });
                }
            }, 0);
            return;
        }
        setSaving(true); setErr('');
        const hasRate = f.rate.trim() !== '';
        // ส่งเฉพาะช่องของแบบที่เลือก — สลับแบบไปมาแล้ว ของที่พิมพ์ในแบบเดิมยังอยู่ในฟอร์ม แต่ไม่ถูกบันทึก
        // ยังไม่เลือก = ส่งค่าเดิมกลับไปตามที่โหลดมา (คนใหม่ = ว่างอยู่แล้ว · แถวเก่าที่มีทั้งเบอร์และสังกัด = ไม่หาย)
        const mode = f.contact_mode;
        const body = {
            // link = ลิงก์ช่องทางแรก (ที่ยังอ่าน link ช่องเดียวแบบเดิมใช้ต่อได้)
            name: f.name.trim(), brands: f.brands, products: allProducts, hire_from: f.hire_from || null, hire_to: f.hire_to || null, kind: kindValue(f.kind), socials: formSocials, link: linkFromSocials(formSocials) || '',
            contact_mode: mode, contact_name: f.contact_name.trim(),
            contact: mode === 'agency' ? '' : f.contact.trim(), agency: mode === 'self' ? '' : f.agency.trim(),
            rate: hasRate ? rateNum(f.rate) : null, scope: f.scope.trim(),
            image_link: f.image_link.trim(), clip_link: f.clip_link.trim(), note: f.note.trim()
        };
        if (imageFile || dropImage) body.auto_image = false;
        try {
            const res = editing
                ? await api(`/hires/talents/${encodeURIComponent(rowId)}`, { method: 'PUT', body })
                : await api('/hires/talents', { method: 'POST', body });
            const saved = res.data || {};
            const tid = saved.id;
            // server รุ่นก่อน (ยังไม่รีสตาร์ตหลัง deploy) ไม่รู้จักช่องสินค้า / ช่วงเวลา — ทิ้งเงียบ ๆ แล้วตอบสำเร็จ · บอกผู้ใช้ตรง ๆ
            const oldServer = !('products' in saved) || !('hire_from' in saved);
            setRowId(tid);
            setOrig(o => ({ ...(o || {}), ...saved }));
            savedAny.current = true;
            clean.current = JSON.stringify(f);
            const fails = [];
            const fileStep = async (field, file, drop, clearFile, clearDrop) => {
                const url = `/hires/talents/${encodeURIComponent(tid)}/${field}`;
                try {
                    // อัปไฟล์ใหม่ = แทนที่ไฟล์เดิมอยู่แล้ว → ล้างทั้งไฟล์ที่เลือกและคำสั่ง "เอาไฟล์เดิมออก"
                    // (ไม่ล้าง drop: กดบันทึกซ้ำตอนอีกไฟล์พลาด จะไปลบไฟล์ใหม่ที่เพิ่งอัปทิ้ง)
                    if (file) { await uploadFile(url, file); clearFile(null); clearDrop(false); }
                    else if (drop) { await api(url, { method: 'DELETE' }); clearDrop(false); }
                } catch (e) { fails.push(`${FILES[field].word}: ${e.message || 'ไม่สำเร็จ'}`); }
            };
            await fileStep('image', imageFile, dropImage, setImageFile, setDropImage);
            await fileStep('clip', clipFile, dropClip, setClipFile, setDropClip);
            if (fails.length) {
                setErr(`บันทึกข้อมูลแล้ว แต่ไฟล์ยังไม่ขึ้น — ${fails.join(' · ')} · กดบันทึกอีกครั้งเพื่อลองใหม่`);
                toTop();
                return;
            }
            if (oldServer && (allProducts.length || f.hire_from || f.hire_to)) {
                clean.current = '';   // ฟอร์มยังนับว่ามีของที่ยังไม่บันทึก — ปิดแล้วถามก่อน
                setErr('บันทึกข้อมูลอื่นแล้ว แต่สินค้า / ช่วงเวลาที่จ้างยังไม่ถูกบันทึก — ระบบกำลังอัปเดต รอสักครู่แล้วกดบันทึกอีกครั้ง');
                toTop();
                return;
            }
            // image_fetch = ผลดึงรูปโปรไฟล์อัตโนมัติ (done / pending / failed / none) — หน้าแม่บอกผู้ใช้ / โหลดการ์ดใหม่เมื่อรูปขึ้น
            onSaved && onSaved(saved, { created: !talentId, image_fetch: (res && res.image_fetch) || null });
        } catch (e) {
            setErr(e.message || 'บันทึกไม่สำเร็จ');
            toTop();
        } finally {
            setSaving(false);
        }
    }

    // POST /hires/talents/:id/fetch-image — server ดึงรูปโปรไฟล์จากลิงก์ TikTok / YouTube / X มาเก็บเป็นรูปของการ์ด (ทับรูปเดิม)
    // ตอบ data = ข้อมูลเต็มของคน (รูปใหม่อยู่ใน image) · ดึงไม่ได้ = error พร้อมข้อความบอกทางแก้ (วาง Ctrl+V / อัปเอง) จาก server
    async function fetchImage() {
        if (!editing || fetching || saving || !fetchFrom) return;
        if (hasImage && !window.confirm('แทนรูปเดิมด้วยรูปโปรไฟล์จากลิงก์?')) return;
        setFetching(true); setFetchMsg(null); setPasteErr('');
        // server อาจเปลี่ยนรูปของแถวนี้แล้ว (แม้ปิดฟอร์มก่อนดึงเสร็จ) — ปิดฟอร์มแล้วหน้าแม่ต้องโหลดการ์ดใหม่
        savedAny.current = true;
        // รูปที่ผู้ใช้เลือก/สั่งเอาออกตอนเริ่มดึง — ดึงเสร็จแล้วล้างเฉพาะของชุดนี้ (ของที่เลือกใหม่ระหว่างดึงต้องไม่หาย)
        const startFile = imageFile;
        const startDrop = dropImage;
        try {
            const res = await api(`/hires/talents/${encodeURIComponent(rowId)}/fetch-image`, { method: 'POST', body: { url: fetchFrom } });
            const row = (res && res.data) || null;
            if (row && row.id != null) setOrig(o => ({ ...(o || {}), ...row }));
            setImageFile(cur => (cur === startFile ? null : cur));
            setDropImage(cur => (cur === startDrop ? false : cur));
            setFetchMsg({ ok: true, text: 'ดึงรูปจากลิงก์แล้ว — การ์ดใช้รูปนี้' });
        } catch (e) {
            setFetchMsg({ ok: false, text: e.message || 'ดึงรูปจากลิงก์ไม่สำเร็จ — ก๊อปรูปแล้วกด Ctrl+V ที่ช่องรูป หรืออัปโหลดเอง' });
        } finally {
            setFetching(false);
        }
    }

    async function remove() {
        if (!editing) return;
        const who = f.name.trim() || 'คนนี้';
        if (!window.confirm(`ลบ "${who}" ออกจาก Talent Book?\nการ์ดที่มาจากงาน (ถ้ามี) ยังอยู่ตามงานเดิม`)) return;
        setSaving(true); setErr('');
        try {
            await api(`/hires/talents/${encodeURIComponent(rowId)}`, { method: 'DELETE' });
            onSaved && onSaved(null);
        } catch (e) {
            setErr(e.message || 'ลบไม่สำเร็จ');
            toTop();
        } finally {
            setSaving(false);
        }
    }

    // ช่องไฟล์: ไฟล์เดิม (เอาออกได้) / ไฟล์ใหม่ที่เลือก / ปุ่มเลือกไฟล์ + ช่องวางลิงก์แทนได้
    const fileField = (field, current, file, setFile, drop, setDrop, linkKey) => {
        const spec = FILES[field];
        const hasOld = !!(current && !drop && !file);
        // ช่องรูประหว่างดึงรูปจากลิงก์: เลือก/เอารูปออกไม่ได้จนกว่าจะดึงเสร็จ
        const lock = field === 'image' && fetching;
        return (
            <>
                <div className="tf-file">
                    {file ? (
                        <span className="tf-file-name">📎 {file.name}
                            <button type="button" className="tf-file-x" onClick={() => setFile(null)} title="ไม่ใช้ไฟล์นี้" disabled={lock}>×</button>
                        </span>
                    ) : hasOld ? (
                        <span className="tf-file-name">📎 {current.original || 'ไฟล์เดิม'}
                            <button type="button" className="tf-file-x" onClick={() => setDrop(true)} title={`เอา${spec.word}ออก`} disabled={lock}>×</button>
                        </span>
                    ) : drop ? (
                        <span className="tf-file-name muted">จะเอาไฟล์เดิมออกตอนบันทึก
                            <button type="button" className="tf-file-x" onClick={() => setDrop(false)} title="เก็บไฟล์เดิมไว้" disabled={lock}>↺</button>
                        </span>
                    ) : null}
                    <label className={'btn-ghost tf-pick' + (lock ? ' is-disabled' : '')} aria-disabled={lock || undefined}
                        title={lock ? 'รอดึงรูปจากลิงก์เสร็จก่อน' : undefined}>
                        {file || hasOld ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'}
                        <input type="file" accept={spec.accept} hidden disabled={lock}
                            onChange={e => {
                                const x = e.target.files && e.target.files[0];
                                e.target.value = '';
                                if (!x) return;
                                if (field === 'image' && fetching) { setPasteErr('รอดึงรูปจากลิงก์เสร็จก่อน แล้วค่อยเลือกรูป'); return; }
                                setFile(x);
                            }} />
                    </label>
                    <span className="tf-file-hint">{spec.exts.join(' ').toUpperCase().replace(/\./g, '')} · ไม่เกิน {spec.mb}MB</span>
                </div>
                <input className="tf-link" type="url" value={f[linkKey]} maxLength={MAX[linkKey]} aria-label={`ลิงก์${spec.word}`}
                    onChange={e => up(linkKey, e.target.value)} placeholder="หรือวางลิงก์ (Google Drive / IG / TikTok ...)" />
            </>
        );
    };

    const footer = (
        <>
            {editing && orig && orig.editable !== false && (
                <button type="button" className="btn-ghost tf-delete" onClick={remove} disabled={saving}>ลบออกจาก Talent Book</button>
            )}
            <button type="button" className="btn-ghost" onClick={requestClose} disabled={saving}>ยกเลิก</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving || fetching || loading || !!loadErr}
                title={fetching ? 'รอดึงรูปจากลิงก์เสร็จก่อน' : undefined}>
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
        </>
    );

    return (
        <SideDrawer title={editing ? 'แก้ข้อมูลใน Talent Book' : 'เพิ่มคนเข้า Talent Book'}
            subtitle="ทุกคนในทีมเห็นการ์ดนี้ · ถ้าคนนี้ถูกจ้างในงาน (ชื่อ + ประเภทงานตรงกัน) จะรวมเป็นการ์ดเดียวกัน"
            onClose={requestClose} footer={footer} width={600} busy={saving} className="qf-drawer tf-drawer">
            <div className="qf" ref={wrapRef}>
                {loading ? <p className="muted">กำลังโหลด...</p> : loadErr ? <div className="alert-error">{loadErr}</div> : (
                    <>
                        {err && <div className="alert-error" role="alert">{err}</div>}
                        <Field label="ชื่อ" req err={E.name} htmlFor={id('name')}>
                            <input id={id('name')} value={f.name} maxLength={MAX.name} autoComplete="off"
                                onChange={e => up('name', e.target.value)} placeholder="ชื่อ-นามสกุล หรือชื่อเล่น" autoFocus={!talentId} />
                        </Field>
                        <Field label="แบรนด์" req err={E.brands} labelId={id('brands')} hint="เลือกได้หลายแบรนด์">
                            <div className="qf-chips" role="group" aria-labelledby={id('brands')}>
                                {/* แบรนด์ที่บันทึกไว้แต่ไม่อยู่ในรายชื่อแล้ว ยังโชว์ให้เอาออกได้ */}
                                {[...BRANDS, ...f.brands.filter(b => !BRANDS.includes(b))].map(b => (
                                    <button type="button" key={b} role="checkbox" aria-checked={f.brands.includes(b)}
                                        className={'qf-chip' + (f.brands.includes(b) ? ' on' : '')} onClick={() => toggleBrand(b)}>{b}</button>
                                ))}
                            </div>
                        </Field>
                        <Field label="สินค้า" err={E.products} labelId={id('prod')}
                            hint={!f.brands.length && !allProducts.length ? 'เลือกแบรนด์ก่อน แล้วเลือกสินค้าของแบรนด์นั้น'
                                : ['เลือกได้หลายตัว · ไม่บังคับ', noCatalog.length > 0 && `${noCatalog.join(' / ')} ยังไม่มีรายการสินค้าในระบบ — พิมพ์ชื่อสินค้าเอง คั่นด้วย ,`].filter(Boolean).join(' · ')}>
                            {(f.brands.length > 0 || allProducts.length > 0) && (
                                <div className="tf-prods" role="group" aria-labelledby={id('prod')}>
                                    {(productOptions.length > 0 || f.products.length > 0) && (
                                        <ProductMultiSelect value={f.products.join(',')} options={productOptions} placeholder="— เลือกสินค้า —"
                                            itemName="สินค้า" ariaLabel="เลือกสินค้า" onChange={v => up('products', sortCodes(splitProductList(v)))} />
                                    )}
                                    {showText && (
                                        <input className="tf-prod-text" value={f.products_text} maxLength={2000} autoComplete="off"
                                            aria-label="สินค้าที่พิมพ์เอง" aria-invalid={E.products ? 'true' : undefined} onChange={e => up('products_text', e.target.value)}
                                            placeholder={noCatalog.length ? `ชื่อสินค้าของ ${noCatalog.join(' / ')} เช่น เซรั่มวิตซี, ครีมกันแดด` : 'ชื่อสินค้า คั่นด้วย ,'} />
                                    )}
                                </div>
                            )}
                        </Field>
                        <Field label="ประเภทงาน" req err={E.kind} labelId={id('kind')}>
                            <KindPicker value={f.kind} onChange={v => up('kind', v)} labelId={id('kind')} invalid={!!E.kind} />
                        </Field>
                        <Field label="ช่องทาง Social" err={E.socials} labelId={id('soc')}
                            hint="วางลิงก์โปรไฟล์ได้เลย ระบบเลือกช่องทางและใส่ชื่อบัญชีให้เอง เช่น https://www.tiktok.com/@ชื่อบัญชี">
                            <div className="tfs" role="group" aria-labelledby={id('soc')}>
                                {f.socials.map((r, i) => {
                                    const re = E.socialRows && E.socialRows[i];
                                    const n = i + 1;
                                    return (
                                        <div key={i} className={'tfs-row' + (re ? ' has-err' : '')}>
                                            <select value={r.platform} aria-label={`ช่องทางที่ ${n}`} onChange={e => setRow(i, { ...r, platform: e.target.value })}>
                                                <option value="">— ช่องทาง —</option>
                                                {SOCIAL_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                                            </select>
                                            {/* ช่อง "อื่น ๆ" ยาวได้ 1000 ตัว (ข้อความ Account เดิม) · หลายบรรทัด = กล่องหลายบรรทัด ไม่ตัดบรรทัดทิ้ง */}
                                            {r.multi && r.platform === SOCIAL_OTHER ? (
                                                <textarea value={r.handle} maxLength={socialHandleMax(r.platform)} rows={3} aria-label={`ชื่อบัญชี ช่องทางที่ ${n}`}
                                                    onChange={e => setRow(i, { ...r, handle: e.target.value })} />
                                            ) : (
                                                <input value={r.handle} maxLength={socialHandleMax(r.platform)} autoComplete="off" aria-label={`ชื่อบัญชี ช่องทางที่ ${n}`}
                                                    placeholder={r.platform === SOCIAL_OTHER ? 'ข้อความ / ชื่อบัญชี' : '@ชื่อบัญชี'}
                                                    onChange={e => setRow(i, { ...r, handle: e.target.value })} onPaste={e => pasteHandle(i, e)} />
                                            )}
                                            <input value={r.url} maxLength={SOCIAL_URL_MAX} autoComplete="off" inputMode="url" aria-label={`ลิงก์ ช่องทางที่ ${n}`}
                                                placeholder="ลิงก์โปรไฟล์ https://..." onChange={e => setRow(i, fillFromUrl(r, e.target.value))} />
                                            <button type="button" className="tfs-x" onClick={() => removeRow(i)} title="เอาช่องทางนี้ออก"
                                                aria-label={`เอาช่องทางที่ ${n} ออก`}>×</button>
                                            {re && <div className="qf-err tfs-err" role="alert">{re}</div>}
                                        </div>
                                    );
                                })}
                                {f.socials.length < SOCIALS_MAX && (
                                    <button type="button" className="btn-ghost tfs-add" onClick={addRow}>+ เพิ่มช่องทาง</button>
                                )}
                            </div>
                        </Field>
                        <Field label="ช่องทางติดต่อ" labelId={id('mode')} hint={modeHint}>
                            <div className="qf-chips" role="radiogroup" aria-labelledby={id('mode')}>
                                {CONTACT_MODES.map(([v, label]) => (
                                    <button type="button" key={v} role="radio" aria-checked={f.contact_mode === v}
                                        className={'qf-chip' + (f.contact_mode === v ? ' on' : '')} onClick={() => up('contact_mode', v)}>{label}</button>
                                ))}
                            </div>
                        </Field>
                        {f.contact_mode === 'self' && (
                            <div className="qf-row2">
                                <Field label="ชื่อผู้ติดต่อ" htmlFor={id('cname')}>
                                    <input id={id('cname')} value={f.contact_name} maxLength={MAX.contact_name} autoComplete="off"
                                        onChange={e => up('contact_name', e.target.value)} placeholder="เช่น ตัวเอง / ผู้จัดการส่วนตัว" />
                                </Field>
                                <Field label="เบอร์ / LINE" htmlFor={id('contact')}>
                                    <input id={id('contact')} value={f.contact} maxLength={MAX.contact} autoComplete="off"
                                        onChange={e => up('contact', e.target.value)} placeholder="เบอร์โทร หรือ LINE ID" />
                                </Field>
                            </div>
                        )}
                        {f.contact_mode === 'agency' && (
                            <div className="qf-row2">
                                <Field label="ชื่อเอเจนซี่" htmlFor={id('agency')}>
                                    <input id={id('agency')} value={f.agency} maxLength={MAX.agency} autoComplete="off"
                                        onChange={e => up('agency', e.target.value)} placeholder="ชื่อเอเจนซี่ / สังกัด" />
                                </Field>
                                <Field label="ชื่อผู้ติดต่อ (ของเอเจนซี่)" htmlFor={id('cname')}>
                                    <input id={id('cname')} value={f.contact_name} maxLength={MAX.contact_name} autoComplete="off"
                                        onChange={e => up('contact_name', e.target.value)} placeholder="คนที่เราคุยด้วยที่เอเจนซี่" />
                                </Field>
                            </div>
                        )}
                        <Field label="เรทราคา (บาท)" err={E.rate} htmlFor={id('rate')} hint="ยังไม่รู้ก็เว้นไว้ได้">
                            <input id={id('rate')} inputMode="decimal" value={f.rate} autoComplete="off"
                                onChange={e => up('rate', e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="เช่น 5000" />
                        </Field>
                        <Field label="ช่วงเวลาที่จ้าง" err={E.hire} labelId={id('hire')} hint="ไม่บังคับ · ใส่ด้านเดียวได้ · กด ✕ ในช่องเพื่อล้างวันที่">
                            <div className="tf-hire" role="group" aria-labelledby={id('hire')}>
                                <div className="tf-hire-side">
                                    <span className="tf-hire-k">ตั้งแต่</span>
                                    <DatePicker value={f.hire_from} onChange={v => up('hire_from', v)} placeholder="วันเริ่ม" />
                                </div>
                                <span className="tf-hire-dash" aria-hidden="true">–</span>
                                <div className="tf-hire-side">
                                    <span className="tf-hire-k">ถึง</span>
                                    <DatePicker value={f.hire_to} onChange={v => up('hire_to', v)} placeholder="วันสิ้นสุด" />
                                </div>
                            </div>
                        </Field>
                        <Field label="Scope of work" htmlFor={id('scope')} hint="งานที่รวมอยู่ในเรทนี้ — ยังไม่รู้ก็เว้นไว้ได้">
                            <textarea id={id('scope')} rows={3} value={f.scope} maxLength={MAX.scope}
                                onChange={e => up('scope', e.target.value)} placeholder="เช่น ถ่ายภาพนิ่ง 1 วัน + คลิปสั้น 2 ชิ้น · ใช้สิทธิ์ภาพ 3 เดือน" />
                        </Field>
                        <Field label="รูป / คอมการ์ด" err={E.image || pasteErr} labelId={id('image')}>
                            <div className="tf-paste" ref={imageBox} tabIndex={0} role="group" aria-labelledby={id('image')}
                                title="ก๊อปรูปแล้วกด Ctrl+V ที่นี่ได้">
                                <ImageThumb file={imageFile} path={!imageFile && !dropImage && editing && orig && orig.image
                                    ? `/hires/talents/${encodeURIComponent(rowId)}/image?v=${Date.parse(orig.updated_at) || 0}` : ''}
                                    pdf={!imageFile && !!(orig && orig.image && /\.pdf$/i.test(orig.image.original || ''))} />
                                <div className="tf-paste-main">
                                    {fileField('image', orig && orig.image, imageFile, setImageFile, dropImage, setDropImage, 'image_link')}
                                    <div className="tf-paste-hint">📋 ก๊อปรูปแล้วกด Ctrl+V ที่นี่ได้</div>
                                </div>
                            </div>
                            {editing && fetchable && (
                                <div className="tf-fetch">
                                    <button type="button" className="btn-ghost tf-fetch-btn" onClick={fetchImage}
                                        disabled={fetching || saving || !!imageFile}>
                                        {fetching ? 'กำลังดึงรูป...' : 'ดึงรูปจากลิงก์'}
                                    </button>
                                    <span className="tf-file-hint">
                                        {imageFile ? 'มีรูปที่เลือกไว้แล้ว — จะใช้รูปนั้นตอนบันทึก'
                                            : autoImg ? 'รูปตอนนี้ดึงมาจากลิงก์อัตโนมัติ · กดเพื่อดึงใหม่'
                                            : 'ใช้รูปโปรไฟล์จาก TikTok / YouTube / X ที่ใส่ลิงก์ไว้'}
                                    </span>
                                </div>
                            )}
                            {!editing && fetchable && !hasImage && (
                                <div className="qf-hint">{f.image_link.trim()
                                    // มีลิงก์รูปแต่ไม่มีไฟล์ = การ์ดโชว์รูปที่ดึงมา · ลิงก์รูปยังเปิดได้จากหน้ารายละเอียด (ไม่หาย)
                                    ? 'บันทึกแล้วระบบดึงรูปโปรไฟล์จากลิงก์ TikTok / YouTube / X มาขึ้นการ์ดให้ — ลิงก์รูปที่วางไว้ยังเปิดดูได้ในหน้ารายละเอียด'
                                    : 'ไม่ใส่รูปก็ได้ — บันทึกแล้วระบบดึงรูปโปรไฟล์จากลิงก์ TikTok / YouTube / X ให้เอง'}</div>
                            )}
                            {!fetchable && onlyNoAvatarLinks(formSocials) && (
                                <div className="qf-hint">รูปจาก Instagram / Facebook ดึงเองไม่ได้ — ก๊อปรูปโปรไฟล์มาวาง (Ctrl+V) หรือเลือกไฟล์แทน</div>
                            )}
                            {/* ลิงก์คลิป / Shorts / ลิงก์ย่อ ดึงรูปโปรไฟล์ไม่ได้ (ได้รูปปกคลิป) — บอกให้ใส่ลิงก์หน้าช่อง หรือชื่อบัญชี */}
                            {!fetchable && !hasImage && notProfilePlatform(formSocials) && (
                                <div className="qf-hint">ลิงก์ {notProfilePlatform(formSocials)} ที่ใส่ไม่ใช่หน้าช่อง (เช่นลิงก์คลิป) — ใส่ลิงก์หน้าโปรไฟล์ หรือชื่อบัญชี แล้วระบบดึงรูปให้ได้ · หรือก๊อปรูปแล้วกด Ctrl+V</div>
                            )}
                            {fetchMsg && <div className={fetchMsg.ok ? 'tf-fetch-ok' : 'qf-err'} role="status">{fetchMsg.text}</div>}
                        </Field>
                        <Field label="คลิปผลงาน" err={E.clip} labelId={id('clip')}>
                            {fileField('clip', orig && orig.clip, clipFile, setClipFile, dropClip, setDropClip, 'clip_link')}
                        </Field>
                        <Field label="หมายเหตุ" htmlFor={id('note')}>
                            <textarea id={id('note')} rows={3} value={f.note} maxLength={MAX.note}
                                onChange={e => up('note', e.target.value)} placeholder="เช่น ถนัดงานสกินแคร์ · ว่างเฉพาะเสาร์-อาทิตย์" />
                        </Field>
                    </>
                )}
            </div>
        </SideDrawer>
    );
}
