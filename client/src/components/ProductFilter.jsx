import { useEffect, useRef, useState } from 'react';
import { productLabel } from '../data/products.js';
import { NO_PRODUCT } from '../data/productFilter.js';

const nameOf = code => (code === NO_PRODUCT ? 'ไม่ระบุสินค้า' : code);

// แถวตัวกรอง "สินค้า:" — กดแล้วติ๊กได้หลายสินค้า (รายชื่อที่มีสินค้าใดสินค้าหนึ่งที่เลือก = แสดง)
// options = [{ code, count }] จาก productFilterOptions · value = รหัสที่เลือก ([] = ทั้งหมด) · total = จำนวนตอนไม่กรอง
// มีสินค้าให้เลือกไม่ถึง 2 ตัว (และไม่ได้กรองค้างไว้) = ไม่แสดงแถวนี้
export default function ProductFilter({ options, value, onChange, total, unit = 'คน' }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    // คลิกนอกกล่องแล้วปิด
    useEffect(() => {
        if (!open) return undefined;
        const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);
    if (options.length < 2 && value.length === 0) return null;
    const toggle = code => onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code]);
    // ค่าที่เลือกไว้แต่ไม่มีในรายชื่อแล้ว (เช่นเพิ่งเปลี่ยนแพลตฟอร์ม) ยังต้องติ๊กออกได้
    const shown = [...options, ...value.filter(c => !options.some(o => o.code === c)).map(code => ({ code, count: 0 }))];
    const picked = value.map(nameOf);
    const label = value.length === 0
        ? `ทั้งหมด (${total})`
        : (picked.length > 3 ? picked.slice(0, 3).join(', ') + ` +${picked.length - 3}` : picked.join(', '));
    return (
        <div className="proc-platfilter prod-filter" ref={ref}>
            <span className="proc-platfilter-lbl">สินค้า:</span>
            <button type="button" className={'proc-plat-chip prod-filter-btn' + (value.length ? ' on' : '')}
                aria-expanded={open} title={value.length ? picked.join(', ') : 'เลือกสินค้าที่ต้องการดู (ได้หลายตัว)'}
                onClick={() => setOpen(o => !o)}>
                {label} <span className="prod-filter-caret">▾</span>
            </button>
            {value.length > 0 && (
                <button type="button" className="prod-filter-clear" onClick={() => onChange([])}>× ดูทุกสินค้า</button>
            )}
            {open && (
                <div className="prod-filter-panel" role="dialog" aria-label="เลือกสินค้า">
                    {shown.map(o => (
                        <label className={'prod-filter-item' + (value.includes(o.code) ? ' on' : '')} key={o.code}>
                            <input type="checkbox" checked={value.includes(o.code)} onChange={() => toggle(o.code)} />
                            <span className="prod-filter-name">{o.code === NO_PRODUCT ? 'ไม่ระบุสินค้า' : productLabel(o.code)}</span>
                            <span className="prod-filter-count">{o.count}{unit ? ' ' + unit : ''}</span>
                        </label>
                    ))}
                    <button type="button" className="prod-filter-done" onClick={() => setOpen(false)}>
                        เสร็จ{value.length ? ` (${value.length} สินค้า)` : ''}
                    </button>
                </div>
            )}
        </div>
    );
}
