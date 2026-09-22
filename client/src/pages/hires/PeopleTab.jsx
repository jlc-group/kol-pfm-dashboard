import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import Icon from '../../components/Icon.jsx';
import FilePreviewModal from '../../components/FilePreviewModal.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { visibleBrands } from '../../data/brands.js';
import { T } from '../../data/talentLabels.js';
import CompCard, { accountOf } from './CompCard.jsx';

// แท็บ "Talent Book" — คอมการ์ดของทุกคนที่เคยเสนอหรือบันทึกให้แบรนด์ (อ่านอย่างเดียว ไว้เลือกคนเดิมซ้ำ ดูราคาเดิม)
// ป้ายบนการ์ดบอกว่า Booked (มีงานที่ตกลงแล้ว) หรือ Casting (เคยเสนอ / ยังไม่ได้งาน) — ไม่มีปุ่มกรองสองกลุ่มนี้ (ผู้ใช้ขอเอาออก)
// server รวมคนเดียวกัน (ชื่อ + ประเภทงาน) เป็นใบเดียวและกรองสิทธิ์แบรนด์แล้ว — หน้านี้กรองต่อในเครื่อง (ข้อมูลชุดเล็ก)
// แยกจากหน้าอินฟลูเอนเซอร์ตั้งใจ — งานพวกนี้ไม่มียอดวิว/CPM ถ้าเอาไปปนกัน ค่าเฉลี่ยของหน้านั้นจะเพี้ยน
// โชว์ทีละ 24 ใบ (12 แถวบนจอกว้าง) แล้วกดดูเพิ่ม — รูปทุกใบโหลดเป็น blob ในหน่วยความจำ ไม่ให้เปิดหน้ามาแล้วค้างทั้งร้อยใบ
const PAGE = 24;
const NONE = [];
const low = v => String(v == null ? '' : v).toLowerCase();

export default function PeopleTab() {
    const { user } = useAuth();
    const BRANDS = visibleBrands(user);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [kind, setKind] = useState('');
    const [brand, setBrand] = useState('');
    const [limit, setLimit] = useState(PAGE);
    const [preview, setPreview] = useState(null);   // { path, title, kind } ของไฟล์ที่กดดู

    useEffect(() => {
        let on = true;
        api('/hires/book')
            .then(res => { if (on) setData(res.data || {}); })
            .catch(err => { if (on) setError(err.message || 'โหลดคอมการ์ดไม่สำเร็จ'); });
        return () => { on = false; };
    }, []);

    const cards = Array.isArray(data && data.cards) ? data.cards : NONE;
    const kinds = useMemo(() => (Array.isArray(data && data.kinds) && data.kinds.length
        ? data.kinds
        : [...new Set(cards.map(c => c.kind).filter(Boolean))].sort()), [data, cards]);
    // ข้อความที่ค้นได้ของแต่ละใบ — ชื่อ / สังกัด / Account / เบอร์-LINE / ผู้ติดต่อ / เสนอโดย / ชื่องาน
    const hay = useMemo(() => new Map(cards.map(c => [c, [
        // ชื่อบัญชีแบบที่การ์ดโชว์ (เช่น "IG @baitoey") — ลิงก์ IG / Facebook / X ไม่มี @ ในตัว พิมพ์ตามที่เห็นบนการ์ดต้องเจอ
        c.name, c.agency, c.link, (accountOf(c.link) || {}).label, c.contact,
        ...(c.team_contacts || []), ...(c.proposed_by || []), ...(c.projects || []).map(p => p && p.name)
    ].map(low).join('\n')])), [cards]);

    const q = search.trim().toLowerCase();
    // skip = ตัวกรองที่ไม่ต้องใช้ตอนนับ — ตัวเลขบนชิปแต่ละชุดนับตามตัวกรองอื่นที่เลือกอยู่ กดแล้วจะเห็นเท่าตัวเลขพอดี
    const fits = (c, skip) =>
        (!kind || c.kind === kind)
        && (skip === 'brand' || !brand || (c.brands || []).includes(brand))
        && (!q || hay.get(c).includes(q));
    const shown = cards.filter(c => fits(c));
    const brandCount = b => cards.filter(c => fits(c, 'brand') && (!b || (c.brands || []).includes(b))).length;
    const brandOptions = BRANDS.filter(b => cards.some(c => (c.brands || []).includes(b)));

    // เปลี่ยนตัวกรอง → กลับไปเริ่มหน้าแรก (ไม่งั้นผลใหม่เปิดมาเต็มจำนวนที่กดดูเพิ่มไว้ รูปโหลดพรวดเดียว)
    useEffect(() => { setLimit(PAGE); }, [kind, brand, q]);
    const filtered = !!(kind || brand || q);
    const clearAll = () => { setKind(''); setBrand(''); setSearch(''); };
    const rest = shown.length - limit;

    return (
        <div className="hub-tab">
            <div className="hub-toolbar tb-toolbar">
                <div className="ka-search">
                    <Icon name="search" size={15} />
                    <input value={search} onChange={e => setSearch(e.target.value)} aria-label="ค้นหาคอมการ์ด"
                        placeholder={`ค้นหาชื่อ / สังกัด / Account / ${T.contact} / ผู้ติดต่อ / เสนอโดย / งาน...`} />
                    {search && (
                        <button type="button" className="ka-search-x" onClick={() => setSearch('')} title="ล้างคำค้นหา">✕</button>
                    )}
                </div>
                <select aria-label="กรองตามประเภทงาน" value={kind} onChange={e => setKind(e.target.value)}>
                    <option value="">ทุกประเภทงาน</option>
                    {kinds.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
            </div>

            {brandOptions.length > 0 && (
                <div className="brand-filter">
                    <span className="brand-filter-label">Brand:</span>
                    <button type="button" className={'brand-chip' + (brand === '' ? ' active' : '')} onClick={() => setBrand('')}>
                        ทุกแบรนด์ ({brandCount('')})
                    </button>
                    {brandOptions.map(b => (
                        <button type="button" key={b} className={'brand-chip' + (brand === b ? ' active' : '')} onClick={() => setBrand(b)}>
                            {b} ({brandCount(b)})
                        </button>
                    ))}
                </div>
            )}

            {error && <div className="alert-error">{error}</div>}

            {!data ? (
                !error && <div className="panel tb-empty">กำลังโหลด...</div>
            ) : shown.length === 0 ? (
                <div className="panel tb-empty">
                    {cards.length === 0 ? (
                        <>
                            <div className="tb-empty-title">ยังไม่มีคอมการ์ด</div>
                            <p>คนที่บันทึกไว้ในงาน และชื่อที่{T.finder}เสนอมาใน{T.request} จะขึ้นที่นี่เองพร้อมรูปและราคา</p>
                        </>
                    ) : (
                        <>
                            <div className="tb-empty-title">ไม่พบคอมการ์ดตามเงื่อนไขที่เลือก</div>
                            {filtered && <button type="button" className="btn-ghost" onClick={clearAll}>ล้างตัวกรอง</button>}
                        </>
                    )}
                </div>
            ) : (
                <>
                    <div className="tb-grid">
                        {shown.slice(0, limit).map((c, i) => (
                            <CompCard key={c.key || `${c.name}|${i}`} card={c} onPreview={setPreview} />
                        ))}
                    </div>
                    {rest > 0 && (
                        <div className="tb-more">
                            <button type="button" className="btn-ghost" onClick={() => setLimit(n => n + PAGE)}>
                                แสดงเพิ่มอีก {Math.min(PAGE, rest)} คน <span className="muted">(เหลือ {rest})</span>
                            </button>
                        </div>
                    )}
                </>
            )}

            {preview && (
                <FilePreviewModal path={preview.path} title={preview.title} kind={preview.kind || 'auto'}
                    onClose={() => setPreview(null)} />
            )}
        </div>
    );
}
