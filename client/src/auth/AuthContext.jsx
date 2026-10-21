import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { api, getToken, setToken } from '../api/client.js';

const AuthContext = createContext(null);

// รอแล้วลองใหม่เมื่อเซิร์ฟเวอร์ยังตอบไม่ได้ — deploy แต่ละครั้งเว็บล่มราว 15 วินาทีตอนรีสตาร์ท
const RETRY_WAITS = [1000, 2000, 3000, 5000, 8000];
// เพดานเวลารวมของการลองใหม่ (รวมเวลาที่แต่ละคำขอค้าง) — เกินนี้ให้ผู้ใช้กด "ลองใหม่" เอง ไม่หมุนค้างนาน
const RETRY_BUDGET_MS = 22000;
// คำขอหนึ่งรอได้ไม่เกินนี้ (ตอนฐานข้อมูลไม่ตอบ เซิร์ฟเวอร์อาจค้างถึง 10 วินาทีกว่าจะตอบ 500)
const REQUEST_TIMEOUT_MS = 6000;
const timeoutSignal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState('');
    const [connecting, setConnecting] = useState(false);   // ลองรอบแรกไม่ผ่าน กำลังลองใหม่
    const [attempt, setAttempt] = useState(0);
    // รุ่นของสถานะล็อกอิน — ล็อกอิน/ออกจากระบบแล้ว ผลของการลองใหม่รอบเก่าที่ตอบช้าต้องไม่มาเขียนทับ
    const gen = useRef(0);

    // ตอนเปิดแอป: ถ้ามี token อยู่แล้ว ลองดึงข้อมูลผู้ใช้ปัจจุบัน
    // ล้าง token เฉพาะตอนเซิร์ฟเวอร์ปฏิเสธจริง (401/403) — ถ้าเน็ตหลุดหรือเซิร์ฟเวอร์กำลังรีสตาร์ท (5xx)
    // ต้องไม่เตะผู้ใช้ออก: เก็บ token ไว้ ลองใหม่เป็นระยะ ถ้ายังไม่ได้ก็ให้กด "ลองใหม่" เอง
    useEffect(() => {
        let alive = true;
        const my = gen.current;
        const live = () => alive && gen.current === my;
        async function loadUser() {
            const token = getToken();
            if (!token) { setLoading(false); return; }
            const started = Date.now();
            for (let i = 0; ; i++) {
                try {
                    const res = await api('/auth/me', { signal: timeoutSignal() });
                    if (live()) { setUser(res.user); setAuthError(''); }
                    break;
                } catch (e) {
                    if (!live()) return;
                    if (e && (e.status === 401 || e.status === 403)) {
                        // token หมดอายุ/ไม่ถูกต้อง — ลบเฉพาะถ้ายังเป็นตัวเดิม (ไม่ลบ token ใหม่ที่เพิ่งล็อกอินได้)
                        if (getToken() === token) setToken(null);
                        break;
                    }
                    const wait = RETRY_WAITS[i];
                    if (wait === undefined || Date.now() - started + wait > RETRY_BUDGET_MS) {
                        setAuthError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ในตอนนี้ — ระบบอาจกำลังอัปเดต ลองใหม่อีกครั้งในอีกสักครู่');
                        break;
                    }
                    setConnecting(true);
                    await new Promise(r => setTimeout(r, wait));
                    if (!live()) return;
                }
            }
            if (live()) { setConnecting(false); setLoading(false); }
        }
        loadUser();
        return () => { alive = false; };
    }, [attempt]);

    // สิทธิ์ (role / แบรนด์ที่ดูได้) อัปเดตเองเมื่อกลับมาที่แท็บ — admin เพิ่งกำหนดแบรนด์ให้ Manager / Member
    // ตัวเลือกแบรนด์ในหน้าเว็บจะตรงกับ server โดยไม่ต้องรีเฟรชเอง (21 ต.ค. 2026 · server อ่านสิทธิ์สดทุกคำขออยู่แล้ว)
    // เงียบ ๆ ไม่ถี่กว่า 30 วินาที · พลาด (เน็ตหลุด / server รีสตาร์ต / 401) ไม่ทำอะไร — คำขอถัดไปจัดการตามเดิม · เหมือนเดิม = ไม่ render ใหม่
    const uid = user ? user.id : null;
    useEffect(() => {
        if (uid == null) return undefined;
        const my = gen.current;
        let last = Date.now();
        const refresh = () => {
            if (document.visibilityState === 'hidden' || Date.now() - last < 30000) return;
            last = Date.now();
            api('/auth/me', { signal: timeoutSignal() })
                .then(res => {
                    if (gen.current !== my || !res || !res.user || res.user.id !== uid) return;
                    setUser(prev => (JSON.stringify(prev) === JSON.stringify(res.user) ? prev : res.user));
                })
                .catch(() => {});
        };
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
    }, [uid]);

    function retry() {
        setAuthError('');
        setLoading(true);
        setAttempt(a => a + 1);
    }

    async function login(username, password) {
        const res = await api('/auth/login', { method: 'POST', body: { username, password } });
        gen.current += 1;   // ตัดการลองใหม่รอบเก่าที่อาจยังค้างอยู่
        setToken(res.token);
        setUser(res.user);
        setAuthError('');
        setConnecting(false);
        setLoading(false);
        return res.user;
    }

    function logout() {
        gen.current += 1;
        setToken(null);
        setUser(null);
        setAuthError('');
        setConnecting(false);
        setLoading(false);
    }

    return (
        <AuthContext.Provider value={{ user, loading, connecting, authError, retry, login, logout, isAdmin: user?.role === 'admin' }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
