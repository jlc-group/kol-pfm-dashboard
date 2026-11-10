import { dayLeftLevel, DAY_LEFT_WHY } from '../data/dayLeft.js';

// ป้ายวัน Gencode ที่เหลือ — หน้า KOL Analytics (คอลัมน์ Day Left) และหน้า Ads (คอลัมน์ DAY LEFT · 10 พ.ย. 2026)
//   ต่ำกว่า 10 วัน = แดง | 10-20 วัน = เหลือง | 21 วันขึ้นไป = เขียว | ติดลบ = หมดอายุแล้ว
// none = กลุ่มตั้ง "-" (ไม่ใช้ Gencode) และแถวนี้ไม่มี Gencode — ขึ้น "ไม่ใช้" ให้แยกออกจาก "—" ที่แปลว่ายังไม่มีข้อมูล
// detail = ข้อความต่อท้ายคำอธิบายตอนชี้ (เช่น วันหมดอายุ) · ไม่ส่ง = คำอธิบายแบบเดิมของหน้า KOL Analytics
export default function DayLeft({ days, none = false, detail = '' }) {
    const level = dayLeftLevel(days, none);
    if (level === 'none') return <span className="muted" title="กลุ่มนี้ไม่ใช้ Gencode">ไม่ใช้</span>;
    if (level === 'unknown') return <span className="muted">—</span>;
    const tip = DAY_LEFT_WHY[level] + (detail ? '\n' + detail : '');
    if (level === 'over') return <span className="dayleft over" title={tip}>หมดอายุแล้ว</span>;
    return <span className={'dayleft ' + level} title={tip}>{Number(days)} Days</span>;
}
