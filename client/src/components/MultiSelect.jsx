import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ช่องเลือกได้หลายตัว — เก็บค่าเป็นสตริงคั่นด้วย , (ตรงกับที่ ProductSummary และฝั่ง server ใช้)
// itemName = คำที่เอาไปต่อท้าย เช่น "Product" → "เลือกทุก Product"
// labelOf  = แปลงค่าเป็นข้อความที่โชว์ในลิสต์ (ค่าเริ่มต้น = โชว์ค่าตรง ๆ)
// ariaLabel = ชื่อของช่องเลือกให้โปรแกรมอ่านจอ (ไม่ส่ง = ใช้ข้อความบนช่อง)
//
// 18 พ.ย. 2026 ผู้ใช้สั่ง "ทำให้แบบกดเลือกได้หลายๆตัวก่อนแล้วหน้าต่างสินค้าค่อยหายไป ตอนนี้กด 1 ครั้งต้องมากดเปิดเลือกใหม่"
//   เดิมเป็น <select> ของเบราว์เซอร์ (เลือก 1 ตัวแล้วปิดเอง) → กล่องติ๊กหลายตัว + "เลือกทุก…" + ปุ่ม "เสร็จ"
//   ติ๊กแล้วบันทึกลงช่องทันที (เหมือนเดิม) · ปิดด้วย เสร็จ / กดนอกกล่อง / Esc / โฟกัสออกจากกล่อง
//   ช่องที่เห็นยังเป็น <select> เดิม (หน้าตาตามที่แต่ละหน้าตั้งไว้ · ทุกจุดที่ใช้ไม่ต้องแก้ CSS) แต่มีปุ่มใสทับไว้รับการกด
//   — ลิสต์ของเบราว์เซอร์จึงไม่เปิด (รวมมือถือ) · กล่องลอยวาดไว้ที่ body (portal) ตารางที่ตัดขอบ / ป๊อปอัปจึงบังไม่ได้
//   ลิ้นชัก (SideDrawer) เช็ค .pms-panel.ms-float ก่อนปิดด้วย Esc — Esc ปิดแค่กล่องนี้
export default function MultiSelect({ value, options = [], onChange, placeholder, itemName = 'รายการ', labelOf = x => x, ariaLabel }) {
    const selected = value ? String(value).split(',').map(s => s.trim()).filter(Boolean) : [];
    const setSel = arr => onChange([...new Set(arr)].join(','));
    const remove = code => setSel(selected.filter(c => c !== code));
    const allSel = options.length > 0 && options.every(o => selected.includes(o));
    // ค่าเดิมที่ไม่อยู่ในตัวเลือกแล้ว (เช่น สินค้ารูปแบบเก่า / สินค้าที่ซ่อนไปแล้ว) ยังต้องติ๊กออกได้ในกล่อง
    const extra = selected.filter(c => !options.includes(c));
    const toggle = code => setSel(selected.includes(code) ? selected.filter(c => c !== code) : [...selected, code]);

    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    // แถวในกล่องจำไว้ตอนเปิด — ติ๊กค่าเดิม (นอกตัวเลือก) ออกแล้วแถวไม่หาย ติ๊กกลับได้จนกว่าจะปิดกล่อง
    const [rows, setRows] = useState([]);
    const wrapRef = useRef(null);
    const btnRef = useRef(null);
    const panelRef = useRef(null);

    // วางกล่องใต้ช่อง (ไม่พอ = ฝั่งที่ที่ว่างมากกว่า) · body มี zoom (--app-zoom) — พิกัดจริงบนจอต้องหารด้วย zoom ก่อนตั้ง top / left
    // ความสูงไม่เกินที่ว่างจริง (จอเตี้ย) — ปุ่ม "เสร็จ" ติดล่างของกล่องจึงยังเห็นเสมอ
    const place = useCallback(() => {
        const el = wrapRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const z = parseFloat(window.getComputedStyle(document.body).zoom) || 1;
        const vw = (window.innerWidth || 1280) / z, vh = (window.innerHeight || 800) / z;
        const top = r.top / z, bottom = r.bottom / z, left = r.left / z;
        const width = Math.min(Math.max(r.width / z, 260), vw - 16);
        const panelH = Math.min(panelRef.current ? panelRef.current.scrollHeight : 340, 340);
        const below = vh - bottom - 12, above = top - 12;
        const up = below < panelH && above > below;
        setPos({
            left: Math.max(8, Math.min(left, vw - width - 8)), width,
            ...(up ? { bottom: vh - top + 4 } : { top: bottom + 4 }),
            maxHeight: Math.max(0, Math.min(340, up ? above : below))
        });
    }, []);

    const close = useCallback((refocus = true) => {
        setOpen(false);
        if (refocus && btnRef.current) btnRef.current.focus();
    }, []);

    function openPanel() {
        setRows([...extra, ...options]);
        place();   // คิดตำแหน่งก่อนวาด — กล่องไม่ซ่อนตอนโฟกัสตัวแรก
        setOpen(true);
    }

    // ช่องยังเห็นอยู่ไหม (ไม่ถูกเลื่อนออกนอกกรอบที่ตัดขอบ เช่น ตัวป๊อปอัป / ลิ้นชัก / ตารางเลื่อนข้าง)
    const triggerVisible = useCallback(() => {
        const el = wrapRef.current;
        if (!el) return false;
        const r = el.getBoundingClientRect();
        let top = 0, left = 0, bottom = window.innerHeight, right = window.innerWidth;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const cs = window.getComputedStyle(p);
            if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + ' ' + cs.overflowY)) {
                const pr = p.getBoundingClientRect();
                top = Math.max(top, pr.top); left = Math.max(left, pr.left);
                bottom = Math.min(bottom, pr.bottom); right = Math.min(right, pr.right);
            }
        }
        return r.bottom > top + 2 && r.top < bottom - 2 && r.right > left + 2 && r.left < right - 2;
    }, []);

    // ติ๊กแล้วชิปเพิ่ม ช่องถูกดันลง — วางกล่องใหม่ทุกครั้งที่ค่าเปลี่ยน (ไม่บังชิป / ช่องของตัวเอง)
    useLayoutEffect(() => { if (open) place(); }, [open, value, place]);

    useEffect(() => {
        if (!open) return undefined;
        const raf = requestAnimationFrame(place);   // วัดซ้ำหลังวาดเสร็จ (รู้ความสูงจริง)
        // โฟกัสตัวแรกในกล่อง — คีย์บอร์ดติ๊กต่อได้ทันที
        const first = panelRef.current && panelRef.current.querySelector('button, input');
        if (first) first.focus({ preventScroll: true });
        const inside = t => (wrapRef.current && wrapRef.current.contains(t)) || (panelRef.current && panelRef.current.contains(t));
        const onDown = e => { if (!inside(e.target)) close(false); };
        const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } };
        // โฟกัสไปที่อื่น (คีย์บอร์ด / โปรแกรมอ่านจอ / กดช่องอื่นด้วย Enter) = ปิด ไม่ค้างเปิดบังฟอร์ม
        const onFocus = e => { if (!inside(e.target)) close(false); };
        // เลื่อนหน้า / ตาราง → กล่องขยับตามช่อง · ช่องถูกเลื่อนออกนอกกรอบแล้ว = ปิด (ไม่ลอยค้างทับหัวป๊อปอัป)
        const onScroll = e => {
            if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
            if (!triggerVisible()) { close(false); return; }
            place();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown, { passive: true });
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('focusin', onFocus);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', place);
        return () => {
            cancelAnimationFrame(raf);
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('focusin', onFocus);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', place);
        };
    }, [open, place, close, triggerVisible]);

    // Tab วนอยู่ในกล่อง (กล่องอยู่ท้าย body ถ้าปล่อย Tab จะหลุดไปท้ายหน้า) — ออกด้วย เสร็จ / Esc แล้วโฟกัสกลับช่อง
    const onPanelKey = e => {
        if (e.key !== 'Tab' || !panelRef.current) return;
        const items = [...panelRef.current.querySelectorAll('button:not([disabled]), input:not([disabled])')];
        if (!items.length) return;
        const firstEl = items[0], lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };

    const text = selected.length ? `+ เพิ่ม ${itemName} (${selected.length})` : placeholder;
    const disabled = options.length === 0 && extra.length === 0;
    const list = open ? [...new Set([...rows, ...extra, ...options])] : [];

    return (
        <div className="pms-cell">
            {selected.length > 0 && (
                <div className="pms-cell-chips">
                    {allSel && extra.length === 0
                        ? <span className="pms-cell-chip all" title={`เลือกทุก ${itemName}`}>ทุก {itemName} ({options.length})<button type="button" onClick={() => setSel([])} title="ล้างทั้งหมด">×</button></span>
                        : selected.map(c => <span className="pms-cell-chip" key={c} title={labelOf(c)}>{c}<button type="button" onClick={() => remove(c)} title="เอาออก">×</button></span>)}
                </div>
            )}
            <div className={'ms-wrap' + (open ? ' open' : '')} ref={wrapRef}>
                {/* ช่องเดิมไว้แสดงผลอย่างเดียว (กดไม่ได้ · โปรแกรมอ่านจออ่านจากปุ่มแทน) */}
                <select value="" disabled={disabled} tabIndex={-1} aria-hidden="true" onChange={() => {}}>
                    <option value="">{text}</option>
                </select>
                <button ref={btnRef} type="button" className="ms-hit" disabled={disabled}
                    aria-label={ariaLabel || text} aria-haspopup="dialog" aria-expanded={open}
                    onClick={() => (open ? close(false) : openPanel())} />
            </div>
            {open && createPortal(
                <div ref={panelRef} className="pms-panel ms-float" role="dialog" aria-label={ariaLabel || `เลือก ${itemName}`}
                    onKeyDown={onPanelKey}
                    style={{ position: 'fixed', ...pos, visibility: pos ? 'visible' : 'hidden' }}>
                    {options.length > 0 && (
                        <button type="button" className="pms-all" onClick={() => setSel(allSel ? selected.filter(c => !options.includes(c)) : [...selected, ...options])}>
                            {allSel ? `✕ ยกเลิกทุก ${itemName}` : `☑ เลือกทุก ${itemName}`}
                        </button>
                    )}
                    {list.map(c => (
                        <label className={'pms-item' + (selected.includes(c) ? ' on' : '')} key={c}>
                            <input type="checkbox" checked={selected.includes(c)} onChange={() => toggle(c)} />
                            <span>{labelOf(c)}</span>
                        </label>
                    ))}
                    <button type="button" className="pms-done" onClick={() => close(true)}>เสร็จ ({selected.length})</button>
                </div>,
                document.body
            )}
        </div>
    );
}
