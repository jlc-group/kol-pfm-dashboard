// Evidence of a past launch is separate from the team's confirmation and live delivery.
export function hasAdSpend(row) {
    return typeof row.ad_has_spend === 'boolean' ? row.ad_has_spend
        : Boolean(row.ad_done_from_spend) || Number(row.ad_spend) > 0;
}

export function adEvidence(row, confirmed, automatic, noAd = false) {
    if (hasAdSpend(row)) return { kind: 'paid', label: 'มีค่าแอดแล้ว', detail: 'ยืนยันจากค่าแอดสะสม' };
    if (confirmed) return automatic
        ? { kind: 'reported', label: 'PFM แจ้งว่าเริ่มยิงแล้ว', detail: 'ยังไม่มีค่าแอดยืนยัน' }
        : { kind: 'reported', label: 'ทีมยืนยันว่าเริ่มยิงแล้ว', detail: 'ยังไม่มีค่าแอดยืนยัน' };
    if (noAd) return { kind: 'pending', label: 'ไม่ต้องยิงแอด', detail: 'กลุ่มไม่ใช้ Gencode' };
    return { kind: 'pending', label: 'ยังไม่มีข้อมูลว่าเริ่มยิง', detail: automatic ? 'รอข้อมูลจาก PFM' : 'ทีมยังไม่ยืนยัน / ยังไม่มีค่าแอด' };
}
