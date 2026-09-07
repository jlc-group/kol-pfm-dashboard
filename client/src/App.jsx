import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Pending from './pages/Pending.jsx';
import AgencyPortal from './pages/AgencyPortal.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Kols from './pages/Kols.jsx';
import InfluencerDetail from './pages/InfluencerDetail.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Budget from './pages/Budget.jsx';
import Report from './pages/Report.jsx';
import Ads from './pages/Ads.jsx';
import Activity from './pages/Activity.jsx';
import Users from './pages/Users.jsx';
import Teams from './pages/Teams.jsx';
import Payments from './pages/Payments.jsx';

// จำกัดเฉพาะ admin — ถ้าไม่ใช่ เด้งกลับหน้าแรก
function AdminRoute({ children }) {
    const { isAdmin } = useAuth();
    return isAdmin ? children : <Navigate to="/" replace />;
}

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/agency/:token" element={<AgencyPortal />} />
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
    );
}
