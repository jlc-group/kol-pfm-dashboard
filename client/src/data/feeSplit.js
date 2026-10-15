// ===== หารค่าตัวเฉลี่ยของ 1 กลุ่ม × 1 Platform — แยกคนที่ทีมจ้างเองออกจากฝั่งเอเจนซี่ (ผู้ใช้สั่ง 15 ต.ค. 2026) =====
// คนที่ทีมจ้างเอง = แถวที่ทีมเพิ่มเองในหน้าแคมเปญ ไม่ได้ส่งมาทางลิงก์เอเจนซี่ (ไม่มี agency_token)
//   ค่าตัวของคนจ้างเองทีมใส่เองรายคน (ไม่เท่ากัน) — หารเฉลี่ยของเอเจนซี่ต้องไม่ไปแตะ และต้องหักเงินส่วนนี้ออกจากงบก่อน
// กลุ่มที่มีทั้งสองฝั่ง: ค่าตัวต่อคลิปของเอเจนซี่ = (งบ − ค่าตัวคนจ้างเองที่ใส่แล้ว) ÷ ((โควตา − จำนวนคนจ้างเอง) × คลิปต่อคน)
//   เช่น Jernis กลุ่มที่ 2 TikTok: (291,938 − 256,000) ÷ ((30 − 7) × 1) = 1,563
// กลุ่มที่ไม่มีเอเจนซี่เลย (ทีมจ้างเองทั้งกลุ่ม เช่น Review Watson) หรือไม่มีคนจ้างเอง = หารแบบเดิมทุกอย่าง: งบ ÷ (โควตา × คลิปต่อคน)
// ใช้ทั้งหน้าต่างหาร/ล้างค่าตัว (components/DivideFeesModal.jsx) และปุ่มในหน้าแคมเปญ — ไฟล์นี้ไม่แตะ DOM (เทสต์ใน node ได้)

const fee = s => Number(s && s.budget) || 0;
const defaultKey = s => s.person_key || ('sub:' + s.id);

// ส่งมาทางลิงก์เอเจนซี่ = มี agency_token (ลิงก์ถูกลบไปแล้วก็ยังนับเป็นฝั่งเอเจนซี่)
export const isSelfHired = s => !String((s && s.agency_token) || '').trim();

// แผนการหาร — rows = คลิปของกลุ่ม × Platform ที่ไม่ได้ถูก "ไม่เลือก" (feeEligible)
// คืน targetRows = คลิปที่ปุ่มหาร/ล้างแตะได้ · mixed = กลุ่มนี้มีทั้งคนจ้างเองและเอเจนซี่
export function splitPlan({ budget = 0, quota = 0, clips = 1, rows = [], personKey = defaultKey } = {}) {
    const own = rows.filter(isSelfHired);
    const agency = rows.filter(s => !isSelfHired(s));
    const mixed = own.length > 0 && agency.length > 0;
    const b = Number(budget) || 0, q = Number(quota) || 0, c = Number(clips) || 0;
    if (!mixed) {
        const divisor = q * c;
        const perClip = b > 0 && divisor > 0 ? Math.round(b / divisor) : 0;
        return { mixed, own, agency, targetRows: rows, ownPeople: 0, ownFees: 0, ownMissing: 0,
            budgetLeft: b, quotaLeft: q, divisor, perClip, rounding: perClip > 0 ? perClip * divisor - b : 0 };
    }
    const ownPeople = new Set(own.map(personKey)).size;
    const ownFees = own.reduce((n, s) => n + fee(s), 0);
    const ownMissing = own.filter(s => fee(s) <= 0).length;
    const budgetLeft = b - ownFees;
    const quotaLeft = Math.max(0, q - ownPeople);
    const divisor = quotaLeft * c;
    const perClip = budgetLeft > 0 && divisor > 0 ? Math.round(budgetLeft / divisor) : 0;
    return { mixed, own, agency, targetRows: agency, ownPeople, ownFees, ownMissing,
        budgetLeft, quotaLeft, divisor, perClip, rounding: perClip > 0 ? perClip * divisor - budgetLeft : 0 };
}

// คลิปที่ปุ่มหาร/ล้างแตะได้ของกลุ่ม × Platform นี้ (ไม่ต้องรู้งบ) — ใช้เปิด/ปิดปุ่มล้างค่าตัวในหน้าแคมเปญ
export const feeTargets = rows => splitPlan({ rows }).targetRows;
