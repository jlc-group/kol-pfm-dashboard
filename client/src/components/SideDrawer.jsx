import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

// ลิ้นชักขวา — เปิดทับหน้าเดิม ปิดแล้วกลับที่เดิม (ใช้กับใบขอให้หา และฟอร์มสั้นของหน้า Talent)
// • วาดที่ document.body (portal) — กรอบของหน้าที่มี transform/overflow จะไม่ตัดลิ้นชัก
// • ตัวลิ้นชักห้ามค้าง transform/filter หลังเปิดเสร็จ: ของข้างใน (ป๊อปอัปแก้ใบ / ยืนยันลบ / ปฏิทิน) ใช้ position:fixed
//   ถ้ามี transform ค้างอยู่ ของพวกนั้นจะถูกขังอยู่ในกรอบลิ้นชักแทนที่จะเต็มจอ — แอนิเมชันจึงไม่ใช้ fill-mode
// • Esc ปิดได้ ยกเว้นตอนมีป๊อปอัปหรือปฏิทินซ้อนอยู่ข้างใน (ให้ตัวนั้นปิดก่อน) หรือกำลังบันทึก
// • มือถือ (≤600px) เต็มจอ
export default function SideDrawer({ title, subtitle, onClose, children, footer, width = 640, busy = false, className = '' }) {
    const panel = useRef(null);
    const titleId = useId();
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const busyRef = useRef(busy);
    busyRef.current = busy;

    useEffect(() => {
        const onKey = e => {
            if (e.key !== 'Escape' || busyRef.current) return;
            const el = panel.current;
            // มีของซ้อนอยู่ข้างใน → ให้ของนั้นจัดการ Esc เอง
            if (el && el.querySelector('.modal-backdrop, .dp-pop')) return;
            // ลิ้นชักที่เปิดทีหลัง (อยู่บนสุด) เท่านั้นที่ปิด
            const all = document.querySelectorAll('.side-drawer');
            if (all.length && all[all.length - 1] !== el?.parentElement) return;
            closeRef.current && closeRef.current();
        };
        // capture: ทำงานก่อนตัวปฏิทิน (มันปิดตัวเองใน listener ของ document) — ตอนเช็คยังเห็น .dp-pop อยู่
        // ถ้าฟังแบบปกติ Esc ที่กดเพื่อปิดปฏิทินจะปิดทั้งลิ้นชักไปด้วย (ค่าที่พิมพ์ไว้หาย)
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, []);

    // ล็อกการเลื่อนหน้าข้างหลัง (นับซ้อนได้ — ลิ้นชักสองชั้นปิดชั้นบนแล้วหน้ายังล็อกอยู่)
    useEffect(() => {
        const b = document.body;
        const n = Number(b.dataset.drawerLock || 0);
        if (n === 0) b.dataset.drawerPrevOverflow = b.style.overflow || '';
        b.dataset.drawerLock = String(n + 1);
        b.style.overflow = 'hidden';
        panel.current && panel.current.focus({ preventScroll: true });
        return () => {
            const left = Math.max(0, Number(b.dataset.drawerLock || 1) - 1);
            b.dataset.drawerLock = String(left);
            if (left === 0) { b.style.overflow = b.dataset.drawerPrevOverflow || ''; delete b.dataset.drawerPrevOverflow; }
        };
    }, []);

    // กดพื้นหลังเพื่อปิด — เช็คทั้งตอนกดและตอนปล่อย กันลากเลือกข้อความจากในลิ้นชักแล้วไปปล่อยข้างนอกแล้วลิ้นชักปิด
    const downOnBackdrop = useRef(false);
    const node = (
        <div className={'side-drawer ' + className}
            onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget; }}
            onClick={e => { if (e.target === e.currentTarget && downOnBackdrop.current && !busy) onClose && onClose(); }}>
            <div className="side-drawer-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
                tabIndex={-1} style={{ '--drawer-w': typeof width === 'number' ? width + 'px' : width }}>
                <div className="side-drawer-head">
                    <div className="side-drawer-titles">
                        <h2 id={titleId}>{title}</h2>
                        {subtitle && <div className="side-drawer-sub">{subtitle}</div>}
                    </div>
                    <button type="button" className="side-drawer-x" onClick={() => !busy && onClose && onClose()}
                        disabled={busy} aria-label="ปิด" title="ปิด (Esc)">×</button>
                </div>
                <div className="side-drawer-body">{children}</div>
                {footer && <div className="side-drawer-foot">{footer}</div>}
            </div>
        </div>
    );
    return createPortal(node, document.body);
}
