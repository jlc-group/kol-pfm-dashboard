import { lazy } from 'react';

// โหลดหน้าแบบแยกไฟล์ (หน้าแรกเปิดเร็วขึ้น ไม่ต้องโหลดโค้ดทุกหน้าตั้งแต่ต้น)
// โหลดไฟล์ของหน้าไม่ได้มี 2 สาเหตุ:
//  1) เซิร์ฟเวอร์กำลังรีสตาร์ทตอน deploy (ล่มราว 15 วินาที) → รอจนกลับมา แล้วลองโหลดใหม่
//  2) deploy เสร็จแล้วไฟล์ชุดเก่าถูกลบ (แท็บที่เปิดค้างไว้ถือชื่อไฟล์เก่า) → โหลดทั้งหน้าใหม่หนึ่งครั้งเพื่อรับไฟล์ชุดใหม่
// ถ้ายังไม่ได้ ให้ PageErrorBoundary แสดงข้อความพร้อมปุ่มโหลดใหม่ (ไม่ปล่อยจอขาว)
const KEY = 'kol:chunk-reload-at';
const WAITS = [1000, 2000, 3000, 5000, 8000];
const BUDGET_MS = 25000;

async function serverIsUp() {
    try {
        const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined;
        const r = await fetch('/api/health', { cache: 'no-store', signal });
        return r.ok;
    } catch { return false; }
}

async function waitForServer() {
    const started = Date.now();
    for (let i = 0; ; i++) {
        if (await serverIsUp()) return true;
        const w = WAITS[i];
        if (w === undefined || Date.now() - started + w > BUDGET_MS) return false;
        await new Promise(r => setTimeout(r, w));
    }
}

function mayReload() {
    let last = 0;
    try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* เก็บค่าไม่ได้ก็ถือว่ายังไม่เคยรีโหลด */ }
    if (Date.now() - last <= 20000) return false;   // เพิ่งรีโหลดไป — กันวนรีโหลดไม่รู้จบ
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* ข้าม */ }
    return true;
}

export default function lazyPage(load) {
    const Page = lazy(() => load().catch(async err => {
        const up = await waitForServer();
        if (up) {
            // ล่มชั่วคราวแล้วกลับมา → ลองโหลดไฟล์เดิมอีกครั้ง (บางเบราว์เซอร์จำผลที่ล้มไว้ จึงมีขั้นถัดไปรองรับ)
            try { return await load(); } catch { /* ไปขั้นรีโหลดทั้งหน้า */ }
            if (mayReload()) {
                window.location.reload();
                return new Promise(() => {});   // รอหน้าโหลดใหม่ ไม่ต้องแสดง error
            }
        }
        throw err;
    }));
    // โหลดล่วงหน้าเงียบ ๆ ตอนเครื่องว่าง — เปลี่ยนหน้าครั้งแรกจะได้ไม่ค้างหน้าเดิมรอไฟล์
    // (ล้มก็เงียบไว้ ปล่อยให้ตอนเปิดหน้าจริงเป็นคนจัดการ)
    Page.preload = () => load().catch(() => {});
    return Page;
}
