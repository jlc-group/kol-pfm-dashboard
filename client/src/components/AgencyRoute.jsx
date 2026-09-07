import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

/**
 * หน้า /agency/:token ต้องล็อกอินก่อน
 *  - ยังไม่ล็อกอิน -> ไปหน้าเข้าสู่ระบบ แล้วจำลิงก์เดิมไว้พากลับมา
 *  - บัญชีเอเจนซี่  -> เปิดได้เฉพาะลิงก์ที่ admin ผูกไว้ให้
 *  - ทีม/แอดมิน     -> เปิดดูได้ทุกลิงก์ (ต้องเข้าไปตรวจงาน)
 * ฝั่ง server กันไว้อีกชั้นแล้ว ตรงนี้แค่ทำให้หน้าจอไม่ค้างหรือขึ้น error เปล่า ๆ
 */
export default function AgencyRoute({ children }) {
    const { user, loading } = useAuth();
    const { token } = useParams();
    const loc = useLocation();

    if (loading) return <div className="page-loading">กำลังโหลด...</div>;
    if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;

    if (user.role === 'agency' && !(user.agency_tokens || []).includes(token)) {
        return (
            <div className="login-screen">
                <div className="login-card">
                    <div className="login-icon">🔒</div>
                    <h2>ลิงก์นี้ไม่ใช่งานของคุณ</h2>
                    <p className="login-sub">บัญชีของคุณไม่ได้รับสิทธิ์เปิดลิงก์งานนี้<br />ติดต่อผู้ดูแลระบบหากคิดว่าผิดพลาด</p>
                </div>
            </div>
        );
    }
    return children;
}
