import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import DatePicker from '../components/DatePicker.jsx';
import Avatar from '../components/Avatar.jsx';

// ไอคอน + สี ตามชนิดการกระทำ
const ACTION_META = {
    create: { icon: 'plus', cls: 'act-create', label: 'สร้าง' },
    update: { icon: 'edit', cls: 'act-update', label: 'แก้ไข' },
    delete: { icon: 'trash', cls: 'act-delete', label: 'ลบ' },
    add_kol: { icon: 'star', cls: 'act-create', label: 'เพิ่ม KOL' },
    update_kol: { icon: 'edit', cls: 'act-update', label: 'แก้ผลงาน' },
    remove_kol: { icon: 'trash', cls: 'act-delete', label: 'เอา KOL ออก' },
    brief: { icon: 'file', cls: 'act-update', label: 'บรีฟ' },
    fee: { icon: 'coins', cls: 'act-update', label: 'ค่าตัว' }
};

function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Activity() {
    const navigate = useNavigate();
    const [logs, setLogs] = useState([]);
    const [actors, setActors] = useState([]);
    const [projects, setProjects] = useState([]);
    const [userFilter, setUserFilter] = useState('');
    const [projectFilter, setProjectFilter] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api('/activity/actors').then(res => setActors(res.data)).catch(() => {});
        api('/projects').then(res => setProjects(res.data)).catch(() => {});
    }, []);

    useEffect(() => {
        setLoading(true);
        const q = new URLSearchParams();
        if (userFilter) q.set('user_id', userFilter);
        if (projectFilter) q.set('project_id', projectFilter);
        if (from) q.set('from', from);
        if (to) q.set('to', to);
        api(`/activity?${q.toString()}`)
            .then(res => setLogs(res.data))
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [userFilter, projectFilter, from, to]);

    function clearFilters() { setUserFilter(''); setProjectFilter(''); setFrom(''); setTo(''); }
    const hasFilter = userFilter || projectFilter || from || to;

    // สรุปจำนวนต่อคน (ช่วยดูว่าคุยกับใคร)
    const perActor = useMemo(() => {
        const m = {};
        logs.forEach(l => { if (l.user_name) m[l.user_name] = (m[l.user_name] || 0) + 1; });
        return m;
    }, [logs]);

    return (
        <div>
            <header className="page-head">
                <h1>ประวัติการแก้ไข</h1>
                <p className="page-sub">ใครสร้าง/แก้ไขแคมเปญ เมื่อไหร่ — กรองดูรายคนเพื่อรู้ว่าต้องคุยกับใคร</p>
            </header>

            <div className="act-filters">
                <label className="bud-month">
                    คน:
                    <select value={userFilter} onChange={e => setUserFilter(e.target.value)}>
                        <option value="">ทุกคน</option>
                        {actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                </label>
                <label className="bud-month">
                    แคมเปญ:
                    <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
                        <option value="">ทุกแคมเปญ</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </label>
                <label className="bud-month">
                    ตั้งแต่:
                    <DatePicker value={from} onChange={setFrom} placeholder="ตั้งแต่" />
                </label>
                <label className="bud-month">
                    ถึง:
                    <DatePicker value={to} onChange={setTo} placeholder="ถึง" />
                </label>
                {hasFilter && <button className="btn-ghost" onClick={clearFilters}>ล้างตัวกรอง</button>}
                <span className="inf-count" style={{ marginLeft: 'auto' }}>{logs.length} รายการ</span>
            </div>

            {error && <div className="alert-error">{error}</div>}

            {loading ? (
                <div className="panel"><p className="empty">กำลังโหลด...</p></div>
            ) : logs.length === 0 ? (
                <div className="panel empty-state">
                    <div className="empty-emoji">🕓</div>
                    <p>ยังไม่มีประวัติการแก้ไข</p>
                </div>
            ) : (
                <div className="panel">
                    <div className="act-list">
                        {logs.map(l => {
                            const meta = ACTION_META[l.action] || ACTION_META.update;
                            return (
                                <div className="act-item" key={l.id}>
                                    <div className={`act-icon ${meta.cls}`}><Icon name={meta.icon} size={16} /></div>
                                    <div className="act-main">
                                        <div className="act-line">
                                            <Avatar name={l.user_name} size={22} />
                                            <strong>{l.user_name}</strong>
                                            <span className="act-summary">{l.summary}</span>
                                        </div>
                                        {l.project_name && (
                                            <button className="act-project" onClick={() => l.project_id && navigate(`/projects/${l.project_id}`)}>
                                                <Icon name="folder" size={12} /> {l.project_name}
                                            </button>
                                        )}
                                    </div>
                                    <div className="act-time">{fmtTime(l.created_at)}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
