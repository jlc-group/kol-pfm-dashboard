export const PERFORMANCE_KEYS = ['views', 'likes', 'comments', 'saves', 'shares', 'reposts'];
export const performanceBaseline = row => Object.fromEntries(PERFORMANCE_KEYS.map(k => [k, Number(row[k]) || 0]));

export function canSelectApi(state, now = Date.now(), idPost = state?.api?.id_post) {
    const api = state?.api;
    const observed = Date.parse(api?.observed_at || '');
    return Boolean(api?.status === 'available' && api.id_post === String(idPost || '').trim() && Number.isFinite(observed)
        && observed <= now && now - observed <= 2 * 60 * 60 * 1000
        && PERFORMANCE_KEYS.filter(k => k !== 'reposts').every(k => Number.isFinite(api.metrics?.[k]) && api.metrics[k] >= 0)
        && api.metrics.views > 0);
}

export function performanceSourceInfo(row, now = Date.now()) {
    const state = row.perf_sources;
    const status = state?.api?.status || row.organic_metrics_status;
    const selectedPost = state?.mode === 'manual' ? state.manual?.id_post : state?.api?.id_post;
    if (selectedPost && selectedPost !== String(row.id_post || '').trim()) return {
        label: 'ยอดของคลิปเดิม', detail: 'ID Post เปลี่ยนแล้ว กรุณากรอกผลงานของคลิปใหม่ หรือเลือก API ที่ตรงกับคลิปใหม่'
    };
    if (state?.mode === 'manual') return {
        label: 'ใช้ค่ากรอกเอง', time: state.manual?.saved_at,
        detail: 'API จะเก็บแยกและไม่ทับผลงานที่กรอก เลือกกลับไปใช้ API ได้เมื่อข้อมูลพร้อม'
    };
    const observed = Date.parse(state?.api?.observed_at || '');
    if (Number.isFinite(observed) && now - observed > 2 * 60 * 60 * 1000) return {
        label: 'ข้อมูล sync ค้าง', time: state.api.observed_at,
        detail: 'ไม่ได้รับข้อมูลจาก PFM เกิน 2 ชั่วโมง ผลที่เห็นคำนวณจากค่าที่เก็บไว้'
    };
    const labels = {
        snapshot_only: 'ยอดเดิมจากต้นทาง', source_unavailable: 'ต้นทางยังดึงยอดไม่ได้',
        pending: 'รอยอดจากต้นทาง', source_not_found: 'ต้นทางไม่พบคลิป'
    };
    if (labels[status]) return {
        label: labels[status], time: state?.api?.observed_at,
        detail: 'เวลา sync เป็นเวลารับข้อมูล ไม่ใช่เวลาที่ TikTok อัปเดตยอดคลิป ผลที่เห็นอาจใช้ยอดเดิม'
    };
    if (state?.api && PERFORMANCE_KEYS.some(k => state.api.metrics?.[k] !== undefined
        && Number(row[k] || 0) !== state.api.metrics[k])) return {
        label: 'ยอดที่ใช้ต่างจาก API', time: state.api.observed_at,
        detail: 'ระบบเก็บยอดที่ใช้เดิมไว้ เปิดกรอกผลงานเพื่อเทียบค่าและเลือก API เมื่อพร้อม'
    };
    if (state?.api) return {
        label: state.mode === 'api' ? 'ใช้ยอด API' : 'ยอด API / ค่าที่เก็บไว้', time: state.api.observed_at,
        detail: 'ยังไม่ยืนยันเวลาที่ดึงยอดคลิปสำเร็จจากต้นทาง ค่าแอดและ Reach อัปเดตแยกจากยอดคลิป'
    };
    return { label: Number(row.views) > 0 ? 'ยอดที่เก็บไว้ · ยังไม่ระบุแหล่ง' : 'ยังไม่มีผลงาน',
        detail: 'ข้อมูลเดิมยังไม่มีหลักฐานแหล่งที่มา จะบันทึกแหล่งเมื่อกรอกหรือรับ API รอบใหม่' };
}
