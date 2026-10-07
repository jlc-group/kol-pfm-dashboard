import { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribeCatalog, getCatalogVersion } from './products.js';
import { loadCatalog, catalogStatus } from './catalogLoader.js';

// เลขรุ่นของคลังสินค้า — เปลี่ยนทุกครั้งที่ส่วนต่างจากหน้า Products & Targets เปลี่ยน (ใส่ใน deps ของ useMemo / ให้หน้า render ใหม่)
export function useCatalogVersion() {
    return useSyncExternalStore(subscribeCatalog, getCatalogVersion, getCatalogVersion);
}

// รอคลังโหลดก่อนเปิดหน้า (ฟอร์มแคมเปญคิด Target ของแคมเปญเก่าครั้งเดียวตอนเปิด) — enabled = ล็อกอินแล้ว
// เร็วสุด: โหลดเสร็จ · ช้าสุด: TIMEOUT แล้วเปิดด้วยรายการตั้งต้นไปก่อน (ไม่ให้หน้าค้างเพราะคลัง)
const TIMEOUT_MS = 4000;
export function useCatalogReady(enabled) {
    const [ready, setReady] = useState(() => catalogStatus() === 'ok');
    useEffect(() => {
        if (!enabled || ready) return undefined;
        let alive = true;
        const done = () => { if (alive) setReady(true); };
        const timer = setTimeout(done, TIMEOUT_MS);
        loadCatalog().finally(() => { clearTimeout(timer); done(); });
        return () => { alive = false; clearTimeout(timer); };
    }, [enabled, ready]);
    return ready || !enabled;
}
