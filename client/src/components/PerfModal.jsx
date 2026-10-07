import { useState } from 'react';
import { performanceBaseline, performanceSourceInfo, canSelectApi } from '../data/performanceSources.js';
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
export default function PerfModal({ sub, fetchUrl, onSave, onClose, notice }) {
    // ดึงอัตโนมัติได้เฉพาะ TikTok — FB/IG/อื่น ๆ ยังไม่มีทางดึง ต้องกรอกมือ
    const canFetch = sub.platform === "TikTok" && Boolean(fetchUrl);
    // Repost มีเฉพาะ Instagram — แพลตฟอร์มอื่นไม่ต้องขึ้นช่องนี้ให้รก
    const hasRepost = sub.platform === 'Instagram';
    const [f, setF] = useState({
        views: sub.views || '', likes: sub.likes || '', comments: sub.comments || '',
        saves: sub.saves || '', shares: sub.shares || '', reposts: sub.reposts || ''
    });
    const [baseline, setBaseline] = useState(() => performanceBaseline(sub));
    const sourceInfo = performanceSourceInfo(sub);
    const apiEvidence = sub.perf_sources?.api;
    const apiCounter = key => ['available', 'snapshot_only'].includes(apiEvidence?.status)
        ? apiEvidence.metrics?.[key]?.toLocaleString() ?? '—' : '—';
    const useApi = /^tiktok/i.test(String(sub.platform || '').trim()) && canSelectApi(sub.perf_sources, Date.now(), sub.id_post);
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
            setBaseline(performanceBaseline(d));
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
                perf_from: baseline,
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
                <div className="perf-source-panel">
                    <strong>{sourceInfo.label}</strong>
                    <p>{sourceInfo.detail}</p>
                    {sourceInfo.time && <small>บันทึก / รับข้อมูล: {new Date(sourceInfo.time).toLocaleString('th-TH')}</small>}
                    {apiEvidence && <div className="perf-api-preview">
                        <span>ข้อมูล API ที่รับไว้แยก: Views {apiCounter('views')} · Likes {apiCounter('likes')} · Comments {apiCounter('comments')} · Saves {apiCounter('saves')} · Shares {apiCounter('shares')}</span>
                        <button type="button" className="btn-ghost" disabled={saving || !useApi} onClick={async () => {
                            setSaving(true);
                            try { await onSave({ perf_mode: 'api', perf_from: baseline }); onClose(); }
                            catch (err) { setMsg(err.message); }
                            finally { setSaving(false); }
                        }}>ใช้ข้อมูล API</button>
                        {!useApi && <small>ยังเลือก API ไม่ได้: ต้นทางต้องพร้อม มียอดครบ และ sync ภายใน 2 ชั่วโมง</small>}
                    </div>}
                    <small>กดบันทึกจะใช้ค่ากรอกเอง และเก็บข้อมูล API แยกไว้จนกว่าจะเลือกใช้ API</small>
                </div>
                {notice && <div className="perf-manual-note">{notice}</div>}
                {canFetch ? (
                    <button type="button" className="perf-fetch-btn" onClick={fetchTikTok} disabled={fetching}>
                        <Icon name="target" size={15} /> {fetching ? 'กำลังดึง...' : 'ดึงจาก TikTok อัตโนมัติ'}
                    </button>
                ) : (
                    <div className="perf-manual-note">
                        ✍️ กรอก Views และ Engagement จาก Insights ของโพสต์จริง — ค่าแอดและ Reach เป็นคนละตัวเลขกับยอดวิว
                    </div>
                )}
                {msg && <div className="perf-msg">{msg}</div>}

                <div className="field"><label>Views (ยอดวิว)</label><input inputMode="numeric" value={f.views} onChange={e => up('views', e.target.value.replace(/\D/g, ''))} placeholder="0" /></div>
                <div className="field-row">
                    <div className="field"><label>Likes</label><input inputMode="numeric" value={f.likes} onChange={e => up('likes', e.target.value.replace(/\D/g, ''))} placeholder="0" /></div>
                    <div className="field"><label>Comments</label><input inputMode="numeric" value={f.comments} onChange={e => up('comments', e.target.value.replace(/\D/g, ''))} placeholder="0" /></div>
                </div>
                <div className="field-row">
                    <div className="field"><label>Bookmark</label><input inputMode="numeric" value={f.saves} onChange={e => up('saves', e.target.value.replace(/\D/g, ''))} placeholder="0" /></div>
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
