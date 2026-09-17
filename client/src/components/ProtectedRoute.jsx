import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Pending from '../pages/Pending.jsx';

// ป้องกันหน้าที่ต้องล็อกอินก่อน — ถ้ายังไม่ล็อกอิน เด้งไปหน้า Login
export default function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();
    const loc = useLocation();

    if (loading) {
        return <div className="page-loading">กำลังโหลด...</div>;
    }
    if (!user) {
        // จำลิงก์เดิมไว้ทั้ง query และ hash (เช่นลิงก์ใบขอจัดหาที่ส่งทาง LINE) — ล็อกอินเสร็จจะพากลับมาที่เดิม
        return <Navigate to="/login" state={{ from: loc.pathname + loc.search + loc.hash }} replace />;
    }
    // สมัครแล้วยังไม่อนุมัติ (หรือถูกปฏิเสธ) — เห็นได้แค่หน้ารออนุมัติ
    if ((user.status || 'active') !== 'active') {
        return <Pending />;
    }
    // บัญชีเอเจนซี่ไม่มีอะไรให้ดูใน dashboard — พาไปหน้าลิงก์งานของตัวเอง
    if (user.role === 'agency') {
        const tk = (user.agency_tokens || [])[0];
        return tk ? <Navigate to={`/agency/${tk}`} replace /> : <Pending />;
    }
    return children;
}
