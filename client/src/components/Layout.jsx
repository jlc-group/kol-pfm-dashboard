import { useState, useEffect, Suspense } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Icon from './Icon.jsx';
import { api } from '../api/client.js';
import { ROLE_LABEL } from '../data/brands.js';
import ChangePasswordModal from './ChangePasswordModal.jsx';
import { useNavSection } from '../utils/navSection.js';
import PageErrorBoundary from './PageErrorBoundary.jsx';
import { preloadPages } from '../pages/lazyPages.js';

const MAIN_NAV = [
    { to: '/', label: 'ภาพรวม', icon: 'dashboard', end: true },
    { to: '/projects', label: 'แคมเปญ', icon: 'folder' },
    { to: '/ads', label: 'โฆษณา', icon: 'target' },
    { to: '/budget', label: 'รายงานแคมเปญ', icon: 'bars' },
    { to: '/kols', label: 'อินฟลูเอนเซอร์', icon: 'star' },
    // รวมงานจัดหาไว้ในเมนูนี้แล้ว (แท็บใบขอจัดหา) — /hire-tasks เดิมพามาที่แท็บนั้นให้
    { to: '/hires', label: 'งานจ้างอื่น ๆ', icon: 'team' }
];

const ADMIN_NAV = [
    { to: '/payments', label: 'รอบทำจ่าย', icon: 'wallet' },
    { to: '/activity', label: 'ประวัติการแก้ไข', icon: 'history' },
    { to: '/users', label: 'ผู้ใช้งาน', icon: 'users' }
];

export default function Layout() {
    const { user, logout, isAdmin } = useAuth();
    // หน้างานจ้างอื่น ๆ ใช้ URL /projects/:id ร่วมกับแคมเปญ KOL — หน้านั้นบอกมาเองว่าเป็นของเมนูไหน
    const navSection = useNavSection();
    // โหลดไฟล์ของหน้าอื่น ๆ ล่วงหน้าตอนเครื่องว่าง — เปลี่ยนหน้าครั้งแรกบนมือถือจะได้ไม่ค้างหน้าเดิม
    useEffect(() => {
        if (!user) return undefined;
        const run = () => preloadPages(isAdmin);
        if (typeof window.requestIdleCallback === 'function') {
            const id = window.requestIdleCallback(run, { timeout: 5000 });
            return () => window.cancelIdleCallback && window.cancelIdleCallback(id);
        }
        const t = setTimeout(run, 2500);
        return () => clearTimeout(t);
    }, [user, isAdmin]);
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

    // ใบขอจัดหาที่ถึงตาเรา (ต้องหาคน / ต้องอนุมัติชื่อ / ต้องมอบหมายคนหา) — ระบบไม่มีอีเมลแจ้ง ต้องเห็นจากตัวเลขบนเมนู
    const [taskCount, setTaskCount] = useState(0);
    const [taskTip, setTaskTip] = useState('');
    useEffect(() => {
        if (!user || user.role === 'agency') return;
        let alive = true;
        const load = () => api('/hires/tasks/count')
            .then(r => {
                if (!alive) return;
                const c = r.data || {};
                setTaskCount(c.total || 0);
                setTaskTip([
                    c.to_find ? `หาคน ${c.to_find}` : '',
                    c.to_decide ? `อนุมัติชื่อ ${c.to_decide}` : '',
                    c.to_assign ? `มอบหมายคนหา ${c.to_assign}` : '',
                    c.to_confirm ? `คอนเฟิร์มคิว ${c.to_confirm}` : '',
                    c.to_fee ? `อนุมัติค่าตัวใหม่ ${c.to_fee}` : ''
                ].filter(Boolean).join(' · '));
            })
            .catch(() => {});
        load();
        const t = setInterval(load, 60000);
        // เสนอ/เลือกชื่อเสร็จ หน้างานจัดหาจะยิง event นี้มา ตัวเลขจะได้เปลี่ยนทันทีไม่ต้องรอครบนาที
        window.addEventListener('kol:hire-tasks-changed', load);
        return () => { alive = false; clearInterval(t); window.removeEventListener('kol:hire-tasks-changed', load); };
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
                className={({ isActive }) => {
                    const on = item.to === '/projects' ? (isActive && navSection !== 'hires')
                        : item.to === '/hires' ? (isActive || navSection === 'hires')
                            : isActive;
                    return 'nav-item' + (on ? ' active' : '');
                }}
            >
                <Icon name={item.icon} size={19} />
                {item.label}
                {item.to === '/users' && pendingCount > 0 && (
                    <span className="nav-badge" title={`มี ${pendingCount} คนรออนุมัติ`}>{pendingCount}</span>
                )}
                {item.to === '/hires' && taskCount > 0 && (
                    <span className="nav-badge" title={`ใบขอจัดหาที่ถึงตาคุณ ${taskCount} ใบ${taskTip ? ` (${taskTip})` : ''}`}>{taskCount}</span>
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
                {/* หน้าต่าง ๆ แยกไฟล์ — ระหว่างโหลดหน้าที่เปิดครั้งแรก เมนูด้านข้างยังอยู่ */}
                {/* หน้าไหนพัง (เช่นโหลดไฟล์ไม่ได้) ขึ้นข้อความพร้อมปุ่มโหลดใหม่ เมนูยังอยู่ · เปลี่ยนเมนูแล้วเริ่มใหม่ */}
                <PageErrorBoundary key={location.pathname}>
                    <Suspense fallback={<div className="page-loading-inline">กำลังโหลด...</div>}>
                        <Outlet />
                    </Suspense>
                </PageErrorBoundary>
            </main>
        </div>
    );
}
