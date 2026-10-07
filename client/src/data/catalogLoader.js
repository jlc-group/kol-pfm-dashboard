import { api } from '../api/client.js';
import { applyCatalogOverlay } from './products.js';

// โหลดส่วนต่างของคลังสินค้า/Target จากหน้า Products & Targets (GET /api/catalog · 7 ต.ค. 2026)
// เรียกหลังล็อกอิน (useCatalogReady ใน ProtectedRoute / AgencyRoute) — แยกจาก products.js เพราะไฟล์นั้นต้อง import ใน node ได้ (เทสต์)
// โหลดไม่ได้ (server ยังไม่อัปเดต / เน็ตหลุด) = ใช้รายการตั้งต้นในโค้ดต่อ ไม่ทำให้หน้าเว็บพัง · รอบหน้าเปิดหน้าใหม่ลองอีก
let status = 'idle';   // idle | loading | ok | failed
let inflight = null;

export const catalogStatus = () => status;

export function loadCatalog() {
    if (inflight) return inflight;
    status = 'loading';
    inflight = api('/catalog')
        .then(res => {
            applyCatalogOverlay((res && res.data) || {});
            status = 'ok';
            return true;
        })
        .catch(() => { status = 'failed'; return false; })
        .finally(() => { inflight = null; });
    return inflight;
}

// หน้า Products & Targets บันทึกแล้ว server ตอบส่วนต่างล่าสุดกลับมา — ใช้ทันทีไม่ต้องโหลดซ้ำ
export function setCatalogFromServer(data) {
    applyCatalogOverlay(data || {});
    status = 'ok';
}
