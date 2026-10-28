// ช่องเลือกได้หลายตัว — เลือกทีละตัว หรือกด "เลือกทุก..." ทีเดียว
// เก็บค่าเป็นสตริงคั่นด้วย , (ตรงกับที่ ProductSummary และฝั่ง server ใช้)
// itemName = คำที่เอาไปต่อท้าย เช่น "Product" → "เลือกทุก Product"
// labelOf  = แปลงค่าเป็นข้อความที่โชว์ในลิสต์ (ค่าเริ่มต้น = โชว์ค่าตรง ๆ)
// ariaLabel = ชื่อของช่องเลือกให้โปรแกรมอ่านจอ (ไม่ส่ง = ไม่มี เหมือนเดิม)
export default function MultiSelect({ value, options = [], onChange, placeholder, itemName = 'รายการ', labelOf = x => x, ariaLabel }) {
    const selected = value ? String(value).split(',').map(s => s.trim()).filter(Boolean) : [];
    const setSel = arr => onChange([...new Set(arr)].join(','));
    const remove = code => setSel(selected.filter(c => c !== code));
    const allSel = options.length > 0 && options.every(o => selected.includes(o));
    const onSelect = e => {
        const v = e.target.value;
        if (v === '__ALL__') setSel(allSel ? [] : options);
        else if (v) setSel([...selected, v]);
        e.target.value = '';
    };
    return (
        <div className="pms-cell">
            {selected.length > 0 && (
                <div className="pms-cell-chips">
                    {allSel
                        ? <span className="pms-cell-chip all" title={`เลือกทุก ${itemName}`}>ทุก {itemName} ({options.length})<button type="button" onClick={() => setSel([])} title="ล้างทั้งหมด">×</button></span>
                        : selected.map(c => <span className="pms-cell-chip" key={c} title={labelOf(c)}>{c}<button type="button" onClick={() => remove(c)} title="เอาออก">×</button></span>)}
                </div>
            )}
            <select value="" onChange={onSelect} disabled={options.length === 0} aria-label={ariaLabel}>
                <option value="">{selected.length ? `+ เพิ่ม ${itemName} (${selected.length})` : placeholder}</option>
                {options.length > 0 && <option value="__ALL__">{allSel ? `✓ ทุก ${itemName} (เลือกครบแล้ว)` : `☑ เลือกทุก ${itemName}`}</option>}
                {options.filter(c => !selected.includes(c)).map(c => <option key={c} value={c}>{labelOf(c)}</option>)}
            </select>
        </div>
    );
}
