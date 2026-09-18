import { Link } from 'react-router-dom';
import SideDrawer from '../../components/SideDrawer.jsx';
import HireRequestCard from '../../components/HireRequestCard.jsx';
import { T, timeAgo } from '../../data/talentLabels.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { turnText, requesterText } from './requestText.js';

// ลิ้นชักของใบขอให้หา — ทุกบทบาทเปิดแบบเดียวกันบนหน้าเดิม (ไม่พาไปหน้างาน กดปิดแล้วกลับที่เดิม)
// request = แถวสดจาก GET /hires/tasks ที่หน้าแม่หามาใหม่ทุกครั้งที่ render — ห้ามเก็บสำเนาไว้เอง ไม่งั้นเห็นขั้นเก่าหลังโหลดใหม่
// สิทธิ์ของการ์ดตรงกับที่ server บังคับ: ตัดสิน/แก้/ลบ = คนในแบรนด์ · เสนอชื่อ = คนในแบรนด์ หรือคนที่ถูกมอบให้ช่วยหา
export default function RequestDrawer({ request, onClose, onChanged }) {
    const { user } = useAuth();
    if (!request) return null;
    const pid = request.project_id;
    const key = request.key;
    const turn = turnText(request);
    const subtitle = [
        request.project_name,
        request.brand,
        requesterText(request, user && user.id),
        timeAgo(request.requested_at)
    ].filter(Boolean).join(' · ');

    return (
        <SideDrawer title={T.request + (request.kind ? ' · ' + request.kind : '')} subtitle={subtitle} onClose={onClose}
            className="th-req-drawer">
            <div className={'th-turn' + (turn.mine ? ' mine' : '')} role="status">{turn.text}</div>
            {/* คนนอกแบรนด์เปิดหน้างานไม่ได้ (403) — ลิงก์นี้จึงมีเฉพาะคนในแบรนด์ */}
            {request.in_brand && (
                <div className="th-drawer-links">
                    <Link className="th-link" to={`/projects/${pid}#req-${key}`}>เปิดหน้างาน →</Link>
                </div>
            )}
            {/* การ์ดจะแสดงหมายเหตุของใบเอง — ไม่ต้องซ้ำที่นี่ · key ผูกกับใบ เปลี่ยนใบแล้วสถานะในการ์ดเริ่มใหม่ */}
            <HireRequestCard key={pid + '~' + key} request={request}
                canDecide={!!request.in_brand} canPropose={!!(request.in_brand || request.is_assignee)}
                heading onChanged={onChanged}
                onDeleted={() => { if (onChanged) onChanged(); onClose(); }} />
        </SideDrawer>
    );
}
