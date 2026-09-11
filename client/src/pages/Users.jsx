import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import Avatar from '../components/Avatar.jsx';
import { BRANDS, ROLE_LABEL } from '../data/brands.js';
import PasswordInput from '../components/PasswordInput.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

// ผู้ใช้ใหม่ให้เริ่มที่ Admin Team ไว้ก่อน — จะได้สร้างแคมเปญได้ทันทีตั้งแต่วันแรก
// ไม่ต้องรอใครมาตั้งทีมให้ทีหลัง (ก่อนหน้านี้ทุกคนที่เพิ่มผ่านหน้าเว็บติดปัญหานี้)
const DEFAULT_TEAM_NAME = 'Admin Team';
const defaultTeamId = teams => {
    const t = teams.find(x => x.name === DEFAULT_TEAM_NAME);
    return t ? String(t.id) : '';
};

function UserForm({ editing, agencyLinks, teams, onClose, onSaved }) {
    const [form, setForm] = useState({
        username: editing?.username || '',
        password: '',
        role: editing?.role || 'member',
        team_id: editing?.team_id ? String(editing.team_id) : defaultTeamId(teams),
        brands: Array.isArray(editing?.brands) ? editing.brands : [],
        agency_tokens: Array.isArray(editing?.agency_tokens) ? editing.agency_tokens : [],
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const isEdit = !!editing;
    // เผื่อกด "เพิ่มผู้ใช้" ตอนรายชื่อทีมยังโหลดไม่เสร็จ — พอทีมมาถึงค่อยเติมค่าตั้งต้นให้
    useEffect(() => {
        if (isEdit) return;
        setForm(f => (f.team_id ? f : { ...f, team_id: defaultTeamId(teams) }));
    }, [teams, isEdit]);

    function update(k, v) { setForm(f => ({ ...f, [k]: v })); }

    async function submit(e) {
        e.preventDefault();
        setError(''); setSaving(true);
        try {
            const body = {
                role: form.role,
                // admin/manager เห็นทุกแบรนด์ ไม่ต้องส่งรายการแบรนด์ไป
                brands: form.role === 'member' ? form.brands : [],
                agency_tokens: form.role === 'agency' ? form.agency_tokens : [],
                // เอเจนซี่ไม่เข้า dashboard จึงไม่ต้องมีทีม ที่เหลือต้องมี ไม่งั้นสร้างแคมเปญไม่ได้
                team_id: form.role === 'agency' ? null : (form.team_id ? Number(form.team_id) : null),
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
                    {/* ทีมเป็นตัวผูกว่าแคมเปญที่สร้างจะอยู่ทีมไหน ถ้าไม่มีทีมจะสร้างแคมเปญไม่ได้เลย
                        (server ปฏิเสธด้วยข้อความ "ผู้ใช้ยังไม่ได้สังกัดทีม") */}
                    {form.role !== 'agency' && (
                        <div className="field">
                            <label>ทีม * <span className="dash-section-sub">ต้องมีทีม ไม่งั้นบัญชีนี้จะสร้างแคมเปญไม่ได้</span></label>
                            <select value={form.team_id} onChange={e => update('team_id', e.target.value)} required>
                                <option value="">— เลือกทีม —</option>
                                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                            {teams.length === 0 && (
                                <p className="dash-section-sub">ยังไม่มีทีมในระบบ — สร้างทีมที่หน้า "ทีม" ก่อน</p>
                            )}
                        </div>
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
    const [teams, setTeams] = useState([]);               // ทีมทั้งหมด (ไว้เลือกให้ผู้ใช้สังกัด)
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
        // บัญชีที่ยังไม่มีทีม (เช่น agency ที่ถูกแปลงเป็น role อื่น) ต้องเติมทีมไปพร้อมกัน
        // ไม่งั้นจะได้บัญชีที่สร้างแคมเปญไม่ได้ — เป็นสถานะที่ฟอร์ม (✎) กันไว้ด้วย required อยู่แล้ว
        const team = (role !== 'agency' && !u.team_id) ? Number(defaultTeamId(teams)) : 0;
        patchUser(u, team ? { role, team_id: team } : { role });
    }


    // อนุมัติ / ปฏิเสธ คำขอเข้าใช้งาน
    async function setStatus(u, status) {
        const what = status === 'active' ? 'อนุมัติ' : 'ปฏิเสธ';
        if (!confirm(`${what}คำขอของ "${u.nickname || u.username}" ?`)) return;
        try {
            await api(`/users/${u.id}`, { method: 'PUT', body: { status } });
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
                            {/* คอลัมน์ "ทีม" ถูกซ่อนไว้ — ผู้ใช้ใหม่ตั้งต้นเป็น Admin Team ให้อยู่แล้ว
                                ถ้าต้องเปลี่ยนทีมรายคน ยังทำได้จากปุ่มแก้ไข (✎) ในฟอร์ม */}
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
                                                <div className="user-noteam" title="ยังไม่ได้สังกัดทีม — บัญชีนี้จะสร้างแคมเปญไม่ได้ กดปุ่มแก้ไข (✎) เพื่อกำหนดทีม">
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
