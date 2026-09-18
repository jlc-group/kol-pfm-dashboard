// ตัวกลางเรียก API ทั้งหมด — แนบ JWT token ให้อัตโนมัติ
const TOKEN_KEY = 'kolv2_token';

export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
}

// เรียก API — คืน data ที่ parse แล้ว หรือ throw error พร้อมข้อความไทย
// signal (ไม่บังคับ) ใช้ตั้งเวลาหมดของคำขอ — เช่นตอนเช็คการล็อกอินตอนเปิดแอป ไม่ให้ค้างรอนาน
export async function api(path, { method = 'GET', body, signal } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal
    });

    let json = null;
    try { json = await res.json(); } catch { /* บาง response ไม่มี body */ }

    if (!res.ok) {
        const message = (json && json.message) || `เกิดข้อผิดพลาด (${res.status})`;
        const err = new Error(message);
        err.status = res.status;
        throw err;
    }
    return json;
}

// อัปโหลดไฟล์ (multipart) — แนบ token ให้อัตโนมัติ
export async function uploadFile(path, file) {
    const fd = new FormData();
    fd.append('file', file);
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api${path}`, { method: 'POST', headers, body: fd });
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    if (!res.ok) throw new Error((json && json.message) || `อัปโหลดไม่สำเร็จ (${res.status})`);
    return json;
}

// โหลดไฟล์ที่ต้องใช้ token มาเป็น blob URL ไว้แสดงในหน้าเว็บเอง
// (เปิดแท็บใหม่แบบ openFile ด้านล่างมักโดนเบราว์เซอร์บล็อก เพราะ window.open ถูกเรียกหลัง await ไม่นับเป็นการกดของผู้ใช้)
export async function fileBlobUrl(path) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`/api${path}`, { headers });
    if (!res.ok) {
        let msg = 'เปิดไฟล์ไม่สำเร็จ';
        try { const j = await res.json(); if (j && j.message) msg = j.message; } catch { /* ไฟล์ไม่ใช่ JSON */ }
        throw new Error(msg);
    }
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), type: blob.type };
}

// เปิดไฟล์ที่ต้องใช้ token (โหลดเป็น blob แล้วเปิดแท็บใหม่)
export async function openFile(path) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`/api${path}`, { headers });
    if (!res.ok) throw new Error('เปิดไฟล์ไม่สำเร็จ');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
