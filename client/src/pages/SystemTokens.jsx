import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';

// ===== หน้า Token ระบบ (เมนู ADMIN · 11 พ.ย. 2026 · มาตรฐาน token ระบบต่อระบบของ JLC) =====
// admin ออก / เพิกถอน token ให้ระบบอื่น (เช่น WeBoostX) มาดึงข้อมูลทางประตูระบบ — ไม่ต้องแก้ .env ไม่ต้อง restart
// token ตัวจริงอยู่ในคำตอบของการออกครั้งเดียว: เก็บไว้ใน state ของหน้านี้เท่านั้น (ไม่ลง localStorage ไม่ลง URL ไม่ลง console)
// ปิดกล่อง / ออกจากหน้า = หายถาวร · รายการในตารางมีแค่ 4 ตัวท้าย

const PREFIX = 'kol_';

const when = v => {
    if (!v) return '';
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
};

// ก๊อปลง clipboard — เบราว์เซอร์ที่ไม่ให้ใช้ navigator.clipboard (http / สิทธิ์ถูกปิด) ใช้ช่องที่เลือกไว้ + execCommand แทน
async function copyText(text, input) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* ลองทางสำรองต่อ */ }
    try {
        if (!input) return false;
        input.focus();
        input.select();
        return document.execCommand('copy');
    } catch {
        return false;
    }
}

// กล่อง token ที่เพิ่งออก — แสดงครั้งเดียว
function FreshToken({ fresh, onClose }) {
    const inputRef = useRef(null);
    const [copied, setCopied] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);

    async function copy() {
        const ok = await copyText(fresh.token, inputRef.current);
        setCopied(ok);
        setCopyFailed(!ok);
    }

    return (
        <div className="systok-fresh" role="status">
            <div className="systok-fresh-title">
                <Icon name="key" size={17} /> token ของ {fresh.name} (ประตู {fresh.scope}) — แสดงครั้งเดียว
            </div>
            <div className="systok-fresh-row">
                <input
                    ref={inputRef} className="systok-fresh-input" readOnly value={fresh.token}
                    aria-label="token ที่เพิ่งออก" onFocus={e => e.target.select()}
                    autoComplete="off" spellCheck={false}
                />
                <button type="button" className="btn-primary" onClick={copy}>
                    <Icon name="copy" size={16} /> {copied ? 'ก๊อปแล้ว ✓' : 'ก๊อป'}
                </button>
            </div>
            {copyFailed && <p className="systok-fresh-note">ก๊อปอัตโนมัติไม่ได้ — เลือกข้อความในช่องแล้วกด Ctrl+C</p>}
            <p className="systok-fresh-note">
                ระบบจะไม่แสดง token นี้อีก — ก๊อปไปใส่ในระบบปลายทางตอนนี้ ถ้าหายให้เพิกถอนแล้วออกใหม่
            </p>
            <button type="button" className="systok-fresh-close" onClick={onClose}>ก๊อปเรียบร้อย ปิดกล่องนี้</button>
        </div>
    );
}

export default function SystemTokens() {
    const [rows, setRows] = useState([]);
    const [doors, setDoors] = useState([]);
    const [maxActive, setMaxActive] = useState(20);
    const [ready, setReady] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [name, setName] = useState('');
    const [scope, setScope] = useState('');
    const [issuing, setIssuing] = useState(false);
    const [formError, setFormError] = useState('');
    const [fresh, setFresh] = useState(null);
    const [revoking, setRevoking] = useState(null);

    function load() {
        setLoading(true);
        return api('/system-tokens')
            .then(res => {
                setRows(res.data || []);
                setDoors(res.doors || []);
                setMaxActive(res.max_active_per_scope || 20);
                setReady(res.ready !== false);
                setScope(s => s || (res.doors && res.doors[0] ? res.doors[0].scope : ''));
                setError('');
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }
    useEffect(() => { load(); }, []);

    const door = doors.find(d => d.scope === scope) || null;
    const doorLabel = s => (doors.find(d => d.scope === s) || {}).label || '';

    async function issue(e) {
        e.preventDefault();
        setFormError('');
        const clean = name.trim();
        if (!clean) { setFormError('กรุณาใส่ชื่อระบบที่จะใช้ token นี้ เช่น WeBoostX'); return; }
        if (!scope) { setFormError('กรุณาเลือกประตูที่จะออก token ให้'); return; }
        setIssuing(true);
        try {
            const res = await api('/system-tokens', { method: 'POST', body: { name: clean, scope } });
            setFresh({ token: res.token, name: res.data.name, scope: res.data.scope });
            setName('');
            await load();
        } catch (err) {
            setFormError(err.message);
        } finally {
            setIssuing(false);
        }
    }

    async function revoke(t) {
        const ask = `เพิกถอน token ของ "${t.name}" (ประตู ${t.scope}, ${PREFIX}…${t.token_hint})?\n\n`
            + 'ระบบนั้นจะดึงข้อมูลไม่ได้ตั้งแต่คำขอถัดไป และกู้คืนไม่ได้';
        if (!confirm(ask)) return;
        setRevoking(t.id);
        try {
            await api(`/system-tokens/${t.id}/revoke`, { method: 'POST' });
            await load();
        } catch (err) {
            alert(err.message);
        } finally {
            setRevoking(null);
        }
    }

    return (
        <div>
            <header className="page-head">
                <h1>Token ระบบ</h1>
                <p className="page-sub">
                    ออก token ให้ระบบอื่นมาดึงข้อมูลจาก KOL Dashboard — ออกและเพิกถอนได้จากหน้านี้ ไม่ต้องแก้ไฟล์บนเซิร์ฟเวอร์
                </p>
            </header>

            {error && <div className="alert-error">{error}</div>}

            {!loading && !ready && (
                <div className="systok-setup">
                    <strong>ยังออก token ไม่ได้</strong> — ฐานข้อมูลยังไม่มีตาราง <code>system_tokens</code>
                    {' '}ให้ผู้ดูแลเซิร์ฟเวอร์รัน <code>npm run setup-db</code> ในโฟลเดอร์ <code>server</code> หนึ่งครั้ง แล้วเปิดหน้านี้ใหม่
                    (ระหว่างนี้ประตูระบบตอบ 503)
                </div>
            )}

            <div className="panel systok-issue">
                <h3>ออก token ใหม่</h3>
                {formError && <div className="alert-error">{formError}</div>}
                <form onSubmit={issue} className="systok-form">
                    <div className="field">
                        <label htmlFor="systok-name">ระบบที่จะใช้ token</label>
                        <input
                            id="systok-name" value={name} maxLength={100} placeholder="เช่น WeBoostX"
                            onChange={e => setName(e.target.value)} autoComplete="off"
                        />
                    </div>
                    <div className="field">
                        <label htmlFor="systok-scope">ประตู (ข้อมูลที่ให้ดึง)</label>
                        <select id="systok-scope" value={scope} onChange={e => setScope(e.target.value)}>
                            {doors.length === 0 && <option value="">—</option>}
                            {doors.map(d => <option key={d.scope} value={d.scope}>{d.scope} — {d.label}</option>)}
                        </select>
                    </div>
                    <button type="submit" className="btn-primary" disabled={issuing || loading || !ready}>
                        <Icon name="key" size={17} /> {issuing ? 'กำลังออก...' : 'ออก token'}
                    </button>
                </form>
                {door && (
                    <p className="systok-hint">
                        ระบบปลายทางส่ง token ใน header <code>{door.header}</code> ไปที่ <code>{door.path}</code>
                        {' '}— เรียกจากฝั่ง server เท่านั้น ห้ามใส่ในหน้าเว็บหรือ URL
                    </p>
                )}
            </div>

            {fresh && <FreshToken fresh={fresh} onClose={() => setFresh(null)} />}

            <div className="panel no-pad systok-table-wrap">
                <table className="data-table systok-table">
                    <thead>
                        <tr>
                            <th>ระบบ</th><th>ประตู</th><th>Token</th><th>ออกโดย · เมื่อ</th>
                            <th>ใช้ล่าสุด</th><th>สถานะ</th><th className="actions">เพิกถอน</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="7" className="empty">กำลังโหลด...</td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan="7" className="empty">ยังไม่เคยออก token</td></tr>
                        ) : rows.map(t => {
                            const off = !!t.revoked_at;
                            return (
                                <tr key={t.id} className={off ? 'systok-off' : undefined}>
                                    <td><strong>{t.name}</strong></td>
                                    <td>
                                        <code>{t.scope}</code>
                                        {doorLabel(t.scope) && <div className="muted systok-small">{doorLabel(t.scope)}</div>}
                                    </td>
                                    <td><code>{PREFIX}…{t.token_hint}</code></td>
                                    <td>
                                        {t.created_by || '—'}
                                        <div className="muted systok-small">{when(t.created_at)}</div>
                                    </td>
                                    <td>{t.last_used_at ? when(t.last_used_at) : <span className="muted">ยังไม่เคยใช้</span>}</td>
                                    <td>
                                        {off ? (
                                            <>
                                                <span className="badge badge-off">เพิกถอนแล้ว</span>
                                                <div className="muted systok-small">
                                                    {[t.revoked_by, when(t.revoked_at)].filter(Boolean).join(' · ')}
                                                </div>
                                            </>
                                        ) : <span className="badge badge-member">ใช้งาน</span>}
                                    </td>
                                    <td className="actions">
                                        {!off && (
                                            <button
                                                type="button" className="btn-ghost danger systok-revoke"
                                                disabled={revoking === t.id} onClick={() => revoke(t)}
                                            >
                                                {revoking === t.id ? 'กำลังเพิกถอน...' : 'เพิกถอน'}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <ul className="systok-notes">
                <li>“ใช้ล่าสุด” อัปเดตไม่ถี่กว่า 10 นาทีครั้ง — เพิ่งเรียกแล้วเวลายังไม่ขยับถือว่าปกติ</li>
                <li>ประตูหนึ่งมี token ที่ใช้งานอยู่ได้ไม่เกิน {maxActive} ตัว · เพิกถอนแล้วมีผลตั้งแต่คำขอถัดไป และแถวยังอยู่เป็นประวัติ</li>
                <li>
                    เปลี่ยน token (หมุน): ออกตัวใหม่ → ระบบปลายทางเปลี่ยนไปใช้ตัวใหม่ → รอให้ “ใช้ล่าสุด” ของตัวใหม่ขยับ → เพิกถอนตัวเก่า
                </li>
                <li>หน้านี้ไม่เก็บและไม่แสดง token ตัวจริงอีกหลังปิดกล่อง — ในฐานข้อมูลมีแค่ค่าแฮชกับ 4 ตัวท้าย</li>
            </ul>
        </div>
    );
}
