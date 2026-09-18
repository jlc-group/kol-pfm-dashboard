import { useSyncExternalStore } from 'react';

// หน้าไหนอยู่ใต้เมนูไหน ปกติรู้จาก URL — แต่หน้างานจ้างอื่น ๆ ใช้ URL /projects/:id ร่วมกับแคมเปญ KOL
// (ลิงก์เดิมทั้งระบบชี้ที่นี่) เมนูด้านข้างจึงไฮไลต์ "แคมเปญ" ผิด
// หน้าที่รู้ตัวว่าเป็นของเมนูอื่นบอกผ่านตรงนี้ แล้ว Layout ไฮไลต์เมนูให้ถูก
let current = null;
const subs = new Set();

export function setNavSection(section) {
    if (current === section) return;
    current = section;
    subs.forEach(fn => fn());
}

export function useNavSection() {
    return useSyncExternalStore(
        cb => { subs.add(cb); return () => subs.delete(cb); },
        () => current
    );
}
