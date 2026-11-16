import { cartValue } from '../data/adGroups.js';

// ป้ายติดตะกร้า / ไม่ติดตะกร้า (TikTok · 11 พ.ย. 2026) — ค่าตั้งต่อชุด Content Type ในฟอร์มแคมเปญ
// หน้า Ads (ใต้ชื่อ KOL) · หน้าเอเจนซี่ / หัวกล่อง Content Type ฝั่งทีม / On Process / ภาพรวมแคมเปญ / KOL รายคน
// value null (ไม่ใช่ TikTok / แคมเปญที่บันทึกก่อนมีช่องนี้) = ไม่ขึ้นป้าย
// agency = ใช้คำว่า "ต้องติดตะกร้า / ไม่ต้องติดตะกร้า" (บอกเอเจนซี่ให้ KOL ทำตอนโพสต์)
// own = ตั้งรายคน (16 พ.ย. 2026 · ต่างจากที่ตั้งไว้ในกลุ่ม) — ต่อท้ายว่า "รายคน" ในแถวของคนนั้น
export default function CartTag({ value, agency = false, own = false }) {
    const v = cartValue(value);
    if (v === null) return null;
    const text = agency ? (v ? '🛒 ต้องติดตะกร้า' : 'ไม่ต้องติดตะกร้า') : (v ? '🛒 ติดตะกร้า' : 'ไม่ติดตะกร้า');
    const tip = own
        ? (v ? 'KOL คนนี้ติดตะกร้า (ตั้งรายคน ต่างจากกลุ่ม)' : 'KOL คนนี้ไม่ติดตะกร้า (ตั้งรายคน ต่างจากกลุ่ม)')
        : (v ? 'ชุดนี้ให้ KOL ติดตะกร้า (TikTok Shop) ในคลิป' : 'ชุดนี้ไม่ติดตะกร้า');
    return <span className={'cart-tag' + (v ? '' : ' no') + (own ? ' own' : '')} title={tip}>{text}{own ? ' · รายคน' : ''}</span>;
}
