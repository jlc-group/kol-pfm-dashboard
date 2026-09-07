import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Login() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(username.trim(), password);
            navigate('/');
        } catch (err) {
            setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="login-screen">
            <div className="login-card">
                <div className="login-icon">👥</div>
                <h2>KOL Dashboard</h2>
                <p className="login-sub">เข้าสู่ระบบเพื่อจัดการ KOL และ Project</p>

                {error && (
                    <div className="login-error">
                        <span>⛔ {error}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="field">
                        <label>Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="กรอก Username"
                            autoComplete="username"
                            required
                        />
                    </div>
                    <div className="field">
                        <label>Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="กรอก Password"
                            autoComplete="current-password"
                            required
                        />
                    </div>
                    <button type="submit" className="btn-login" disabled={loading}>
                        {loading ? 'กำลังเข้าสู่ระบบ...' : '➜ เข้าสู่ระบบ'}
                    </button>
                </form>

                <div className="login-hint">
                    ยังไม่มีบัญชี? <Link to="/register">ขอสิทธิ์เข้าใช้งาน</Link>
                </div>
            </div>
        </div>
    );
}
