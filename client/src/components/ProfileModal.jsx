import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Icon from './Icon.jsx';
import PasswordInput from './PasswordInput.jsx';

// ต้องตรงกับ server (server/src/data/userNames.js)
const NAME_MAX = 40;
const USERNAME_MIN = 3;
const USERNAME_MAX = 40;
// ตัวที่มองไม่เห็นตัดทิ้งจากชื่อที่แสดง (คงตัวที่อีโมจิต้องใช้) · ชื่อล็อกอินห้ามมีเลย (พิมพ์ตอนเข้าระบบไม่ได้) — เหมือน server
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu;
const HIDDEN = /(?![‍︎️\u{E0020}-\u{E007F}])[\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu;
const NAME_BAD = /(?![‍\u{E0020}-\u{E007F}])\p{C}/u;
const VISIBLE = /[\p{L}\p{N}]/u;
const OTHER = /\p{C}/u;
const squash = s => String(s || '').replace(HIDDEN, '').replace(/\s+/g, ' ').trim();

// ชื่อที่โชว์ทุกหน้า — nickname ก่อน full_name / username (เหมือน server displayName)
export const shownName = u => (u && (String(u.nickname || '').trim() || String(u.full_name || '').trim() || u.username)) || '';

// โมดัลแก้บัญชีของตัวเอง (ผู้ใช้สั่ง 28 ต.ค. 2026) — ชื่อที่แสดง + ชื่อล็อกอิน (Username)
// เปลี่ยนชื่อล็อกอินต้องใส่รหัสผ่านปัจจุบันยืนยัน · ส่งไปเฉพาะช่องที่เปลี่ยน · รหัสผ่านเปลี่ยนที่ปุ่ม Change password เหมือนเดิม
export default function ProfileModal({ onClose }) {
    const { user, updateUser } = useAuth();
    const startName = squash(shownName(user));   // เทียบแบบรวบช่องว่างเหมือนกันทั้ง 2 ฝั่ง — ยังไม่แตะ = ยังไม่เปลี่ยน
    const startUser = user?.username || '';
    const [f, setF] = useState({ nickname: startName, username: startUser, password: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(null);   // { username } — ชื่อล็อกอินใหม่ (null = ไม่ได้เปลี่ยน)
    const up = (k, v) => { setF(s => ({ ...s, [k]: v })); setError(''); };

    // ตรวจฝั่งหน้าเว็บก่อน บอกปัญหาได้ทันที — server ตรวจซ้ำ + ตรวจชื่อซ้ำกับคนอื่น
    const nick = squash(f.nickname);
    const uname = f.username.trim();
    const nickChanged = nick !== startName;
    const unameChanged = uname !== startUser;
    // ตรวจเฉพาะช่องที่แก้ — ชื่อเดิมที่ตั้งไว้ก่อนมีกติกา (เช่น username 2 ตัว / ยาวเกิน) ไม่ขวางการแก้อีกช่อง (ผลรีวิว 28 ต.ค.)
    const nickErr = !nickChanged ? ''
        : !nick ? 'กรุณาใส่ชื่อที่แสดง'
            : nick.length > NAME_MAX ? `ยาวได้ไม่เกิน ${NAME_MAX} ตัวอักษร (ตอนนี้ ${nick.length})`
                : NAME_BAD.test(nick) ? 'มีตัวอักษรที่ใช้ไม่ได้'
                    : !VISIBLE.test(nick.replace(INVISIBLE, '')) ? 'ต้องมีตัวอักษรหรือตัวเลขอย่างน้อย 1 ตัว' : '';
    const unameErr = !unameChanged ? ''
        : !uname ? 'กรุณาใส่ชื่อล็อกอิน'
            : /\s/.test(uname) ? 'ห้ามมีช่องว่าง'
                : OTHER.test(uname) ? 'มีตัวอักษรที่มองไม่เห็น / ใช้ไม่ได้'
                    : uname.length < USERNAME_MIN || uname.length > USERNAME_MAX ? `ต้องยาว ${USERNAME_MIN}-${USERNAME_MAX} ตัวอักษร (ตอนนี้ ${uname.length})` : '';
    const canSubmit = (nickChanged || unameChanged) && !nickErr && !unameErr && (!unameChanged || f.password) && !saving;

    async function submit(e) {
        e.preventDefault();
        if (!canSubmit) return;
        setSaving(true); setError('');
        try {
            const body = {};
            // เปลี่ยนแค่ username → ขอ server เก็บ username เดิมเป็นชื่อที่แสดง (ถ้ายังไม่มีชื่อที่แสดง / ชื่อเต็ม) ชื่อที่โชว์จะได้ไม่เปลี่ยนตามเงียบ ๆ
            // (ช่องชื่อที่แสดงในโมดัลยังเป็นชื่อเดิม = ผู้ใช้ไม่ได้ขอเปลี่ยน) · server ตัดสินจากข้อมูลในฐาน ไม่ใช้ค่าในโมดัลที่อาจเก่า (ผลรีวิว 28 ต.ค. 2 รอบ)
            if (nickChanged) body.nickname = nick;
            if (unameChanged) { body.username = uname; body.current_password = f.password; if (!nickChanged) body.keep_name = true; }
            const res = await api('/auth/profile', { method: 'PUT', body });
            updateUser(res.user);
            setDone({ username: unameChanged ? res.user?.username || uname : null });
        } catch (err) {
            setError(err.message || 'บันทึกไม่สำเร็จ');
        } finally {
            setSaving(false);
        }
    }

    if (done) {
        return (
            <div className="modal-backdrop" onClick={onClose}>
                <div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="draft-head">
                        <div className="draft-name">✅ บันทึกเรียบร้อย</div>
                    </div>
                    <p className="dash-section-sub" style={{ marginBottom: 18 }}>
                        {done.username
                            ? <>ครั้งต่อไปให้เข้าสู่ระบบด้วยชื่อ <strong>{done.username}</strong> (ตัวพิมพ์เล็ก/ใหญ่ต้องตรง) · รหัสผ่านเหมือนเดิม · ตอนนี้ยังใช้งานต่อได้เลยไม่ต้องล็อกอินใหม่</>
                            : 'ชื่อใหม่ขึ้นในเมนูแล้ว · ช่องเลือกคนตรวจ / Owner และประวัติจะใช้ชื่อใหม่ (ประวัติที่บันทึกไว้ก่อนหน้ายังเป็นชื่อเดิม)'}
                    </p>
                    <button type="button" className="btn-primary" onClick={onClose}>เสร็จสิ้น</button>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="draft-head">
                    <div className="draft-name">👤 แก้ไขบัญชีของฉัน</div>
                </div>

                {error && <div className="alert-error">{error}</div>}

                <form onSubmit={submit}>
                    <div className="field">
                        <label htmlFor="profile-nickname">ชื่อที่แสดง</label>
                        <input id="profile-nickname" value={f.nickname} maxLength={NAME_MAX + 20} autoComplete="nickname"
                            onChange={e => up('nickname', e.target.value)} autoFocus />
                        {nickErr
                            ? <span className="cpw-hint bad">{nickErr}</span>
                            : <span className="cpw-hint">โชว์ในเมนู ช่องเลือกคนตรวจ / Owner และประวัติ · ห้ามซ้ำกับคนอื่น</span>}
                    </div>

                    <div className="field">
                        <label htmlFor="profile-username">ชื่อล็อกอิน (Username)</label>
                        <input id="profile-username" value={f.username} maxLength={USERNAME_MAX + 20} autoComplete="username"
                            autoCapitalize="none" spellCheck={false}
                            onChange={e => up('username', e.target.value)} />
                        {unameErr
                            ? <span className="cpw-hint bad">{unameErr}</span>
                            : <span className="cpw-hint">ใช้ตอนเข้าสู่ระบบ · ห้ามมีช่องว่าง · ตัวพิมพ์เล็ก/ใหญ่ต้องตรงตอนล็อกอิน</span>}
                    </div>

                    {/* เปลี่ยนชื่อล็อกอิน = เปลี่ยนสิ่งที่ใช้เข้าระบบ ต้องยืนยันว่าเป็นเจ้าของจริง (กันคนอื่นแก้ตอนเจ้าของลุกจากเครื่อง) */}
                    {unameChanged && (
                        <div className="field">
                            <label>รหัสผ่านปัจจุบัน (ยืนยันการเปลี่ยนชื่อล็อกอิน)</label>
                            <PasswordInput value={f.password} onChange={e => up('password', e.target.value)} autoComplete="current-password" />
                        </div>
                    )}

                    <div className="modal-actions">
                        <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>ยกเลิก</button>
                        <button type="submit" className="btn-primary" disabled={!canSubmit}>
                            <Icon name="check" size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
