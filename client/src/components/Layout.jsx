import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Icon from './Icon.jsx';
import { api } from '../api/client.js';
import { ROLE_LABEL } from '../data/brands.js';
import ChangePasswordModal from './ChangePasswordModal.jsx';

const MAIN_NAV = [
    { to: '/', label: 'ภาพรวม', icon: 'dashboard', end: true },
    { to: '/projects', label: 'แคมเปญ', icon: 'folder' },
    { to: '/ads', label: 'โฆษณา', icon: 'target' },
    { to: '/budget', label: 'รายงานแคมเปญ', icon: 'bars' },
    { to: '/kols', label: 'อินฟลูเอนเซอร์', icon: 'star' }
];

const ADMIN_NAV = [
    { to: '/payments', label: 'รอบทำจ่าย', icon: 'wallet' },
    { to: '/activity', label: 'ประวัติการแก้ไข', icon: 'history' },
    { to: '/users', label: 'ผู้ใช้งาน', icon: 'users' }
];

export default function Layout() {
    const { user, logout, isAdmin } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [showPw, setShowPw] = useState(false);
    const [navOpen, setNavOpen] = useState(false);
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

    useEffect(() => {
        setNavOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        document.body.classList.toggle('nav-open', navOpen);
        return () => document.body.classList.remove('nav-open');
    }, [navOpen]);

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
                onClick={() => setNavOpen(false)}
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
            <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหา</a>
            <header className="mobile-topbar">
                <button
                    type="button"
                    className="mobile-menu-btn"
                    aria-label="เปิดเมนูหลัก"
                    aria-expanded={navOpen}
                    aria-controls="primary-sidebar"
                    onClick={() => setNavOpen(true)}
                >
                    <span aria-hidden="true">☰</span>
                </button>
                <div className="mobile-brand">
                    <span className="brand-mark">K</span>
                    <span>KOL Dashboard</span>
                </div>
                <div className="mobile-avatar" aria-label={user?.full_name || user?.username}>
                    {(user?.full_name || user?.username || '?')[0]}
                </div>
            </header>
            <button
                type="button"
                className={'sidebar-backdrop' + (navOpen ? ' show' : '')}
                aria-label="ปิดเมนูหลัก"
                tabIndex={navOpen ? 0 : -1}
                onClick={() => setNavOpen(false)}
            />
            <aside id="primary-sidebar" className={'sidebar' + (navOpen ? ' open' : '')} aria-label="เมนูหลัก">
                <div className="brand">
                    <span className="brand-mark">K</span>
                    <span className="brand-text">KOL Dashboard</span>
                    <button type="button" className="sidebar-close" aria-label="ปิดเมนูหลัก" onClick={() => setNavOpen(false)}>×</button>
                </div>
                <nav className="nav" aria-label="เมนูการทำงาน">
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
                                {ROLE_LABEL[user?.role] || user?.role}
                                {user?.role === 'member' && (user?.brands || []).length > 0
                                    ? ` · ${user.brands.join(', ')}`
                                    : ''}
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
            <main id="main-content" className="content" tabIndex="-1">
                <Outlet />
            </main>
        </div>
    );
}
