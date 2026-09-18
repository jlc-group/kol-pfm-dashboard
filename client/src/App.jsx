import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AgencyRoute from './components/AgencyRoute.jsx';
import Layout from './components/Layout.jsx';
import PageErrorBoundary from './components/PageErrorBoundary.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
// หน้าอื่นแยกไฟล์ โหลดตอนเปิดหน้านั้นครั้งแรก — หน้าแรก/หน้าล็อกอินเปิดเร็วขึ้นบนมือถือ
// (หน้าล็อกอิน/สมัครโหลดมาพร้อมกันเลย เพราะเป็นหน้าแรกที่คนส่วนใหญ่เจอ)
import {
    AgencyPortal, Dashboard, Kols, OtherWork, InfluencerDetail, Projects, ProjectDetail,
    Budget, Report, Ads, Activity, Users, Teams, Payments
} from './pages/lazyPages.js';

// จำกัดเฉพาะ admin — ถ้าไม่ใช่ เด้งกลับหน้าแรก
function AdminRoute({ children }) {
    const { isAdmin } = useAuth();
    return isAdmin ? children : <Navigate to="/" replace />;
}

export default function App() {
    return (
        // หน้าที่อยู่ในเมนูหลักมี Suspense/ตัวกันจอขาวของตัวเองใน Layout (เมนูด้านข้างไม่หายตอนโหลดหน้า)
        // ชุดนี้รับเฉพาะหน้าที่อยู่นอก Layout เช่นหน้าลิงก์เอเจนซี่
        <PageErrorBoundary full>
            <Suspense fallback={<div className="page-loading">กำลังโหลด...</div>}>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/agency/:token" element={<AgencyRoute><AgencyPortal /></AgencyRoute>} />
                    <Route
                        path="/"
                        element={
                            <ProtectedRoute>
                                <Layout />
                            </ProtectedRoute>
                        }
                    >
                        <Route index element={<Dashboard />} />
                        <Route path="kols" element={<Kols />} />
                        <Route path="hires" element={<OtherWork />} />
                        {/* เมนู "งานจัดหา" เดิมรวมเข้าเมนูงานจ้างอื่น ๆ แล้ว — ลิงก์/บุ๊กมาร์กเก่าพาไปที่แท็บใบขอจัดหา */}
                        <Route path="hire-tasks" element={<Navigate to="/hires?tab=requests" replace />} />
                        <Route path="influencers/:id" element={<InfluencerDetail />} />
                        <Route path="projects" element={<Projects />} />
                        <Route path="projects/:id" element={<ProjectDetail />} />
                        <Route path="budget" element={<Budget />} />
                        <Route path="reports/:id" element={<Report />} />
                        <Route path="ads" element={<Ads />} />
                        <Route path="activity" element={<AdminRoute><Activity /></AdminRoute>} />
                        <Route path="payments" element={<AdminRoute><Payments /></AdminRoute>} />
                        <Route path="users" element={<AdminRoute><Users /></AdminRoute>} />
                        <Route path="teams" element={<AdminRoute><Teams /></AdminRoute>} />
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Suspense>
        </PageErrorBoundary>
    );
}
