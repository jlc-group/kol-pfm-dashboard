// ดราฟงานของ KOL — ตรรกะแปลงข้อมูลระหว่าง submission (ฟิลด์แบน) กับรายการดราฟในโมดัล
// แยกจาก DraftModal.jsx เพราะ .jsx มี JSX ทำให้เทสต์ (node:test) import ตรง ๆ ไม่ได้
// 1 ดราฟ = ลิงก์งาน + Feedback ของทีม + Remark ของเอเจนซี่
// ชื่อฟิลด์: ดราฟ 1 = draft_link / feedback / draft_remark · ดราฟ 2-5 = ต่อท้ายด้วยเลข

export const MAX_DRAFTS = 5;
export const draftSuffix = i => (i === 0 ? '' : String(i + 1));

// สร้าง array ของดราฟจากข้อมูล submission (อย่างน้อย 1 ดราฟ)
// ดราฟ 2-5 ขึ้นเมื่อมีอย่างน้อยอย่างหนึ่ง — รวม Remark ด้วย ไม่งั้นรอบที่เอเจนซี่เขียนแต่หมายเหตุจะหายไป
export function buildDrafts(sub) {
    const s = sub || {};
    const out = [{ link: s.draft_link || '', fb: s.feedback || '', rm: s.draft_remark || '' }];
    for (let i = 1; i < MAX_DRAFTS; i++) {
        const link = s['draft_link' + (i + 1)] || '';
        const fb = s['feedback' + (i + 1)] || '';
        const rm = s['draft_remark' + (i + 1)] || '';
        if (link || fb || rm) out.push({ link, fb, rm });
    }
    return out;
}

// แปลง drafts array + สถานะ เป็น payload ฟิลด์แบน (draft_link / feedback / draft_status / approved)
// opts.canRemark   = เขียน Remark ได้ (ฝั่งเอเจนซี่) · ทีมไม่ส่งช่องนี้มาเลย
// opts.canDecide   = ตัดสินผลตรวจได้ (ฝั่งทีม) · เอเจนซี่ไม่ส่ง draft_status/approved มาเลย จะได้อนุมัติตัวเองไม่ได้
// opts.resetReview = เพิ่งเพิ่มดราฟรอบใหม่ในครั้งนี้ — คนที่ตัดสินไม่ได้ก็ยังต้องล้างผลตรวจรอบก่อนออกได้
//                    ไม่งั้นดราฟใหม่จะขึ้นป้าย Approve ค้างมาจากรอบที่แล้ว เหมือนทีมตรวจไปแล้วทั้งที่ยังไม่ได้ดู
export function draftPayload(drafts, status, opts = {}) {
    const { canRemark = false, canDecide = true, resetReview = false } = opts;
    // ฝั่งเอเจนซี่ (ส่ง Remark ด้วย) ตัดดราฟที่ว่างทุกช่องทิ้งก่อนเขียน — ในฐานจะไม่มีช่องว่างคั่นกลางดราฟ
    // ไม่งั้นตำแหน่งในโมดัล (buildDrafts ตัดช่องว่างตอนโหลด) จะไม่ตรงกับในฐาน พอทีมบันทึกลิงก์จะเลื่อนแต่ Remark ไม่เลื่อน
    // ฝั่งทีมห้ามตัด — ต้องเขียนกลับตำแหน่งเดิมเป๊ะ เพราะไม่ได้ส่ง Remark ไปเลื่อนตาม
    const all = drafts || [];
    const ds = canRemark ? all.filter(d => d && ((d.link || '').trim() || (d.fb || '').trim() || (d.rm || '').trim())) : all;
    const payload = {};
    if (canDecide) {
        payload.draft_status = status || null;
        payload.approved = status === 'approve';
    } else if (resetReview) {
        payload.draft_status = null;
        payload.approved = false;
    }
    for (let i = 0; i < MAX_DRAFTS; i++) {
        payload['draft_link' + draftSuffix(i)] = (ds[i] && ds[i].link) || null;
        payload['feedback' + draftSuffix(i)] = (ds[i] && ds[i].fb) || null;
        if (canRemark) payload['draft_remark' + draftSuffix(i)] = (ds[i] && ds[i].rm) || null;
    }
    return payload;
}

// ลบดราฟที่ i ได้ไหม — ลบแล้วดราฟถัดไปเลื่อนขึ้นมาแทน
// ฝั่งที่ส่ง Remark ด้วย (เอเจนซี่) เลื่อนได้ครบทุกช่อง จึงลบได้เสมอ
// ฝั่งทีมไม่ได้ส่ง Remark (อ่านอย่างเดียว) ถ้าตั้งแต่ดราฟนี้ลงไปมี Remark อยู่ ลิงก์จะเลื่อนแต่ Remark ค้างที่เดิม
// ⇒ Remark ไปติดผิดดราฟ หรือกลายเป็นดราฟผีที่มีแต่ Remark และลบไม่ออก จึงไม่ให้ลบ
// ดราฟ 1 (i = 0) ลบไม่ได้อยู่แล้วทั้งสองฝั่ง
export function canRemoveDraft(drafts, i, canRemark = false) {
    const ds = drafts || [];
    if (i <= 0 || i >= ds.length) return false;
    if (canRemark) return true;
    return !ds.slice(i).some(d => d && (d.rm || '').trim());
}
