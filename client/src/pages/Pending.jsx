import { useAuth } from '../auth/AuthContext.jsx';

/**
 * หน้าที่คนสมัครแล้วแต่ยังไม่ได้รับอนุมัติจะเห็น — ไม่มีข้อมูลใด ๆ ให้ดู
 * (ฝั่ง server ก็กันไว้อีกชั้น ต่อให้ยิง API ตรงก็ได้ 403)
 */
export default function Pending() {
    const { user, logout } = useAuth();
    const rejected = user?.status === 'rejected';
    return (
        <div className="login-screen">
            <div className="login-card">
                <div className="login-icon">{rejected ? '✕' : '⏳'}</div>
                <h2>{rejected ? 'คำขอไม่ผ่าน' : 'รออนุมัติ'}</h2>
                <p className="login-sub">
                    {rejected ? (
                        <>คำขอเข้าใช้งานของคุณไม่ได้รับอนุมัติ<br />ติดต่อผู้ดูแลระบบหากคิดว่าผิดพลาด</>
                    ) : (
                        <>บัญชี <b>{user?.nickname || user?.username}</b> ส่งคำขอแล้ว<br />
                            รอผู้ดูแลระบบอนุมัติและกำหนดแบรนด์ที่คุณดูแล</>
                    )}
                </p>
                <button className="btn-login ghost" onClick={logout}>ออกจากระบบ</button>
            </div>
        </div>
    );
}
