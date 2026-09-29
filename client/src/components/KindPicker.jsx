import { useEffect, useRef, useState } from 'react';
import { HIRE_KINDS, KIND_OTHER, KIND_MAXLEN, kindChoiceOf, kindOtherText } from '../data/hireKinds.js';

// ตัวเลือกประเภทงาน Talent — ใช้ทุกฟอร์ม · variant: 'chips' (ปุ่มเรียงกัน) | 'select' (ดรอปดาวน์ ในตารางฟอร์มงานเต็ม)
// เลือก "อื่น ๆ" แล้วมีช่องให้พิมพ์ว่าเป็นงานอะไร — ค่าที่ส่งออกคือข้อความที่พิมพ์ (ยังไม่พิมพ์ = "อื่น ๆ" → ฟอร์มเตือนด้วย kindError)
// • อยู่โหมด "อื่น ๆ" ค้างไว้ระหว่างพิมพ์ (otherOpen) — พิมพ์ไปตรงกับชื่อในรายการ (เช่น "นักแสดง…") ช่องจะไม่หายกลางคัน
//   เปิดมาพร้อมค่าที่พิมพ์เองไว้ก่อน (แก้คน / แก้ใบ / แถวที่ก๊อปจากแถวก่อน) ก็เริ่มในโหมดนี้เลย
// • ข้อความในช่องเก็บเป็น state ของตัวเอง (draft) — พิมพ์คำว่า "อื่น ๆ" ลงไปตรง ๆ ช่องจะไม่ว่างเอง
// • ค่าที่เปลี่ยนจากข้างนอก (ไม่ได้มาจากช่องพิมพ์นี้) = คำนวณโหมดและข้อความใหม่ — typedRef บอกว่าค่านั้นมาจากการพิมพ์หรือไม่
export default function KindPicker({ value, onChange, variant = 'chips', labelId, ariaLabel = 'ประเภทงาน', invalid = false }) {
    const v = String(value ?? '');
    const [otherOpen, setOtherOpen] = useState(() => kindChoiceOf(v) === KIND_OTHER);
    const [draft, setDraft] = useState(() => kindOtherText(v));
    const [focusOther, setFocusOther] = useState(false);
    const inputRef = useRef(null);
    const typedRef = useRef(null);

    useEffect(() => {
        if (v === typedRef.current) return;              // ค่านี้มาจากการพิมพ์ในช่องเอง
        typedRef.current = null;
        setOtherOpen(kindChoiceOf(v) === KIND_OTHER);
        setDraft(kindOtherText(v));
    }, [v]);
    useEffect(() => {
        if (focusOther && inputRef.current) { inputRef.current.focus(); setFocusOther(false); }
    }, [focusOther]);

    const choice = otherOpen && v ? KIND_OTHER : kindChoiceOf(v);

    const pick = k => {
        if (k === KIND_OTHER) {
            // เลือกซ้ำ = ไม่ล้างข้อความที่พิมพ์ไว้
            if (choice !== KIND_OTHER) { setDraft(''); typedRef.current = KIND_OTHER; onChange(KIND_OTHER); }
            setOtherOpen(true);
            setFocusOther(true);
        } else {
            setOtherOpen(false);
            onChange(k);
        }
    };
    const type = text => {
        setDraft(text);
        const next = text === '' ? KIND_OTHER : text;
        typedRef.current = next;
        onChange(next);
    };

    const other = choice === KIND_OTHER && (
        <input ref={inputRef} className={'kind-other' + (invalid && !draft.trim() ? ' tc2-invalid' : '')}
            value={draft} maxLength={KIND_MAXLEN} autoComplete="off"
            aria-label="ระบุประเภทงาน" placeholder="ระบุว่าเป็นงานอะไร เช่น ช่างแต่งหน้า"
            onChange={e => type(e.target.value)} />
    );

    if (variant === 'select') {
        return (
            <>
                <select value={choice} aria-labelledby={labelId} aria-label={labelId ? undefined : ariaLabel}
                    className={invalid && !choice ? 'tc2-invalid' : undefined} aria-invalid={invalid ? 'true' : undefined}
                    onChange={e => (e.target.value ? pick(e.target.value) : (setOtherOpen(false), onChange('')))}>
                    <option value="">— เลือก —</option>
                    {HIRE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                {other}
            </>
        );
    }
    return (
        <>
            <div className="qf-chips" role="radiogroup" aria-labelledby={labelId} aria-label={labelId ? undefined : ariaLabel}>
                {HIRE_KINDS.map(k => (
                    <button type="button" key={k} role="radio" aria-checked={choice === k}
                        className={'qf-chip' + (choice === k ? ' on' : '')} onClick={() => pick(k)}>{k}</button>
                ))}
            </div>
            {other}
        </>
    );
}
