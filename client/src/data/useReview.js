import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

// คนตรวจคลิปของแคมเปญ (27 ต.ค. 2026) — ป้อน prop review ให้ตาราง On Process (ฝั่งทีมเท่านั้น)
// reload = โหลดแคมเปญ + รายชื่อใหม่ (review_assign อยู่ที่แคมเปญ · reviewer_id อยู่ที่คลิป)
// เปลี่ยนแล้วยิง event ให้เลขแดงเมนู "งานของฉัน" นับใหม่
export function useReview(project, reload) {
    const { user } = useAuth();
    const id = project ? project.id : null;
    // null = ยังโหลดไม่เสร็จ / โหลดไม่ได้ (ดรอปดาวน์ล็อกไว้ ไม่เดาว่าคนตรวจไม่มีสิทธิ์) · โหลดไม่ได้ลองใหม่ตอนกลับมาที่แท็บ
    const [options, setOptions] = useState(null);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (!id) return undefined;
        let alive = true;
        setOptions(null);
        api(`/projects/${id}/reviewer-options`).then(r => { if (alive) setOptions(r.data || []); }).catch(() => {});
        return () => { alive = false; };
    }, [id, retry]);
    useEffect(() => {
        if (!id || options) return undefined;
        const again = () => { if (document.visibilityState !== 'hidden') setRetry(n => n + 1); };
        document.addEventListener('visibilitychange', again);
        return () => document.removeEventListener('visibilitychange', again);
    }, [id, options]);
    const run = useCallback(async call => {
        try { await call(); } catch (e) { alert(e.message || 'บันทึกคนตรวจไม่สำเร็จ'); }
        finally { reload(); window.dispatchEvent(new Event('kol:my-work-changed')); }
    }, [reload]);
    const assign = project ? project.review_assign : null;
    return useMemo(() => (id ? {
        me: user ? user.id : null,
        options,
        assign: assign || {},
        setDefault: rid => run(() => api(`/projects/${id}/review-assign`, { method: 'PUT', body: { default: rid } })),
        setGroup: (key, rid) => run(() => api(`/projects/${id}/review-assign`, { method: 'PUT', body: { groups: { [key]: rid } } })),
        setClip: (subIds, rid) => run(() => api(`/projects/${id}/clip-reviewer`, { method: 'PUT', body: { sub_ids: subIds, reviewer_id: rid } }))
    } : null), [id, user, options, assign, run]);
}
