import { useEffect, useState } from 'react';
import { fileBlobUrl } from '../api/client.js';
import Icon from './Icon.jsx';

// ดูไฟล์แนบ (รูป / PDF คอมการ์ด / คลิปแนะนำตัว) ในหน้าเว็บเลย
// เดิมใช้วิธีเปิดแท็บใหม่ ซึ่งเบราว์เซอร์บล็อกเป็นป๊อปอัปบ่อย เพราะ window.open ถูกเรียกหลังโหลดไฟล์เสร็จ
// ไม่นับเป็นการกดของผู้ใช้อีกต่อไป — กดคอมการ์ดแล้วเงียบไปเฉย ๆ โดยไม่มีข้อความบอก
export default function FilePreviewModal({ path, title, kind = 'auto', onClose }) {
    const [state, setState] = useState({ loading: true });

    useEffect(() => {
        let alive = true;
        let made = null;
        setState({ loading: true });
        fileBlobUrl(path)
            .then(r => {
                if (!alive) { URL.revokeObjectURL(r.url); return; }
                made = r.url;
                setState({ loading: false, url: r.url, type: r.type });
            })
            .catch(e => { if (alive) setState({ loading: false, error: e.message }); });
        // คืนหน่วยความจำของ blob ตอนปิด ไม่งั้นไฟล์ค้างอยู่ในแท็บจนกว่าจะรีเฟรช
        return () => { alive = false; if (made) URL.revokeObjectURL(made); };
    }, [path]);

    const type = state.type || '';
    const isVideo = kind === 'video' || type.startsWith('video/');
    const isPdf = type.includes('pdf') || /\.pdf$/i.test(title || '');

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide file-prev" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>{title || 'ไฟล์แนบ'}</h3>
                    <button type="button" className="modal-x" onClick={onClose}>×</button>
                </div>

                {state.error && <div className="alert-error">{state.error}</div>}

                <div className="file-prev-body">
                    {state.loading && <div className="file-prev-wait">กำลังโหลดไฟล์...</div>}
                    {state.url && isVideo && <video src={state.url} controls autoPlay />}
                    {state.url && !isVideo && isPdf && <iframe src={state.url} title={title || 'ไฟล์แนบ'} />}
                    {state.url && !isVideo && !isPdf && <img src={state.url} alt={title || 'ไฟล์แนบ'} />}
                </div>

                <div className="modal-actions">
                    {state.url && (
                        <a className="btn-ghost" href={state.url} download={title || 'file'}>
                            <Icon name="download" size={14} /> ดาวน์โหลด
                        </a>
                    )}
                    <button type="button" className="btn-ghost" onClick={onClose}>ปิด</button>
                </div>
            </div>
        </div>
    );
}
