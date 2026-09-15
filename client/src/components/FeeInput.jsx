import { useEffect, useRef, useState } from 'react';

// ช่องกรอกค่าตัว KOL "ต่อคลิป" (ฝั่งทีม)
// - ระหว่างพิมพ์เก็บค่าร่างไว้เอง — หน้าแคมเปญโหลดรายชื่อซ้ำทุก 20 วิ จะได้ไม่ทับตัวเลขที่กำลังพิมพ์
// - บันทึกตอนคลิกออกจากช่อง หรือกด Enter · กด Esc = คืนค่าเดิม ไม่บันทึก
// - บันทึกไม่ผ่าน ข้อความ error ค้างไว้ให้เห็นจนกว่าจะเริ่มแก้ใหม่ (ไม่หายเองแบบ toast)
const MAX_FEE = 10000000;

const fmt = v => { const n = Number(v) || 0; return n > 0 ? n.toLocaleString('th-TH') : ''; };

// รับได้ทั้ง "12,000" / "฿12000" / "12000.50" · ช่องว่าง = null (ไม่เปลี่ยน) · อย่างอื่น = NaN
// ช่องว่างไม่นับเป็น 0 — กันลบเผลอแล้วคลิกออกจนค่าตัวหาย ถ้าต้องการ 0 จริงให้พิมพ์ 0
function parseFee(text) {
    const t = String(text == null ? '' : text).replace(/[,\s฿]/g, '');
    if (t === '') return null;
    if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
    return Math.round(Number(t) * 100) / 100;
}

// dirty = คลิปของคนนี้ยังไม่เท่ากัน/มีคลิปที่เป็น 0 → พิมพ์ยอดเดิมก็ต้องบันทึก
// version = ค่าตัวของทุกคลิป (จากหน้าแคมเปญ) ใช้จับว่าระหว่างพิมพ์มีคนแก้ไปแล้วหรือยัง
export default function FeeInput({ value, onSave, missing, disabled = false, dirty = false, version }) {
    const current = Number(value) || 0;
    const [draft, setDraft] = useState(fmt(current));
    const [state, setState] = useState('idle');      // idle | saving | saved | error
    const [msg, setMsg] = useState('');
    const focused = useRef(false);
    const skipCommit = useRef(false);                // กด Esc -> blur แล้วไม่ต้องบันทึก
    const latest = useRef(current);                  // ค่าล่าสุดจากเซิร์ฟเวอร์ (กันใช้ค่าเก่าที่ค้างใน closure)
    const alive = useRef(true);
    const timer = useRef(null);
    latest.current = current;
    const ver = version != null ? String(version) : String(current);
    const latestVer = useRef(ver);
    const baseVer = useRef(null);                    // เวอร์ชันตอนเริ่มแก้ (null = ยังไม่ได้จำ)
    const typed = useRef(false);                     // พิมพ์จริงไหม — แค่คลิกเข้าแล้วออก/กด Tab ต้องไม่บันทึก
    latestVer.current = ver;

    // StrictMode ตอน dev จะจำลองถอดแล้วใส่ใหม่ — ต้องตั้ง alive กลับเป็น true ทุกครั้งที่ mount
    // ไม่งั้นหลังบันทึกเสร็จ ช่องจะคิดว่าถูกถอดไปแล้วและค้าง "กำลังบันทึก..." ตลอด
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; clearTimeout(timer.current); };
    }, []);

    // ค่าจากเซิร์ฟเวอร์เปลี่ยน -> ตามให้ เว้นแต่คนกำลังพิมพ์หรือกำลังบันทึกอยู่
    // ตอนขึ้น error (ยังไม่ได้พิมพ์ต่อ) ก็ตามให้ด้วย ไม่งั้นช่องที่ยังโฟกัสอยู่จะโชว์ค่าเก่า ทั้งที่โหลดค่าล่าสุดมาแล้ว
    useEffect(() => {
        if ((!focused.current || state === 'error') && state !== 'saving') setDraft(fmt(current));
    }, [current, state]);

    function fail(text) {
        setDraft(fmt(latest.current));
        setState('error');
        setMsg(text);
    }

    async function commit() {
        const startVer = baseVer.current;
        baseVer.current = null;
        const edited = typed.current;
        typed.current = false;
        const next = parseFee(draft);
        if (next === null) { setDraft(fmt(latest.current)); return; }
        if (Number.isNaN(next) || next < 0) { fail('กรอกเป็นตัวเลขเท่านั้น'); return; }
        if (next > MAX_FEE) { fail('ค่าตัวต่อคลิปต้องไม่เกิน ฿10,000,000'); return; }
        // ระหว่างพิมพ์มีคนแก้ค่าตัวคนนี้ไปแล้ว (หน้าโหลดค่าใหม่มา) — ไม่บันทึกทับ ให้ดูค่าล่าสุดก่อน
        if (startVer !== null && startVer !== latestVer.current) { fail('มีคนแก้ค่าตัวนี้ไปแล้ว — โหลดค่าล่าสุดให้แล้ว ลองใหม่อีกครั้ง'); return; }
        // ยอดเท่าเดิมไม่ต้องส่ง — ยกเว้นคลิปยังไม่เท่ากัน/มีคลิปที่เป็น 0 (dirty) และผู้ใช้พิมพ์ยอดนั้นเอง จะได้ทำให้ทุกคลิปเท่ากันได้
        // ถ้าแค่คลิกเข้าแล้วออก ช่องเติมยอดคลิปแรกให้เอง ห้ามถือว่าตั้งใจเขียนทับคลิปอื่น
        if (next === latest.current && !(dirty && edited)) { setDraft(fmt(next)); return; }
        setDraft(fmt(next));
        setState('saving'); setMsg('');
        try {
            await onSave(next);
            if (!alive.current) return;
            setState('saved');
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
                if (alive.current) setState(s => (s === 'saved' ? 'idle' : s));
            }, 2500);
        } catch (err) {
            if (!alive.current) return;
            // กดยกเลิกที่หน้าต่างยืนยัน — คืนค่าเดิมเงียบ ๆ ไม่ใช่ error
            if (err && err.cancelled) { setDraft(fmt(latest.current)); setState('idle'); setMsg(''); return; }
            fail((err && err.message) || 'บันทึกค่าตัวไม่สำเร็จ');
        }
    }

    const isMissing = missing != null ? missing : current <= 0;
    const saving = state === 'saving';
    return (
        <span className="fee-input-wrap">
            <span className={'fee-input' + (isMissing && !saving ? ' missing' : '') + (state === 'error' ? ' err' : '')}>
                <span className="fee-input-cur">฿</span>
                <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={draft}
                    placeholder="0"
                    readOnly={saving}
                    disabled={disabled}
                    aria-label="ค่าตัวต่อคลิป (บาท)"
                    title={isMissing
                        ? 'ยังไม่ใส่ค่าตัว — พิมพ์ยอดต่อคลิปแล้วกด Enter'
                        : 'ค่าตัวต่อคลิป — แก้แล้วกด Enter หรือคลิกออกเพื่อบันทึก · Esc = ยกเลิก'}
                    onFocus={e => {
                        focused.current = true;
                        if (saving) return;   // กำลังบันทึก ช่องเป็น readOnly — ไม่รีเซ็ตค่าร่าง (จะจำเวอร์ชันตอนเริ่มพิมพ์แทน)
                        baseVer.current = latestVer.current;
                        typed.current = false;
                        // ตอนแก้ให้เห็นเลขล้วน ไม่มีคอมมา แล้วเลือกทั้งช่องไว้ พิมพ์ทับได้เลย
                        setDraft(latest.current > 0 ? String(latest.current) : '');
                        const el = e.target;
                        setTimeout(() => { try { el.select(); } catch { /* ช่องถูกถอดไปแล้ว */ } }, 0);
                    }}
                    onChange={e => {
                        // โฟกัสตอนกำลังบันทึก หรือหลังขึ้น error ยังไม่ได้จำเวอร์ชัน — จำตอนเริ่มพิมพ์ (ตอนนั้นช่องโชว์ค่าล่าสุดแล้ว)
                        if (baseVer.current === null) baseVer.current = latestVer.current;
                        typed.current = true;
                        setDraft(e.target.value);
                        if (state === 'error') { setState('idle'); setMsg(''); }
                    }}
                    onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                        else if (e.key === 'Escape') { skipCommit.current = true; e.currentTarget.blur(); }
                    }}
                    onBlur={() => {
                        focused.current = false;
                        if (skipCommit.current) {
                            skipCommit.current = false;
                            setDraft(fmt(latest.current));
                            return;
                        }
                        if (!saving) commit();
                    }}
                />
                {saving && <span className="fee-input-st saving" aria-hidden="true">…</span>}
                {state === 'saved' && <span className="fee-input-st ok" title="บันทึกแล้ว">✓</span>}
            </span>
            {saving && <small className="fee-input-msg">กำลังบันทึก...</small>}
            {state === 'error' && msg && <small className="fee-input-msg err" role="alert">{msg}</small>}
        </span>
    );
}
