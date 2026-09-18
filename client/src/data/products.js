// คลังรายชื่อสินค้า (รหัส + ชื่อ + แบรนด์) — ใช้ในดรอปดาวน์เลือกสินค้า (กรองตามแบรนด์ของ Project)
export const PRODUCT_CATALOG = [
    // ===== Jula's Herb =====
    { code: 'C1', name: 'เจลแต้มสิวดอกดาวเรือง', brand: "Jula's Herb" },
    { code: 'C2', name: 'เซรั่มมะรุมเปปไทด์', brand: "Jula's Herb" },
    { code: 'C3', name: 'กันแดดน้ำนมเมลอน', brand: "Jula's Herb" },
    { code: 'C4', name: 'เซรั่มขิงดำ', brand: "Jula's Herb" },
    { code: 'A1', name: 'บีบีโลชั่นแตงโม', brand: "Jula's Herb" },
    { code: 'L3', name: 'ดีดีครีมแตงโม', brand: "Jula's Herb" },
    { code: 'L4', name: 'เซรั่มลำไย', brand: "Jula's Herb" },
    { code: 'L6', name: 'เซรั่มแครอท', brand: "Jula's Herb" },
    { code: 'L7', name: 'โดสส้มแดง กลูต้าซีไฮยา', brand: "Jula's Herb" },
    { code: 'L8A', name: 'อีอีคูชั่นแตงโม เบอร์ 01', brand: "Jula's Herb" },
    { code: 'L8B', name: 'อีอีคูชั่นแตงโม เบอร์ 02', brand: "Jula's Herb" },
    { code: 'L10', name: 'กันแดดแตงโม 3D ออร่า', brand: "Jula's Herb" },
    { code: 'L13', name: 'บลูโรสอนเดอร์อาร์มครีม', brand: "Jula's Herb" },
    { code: 'L14', name: 'วิปโฟมล้างหน้าแตงโม', brand: "Jula's Herb" },
    { code: 'L19', name: 'มอยส์เจลฉ่ำบัว', brand: "Jula's Herb" },
    { code: 'L20', name: 'กันแดดเจลทานตะวัน', brand: "Jula's Herb" },
    { code: 'S1', name: 'สบู่ดาวเรือง', brand: "Jula's Herb" },
    { code: 'S2', name: 'สบู่แตงโม', brand: "Jula's Herb" },
    { code: 'S3', name: 'สบู่ลำไย', brand: "Jula's Herb" },
    { code: 'S4', name: 'สบู่แครอท', brand: "Jula's Herb" },
    { code: 'T5A', name: 'ลิปเซรั่มแทททู (ชมพู)', brand: "Jula's Herb" },
    { code: 'T5B', name: 'ลิปเซรั่มแทททู (แดง)', brand: "Jula's Herb" },
    { code: 'T5C', name: 'ลิปเซรั่มแทททู (ส้ม)', brand: "Jula's Herb" },
    { code: 'T6A', name: 'แป้งพัพแตงโม', brand: "Jula's Herb" },
    { code: 'L1', name: 'บีบี บอดี้โลชั่น พลัส', brand: "Jula's Herb" },
    { code: 'L9', name: 'มอยส์เจอร์อโวคาโด', brand: "Jula's Herb" },
    { code: 'L11', name: 'โลชั่นโดสส้มแดง', brand: "Jula's Herb" },
    // ===== Jarvit =====
    { code: 'V1', name: 'กลูต้า จารวิต', brand: 'Jarvit' },
    // ===== Jdent =====
    { code: 'D2', name: 'ยาสีฟันเจเด็นท์ สูตรลดเสียวฟัน (สีชมพู)', brand: 'Jdent' },
    { code: 'D3', name: 'ยาสีฟันเจเด็นท์ สูตรฟันขาว (สีเขียว)', brand: 'Jdent' },
    // ===== Jernis =====
    { code: 'JNP1', name: 'Morinng Bloom', brand: 'Jernis' },
    { code: 'JNP2', name: 'Midnight Muse', brand: 'Jernis' },
    { code: 'JNP3', name: 'Soft Whisper', brand: 'Jernis' },
    // ===== Beauterry =====
    { code: 'BTA1-01', name: 'บิวเทอร์รี่ ลิป (DUSTY ROSE)', brand: 'Beauterry' },
    { code: 'BTA1-02', name: 'บิวเทอร์รี่ ลิป (PEONY PINK)', brand: 'Beauterry' },
    { code: 'BTA1-03', name: 'บิวเทอร์รี่ ลิป (BARE TAUPE)', brand: 'Beauterry' },
    { code: 'BTA1-04', name: 'บิวเทอร์รี่ ลิป (ROSE WOOD)', brand: 'Beauterry' },
    { code: 'BTA1-05', name: 'บิวเทอร์รี่ ลิป (SOFT AMBER)', brand: 'Beauterry' },
    { code: 'BTA1-06', name: 'บิวเทอร์รี่ ลิป (CORAL POP)', brand: 'Beauterry' },
    { code: 'BTA2-01', name: 'บิวเทอร์รี่ บลัช พาเลตต์ (COOL ROSY)', brand: 'Beauterry' },
    { code: 'BTA2-02', name: 'บิวเทอร์รี่ บลัช พาเลตต์ (NEUTRAL POISE)', brand: 'Beauterry' },
    { code: 'BTA2-03', name: 'บิวเทอร์รี่ บลัช พาเลตต์ (WARM ALLURE)', brand: 'Beauterry' },
    { code: 'BTA3-01', name: 'บิวเทอร์รี่ อาย พาเลตต์ (COOL BERRY)', brand: 'Beauterry' },
    { code: 'BTA3-02', name: 'บิวเทอร์รี่ อาย พาเลตต์ (QUIET NUDE)', brand: 'Beauterry' },
    { code: 'BTA3-03', name: 'บิวเทอร์รี่ อาย พาเลตต์ (WARM COZY)', brand: 'Beauterry' },
    { code: 'BTA4-00', name: 'บิวเทอร์รี่ คุชชั่น (WHITE CLOUD)', brand: 'Beauterry' },
    { code: 'BTA4-01', name: 'บิวเทอร์รี่ คุชชั่น (FAIR LIGHT)', brand: 'Beauterry' },
    { code: 'BTA4-02', name: 'บิวเทอร์รี่ คุชชั่น (COOL PORCELAIN)', brand: 'Beauterry' },
    { code: 'BTA4-03', name: 'บิวเทอร์รี่ คุชชั่น (WARM IVORY)', brand: 'Beauterry' },
    { code: 'BTA4-04', name: 'บิวเทอร์รี่ คุชชั่น (NEUTRAL BEIGE)', brand: 'Beauterry' },
    { code: 'BTA4-05', name: 'บิวเทอร์รี่ คุชชั่น (COOL PETAL)', brand: 'Beauterry' },
    { code: 'BTA4-06', name: 'บิวเทอร์รี่ คุชชั่น (WARM SAND)', brand: 'Beauterry' },
    { code: 'BTA4-07', name: 'บิวเทอร์รี่ คุชชั่น (WARM HONEY)', brand: 'Beauterry' }
];

// แสดงเป็น "รหัส - ชื่อ" (ถ้าไม่พบในคลัง คืนค่าเดิม)
export function productLabel(code) {
    const p = PRODUCT_CATALOG.find(x => x.code === code);
    return p ? `${p.code} - ${p.name}` : code;
}

// รายการสินค้าของแบรนด์ (ถ้าไม่ระบุแบรนด์ = คืนทั้งหมด)
export function productsByBrand(brand) {
    return brand ? PRODUCT_CATALOG.filter(p => p.brand === brand) : PRODUCT_CATALOG;
}

// ===== Target Audience ต่อรหัสสินค้า =====
const T_SUN = ['MF_SUN_MASS_18_54', 'F_SUN_MASS_18_54'];
const T_MELASMA = ['F_MELASMA_25_54', 'MF_MELASMA_25_54', 'MF_MELASMA_35-99'];
const T_AGING = ['F_AGING_25_44', 'MF_AGING_35_99', 'MF_BEAUTY_ENTNEWS_25_99'];
const T_WHITE = ['F_WHITE_MOIST_18_44', 'F_WHITE_MOIST_25_44', 'MF_BEAUTY_ENTNEWS_18_44'];
const T_BODY = ['F_BODYCARE_18_54', 'MF_BODYCARE_18_54'];
const T_MAKEUP = ['F_MAKEUP_18_54', 'F_SUN_MASS_18_54', 'MF_SUN_MASS_18_54'];
const T_SUNBODY = ['MF_SUNBODY_18_54', 'F_SUNBODY_18_54', 'MF_SUN_MASS_18_54'];
const T_ORAL = ['F_ORALCARE_18-54', 'MF_ORALCARE_18-54', 'MF_ORALYOUNG_13-34', 'MF_ORALCARE_13_99', 'M_ORALCARE_18-54', 'MF_ORALADULT_35-99'];
const T_ACNE = ['MF_ACNE_13-34', 'MF_AGING_35_99'];
const T_BTY_MAKEUP = ['F_Beauty-Make up_18-44']; // Beauterry (เครื่องสำอาง)

export const TARGET_MAP = {
    L3: T_SUN, L10: T_SUN, L20: T_SUN, C3: T_SUN,
    L4: T_MELASMA, S3: T_MELASMA,
    L6: T_AGING, S4: T_AGING,
    L7: T_WHITE, L19: T_WHITE, L9: T_WHITE, L11: T_WHITE,
    L13: T_BODY,
    L8A: T_MAKEUP, L8B: T_MAKEUP, T5A: T_MAKEUP, T5B: T_MAKEUP, T5C: T_MAKEUP, T6A: T_MAKEUP, L14: T_MAKEUP,
    S2: [...T_WHITE, ...T_MAKEUP],   // S2 อยู่ทั้งกลุ่มผิวขาว + เมคอัพ
    A1: T_SUNBODY, L1: T_SUNBODY,
    D2: T_ORAL, D3: T_ORAL,
    S1: T_ACNE,
    // Beauterry — เมคอัพทั้งหมด
    'BTA1-01': T_BTY_MAKEUP, 'BTA1-02': T_BTY_MAKEUP, 'BTA1-03': T_BTY_MAKEUP, 'BTA1-04': T_BTY_MAKEUP, 'BTA1-05': T_BTY_MAKEUP, 'BTA1-06': T_BTY_MAKEUP,
    'BTA2-01': T_BTY_MAKEUP, 'BTA2-02': T_BTY_MAKEUP, 'BTA2-03': T_BTY_MAKEUP,
    'BTA3-01': T_BTY_MAKEUP, 'BTA3-02': T_BTY_MAKEUP, 'BTA3-03': T_BTY_MAKEUP,
    'BTA4-00': T_BTY_MAKEUP, 'BTA4-01': T_BTY_MAKEUP, 'BTA4-02': T_BTY_MAKEUP, 'BTA4-03': T_BTY_MAKEUP, 'BTA4-04': T_BTY_MAKEUP, 'BTA4-05': T_BTY_MAKEUP, 'BTA4-06': T_BTY_MAKEUP, 'BTA4-07': T_BTY_MAKEUP
};

// แปลงค่า target ให้เป็น array เสมอ (รองรับข้อมูลเดิมที่เป็น string เดี่ยว)
export function asTargetArray(t) {
    if (Array.isArray(t)) return t.filter(Boolean);
    return t ? [t] : [];
}

// Target ที่เลือกได้ของสินค้าตัวเดียว (ช่อง Target ของแต่ละแถวในฟอร์มแคมเปญ)
export function targetsForProduct(code) {
    return [...(TARGET_MAP[code] || [])];
}

// รวม Target ของสินค้าหลายตัว (union) — สินค้าที่ไม่มีใน map จะไม่มี Target
export function targetsForProducts(codes) {
    const out = [];
    (codes || []).forEach(c => (TARGET_MAP[c] || []).forEach(t => { if (!out.includes(t)) out.push(t); }));
    return out;
}
