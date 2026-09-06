// คลิปต่อคน — 1 กลุ่มกำหนดได้ว่า KOL 1 คนต้องทำกี่คลิป และแต่ละคลิปชื่ออะไร
//
// เก็บข้อมูลเป็น "แถวละคลิป" (submission 1 แถว = 1 คลิป) เพราะช่อง Gencode /
// ลิงก์โพสต์ / ยอดวิว / ข้อมูลแอด ผูกกับคลิปอยู่แล้ว ไม่ต้องย้ายที่
// แถวของคนเดียวกันเชื่อมกันด้วย person_key แล้วหน้าคัดเลือกค่อย "ยุบ" ให้เหลือคนละแถว

// ชื่อคลิปของกลุ่ม — [] แปลว่า 1 คนทำ 1 คลิป (แบบเดิม ไม่ต้องตั้งชื่อ)
export function groupClips(g) {
    if (!g || !Array.isArray(g.clips)) return [];
    return g.clips.map(c => String(c || '').trim()).filter(Boolean);
}
// จำนวนคลิปต่อคน (อย่างน้อย 1 เสมอ)
export function clipCount(g) {
    return Math.max(1, groupClips(g).length);
}

// ยุบแถวพี่น้อง (คนเดียวกันหลายคลิป) ให้เหลือคนละ 1 แถว
// คืนแถวหัว + _clips (ทุกคลิปเรียงตามลำดับ) + budget รวมของทุกคลิป
export function collapseByPerson(subs = []) {
    const map = new Map();
    subs.forEach(s => {
        const key = s.person_key || ('sub:' + s.id);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(s);
    });
    return [...map.values()].map(clips => {
        clips.sort((a, b) => (Number(a.clip_no) || 1) - (Number(b.clip_no) || 1) || (a.id - b.id));
        return {
            ...clips[0],
            _clips: clips,
            budget: clips.reduce((n, c) => n + (Number(c.budget) || 0), 0)
        };
    });
}

// นับจำนวน "คน" (ไม่ใช่จำนวนคลิป)
export function countPeople(subs = []) {
    return new Set(subs.map(s => s.person_key || ('sub:' + s.id))).size;
}
