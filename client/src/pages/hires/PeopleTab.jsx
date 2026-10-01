import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import Icon from '../../components/Icon.jsx';
import { BRANDS } from '../../data/brands.js';
import { T } from '../../data/talentLabels.js';
import { socialsSearchText } from '../../data/talentSocials.js';
import CompCard, { cardSocials } from './CompCard.jsx';
import TalentDetail from './TalentDetail.jsx';
import TalentForm from './TalentForm.jsx';

// Talent Book — ทั้งหน้า Talent มีแค่ส่วนนี้ (ผู้ใช้สั่ง 1 ต.ค. 2026): คอมการ์ด + เรทราคา ทีมเพิ่ม/แก้เองด้วย "+ Talent Book"
// การ์ดจากงาน Talent เก่า (คนที่เคยบันทึก/เสนอในงาน) ยังรวมขึ้นมาให้ด้วย — อ่านอย่างเดียว ไว้เลือกคนเดิมซ้ำ ดูราคาเดิม
// ป้ายบนการ์ดบอกว่า Booked (มีงานที่ตกลงแล้ว) หรือ Casting (เคยเสนอ / ยังไม่ได้งาน) — ไม่มีปุ่มกรองสองกลุ่มนี้ (ผู้ใช้ขอเอาออก)
// server รวมคนเดียวกัน (ชื่อ + ประเภทงาน) เป็นใบเดียวและกรองสิทธิ์แบรนด์แล้ว — หน้านี้กรองต่อในเครื่อง (ข้อมูลชุดเล็ก)
// แยกจากหน้าอินฟลูเอนเซอร์ตั้งใจ — งานพวกนี้ไม่มียอดวิว/CPM ถ้าเอาไปปนกัน ค่าเฉลี่ยของหน้านั้นจะเพี้ยน
// โชว์ทีละ 24 ใบ (12 แถวบนจอกว้าง) แล้วกดดูเพิ่ม — รูปทุกใบโหลดเป็น blob ในหน่วยความจำ ไม่ให้เปิดหน้ามาแล้วค้างทั้งร้อยใบ
// ผู้ใช้สั่ง 1 ต.ค. 2026: หน้าการ์ด = ข้อมูล KOL (รูป / ชื่อ / ช่องทาง Social / เรท) · กดการ์ด = หน้ารายละเอียด + งานที่จ้าง (TalentDetail)
//   แก้ข้อมูลจากหน้ารายละเอียด = ฟอร์มเปิดซ้อนบนหน้ารายละเอียด บันทึกแล้วกลับมาที่หน้ารายละเอียดเดิม
const PAGE = 24;
const NONE = [];
// รูปโปรไฟล์ที่ server ยังดึงไม่เสร็จตอนตอบ — ถามซ้ำทุก POLL_MS ไม่เกิน WATCH_MS (ดู watch ด้านล่าง)
const POLL_MS = 4000;
const WATCH_MS = 25000;
const low = v => String(v == null ? '' : v).toLowerCase();

export default function PeopleTab() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [kind, setKind] = useState('');
    const [brand, setBrand] = useState('');
    const [limit, setLimit] = useState(PAGE);
    // หน้ารายละเอียดที่เปิดอยู่: null = ปิด · { tid, key } — หาการ์ดจาก id ของคนที่เพิ่มเอง (แก้ชื่อแล้ว key เปลี่ยน) ไม่มีค่อยใช้ key
    const [detail, setDetail] = useState(null);
    const [detailVer, setDetailVer] = useState(0);   // แก้ข้อมูลในฟอร์มแล้ว → หน้ารายละเอียดโหลดใหม่
    // ฟอร์มเพิ่ม/แก้คนใน Talent Book เอง: null = ปิด · { id: null } = เพิ่มใหม่ · { id } = แก้การ์ดที่เพิ่มเอง
    const [form, setForm] = useState(null);
    const [ver, setVer] = useState(0);   // บันทึก/ลบแล้วโหลดการ์ดใหม่
    // ผลดึงรูปโปรไฟล์จากลิงก์หลังบันทึก (server ตอบ image_fetch) — { ok, text } แถบแจ้งบนหน้า กดปิดได้
    const [notice, setNotice] = useState(null);
    // server ยังดึงรูปไม่เสร็จตอนตอบ (pending) → ถามแถวนั้นซ้ำทุก ~4 วินาที จนรูปเปลี่ยน (โหลดการ์ด + หน้ารายละเอียดใหม่ รูปขึ้นเองไม่ต้องรีเฟรช)
    // หรือจนครบเวลา: server รอ 6 วิ แล้วดึงต่อได้อีกถึง 20 วิ (+ คิวตอนดึงพร้อมกันหลายคน) → เผื่อไว้ 25 วิ นับจากได้คำตอบ
    // ครบแล้วยังไม่มีรูป = โหลดการ์ดอีกรอบ แล้วเปลี่ยนข้อความเป็นทางแก้ (ไม่สัญญาว่ารูปจะขึ้นเองแล้ว)
    // watch = { tid, until, image (รูปตอนตอบ — เทียบว่ารูปเปลี่ยนหรือยัง), platform } · บันทึกครั้งใหม่ที่ pending แทนตัวเดิม
    const [watch, setWatch] = useState(null);
    useEffect(() => {
        if (!watch) return undefined;
        let on = true;
        let timer = null;
        const mine = n => !!(n && n.watch === watch);   // แถบข้อความของรอบนี้ (บันทึกอื่นเปลี่ยนข้อความไปแล้ว = ไม่แตะ)
        const poll = async () => {
            let changed = false;
            try {
                const res = await api(`/hires/talents/${encodeURIComponent(watch.tid)}`);
                const img = (res && res.data && res.data.image) || null;
                changed = !!img && JSON.stringify(img) !== watch.image;
            } catch { /* ถามรอบหน้า */ }
            if (!on) return;
            if (changed) {
                setVer(v => v + 1);
                setDetailVer(v => v + 1);
                setNotice(n => (mine(n) ? null : n));
                setWatch(null);
            } else if (Date.now() >= watch.until) {
                setVer(v => v + 1);
                setNotice(n => (mine(n) ? { ok: false, text: `ยังดึงรูปจาก ${watch.platform || 'ลิงก์'} ไม่ได้ — กด "ดึงรูปจากลิงก์" ในฟอร์มแก้ไข หรือก๊อปรูปแล้วกด Ctrl+V` } : n));
                setWatch(null);
            } else {
                timer = setTimeout(poll, POLL_MS);
            }
        };
        timer = setTimeout(poll, POLL_MS);
        return () => { on = false; clearTimeout(timer); };
    }, [watch]);
    useEffect(() => {
        let on = true;
        api('/hires/book')
            .then(res => { if (on) { setData(res.data || {}); setError(''); } })
            .catch(err => { if (on) setError(err.message || 'โหลดคอมการ์ดไม่สำเร็จ'); });
        return () => { on = false; };
    }, [ver]);

    const cards = Array.isArray(data && data.cards) ? data.cards : NONE;
    const kinds = useMemo(() => (Array.isArray(data && data.kinds) && data.kinds.length
        ? data.kinds
        : [...new Set(cards.map(c => c.kind).filter(Boolean))].sort()), [data, cards]);
    // ข้อความที่ค้นได้ของแต่ละใบ — ชื่อ / สังกัด / ช่องทาง Social / เบอร์-LINE / ผู้ติดต่อ / เสนอโดย / ชื่องาน
    const hay = useMemo(() => new Map(cards.map(c => [c, [
        // ชื่อบัญชีแบบที่การ์ดโชว์ (เช่น "@baitoey") + แพลตฟอร์ม + ลิงก์ — พิมพ์ตามที่เห็นบนการ์ดต้องเจอ
        c.name, c.agency, c.link, socialsSearchText(cardSocials(c)), c.contact, c.contact_name,
        ...(c.team_contacts || []), ...(c.proposed_by || []), ...(c.projects || []).map(p => p && p.name),
        // คนที่เพิ่มเอง: หมายเหตุ + คนที่เพิ่ม
        c.talent && c.talent.note, c.talent && c.talent.scope, c.talent && c.talent.added_by
    ].map(low).join('\n')])), [cards]);

    const q = search.trim().toLowerCase();
    // skip = ตัวกรองที่ไม่ต้องใช้ตอนนับ — ตัวเลขบนชิปแต่ละชุดนับตามตัวกรองอื่นที่เลือกอยู่ กดแล้วจะเห็นเท่าตัวเลขพอดี
    const fits = (c, skip) =>
        (!kind || c.kind === kind)
        && (skip === 'brand' || !brand || (c.brands || []).includes(brand))
        && (!q || hay.get(c).includes(q));
    const shown = cards.filter(c => fits(c));
    const brandCount = b => cards.filter(c => fits(c, 'brand') && (!b || (c.brands || []).includes(b))).length;
    // ตัวกรอง Brand = ทุกแบรนด์ที่มีบนการ์ด (เรียงตามรายชื่อแบรนด์) — การ์ดจากงาน server กรองตามสิทธิ์แบรนด์มาแล้ว
    // แบรนด์ที่ทีมติดให้คนที่เพิ่มเอง ทุกคนเห็น (ผู้ใช้เลือก 30 ก.ย.) จึงต้องกรองได้ด้วย แม้ไม่ใช่แบรนด์ที่ตัวเองดูแล
    const brandOptions = useMemo(() => {
        const on = new Set(cards.flatMap(c => c.brands || []));
        return [...BRANDS.filter(b => on.has(b)), ...[...on].filter(b => b && !BRANDS.includes(b)).sort()];
    }, [cards]);

    // เปลี่ยนตัวกรอง → กลับไปเริ่มหน้าแรก (ไม่งั้นผลใหม่เปิดมาเต็มจำนวนที่กดดูเพิ่มไว้ รูปโหลดพรวดเดียว)
    useEffect(() => { setLimit(PAGE); }, [kind, brand, q]);
    // โหลดใหม่หลังแก้/ลบ แล้วประเภทที่กรองอยู่ไม่มีการ์ดแล้ว — ล้างตัวกรอง (ไม่งั้นดรอปดาวน์ไม่มีตัวเลือกนั้น แต่ยังกรองอยู่)
    useEffect(() => { if (kind && data && !kinds.includes(kind)) setKind(''); }, [kinds]);   // eslint-disable-line react-hooks/exhaustive-deps
    // แบบเดียวกันกับตัวกรอง Brand — แบรนด์ของการ์ดที่เพิ่มเองแก้/ลบได้ ชิปแบรนด์ที่เลือกอยู่จึงหายไปได้
    useEffect(() => { if (brand && data && !brandOptions.includes(brand)) setBrand(''); }, [brandOptions]);   // eslint-disable-line react-hooks/exhaustive-deps
    const filtered = !!(kind || brand || q);
    // การ์ดของหน้ารายละเอียด — หาจากชุดล่าสุดทุกครั้ง (โหลดใหม่แล้วรูป/เรท/จำนวนงานบนหน้ารายละเอียดเปลี่ยนตาม)
    const detailCard = detail
        ? (detail.tid != null && cards.find(c => c.talent && String(c.talent.id) === String(detail.tid))) || cards.find(c => c.key === detail.key) || null
        : null;
    // ลบคนออกไปแล้ว (โหลดใหม่ไม่เจอการ์ด) → ปิดหน้ารายละเอียด
    useEffect(() => { if (detail && data && !detailCard) setDetail(null); }, [detail, data, detailCard]);
    const openDetail = c => setDetail({ tid: c.talent ? c.talent.id : null, key: c.key });
    const clearAll = () => { setKind(''); setBrand(''); setSearch(''); };
    const rest = shown.length - limit;

    return (
        <div className="hub-tab">
            <div className="hub-toolbar tb-toolbar">
                {/* เพิ่มคนเข้า Talent Book เองได้เลย ไม่ต้องมีงาน (ทุกคนในทีมเห็น) */}
                <button type="button" className="btn-primary tb-add" onClick={() => setForm({ id: null })}>
                    <Icon name="plus" size={16} /> Talent Book
                </button>
                <div className="ka-search">
                    <Icon name="search" size={15} />
                    <input value={search} onChange={e => setSearch(e.target.value)} aria-label="ค้นหาคอมการ์ด"
                        placeholder={`ค้นหาชื่อ / @ชื่อช่อง / สังกัด / ${T.contact} / ผู้ติดต่อ / Scope...`} />
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
            {notice && (
                <div className={'tb-notice' + (notice.ok ? '' : ' warn')} role="status">
                    <span>{notice.text}</span>
                    <button type="button" className="tb-notice-x" onClick={() => setNotice(null)} aria-label="ปิดข้อความนี้">×</button>
                </div>
            )}

            {!data ? (
                !error && <div className="panel tb-empty">กำลังโหลด...</div>
            ) : shown.length === 0 ? (
                <div className="panel tb-empty">
                    {cards.length === 0 ? (
                        <>
                            <div className="tb-empty-title">ยังไม่มีคอมการ์ด</div>
                            <p>กด "+ Talent Book" เพื่อเพิ่มคอมการ์ดพร้อมเรทราคาได้เลย — แบรนด์ไหนจ้างใคร เพิ่มเก็บไว้ที่นี่ ทุกคนในทีมเห็น</p>
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
                            <CompCard key={c.key || `${c.name}|${i}`} card={c} onOpen={openDetail} onEdit={tid => setForm({ id: tid })} />
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

            {detailCard && (
                <TalentDetail key={detail.tid != null ? 't' + detail.tid : 'k' + detail.key} card={detailCard} reloadKey={detailVer}
                    onClose={() => setDetail(null)}
                    onEdit={tid => setForm({ id: tid })}
                    onChanged={() => setVer(v => v + 1)} />
            )}

            {/* เปิดหลังหน้ารายละเอียด = ซ้อนอยู่บนสุด (Esc / ปิด ปิดแค่ฟอร์ม กลับไปหน้ารายละเอียดเดิม) */}
            {form && (
                <TalentForm talentId={form.id}
                    // changed = บันทึกข้อมูลไปแล้ว (แม้ไฟล์ยังอัปไม่ขึ้น) — โหลดการ์ดใหม่ ไม่งั้นการ์ดใหม่ไม่ขึ้นจนรีเฟรชหน้า
                    onClose={changed => { setForm(null); if (changed) { setVer(v => v + 1); setDetailVer(v => v + 1); } }}
                    onSaved={(row, info) => {
                        setForm(null);
                        // ลบคนออกแล้ว (row = null) → ปิดหน้ารายละเอียดของคนนั้นด้วย
                        if (!row) setDetail(null);
                        // ผลดึงรูปโปรไฟล์อัตโนมัติ: กำลังดึง = บอก + ถามซ้ำจนรูปขึ้น · ดึงแล้ว = บอก (รูปไม่โผล่มาเงียบ ๆ)
                        // ดึงไม่ได้ / ช่องทางที่ดึงไม่ได้ (IG / FB / ลิงก์คลิป) = บอกทางแก้
                        const img = info && info.image_fetch;
                        if (img && img.status === 'pending' && row && row.id != null) {
                            const w = { tid: row.id, until: Date.now() + WATCH_MS, image: JSON.stringify(row.image || null), platform: img.platform || '' };
                            setNotice({ ok: true, text: `กำลังดึงรูปโปรไฟล์จาก ${img.platform || 'ลิงก์'} — รูปจะขึ้นบนการ์ดเองเมื่อดึงเสร็จ`, watch: w });
                            setWatch(w);
                        } else if (img && img.status === 'done') {
                            setNotice({ ok: true, text: `ใส่รูปโปรไฟล์จาก ${img.platform || 'ลิงก์'} ให้แล้ว${row && row.name ? ` ("${row.name}")` : ''} — ไม่ใช้รูปนี้ กดแก้ไขแล้วกด × ที่ช่องรูป` });
                        } else if (img && img.message && (img.status === 'failed' || img.status === 'none')) {
                            setNotice({ ok: false, text: `${row && row.name ? `"${row.name}" — ` : ''}${img.message}` });
                        } else {
                            setNotice(null);
                        }
                        // เพิ่มคนใหม่ (ไม่ผูกแบรนด์) ตอนกรองแบรนด์/ประเภท/คำค้นอยู่ → ล้างตัวกรอง ไม่งั้นการ์ดใหม่ถูกซ่อน ดูเหมือนไม่ได้บันทึก
                        if (info && info.created) clearAll();
                        setVer(v => v + 1);
                        setDetailVer(v => v + 1);
                    }} />
            )}
        </div>
    );
}
