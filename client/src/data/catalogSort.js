// หน้า Products & Targets: เรียงตามรหัส / ชื่อสินค้า + กรองตามตัวอักษรนำหน้ารหัส (ผู้ใช้สั่ง 22 ต.ค. 2026)
// รหัสเรียงแบบ "ตัวอักษรก่อน แล้วตัวเลขตามค่า" — L8A ก่อน L10, BTA4-01 ก่อน BTA10-01 (ไม่ใช่เรียงทีละตัวอักษรที่ได้ L10 ก่อน L8A)

// ตัวอักษรนำหน้ารหัส (ก่อนตัวเลขตัวแรก): L8A → L · BTA4-01 → BTA · JNPSET1 → JNPSET · ไม่มีตัวอักษร = '#'
export function codePrefix(code) {
    const m = String(code || '').toUpperCase().match(/^[A-Z]+/);
    return m ? m[0] : '#';
}

const byCode = (a, b) => String(a.code).localeCompare(String(b.code), 'en', { numeric: true, sensitivity: 'base' });
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th', { numeric: true }) || byCode(a, b);

export const SORT_MODES = [
    { value: '', label: 'ลำดับเดิม' },
    { value: 'code-asc', label: 'รหัส A → Z' },
    { value: 'code-desc', label: 'รหัส Z → A' },
    { value: 'name-asc', label: 'ชื่อสินค้า ก → ฮ' },
    { value: 'name-desc', label: 'ชื่อสินค้า ฮ → ก' }
];
const MODE_SET = new Set(SORT_MODES.map(m => m.value));
export const isSortMode = v => MODE_SET.has(v);

// คืนอาเรย์ใหม่ (ไม่แก้ของเดิม) · '' / ค่าที่ไม่รู้จัก = ลำดับเดิม (ตามคลัง)
export function sortProducts(list, mode) {
    const arr = Array.isArray(list) ? [...list] : [];
    if (mode === 'code-asc') return arr.sort(byCode);
    if (mode === 'code-desc') return arr.sort((a, b) => byCode(b, a));
    if (mode === 'name-asc') return arr.sort(byName);
    if (mode === 'name-desc') return arr.sort((a, b) => byName(b, a));
    return arr;
}

// ตัวเลือกตัวกรองตัวอักษรนำหน้า: [{ value, label, count }] เรียง A → Z
export function prefixOptions(list) {
    const counts = new Map();
    (list || []).forEach(p => { const k = codePrefix(p.code); counts.set(k, (counts.get(k) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'))
        .map(([value, count]) => ({ value, label: value === '#' ? 'ไม่ขึ้นต้นด้วยตัวอักษร' : `ขึ้นต้นด้วย ${value}`, count }));
}
