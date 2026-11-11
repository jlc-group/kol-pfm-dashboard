import { cartValue } from '../data/adGroups.js';

// ป้ายติดตะกร้า / ไม่ติดตะกร้า (TikTok · 11 พ.ย. 2026) — ค่าตั้งต่อชุด Content Type ในฟอร์มแคมเปญ
// หน้า Ads (ใต้ชื่อ KOL) · หน้าเอเจนซี่ / หัวกล่อง Content Type ฝั่งทีม / On Process / ภาพรวมแคมเปญ / KOL รายคน
// value null (ไม่ใช่ TikTok / แคมเปญที่บันทึกก่อนมีช่องนี้) = ไม่ขึ้นป้าย
// agency = ใช้คำว่า "ต้องติดตะกร้า / ไม่ต้องติดตะกร้า" (บอกเอเจนซี่ให้ KOL ทำตอนโพสต์)
export default function CartTag({ value, agency = false }) {
    const v = cartValue(value);
    if (v === null) return null;
    const text = agency ? (v ? '🛒 ต้องติดตะกร้า' : 'ไม่ต้องติดตะกร้า') : (v ? '🛒 ติดตะกร้า' : 'ไม่ติดตะกร้า');
    const tip = v ? 'ชุดนี้ให้ KOL ติดตะกร้า (TikTok Shop) ในคลิป' : 'ชุดนี้ไม่ติดตะกร้า';
    return <span className={'cart-tag' + (v ? '' : ' no')} title={tip}>{text}</span>;
}
