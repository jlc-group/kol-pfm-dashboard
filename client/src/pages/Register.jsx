import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';

/**
 * หน้าสมัครใช้งาน — สมัครเองได้ แต่ยังเข้าใช้อะไรไม่ได้จนกว่า admin จะอนุมัติ
 * และเป็นคนกำหนดว่าให้อยู่แบรนด์ไหน / บทบาทอะไร
 */
export default function Register() {
    const [f, setF] = useState({ username: '', full_name: '', password: '', confirm: '' });
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const [saving, setSaving] = useState(false);
    const nav = useNavigate();
    const up = (k, v) => setF(s => ({ ...s, [k]: v }));

    async function submit(e) {
        e.preventDefault();
        setError('');
        if (f.password !== f.confirm) { setError('รหัสผ่านสองช่องไม่ตรงกัน'); return; }
        if (f.password.length < 8) { setError('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'); return; }
        setSaving(true);
        try {
            await api('/auth/register', {
                method: 'POST',
                body: {
                    username: f.username.trim(), password: f.password,
                    full_name: f.full_name.trim() || null
                }
            });
            setDone(true);
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    }

    if (done) {
        return (
            <div className="login-screen">
                <div className="login-card">
                    <div className="login-icon">✓</div>
                    <h2>ส่งคำขอแล้ว</h2>
                    <p className="login-sub">
                        รอผู้ดูแลระบบอนุมัติและกำหนดแบรนด์ที่คุณดูแล<br />
                        อนุมัติแล้วเข้าใช้งานได้ด้วยชื่อผู้ใช้และรหัสผ่านที่สมัครไว้
                    </p>
                    <button className="btn-login" onClick={() => nav('/login')}>ไปหน้าเข้าสู่ระบบ</button>
                </div>
            </div>
        );
    }

    return (
        <div className="login-screen">
            <div className="login-card">
                <div className="login-icon">👥</div>
                <h2>ขอสิทธิ์เข้าใช้งาน</h2>
                <p className="login-sub">สมัครไว้ก่อน แล้วผู้ดูแลระบบจะอนุมัติและกำหนดแบรนด์ให้</p>
                {error && <div className="login-error">{error}</div>}
                <form onSubmit={submit}>
                    <div className="field">
                        <label>ชื่อผู้ใช้ * <span className="dash-section-sub">ใช้เข้าสู่ระบบ และเป็นชื่อที่แสดงในระบบ</span></label>
                        <input value={f.username} onChange={e => up('username', e.target.value)}
                            placeholder="เช่น ชื่อเล่นของคุณ" required autoFocus autoComplete="username" />
                    </div>
                    <div className="field">
                        <label>ชื่อ-นามสกุล</label>
                        <input value={f.full_name} onChange={e => up('full_name', e.target.value)} placeholder="ไม่บังคับ" />
                    </div>
                    <div className="field">
                        <label>รหัสผ่าน * <span className="dash-section-sub">อย่างน้อย 8 ตัวอักษร</span></label>
                        <input type="password" value={f.password} onChange={e => up('password', e.target.value)}
                            required autoComplete="new-password" />
                    </div>
                    <div className="field">
                        <label>ยืนยันรหัสผ่าน *</label>
                        <input type="password" value={f.confirm} onChange={e => up('confirm', e.target.value)}
                            required autoComplete="new-password" />
                    </div>
                    <button type="submit" className="btn-login" disabled={saving}>
                        {saving ? 'กำลังส่ง...' : 'ส่งคำขอ'}
                    </button>
                </form>
                <p className="login-hint">มีบัญชีอยู่แล้ว? <Link to="/login">เข้าสู่ระบบ</Link></p>
            </div>
        </div>
    );
}
