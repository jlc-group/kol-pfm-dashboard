import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Pending from '../pages/Pending.jsx';

// ป้องกันหน้าที่ต้องล็อกอินก่อน — ถ้ายังไม่ล็อกอิน เด้งไปหน้า Login
export default function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();

    if (loading) {
        return <div className="page-loading">กำลังโหลด...</div>;
    }
    if (!user) {
        return <Navigate to="/login" replace />;
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
