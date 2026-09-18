import lazyPage from '../utils/lazyPage.js';

// หน้าทั้งหมดที่แยกไฟล์ — App ใช้แสดง ส่วน Layout ใช้โหลดล่วงหน้าตอนเครื่องว่าง
// (ตัวเปลี่ยนหน้าของ React Router ค้างหน้าเดิมไว้ระหว่างรอไฟล์หน้าใหม่ ถ้าไม่โหลดล่วงหน้า มือถือเน็ตช้าจะรู้สึกว่ากดไม่ติด)
export const AgencyPortal = lazyPage(() => import('./AgencyPortal.jsx'));
export const Dashboard = lazyPage(() => import('./Dashboard.jsx'));
export const Kols = lazyPage(() => import('./Kols.jsx'));
export const OtherWork = lazyPage(() => import('./OtherWork.jsx'));
export const InfluencerDetail = lazyPage(() => import('./InfluencerDetail.jsx'));
export const Projects = lazyPage(() => import('./Projects.jsx'));
export const ProjectDetail = lazyPage(() => import('./ProjectDetail.jsx'));
export const Budget = lazyPage(() => import('./Budget.jsx'));
export const Report = lazyPage(() => import('./Report.jsx'));
export const Ads = lazyPage(() => import('./Ads.jsx'));
export const Activity = lazyPage(() => import('./Activity.jsx'));
export const Users = lazyPage(() => import('./Users.jsx'));
export const Teams = lazyPage(() => import('./Teams.jsx'));
export const Payments = lazyPage(() => import('./Payments.jsx'));

// หน้าในเมนูหลัก (หน้าเอเจนซี่ไม่ต้อง — ทีมไม่ได้เปิดจากเมนู)
const MENU_PAGES = [Dashboard, Projects, ProjectDetail, Ads, Budget, Kols, OtherWork, InfluencerDetail, Report];
const ADMIN_PAGES = [Payments, Activity, Users, Teams];

export function preloadPages(isAdmin) {
    [...MENU_PAGES, ...(isAdmin ? ADMIN_PAGES : [])].forEach(p => p.preload());
}
