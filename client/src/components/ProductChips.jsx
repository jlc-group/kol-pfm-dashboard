import { Fragment, useState } from 'react';
import { productLabel } from '../data/products.js';
import { pickTitle, pickEventAdd } from '../data/productFilter.js';

// สรุปรายการสินค้าสำหรับช่องตาราง — โชว์ "รหัสสินค้า" คั่นคอมมาแบบข้อความ (ประหยัดพื้นที่สุด) ถ้าเยอะจะพับ + ปุ่มดูเพิ่ม
// รับค่าเป็นสตริงคั่นคอมมา หรืออาเรย์ของรหัสสินค้า
// onPick(code, add) = กดรหัสเพื่อกรองตามสินค้า (หัวกลุ่มแท็บ On Process · 21 ต.ค. 2026) · picked = รหัสที่กรองอยู่ (ไฮไลต์)
// pickable = Set รหัสที่กดได้ (null = ทุกตัว) — รหัสอื่นเป็นตัวหนังสือธรรมดา · ตัวที่กรองอยู่กดได้เสมอ (ไว้เอาออก)
export function ProductSummary({ value, max = 3, onPick, picked = [], pickable = null }) {
    const [open, setOpen] = useState(false);
    const codes = Array.isArray(value)
        ? value
        : (value ? String(value).split(',').map(s => s.trim()).filter(Boolean) : []);
    if (codes.length === 0) return <span className="muted">—</span>;
    const collapsed = !open && codes.length > max;
    const shown = collapsed ? codes.slice(0, max) : codes;
    return (
        <span className={'prod-codes' + (onPick ? ' pickable' : '')} title={onPick ? undefined : codes.map(c => productLabel(c)).join('\n')}>
            {onPick ? shown.map((c, i) => (
                <Fragment key={c}>
                    {i > 0 && ', '}
                    {!pickable || pickable.has(c) || picked.includes(c) ? (
                        <button type="button" className={'prod-code-pick' + (picked.includes(c) ? ' on' : '')} aria-pressed={picked.includes(c)}
                            title={pickTitle(c, productLabel(c), picked.includes(c))} onClick={e => onPick(c, pickEventAdd(e))}>{c}</button>
                    ) : (
                        <span className="prod-code-nopick" title={`${productLabel(c)}\nยังไม่มีคลิปของ ${c} ในตารางตอนนี้`}>{c}</span>
                    )}
                </Fragment>
            )) : shown.join(', ')}
            {codes.length > max && (
                <button type="button" className="prod-codes-more" onClick={() => setOpen(o => !o)}>
                    {collapsed ? `+${codes.length - max}` : 'ย่อ'}
                </button>
            )}
        </span>
    );
}

// ชิปสินค้าแบบกะทัดรัด — โชว์เฉพาะรหัสสินค้า (ชื่อเต็มอยู่ใน tooltip) เรียงต่อกันแนวนอน
// ถ้าสินค้าเยอะเกิน collapseAt จะพับเก็บเหลือ N อันแรก + ปุ่ม "ดูทั้งหมด" กันการ์ดยาวเกินไป
// onPick(code, add) = กดชิปเพื่อกรองตามสินค้า (หัวกลุ่มแท็บรายชื่อ · 21 ต.ค. 2026) · picked = รหัสที่กรองอยู่ (ไฮไลต์)
export default function ProductChips({ products = [], collapseAt = 12, onPick, picked = [] }) {
    const [open, setOpen] = useState(false);
    if (!products || products.length === 0) return <span className="muted">—</span>;

    const collapsed = !open && products.length > collapseAt;
    const shown = collapsed ? products.slice(0, collapseAt) : products;

    return (
        <div className="prodchip-wrap">
            {shown.map(code => (onPick ? (
                <button type="button" className={'prodchip pick' + (picked.includes(code) ? ' on' : '')} key={code} aria-pressed={picked.includes(code)}
                    title={pickTitle(code, productLabel(code), picked.includes(code))} onClick={e => onPick(code, pickEventAdd(e))}>{code}</button>
            ) : (
                <span className="prodchip" key={code} title={productLabel(code)}>{code}</span>
            )))}
            {products.length > collapseAt && (
                <button type="button" className="prodchip-more" onClick={() => setOpen(o => !o)}>
                    {collapsed ? `+${products.length - collapseAt} เพิ่มเติม` : '▲ ย่อ'}
                </button>
            )}
        </div>
    );
}
