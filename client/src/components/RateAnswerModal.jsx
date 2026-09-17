import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Icon from './Icon.jsx';

// ตอบราคาให้คำขอสอบถามราคาหนึ่งใบ
// ฝั่งซ้ายคือสิ่งที่ทีมขอมา (อ่านอย่างเดียว) ฝั่งล่างคือคำตอบ — ตอบแล้วสถานะขยับจาก "รอตอบ" เป็น "ตอบแล้ว" ให้เอง
const B = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const fmtDT = s => {
    if (!s) return '—';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
};

export default function RateAnswerModal({ item, onClose, onSaved }) {
    const [rate, setRate] = useState(item.quoted_rate == null ? '' : String(item.quoted_rate));
    const [note, setNote] = useState(item.answer_note || '');
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');
    const [done, setDone] = useState(false);
    // หน้าแม่ส่งคำขอที่บันทึกแล้วกลับมาให้ — ช่องกรอกต้องตรงกับค่าล่าสุดในฐาน
    useEffect(() => {
        setRate(item.quoted_rate == null ? '' : String(item.quoted_rate));
        setNote(item.answer_note || '');
    }, [item.id, item.answered_at]);   // eslint-disable-line react-hooks/exhaustive-deps

    async function save(status) {
        setBusy(status || 'save'); setErr(''); setDone(false);
        try {
            const body = { quoted_rate: rate === '' ? null : Number(rate), answer_note: note };
            if (status) body.status = status;
            const res = await api(`/rate-requests/${item.id}`, { method: 'PATCH', body });
            setDone(true);
            onSaved(res.data);
        } catch (e) { setErr(e.message); }
        finally { setBusy(''); }   // ต้องคืนปุ่มทุกทาง ไม่งั้นบันทึกสำเร็จแล้วปุ่มค้าง "กำลังบันทึก..."
    }

    const platforms = Array.isArray(item.platforms) ? item.platforms : [];
    const products = Array.isArray(item.products) ? item.products : [];

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>สอบถามราคา {item.request_type === 'presenter' ? '(Presenter)' : '(KOL)'} · {item.kol_name}</h3>
                    <button type="button" className="modal-x" onClick={onClose}>×</button>
                </div>
                <p className="ctype-lead">
                    เปิดคำขอโดย {item.created_by || '—'} เมื่อ {fmtDT(item.created_at)}
                    {item.brand ? ` · ${item.brand}` : ''}
                </p>

                {err && <div className="alert-error">{err}</div>}

                <div className="req-facts">
                    <div><span>งบที่ตั้งไว้</span><b>{item.no_budget ? 'ไม่กำหนด' : B(item.budget)}</b></div>
                    <div><span>ช่องทาง</span><b>{platforms.length ? platforms.join(' · ') : '—'}</b></div>
                    <div><span>สินค้า</span><b>{products.length ? products.join(', ') : '—'}</b></div>
                    {item.request_type === 'presenter' && (
                        <div><span>ระยะเวลาสัญญา</span><b>{item.contract_period || '—'}</b></div>
                    )}
                </div>

                {item.scope && <div className="req-spec"><Icon name="file" size={14} /> {item.scope}</div>}
                {(item.link_account || item.brief_link || item.brief_note) && (
                    <div className="req-cand-links" style={{ marginBottom: 12 }}>
                        {item.link_account && <a className="work-link" href={item.link_account} target="_blank" rel="noreferrer"><Icon name="eye" size={12} /> Account</a>}
                        {item.brief_link && <a className="work-link" href={item.brief_link} target="_blank" rel="noreferrer"><Icon name="eye" size={12} /> บรีฟ</a>}
                        {item.brief_note && <span className="req-cand-note">📝 {item.brief_note}</span>}
                    </div>
                )}

                <div className="hire-grid">
                    <label className="hire-f">
                        <span>ราคาที่ได้ (บาท)</span>
                        <input inputMode="numeric" value={rate} autoFocus
                            onChange={e => setRate(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" />
                    </label>
                    <label className="hire-f wide">
                        <span>โน้ตคำตอบ</span>
                        <input value={note} onChange={e => setNote(e.target.value)}
                            placeholder="เช่น ราคานี้รวมไลฟ์ 1 รอบ / ว่างเฉพาะต้นเดือน" />
                    </label>
                </div>

                {done && <div className="rate-sent-note">✓ บันทึกคำตอบแล้ว</div>}
                {item.answered_by && (
                    <div className="rate-answered">ตอบล่าสุดโดย {item.answered_by} · {fmtDT(item.answered_at)}</div>
                )}

                <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={onClose}>ปิดหน้าต่าง</button>
                    {item.status === 'closed' ? (
                        <button type="button" className="btn-ghost" disabled={busy === 'open'} onClick={() => save('open')}>
                            เปิดคำขอใหม่
                        </button>
                    ) : (
                        <button type="button" className="btn-ghost" disabled={busy === 'closed'} onClick={() => save('closed')}>
                            {busy === 'closed' ? 'กำลังบันทึก...' : 'ตอบแล้ว ปิดงาน'}
                        </button>
                    )}
                    <button type="button" className="btn-primary" disabled={busy === 'save'} onClick={() => save(null)}>
                        {busy === 'save' ? 'กำลังบันทึก...' : 'บันทึกคำตอบ'}
                    </button>
                </div>
            </div>
        </div>
    );
}
