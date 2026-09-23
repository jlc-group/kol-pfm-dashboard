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

// เมนูด้านซ้ายเป็นภาษาอังกฤษตามที่ทีมขอ (เนื้อหาในแต่ละหน้ายังเป็นภาษาไทย)
const MAIN_NAV = [
    { to: '/', label: 'Overview', icon: 'dashboard', end: true },
    { to: '/projects', label: 'Campaigns', icon: 'folder' },
    { to: '/ads', label: 'Ads', icon: 'target' },
    { to: '/budget', label: 'Campaign Reports', icon: 'bars' },
    { to: '/kols', label: 'Influencers', icon: 'star' },
    // Talent (เดิม "งานจ้างอื่น ๆ") = นางแบบ / นักแสดง / Live / พิธีกร — รวมงานจัดหาไว้แล้ว (แท็บใบขอจัดหา) /hire-tasks เดิมพามาที่แท็บนั้น
    { to: '/hires', label: 'Talent', icon: 'team' }
];

const ADMIN_NAV = [
    { to: '/payments', label: 'Payouts', icon: 'wallet' },
    { to: '/activity', label: 'Activity Log', icon: 'history' },
    { to: '/users', label: 'Users', icon: 'users' }
];

// พับเมนูซ้ายให้เหลือแถบไอคอน — หน้าเนื้อหา (เช่นตารางหน้า Ads) จะได้กว้างขึ้น
// จำค่าไว้ให้เปิดมาเหมือนเดิม · ที่เก็บข้อมูลอาจถูกปิด (โหมดส่วนตัว) ต้องกัน error เหมือน talent.startUses
const RAIL_KEY = 'ui.navRail';
const readRail = () => {
    try { return window.localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; }
};

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
    // โหมดแถบไอคอน — มีผลเฉพาะจอกว้าง (CSS คุมไว้ใน @media min-width 901px) จอแคบยังเป็นลิ้นชักเหมือนเดิม
    const [rail, setRail] = useState(readRail);
    function toggleRail() {
        setRail(v => {
            const next = !v;
            try { window.localStorage.setItem(RAIL_KEY, next ? '1' : '0'); } catch { /* ที่เก็บข้อมูลถูกปิด — ไม่เป็นไร */ }
            return next;
        });
    }
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
                    c.to_decide ? `เลือกชื่อ ${c.to_decide}` : '',
                    c.to_assign ? `เลือกคนช่วยหา ${c.to_assign}` : '',
                    c.to_confirm ? `ยืนยันคิว ${c.to_confirm}` : '',
                    c.to_fee ? `ตัดสินค่าตัวใหม่ ${c.to_fee}` : ''
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

    // เลขแดงของเมนู — ตอนพับต้องเอาไปต่อท้ายชื่อใน aria-label ด้วย (เห็นด้วยตา แต่โปรแกรมอ่านหน้าจอไม่เห็นถ้าไม่ใส่)
    const navCount = to => (to === '/users' ? pendingCount : to === '/hires' ? taskCount : 0);

    function renderItem(item) {
        return (
            <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setNavOpen(false)}
                // พับอยู่จะเห็นแค่ไอคอน — ต้องบอกชื่อเมนูให้ทั้งเมาส์ (title) และโปรแกรมอ่านหน้าจอ (aria-label)
                // พับอยู่ = เห็นแค่ไอคอน ชื่อเมนูจึงต้องอยู่ใน aria-label · เลขแดงต้องไปกับชื่อด้วย ไม่งั้นคนใช้โปรแกรมอ่านหน้าจอไม่รู้ว่ามีของค้าง
                title={rail ? item.label : undefined}
                aria-label={rail ? item.label + (navCount(item.to) ? ` (${navCount(item.to)})` : '') : undefined}
                className={({ isActive }) => {
                    const on = item.to === '/projects' ? (isActive && navSection !== 'hires')
                        : item.to === '/hires' ? (isActive || navSection === 'hires')
                            : isActive;
                    return 'nav-item' + (on ? ' active' : '');
                }}
            >
                <Icon name={item.icon} size={19} />
                <span className="nav-label">{item.label}</span>
                {item.to === '/users' && pendingCount > 0 && (
                    <span className="nav-badge" title={`มี ${pendingCount} คนรออนุมัติ`}>{pendingCount}</span>
                )}
                {item.to === '/hires' && taskCount > 0 && (
                    <span className="nav-badge" title={`ใบขอให้หาที่ถึงตาคุณ ${taskCount} ใบ${taskTip ? ` (${taskTip})` : ''}`}>{taskCount}</span>
                )}
            </NavLink>
        );
    }

    return (
        <div className={'layout' + (rail ? ' nav-rail' : '')}>
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
                    {/* ปุ่มพับ/กางเมนู — โผล่เฉพาะจอกว้าง (จอแคบซ่อนด้วย CSS เพราะใช้ลิ้นชักแทน) */}
                    <button
                        type="button"
                        className="sidebar-rail-btn"
                        aria-label={rail ? 'กางเมนูหลัก' : 'พับเมนูหลักให้เหลือไอคอน'}
                        title={rail ? 'กางเมนู' : 'พับเมนู'}
                        aria-expanded={!rail}
                        aria-controls="primary-sidebar"
                        onClick={toggleRail}
                    >
                        <Icon name="chevron" size={18} />
                    </button>
                    <button type="button" className="sidebar-close" aria-label="ปิดเมนูหลัก" onClick={() => setNavOpen(false)}>×</button>
                </div>
                <nav className="nav" aria-label="เมนูการทำงาน">
                    {MAIN_NAV.map(renderItem)}
                    {isAdmin && (
                        <>
                            <div className="nav-group-label">Admin</div>
                            {ADMIN_NAV.map(renderItem)}
                        </>
                    )}
                </nav>
                <div className="sidebar-footer">
                    <div className="user-box">
                        {/* พับอยู่เหลือแค่วงกลมย่อ — ชี้เมาส์ค้างถึงจะเห็นชื่อ */}
                        <div className="user-avatar" title={rail ? (user?.full_name || user?.username || '') : undefined}>
                            {(user?.full_name || user?.username || '?')[0]}
                        </div>
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
                    {/* พับอยู่เหลือไอคอน — ข้อความอยู่ใน title/aria-label แทน (ปุ่ม Log out มีเทสต์ smoke จับชื่ออยู่) */}
                    <button
                        className="btn-changepw"
                        onClick={() => setShowPw(true)}
                        title={rail ? 'Change password' : undefined}
                        aria-label={rail ? 'Change password' : undefined}
                    >
                        <Icon name="edit" size={15} /> <span className="btn-label">Change password</span>
                    </button>
                    <button
                        className="btn-logout"
                        onClick={handleLogout}
                        title={rail ? 'Log out' : undefined}
                        aria-label={rail ? 'Log out' : undefined}
                    >
                        <Icon name="logout" size={17} /> <span className="btn-label">Log out</span>
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
