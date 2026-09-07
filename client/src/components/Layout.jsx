import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Icon from './Icon.jsx';
import { api } from '../api/client.js';
import ChangePasswordModal from './ChangePasswordModal.jsx';

const MAIN_NAV = [
    { to: '/', label: 'ภาพรวม', icon: 'dashboard', end: true },
    { to: '/projects', label: 'Projects', icon: 'folder' },
    { to: '/ads', label: 'ADS', icon: 'target' },
    { to: '/budget', label: 'Report Campaign', icon: 'bars' },
    { to: '/kols', label: 'Influencer', icon: 'star' }
];

const ADMIN_NAV = [
    { to: '/payments', label: 'รอบทำจ่าย', icon: 'wallet' },
    { to: '/activity', label: 'ประวัติการแก้ไข', icon: 'history' },
    { to: '/users', label: 'ผู้ใช้งาน', icon: 'users' },
    { to: '/teams', label: 'ทีม', icon: 'team' }
];

export default function Layout() {
    const { user, logout, isAdmin } = useAuth();
    const navigate = useNavigate();
    const [showPw, setShowPw] = useState(false);
    // จำนวนคนที่สมัครแล้วรออนุมัติ — ไม่มีอีเมลแจ้ง admin ต้องเห็นจากตัวเลขบนเมนู
    const [pendingCount, setPendingCount] = useState(0);
    useEffect(() => {
        if (user?.role !== 'admin') return;
        let alive = true;
        const load = () => api('/users/pending-count')
            .then(r => { if (alive) setPendingCount(r.data?.count || 0); })
            .catch(() => {});
        load();
        const t = setInterval(load, 60000);
        // อนุมัติ/ปฏิเสธเสร็จ หน้าผู้ใช้งานจะยิง event นี้มา ตัวเลขจะได้เปลี่ยนทันที
        window.addEventListener('kol:users-changed', load);
        return () => { alive = false; clearInterval(t); window.removeEventListener('kol:users-changed', load); };
    }, [user]);

    function handleLogout() {
        logout();
        navigate('/login');
    }

    function renderItem(item) {
        return (
            <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
                <Icon name={item.icon} size={19} />
                {item.label}
                {item.to === '/users' && pendingCount > 0 && (
                    <span className="nav-badge" title={`มี ${pendingCount} คนรออนุมัติ`}>{pendingCount}</span>
                )}
            </NavLink>
        );
    }

    return (
        <div className="layout">
            <aside className="sidebar">
                <div className="brand">
                    <span className="brand-mark">K</span>
                    <span className="brand-text">KOL Dashboard</span>
                </div>
                <nav className="nav">
                    {MAIN_NAV.map(renderItem)}
                    {isAdmin && (
                        <>
                            <div className="nav-group-label">ผู้ดูแลระบบ</div>
                            {ADMIN_NAV.map(renderItem)}
                        </>
                    )}
                </nav>
                <div className="sidebar-footer">
                    <div className="user-box">
                        <div className="user-avatar">{(user?.full_name || user?.username || '?')[0]}</div>
                        <div className="user-meta">
                            <div className="user-name">{user?.full_name || user?.username}</div>
                            <div className="user-role">
                                {user?.role === 'admin' ? 'ผู้ดูแลระบบ' : 'สมาชิกทีม'}
                                {user?.team_name ? ` · ${user.team_name}` : ''}
                            </div>
                        </div>
                    </div>
                    <button className="btn-changepw" onClick={() => setShowPw(true)}>
                        <Icon name="edit" size={15} /> เปลี่ยนรหัสผ่าน
                    </button>
                    <button className="btn-logout" onClick={handleLogout}>
                        <Icon name="logout" size={17} /> ออกจากระบบ
                    </button>
                </div>
            </aside>
            {showPw && <ChangePasswordModal onClose={() => setShowPw(false)} />}
            <main className="content">
                <Outlet />
            </main>
        </div>
    );
}
