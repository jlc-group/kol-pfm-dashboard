import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

// หาโพสต์ IG / FB จากรายการโพสต์ KOL ของ WeBoostX ให้แถวที่ยังไม่มี ID POST (หน้า Ads · 26 ต.ค. 2026)
// server เรียงตัวเลือกจากชื่อ KOL / วันลงโพสต์ / สินค้า ที่อ่านจาก "ชื่อแอด" (services/weboostxPosts.js) — ชื่อแอดอาจไม่ตรงโพสต์จริง
// จึงไม่เลือกให้เอง: คนต้องเลือก → เปิดดูโพสต์ → ติ๊กยืนยัน → server ถาม WeBoostX ซ้ำแล้วเก็บ ID POST + ลงค่าแอดให้ทันที

const LEVEL = { high: ['ใกล้เคียงมาก', 'high'], mid: ['น่าจะใช่', 'mid'], low: ['ไม่แน่ใจ', 'low'] };
const fmtDay = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—');
const fmtNum = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString('th-TH'));

export default function WxPostFinder({ row, canCost, onClose, onSaved }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [q, setQ] = useState('');
    const [query, setQuery] = useState('');
    const [picked, setPicked] = useState(null);
    const [checked, setChecked] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    useEffect(() => {
        let alive = true;
        setLoading(true); setError('');
        api(`/ads/${row.sub_id}/wx-posts${query ? `?q=${encodeURIComponent(query)}` : ''}`)
            .then(r => { if (alive) setData(r.data); })
            .catch(e => { if (alive) setError(e.message || 'ดึงรายการโพสต์ไม่ได้'); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [row.sub_id, query]);

    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape' && !saving) onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose, saving]);

    const pick = c => { setPicked(c); setChecked(false); setSaveError(''); };
    async function confirm() {
        if (!picked || !checked) return;
        setSaving(true); setSaveError('');
        try {
            await api(`/ads/${row.sub_id}/wx-confirm`, { method: 'POST', body: { id_post: picked.id_post, fb_story_id: picked.fb_story_id || undefined } });
            onSaved();
            onClose();
        } catch (e) {
            setSaveError(e.message || 'บันทึกไม่สำเร็จ');
        } finally { setSaving(false); }
    }

    const list = data ? data.candidates : [];
    return (
        <div className="modal-backdrop" onClick={() => { if (!saving) onClose(); }}>
            <div className="modal wx-find" role="dialog" aria-label="หาโพสต์จาก WeBoostX" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>🔍 หาโพสต์จาก WeBoostX</h3>
                    <button type="button" className="modal-x" aria-label="ปิด" onClick={onClose} disabled={saving}>×</button>
                </div>

                <div className="wx-find-clip">
                    <div><span className="muted">คลิปนี้</span> <b>{row.account_name || '—'}</b> · {row.platform} · {row.brand}</div>
                    <div><span className="muted">วันลงโพสต์</span> {fmtDay(row.post_date)} · <span className="muted">สินค้า</span> {row.product || '—'}</div>
                    {/^https?:\/\//i.test(String(row.post_url || '')) && <div><span className="muted">ลิงก์ที่ทีมใส่</span> <a href={row.post_url} target="_blank" rel="noopener noreferrer">เปิดดู ↗</a></div>}
                </div>

                {!picked ? (
                    <>
                        <p className="wx-find-hint">
                            ตัวเลือกเรียงจากชื่อ KOL / วันลงโพสต์ / สินค้า ที่อ่านจาก<b>ชื่อแอด</b> — ชื่อแอดอาจไม่ตรงโพสต์จริง
                            ต้องเปิดดูโพสต์ก่อนเลือกทุกครั้ง
                        </p>
                        <form className="wx-find-search" onSubmit={e => { e.preventDefault(); setQuery(q.trim()); }}>
                            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นชื่อที่ทีมตั้งในแอด หรือ ID โพสต์" aria-label="ค้นชื่อในแอด" />
                            <button type="submit" className="btn-ghost" disabled={loading}>ค้น</button>
                            {query && <button type="button" className="btn-ghost" onClick={() => { setQ(''); setQuery(''); }}>ดูที่ใกล้เคียง</button>}
                        </form>
                        {error && <div className="alert-error">{error}</div>}
                        {loading ? <p className="muted wx-find-empty">กำลังดึงรายการโพสต์...</p>
                            : !error && list.length === 0 ? (
                                <p className="muted wx-find-empty">
                                    {query ? `ไม่เจอโพสต์ที่ชื่อในแอดมีคำว่า "${query}"` : 'ไม่เจอโพสต์ที่ชื่อ KOL / วันที่ / สินค้าใกล้เคียง'}
                                    {data ? ` (จากโพสต์ที่แอดของเราโปรโมต ${data.total} โพสต์)` : ''} — ลองค้นด้วยชื่อที่ทีมตั้งในแอด
                                </p>
                            ) : (
                                <ul className="wx-find-list">
                                    {list.map(c => (
                                        <li key={c.id_post} className="wx-find-item">
                                            <div className="wx-find-top">
                                                <b className="wx-find-creator">{c.creator || 'ไม่มีชื่อในแอด'}</b>
                                                <span className={'wx-find-level ' + LEVEL[c.level][1]}>{LEVEL[c.level][0]}</span>
                                                {c.permalink
                                                    ? <a className="wx-find-open" href={c.permalink} target="_blank" rel="noopener noreferrer">เปิดโพสต์ ↗</a>
                                                    : <span className="muted wx-find-open">ไม่มีลิงก์โพสต์</span>}
                                            </div>
                                            <div className="wx-find-reasons">
                                                {c.reasons.map((r, i) => <span key={i} className={'wx-find-reason' + (r.ok ? ' ok' : '')}>{r.ok ? '✓' : '•'} {r.text}</span>)}
                                            </div>
                                            <div className="wx-find-meta">
                                                <span>ลงโพสต์ (ตามชื่อแอด) {fmtDay(c.post_date)}</span>
                                                <span>ยิงแอด {fmtDay(c.first_ad_date)} – {fmtDay(c.last_ad_date)}</span>
                                                {c.sku_codes.length > 0 && <span>สินค้า {c.sku_codes.join(', ')}</span>}
                                                <span>แอด {fmtNum(c.ads_count)} ตัว · Reach {fmtNum(c.ad_reach)}</span>
                                                {canCost && c.ad_spend !== null && <span>ค่าแอด ฿{fmtNum(c.ad_spend)}</span>}
                                                <span className="wx-find-id">ID {c.fb_story_id || c.id_post}</span>
                                            </div>
                                            {c.used_by.length > 0 && (
                                                <div className="wx-find-used">⚠ ผูกกับคลิปอื่นแล้ว: {c.used_by.map(u => u.account_name || 'คลิปของแบรนด์อื่น').join(', ')}</div>
                                            )}
                                            <button type="button" className="btn-ghost wx-find-pick" onClick={() => pick(c)}>เลือกโพสต์นี้</button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                    </>
                ) : (
                    <div className="wx-find-confirm">
                        <div className="wx-find-item chosen">
                            <div className="wx-find-top">
                                <b className="wx-find-creator">{picked.creator || 'ไม่มีชื่อในแอด'}</b>
                                {picked.permalink
                                    ? <a className="wx-find-open" href={picked.permalink} target="_blank" rel="noopener noreferrer">เปิดโพสต์ ↗</a>
                                    : <span className="muted wx-find-open">ไม่มีลิงก์โพสต์</span>}
                            </div>
                            <div className="wx-find-meta">
                                <span>ลงโพสต์ (ตามชื่อแอด) {fmtDay(picked.post_date)}</span>
                                {picked.sku_codes.length > 0 && <span>สินค้า {picked.sku_codes.join(', ')}</span>}
                                <span className="wx-find-id">ID POST ที่จะเก็บ {picked.fb_story_id || picked.id_post}</span>
                            </div>
                            {!picked.permalink && <div className="wx-find-used">⚠ WeBoostX ไม่มีลิงก์ของโพสต์นี้ — เทียบได้จากชื่อแอดอย่างเดียว ตรวจให้แน่ใจก่อนยืนยัน</div>}
                            {picked.used_by.length > 0 && <div className="wx-find-used">⚠ โพสต์นี้ผูกกับคลิปอื่นแล้ว: {picked.used_by.map(u => u.account_name || 'คลิปของแบรนด์อื่น').join(', ')}</div>}
                        </div>
                        <label className="wx-find-check">
                            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
                            เปิดดูโพสต์แล้ว เป็นโพสต์เดียวกับคลิปของ <b>{row.account_name || 'KOL คนนี้'}</b>
                        </label>
                        <p className="muted wx-find-after">ยืนยันแล้ว ระบบเก็บ ID POST ในแถวนี้ (แก้ภายหลังได้ที่แท็บ On Process) แล้วดึงค่าแอด / Reach ของโพสต์นี้มาให้ทันที</p>
                        {saveError && <div className="alert-error">{saveError}</div>}
                        <div className="modal-actions">
                            <button type="button" className="btn-ghost" onClick={() => setPicked(null)} disabled={saving}>← กลับไปเลือก</button>
                            <button type="button" className="btn-primary" onClick={confirm} disabled={!checked || saving}>{saving ? 'กำลังบันทึก...' : 'ยืนยัน เก็บ ID POST'}</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
