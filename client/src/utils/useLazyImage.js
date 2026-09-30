import { useEffect, useRef, useState } from 'react';
import { fileBlobUrl } from '../api/client.js';

// โหลดรูปที่ต้องแนบ token เป็น blob เฉพาะตอนกล่องรูปเลื่อนมาใกล้จอ (รายการยาวเป็นร้อย ไม่ดึงรูปทั้งหมดตั้งแต่เปิดหน้า)
// กล่องหลุดจากรายการ / path เปลี่ยน → คืนหน่วยความจำของรูปเดิมทันที · <img src> ตรง ๆ ใช้ไม่ได้เพราะไฟล์ต้องแนบ token
// ใช้ร่วมกัน: คอมการ์ด Talent Book (pages/hires/CompCard.jsx) · รูปปกคลิปหน้า Ads (components/PostThumb.jsx)
// คืน [ref ของกล่องรูป, { url, failed }] — path ว่าง = ไม่โหลดอะไร
export default function useLazyImage(path) {
    const box = useRef(null);
    const [got, setGot] = useState({ path: '', url: '', failed: false });
    useEffect(() => {
        if (!path) return undefined;
        let alive = true;
        let made = '';
        let io = null;
        const go = () => fileBlobUrl(path).then(r => {
            // ไม่ใช่รูป (ไฟล์ถูกเปลี่ยนเป็น PDF ระหว่างนั้น) หรือการ์ดหายไปแล้ว → ไม่มีใครใช้ blob นี้ คืนทันที
            if (!alive || !String(r.type || '').startsWith('image/')) {
                URL.revokeObjectURL(r.url);
                if (alive) setGot({ path, url: '', failed: true });
                return;
            }
            made = r.url;
            setGot({ path, url: r.url, failed: false });
        }).catch(() => { if (alive) setGot({ path, url: '', failed: true }); });
        const el = box.current;
        if (el && typeof window.IntersectionObserver === 'function') {
            io = new window.IntersectionObserver(entries => {
                if (!entries.some(e => e.isIntersecting)) return;
                io.disconnect(); io = null;
                go();
            }, { rootMargin: '300px 0px' });
            io.observe(el);
        } else {
            go();
        }
        return () => {
            alive = false;
            if (io) io.disconnect();
            if (made) URL.revokeObjectURL(made);
        };
    }, [path]);
    return [box, got.path === path ? got : { url: '', failed: false }];
}
