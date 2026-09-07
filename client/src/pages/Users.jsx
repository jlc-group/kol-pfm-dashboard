import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import Avatar from '../components/Avatar.jsx';
import { BRANDS, ROLE_LABEL } from '../data/brands.js';
import PasswordInput from '../components/PasswordInput.jsx';

function UserForm({ editing, agencyLinks, onClose, onSaved }) {
    const [form, setForm] = useState({
        username: editing?.username || '',
        password: '',
        role: editing?.role || 'member',
        brands: Array.isArray(editing?.brands) ? editing.brands : [],
        agency_tokens: Array.isArray(editing?.agency_tokens) ? editing.agency_tokens : [],
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const isEdit = !!editing;

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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [modal, setModal] = useState(null); // null | {editing?}

    function load() {
        setLoading(true);
        // ใช้เส้นเดิมที่คืนลิงก์เอเจนซี่ทุกแคมเปญอยู่แล้ว ไม่ต้องทำเส้นใหม่
        Promise.all([api('/users'), api('/projects/chats/all')])
            .then(([u, a]) => { setUsers(u.data); setAgencyLinks(a.data || []); })
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

            <div className="panel no-pad">
                <table className="data-table">
                    <thead>
                        <tr>
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
                                        </div>
                                    </div>
                                </td>
                                <td><span className={`badge badge-${u.role}`}>{ROLE_LABEL[u.role] || u.role}</span></td>
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

            {modal && <UserForm editing={modal.editing} agencyLinks={agencyLinks} onClose={() => setModal(null)} onSaved={handleSaved} />}
        </div>
    );
}
