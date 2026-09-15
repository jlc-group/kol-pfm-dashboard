import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import Avatar from '../components/Avatar.jsx';
import { BRANDS, ROLE_LABEL } from '../data/brands.js';
import PasswordInput from '../components/PasswordInput.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

// ทีม = สังกัด ไม่ใช่สิทธิ์ (roles.js ตัดสินว่าใครเห็นอะไรจาก role อย่างเดียว ไม่ได้ดูทีม)
// ค่าตั้งต้นตอนเพิ่มผู้ใช้: admin → ทีม Admin · manager → ทีม Manager · member ต้องเลือกเอง (KOL / Ads)
// เปลี่ยนทีมทีหลังได้ที่ฟอร์มแก้ไข เช่น Manager ที่ทำงานทีม Ads · agency ไม่มีทีม เพราะไม่เข้า dashboard
// คนที่ใช้ dashboard ต้องมีทีมเสมอ — server ไม่ให้สร้างแคมเปญถ้าไม่มีทีม (routes/projects.js:104)
const ROLE_TEAM_NAME = { admin: 'Admin', manager: 'Manager' };
const teamIdByName = (teams, name) => {
    const t = teams.find(x => x.name === name);
    return t ? t.id : null;
};
// ทีมที่ member เลือกได้ = ทุกทีมที่ไม่ได้จองไว้ให้สิทธิ์ admin/manager (ตอนนี้คือ KOL, Ads)
const memberTeams = teams => teams.filter(t => !Object.values(ROLE_TEAM_NAME).includes(t.name));
// ทีมที่ควรได้ตามสิทธิ์ — member คงทีมเดิมไว้ถ้าเป็นทีมที่เลือกได้ ไม่งั้นคืน null (ต้องให้คนเลือก)
const teamForRole = (teams, role, currentTeamId) => {
    if (role === 'agency') return null;
    if (ROLE_TEAM_NAME[role]) return teamIdByName(teams, ROLE_TEAM_NAME[role]);
    return memberTeams(teams).some(t => t.id === currentTeamId) ? currentTeamId : null;
};

function UserForm({ editing, agencyLinks, teams, onClose, onSaved }) {
    const [form, setForm] = useState({
        username: editing?.username || '',
        password: '',
        role: editing?.role || 'member',
        team_id: editing?.team_id ? String(editing.team_id) : '',   // ใช้เฉพาะ member (admin/manager ระบบจัดทีมให้)
        brands: Array.isArray(editing?.brands) ? editing.brands : [],
        agency_tokens: Array.isArray(editing?.agency_tokens) ? editing.agency_tokens : [],
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const isEdit = !!editing;
    // ทีมที่เลือกไว้ต้องเป็นทีมที่ member เลือกได้จริง (ไม่ใช่ Admin/Manager ที่ติดมาจากสิทธิ์เดิม) ไม่งั้นบังคับเลือกใหม่
    const memberTeamOk = memberTeams(teams).some(t => String(t.id) === String(form.team_id));
    // ตอนแก้ไข เลือกทีมไหนก็ได้ — ทีมเป็นแค่สังกัด ไม่ได้กำหนดว่าเห็นอะไร
    // เช่น Manager ที่อยู่ทีม Ads ก็ยังเห็นทุกอย่างแบบ Manager
    const anyTeamOk = teams.some(t => String(t.id) === String(form.team_id));

    function update(k, v) { setForm(f => ({ ...f, [k]: v })); }

    async function submit(e) {
        e.preventDefault();
        setError(''); setSaving(true);
        try {
            // แก้ไข: ใช้ทีมที่เลือกในฟอร์ม (เปลี่ยนทีมได้อิสระ ไม่ผูกกับสิทธิ์)
            // เพิ่มใหม่: admin/manager ระบบเลือกทีมตามสิทธิ์ให้ · member ใช้ทีมที่เลือก · agency ไม่มีทีม
            // คำนวณตอนกดบันทึก จึงไม่ต้องห่วงว่ารายชื่อทีมโหลดเสร็จหรือยังตอนเปิดฟอร์ม
            const teamId = isEdit
                ? (anyTeamOk ? Number(form.team_id) : null)
                : form.role === 'member'
                    ? (memberTeamOk ? Number(form.team_id) : null)
                    : teamForRole(teams, form.role, null);
            const body = {
                role: form.role,
                // admin/manager เห็นทุกแบรนด์ ไม่ต้องส่งรายการแบรนด์ไป
                brands: form.role === 'member' ? form.brands : [],
                agency_tokens: form.role === 'agency' ? form.agency_tokens : [],
                // เอเจนซี่ไม่เข้า dashboard จึงไม่ต้องมีทีม ที่เหลือต้องมี ไม่งั้นสร้างแคมเปญไม่ได้
                team_id: form.role === 'agency' ? null : teamId,
            };
            body.username = form.username.trim();
            if (form.password) body.password = form.password;
            if (isEdit) {
                await api(`/users/${editing.id}`, { method: 'PUT', body });
            } else {
                await api('/users', { method: 'POST', body: { ...body, username: form.username, password: form.password } });
            }
            onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <h3>{isEdit ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}</h3>
                {error && <div className="alert-error">{error}</div>}
                <form onSubmit={submit}>
                    <div className="field">
                        <label>Username *</label>
                        <input value={form.username} onChange={e => update('username', e.target.value)}
                            required />
                    </div>
                    <div className="field">
                        <label>{isEdit ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน *'}</label>
                        <PasswordInput value={form.password}
                            onChange={e => update('password', e.target.value)}
                            autoComplete="new-password" required={!isEdit} />
                    </div>
                    <div className="field">
                        <label>สิทธิ์</label>
                            <select value={form.role} onChange={e => update('role', e.target.value)}>
                                <option value="member">Member — เห็นเฉพาะแบรนด์ที่กำหนด</option>
                                <option value="manager">Manager — เห็นทุกแบรนด์</option>
                                <option value="admin">ผู้ดูแลระบบ — เห็นทุกอย่าง</option>
                                <option value="agency">Agency — เห็นเฉพาะลิงก์งานของตัวเอง</option>
                            </select>
                    </div>
                    {/* ทีม
                        - แก้ไข: มีช่องเลือกทีมทุกสิทธิ์ (ยกเว้น agency) เปลี่ยนได้อิสระ ไม่กระทบสิ่งที่มองเห็น
                        - เพิ่มใหม่: admin/manager ระบบจัดทีมให้ตามสิทธิ์ · member ต้องเลือกว่าอยู่ทีมไหน */}
                    {isEdit && form.role !== 'agency' && (
                        <div className="field">
                            <label>ทีม * <span className="dash-section-sub">เปลี่ยนทีมได้ ไม่กระทบสิทธิ์ — สิ่งที่มองเห็นขึ้นกับช่องสิทธิ์ด้านบน</span></label>
                            <select value={anyTeamOk ? form.team_id : ''} onChange={e => update('team_id', e.target.value)} required>
                                <option value="">— เลือกทีม —</option>
                                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </div>
                    )}
                    {!isEdit && form.role === 'member' && (
                        <div className="field">
                            <label>ทีม * <span className="dash-section-sub">Admin / Manager ระบบจัดทีมให้ตามสิทธิ์ · Member เลือกทีมที่ทำงาน</span></label>
                            <select value={memberTeamOk ? form.team_id : ''} onChange={e => update('team_id', e.target.value)} required>
                                <option value="">— เลือกทีม —</option>
                                {memberTeams(teams).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </div>
                    )}
                    {!isEdit && ROLE_TEAM_NAME[form.role] && (
                        <p className="dash-section-sub">ทีม: {ROLE_TEAM_NAME[form.role]} — ระบบจัดให้ตามสิทธิ์ (เปลี่ยนทีมทีหลังได้ที่ปุ่มแก้ไข)</p>
                    )}
                    {form.role === 'agency' && (
                        <div className="field">
                            <label>ลิงก์งานที่เข้าได้ <span className="dash-section-sub">เลือกได้หลายลิงก์ · บัญชีนี้จะเข้า dashboard ไม่ได้เลย</span></label>
                            {agencyLinks.length === 0 ? (
                                <p className="dash-section-sub">ยังไม่มีลิงก์เอเจนซี่ในระบบ — สร้างที่หน้าแคมเปญก่อน</p>
                            ) : (
                                <div className="brand-pick">
                                    {agencyLinks.map(l => (
                                        <label key={l.token} className={'brand-pick-item' + (form.agency_tokens.includes(l.token) ? ' on' : '')}>
                                            <input type="checkbox" checked={form.agency_tokens.includes(l.token)}
                                                onChange={() => update('agency_tokens', form.agency_tokens.includes(l.token)
                                                    ? form.agency_tokens.filter(x => x !== l.token)
                                                    : [...form.agency_tokens, l.token])} />
                                            {l.agency_name || l.token} · {l.project_name}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    {form.role === 'member' && (
                        <div className="field">
                            <label>แบรนด์ที่ดูได้ <span className="dash-section-sub">เลือกได้หลายแบรนด์ · ไม่เลือกเลย = ยังไม่เห็นข้อมูลใด ๆ</span></label>
                            <div className="brand-pick">
                                {BRANDS.map(b => (
                                    <label key={b} className={'brand-pick-item' + (form.brands.includes(b) ? ' on' : '')}>
                                        <input type="checkbox" checked={form.brands.includes(b)}
                                            onChange={() => update('brands', form.brands.includes(b)
                                                ? form.brands.filter(x => x !== b)
                                                : [...form.brands, b])} />
                                        {b}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="modal-actions">
                        <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
                        <button type="submit" className="btn-primary" disabled={saving}>
                            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function Users() {
    const [users, setUsers] = useState([]);
    const [agencyLinks, setAgencyLinks] = useState([]);   // ลิงก์เอเจนซี่ทุกแคมเปญ (ไว้ผูกกับบัญชี role agency)
    const [teams, setTeams] = useState([]);               // ทีมทั้งหมด (ใช้จัดทีมตามสิทธิ์ และให้ member เลือกทีม)
    const { user: me } = useAuth();                       // บัญชีที่กำลังล็อกอินอยู่ — ห้ามลดสิทธิ์ตัวเอง
    const [busyId, setBusyId] = useState(null);           // แถวที่กำลังบันทึกอยู่ (ล็อก dropdown กันกดซ้ำ)
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [modal, setModal] = useState(null); // null | {editing?}

    function load() {
        setLoading(true);
        // ใช้เส้นเดิมที่คืนลิงก์เอเจนซี่ทุกแคมเปญอยู่แล้ว ไม่ต้องทำเส้นใหม่
        Promise.all([api('/users'), api('/projects/chats/all'), api('/teams')])
            .then(([u, a, t]) => { setUsers(u.data); setAgencyLinks(a.data || []); setTeams(t.data || []); })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }
    useEffect(() => { load(); }, []);

    async function handleDelete(u) {
        if (!confirm(`ลบผู้ใช้ "${u.username}" ?`)) return;
        try { await api(`/users/${u.id}`, { method: 'DELETE' }); load(); }
        catch (err) { alert(err.message); }
    }

    function handleSaved() { setModal(null); load(); window.dispatchEvent(new Event('kol:users-changed')); }

    // บันทึกฟิลด์เดียวจาก dropdown ในตาราง — ส่งเฉพาะฟิลด์ที่เปลี่ยน
    // ฝั่ง server ข้ามฟิลด์ที่เป็น undefined อยู่แล้ว ค่าอื่นจึงไม่โดนล้าง
    async function patchUser(u, body) {
        setBusyId(u.id);
        try {
            await api(`/users/${u.id}`, { method: 'PUT', body });
            load();
            window.dispatchEvent(new Event('kol:users-changed'));
        } catch (err) { alert(err.message); load(); }
        finally { setBusyId(null); }
    }

    function changeRole(u, role) {
        if (role === u.role) return;
        const who = u.nickname || u.full_name || u.username;
        // server ล้างข้อมูลพ่วงเมื่อเปลี่ยน role — เตือนก่อนเพราะกู้คืนเองไม่ได้
        const loss = [];
        if (role !== 'member' && (u.brands || []).length) loss.push(`แบรนด์ที่กำหนดไว้ ${u.brands.length} แบรนด์`);
        if (role !== 'agency' && (u.agency_tokens || []).length) loss.push(`ลิงก์งานเอเจนซี่ ${u.agency_tokens.length} ลิงก์`);
        const warn = loss.length ? `\n\n⚠ การเปลี่ยนนี้จะล้าง ${loss.join(' และ ')} ทิ้ง` : '';
        const admin = role === 'admin' ? '\n\n⚠ ผู้ดูแลระบบเข้าถึงรอบทำจ่าย ผู้ใช้งาน และตั้งสิทธิ์คนอื่นได้' : '';
        // admin/manager มี brands ว่างเสมอโดยการออกแบบ ลดลงมาเป็น member ตรง ๆ จะได้บัญชีที่ไม่เห็นข้อมูลอะไรเลย
        const blind = (role === 'member' && !(u.brands || []).length)
            ? '\n\n⚠ บัญชีนี้ยังไม่ได้กำหนดแบรนด์ — เปลี่ยนแล้วจะไม่เห็นข้อมูลใด ๆ จนกว่าจะไปกำหนดแบรนด์ให้ที่ปุ่มแก้ไข (✎)' : '';
        if (!confirm(`เปลี่ยนสิทธิ์ "${who}"\nจาก ${ROLE_LABEL[u.role] || u.role} → ${ROLE_LABEL[role] || role}${admin}${warn}${blind}`)) return;
        // เปลี่ยนสิทธิ์ไม่ย้ายทีม — ทีมเป็นสังกัดที่ตั้งเองได้ (เช่น Manager ที่อยู่ทีม Ads)
        // เติมทีมให้เฉพาะบัญชีที่ยังไม่มีทีม: admin/manager ได้ทีมตามสิทธิ์ · member ต้องเลือกเอง
        if (u.team_id || role === 'agency') { patchUser(u, { role }); return; }
        const team = teamForRole(teams, role, null);
        // ยังไม่มีทีมและระบบเลือกให้ไม่ได้ (member) เปิดฟอร์มแก้ไขให้เลือกทีมและแบรนด์ในจังหวะเดียว
        if (!team) { setModal({ editing: { ...u, role } }); return; }
        patchUser(u, { role, team_id: team });
    }


    // อนุมัติ / ปฏิเสธ คำขอเข้าใช้งาน
    async function setStatus(u, status) {
        const what = status === 'active' ? 'อนุมัติ' : 'ปฏิเสธ';
        if (!confirm(`${what}คำขอของ "${u.nickname || u.username}" ?`)) return;
        try {
            // อนุมัติคนที่ยังไม่มีทีม: admin/manager ใส่ทีมตามสิทธิ์ให้เลย · member ต้องเลือกทีมเอง
            // จึงอนุมัติไปก่อน แล้วป้าย "ยังไม่มีทีม" ใต้ชื่อจะเตือนให้กด ✎ เลือกทีม · คนที่มีทีมอยู่แล้วไม่ย้าย
            const team = (status === 'active' && !u.team_id) ? teamForRole(teams, u.role, null) : null;
            await api(`/users/${u.id}`, { method: 'PUT', body: team ? { status, team_id: team } : { status } });
            load();
            window.dispatchEvent(new Event('kol:users-changed'));
        }
        catch (err) { alert(err.message); }
    }

    return (
        <div>
            <header className="page-head with-action">
                <div>
                    <h1>ผู้ใช้งาน</h1>
                    <p className="page-sub">จัดการบัญชีผู้ใช้และสิทธิ์การเข้าถึง</p>
                </div>
                <button className="btn-primary" onClick={() => setModal({})}>
                    <Icon name="plus" size={17} /> เพิ่มผู้ใช้
                </button>
            </header>

            {error && <div className="alert-error">{error}</div>}

            {/* .panel.no-pad มี overflow:hidden (ไว้ตัดมุมโค้ง) ถ้าตารางกว้างเกินจอ ของที่ล้นจะหายไปเฉย ๆ
                เลื่อนไปหาไม่ได้ด้วย — บนมือถือปุ่มลบเคยหลุดออกนอกจอเพราะเหตุนี้
                จึงห่อด้วยกล่องเลื่อนแนวนอนแบบเดียวกับ .ads-tbl-scroll / .proc-tbl-scroll */}
            <div className="panel no-pad">
              <div className="users-table-scroll">
                <table className="data-table users-table">
                    <thead>
                        <tr>
                            {/* คอลัมน์ "ทีม" ถูกซ่อนไว้
                                เปลี่ยนทีมได้ที่ปุ่มแก้ไข (✎) — ทีมไม่กระทบสิทธิ์การมองเห็น */}
                            <th>ผู้ใช้</th><th>สิทธิ์</th><th>แบรนด์ที่ดูได้</th><th>สถานะ</th><th className="actions">จัดการ</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="5" className="empty">กำลังโหลด...</td></tr>
                        ) : users.length === 0 ? (
                            <tr><td colSpan="5" className="empty">ยังไม่มีผู้ใช้</td></tr>
                        ) : users.map(u => (
                            <tr key={u.id}>
                                <td>
                                    <div className="inf-cell">
                                        <Avatar name={u.nickname || u.full_name || u.username} size={40} />
                                        <div>
                                            {/* ชื่อผู้ใช้ขึ้นก่อนเป็นตัวเด่น ชื่อเล่น/ชื่อเต็มอยู่บรรทัดล่าง */}
                                            <div className="inf-cell-name">@{u.username}</div>
                                            {(u.nickname || u.full_name) && (u.nickname || u.full_name) !== u.username && (
                                                <div className="inf-cell-user">{u.nickname || u.full_name}</div>
                                            )}
                                            {/* คอลัมน์ "ทีม" ถูกซ่อนไปแล้ว แต่ยังต้องเห็นบัญชีที่สร้างแคมเปญไม่ได้
                                                (เช่นคนที่สมัครเองผ่าน /register จะไม่ได้ทีมมาตั้งแต่ต้น) */}
                                            {u.role !== 'agency' && !u.team_name && (
                                                <div className="user-noteam" title="ยังไม่ได้สังกัดทีม — บัญชีนี้จะสร้างแคมเปญไม่ได้ กดปุ่มแก้ไข (✎) เพื่อเลือกทีม">
                                                    ⚠ ยังไม่มีทีม
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    {/* สิทธิ์ของตัวเองแก้จากตรงนี้ไม่ได้ — ระบบอ่าน role จากฐานสดทุก request
                                        ถ้าเผลอลดสิทธิ์ตัวเองจะหลุดออกทันทีและกลับเข้ามาแก้คืนไม่ได้ */}
                                    {u.id === me?.id ? (
                                        <span className={`badge badge-${u.role}`} title="สิทธิ์ของบัญชีคุณเอง — ให้ผู้ดูแลระบบคนอื่นเป็นคนเปลี่ยนให้">
                                            {ROLE_LABEL[u.role] || u.role}
                                        </span>
                                    ) : (
                                        <select className="users-inline-sel" value={u.role} disabled={busyId === u.id}
                                            onChange={e => changeRole(u, e.target.value)}>
                                            {Object.entries(ROLE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                                        </select>
                                    )}
                                </td>
                                <td>
                                    {u.role === 'agency'
                                        ? <span className="cat-chip">{(u.agency_tokens || []).length} ลิงก์งาน</span>
                                        : u.role !== 'member'
                                        ? <span className="muted">ทุกแบรนด์</span>
                                        : (u.brands || []).length > 0
                                            ? <span className="brand-chips-cell">{u.brands.map(b => <span className="cat-chip" key={b}>{b}</span>)}</span>
                                            : <span className="muted">ยังไม่ได้กำหนด</span>}
                                </td>
                                <td>
                                    {(u.status || 'active') === 'pending'
                                        ? <span className="badge badge-pending">⏳ รออนุมัติ</span>
                                        : (u.status === 'rejected'
                                            ? <span className="badge badge-off">ปฏิเสธ</span>
                                            : (u.is_active
                                                ? <span className="badge badge-member">ใช้งาน</span>
                                                : <span className="badge badge-off">ปิด</span>))}
                                </td>
                                <td className="actions">
                                    <span className="row-actions">
                                        {(u.status || 'active') === 'pending' && (
                                            <>
                                                <button className="btn-approve" title="อนุมัติให้เข้าใช้งาน" onClick={() => setStatus(u, 'active')}>✓ อนุมัติ</button>
                                                <button className="btn-reject-sm" title="ปฏิเสธคำขอ" onClick={() => setStatus(u, 'rejected')}>✕</button>
                                            </>
                                        )}
                                        <button className="icon-btn" title="แก้ไข" onClick={() => setModal({ editing: u })}><Icon name="edit" size={16} /></button>
                                        <button className="icon-btn danger" title="ลบ" onClick={() => handleDelete(u)}><Icon name="trash" size={16} /></button>
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
              </div>
            </div>

            {modal && <UserForm editing={modal.editing} agencyLinks={agencyLinks} teams={teams} onClose={() => setModal(null)} onSaved={handleSaved} />}
        </div>
    );
}
