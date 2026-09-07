import { useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api/client.js';



/**
 * โมดัลกรอกผลงานคอนเทนต์ (Views/Engagement)
 * props:
 *   sub          = submission
 *   fetchUrl     = endpoint ดึงจาก TikTok (เช่น `/ads/${sub.id}/fetch-tiktok` หรือ team route)
 *                  ปุ่มดึงอัตโนมัติขึ้นเฉพาะ TikTok — แพลตฟอร์มอื่นยังไม่มี API ให้ดึง จึงกรอกมืออย่างเดียว
 *   onSave(payload) = async ผู้เรียกยิง API เอง
 *   onClose()
 */
export default function PerfModal({ sub, fetchUrl, onSave, onClose }) {
    // ดึงอัตโนมัติได้เฉพาะ TikTok — FB/IG/อื่น ๆ ยังไม่มีทางดึง ต้องกรอกมือ
    const canFetch = sub.platform === "TikTok";
    // Repost มีเฉพาะ Instagram — แพลตฟอร์มอื่นไม่ต้องขึ้นช่องนี้ให้รก
    const hasRepost = sub.platform === 'Instagram';
    const [f, setF] = useState({
        views: sub.views || '', likes: sub.likes || '', comments: sub.comments || '',
        saves: sub.saves || '', shares: sub.shares || '', reposts: sub.reposts || ''
    });
    const [saving, setSaving] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [msg, setMsg] = useState('');
    const up = (k, v) => setF(s => ({ ...s, [k]: v }));
    const num = v => Number(String(v).replace(/[^\d]/g, '')) || 0;

    const engagement = num(f.likes) + num(f.comments) + num(f.saves) + num(f.shares)
        + (hasRepost ? num(f.reposts) : 0);
    const er = num(f.views) > 0 ? ((engagement / num(f.views)) * 100).toFixed(2) : '0';

    async function fetchTikTok() {
        setFetching(true); setMsg('');
        try {
            const res = await api(fetchUrl, { method: 'POST' });
            const d = res.data || {};
            setF(s => ({
                ...s,
                views: d.views ?? s.views, likes: d.likes ?? s.likes, comments: d.comments ?? s.comments,
                saves: d.saves ?? s.saves, shares: d.shares ?? s.shares
            }));
            setMsg('✓ ดึงข้อมูลจาก TikTok สำเร็จ');
        } catch (err) {
            setMsg('⚠️ ' + (err.message || 'ดึงจาก TikTok ไม่สำเร็จ — ตรวจสอบการตั้งค่า TikTok API'));
        } finally { setFetching(false); }
    }

    async function save() {
        setSaving(true);
        try {
            await onSave({
                views: num(f.views), likes: num(f.likes), comments: num(f.comments),
                saves: num(f.saves), shares: num(f.shares),
                ...(hasRepost ? { reposts: num(f.reposts) } : {})
            });
            onClose();
        } catch (err) { alert(err.message); }
        finally { setSaving(false); }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="draft-head">
                    <div className="draft-name">📊 ผลงานคอนเทนต์ · {sub.account_name} <span className="muted">· {sub.platform || '—'}</span></div>
                </div>
                {canFetch ? (
                    <button type="button" className="perf-fetch-btn" onClick={fetchTikTok} disabled={fetching}>
                        <Icon name="target" size={15} /> {fetching ? 'กำลังดึง...' : 'ดึงจาก TikTok อัตโนมัติ'}
                    </button>
                ) : (
                    <div className="perf-manual-note">
                        ✍️ {sub.platform || "แพลตฟอร์มนี้"} ยังไม่มีช่องทางดึงตัวเลขอัตโนมัติ — กรอกจากหน้า Insights ของโพสต์เอง
                    </div>
                )}
                {msg && <div className="perf-msg">{msg}</div>}

                <div className="field"><label>Views (ยอดวิว)</label><input inputMode="numeric" value={f.views} onChange={e => up('views', e.target.value.replace(/\D/g, ''))} placeholder="0" /></div>
                <div className="field-row">
                    <div className="field"><label>Likes</label><input inputMode="numeric" value={f.likes} onChange={e => up('likes', e.target.value.replace(/\D/g, ''))} placeholder="0" /></div>
                    <div className="field"><label>Comments</label><input inputMode="numeric" value={f.comments} onChange={e => up('comments', e.target.value.replace(/\D/g, ''))} placeholder="0" /></div>
                </div>
                <div className="field-row">
                    <div className="field"><label>Saves</label><input inputMode="numeric" value={f.saves} onChange={e => up('saves', e.target.value.replace(/\D/g, ''))} placeholder="0" /></div>
                    <div className="field"><label>Shares</label><input inputMode="numeric" value={f.shares} onChange={e => up('shares', e.target.value.replace(/\D/g, ''))} placeholder="0" /></div>
                </div>
                {hasRepost && (
                    <div className="field">
                        <label>Repost <span className="dash-section-sub">เฉพาะ Instagram</span></label>
                        <input inputMode="numeric" value={f.reposts} onChange={e => up('reposts', e.target.value.replace(/\D/g, ''))} placeholder="0" />
                    </div>
                )}
                <div className="perf-er">Engagement รวม: <b>{engagement.toLocaleString()}</b> · Engagement Rate: <b>{er}%</b></div>

                <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={onClose}>ปิด</button>
                    <button type="button" className="btn-primary" onClick={save} disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
                </div>
            </div>
        </div>
    );
}
