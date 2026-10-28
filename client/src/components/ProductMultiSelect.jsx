import { productLabel } from '../data/products.js';
import MultiSelect from './MultiSelect.jsx';

// ช่องเลือกสินค้าแบบหลายตัว — เป็น MultiSelect ที่ตั้งค่าไว้ให้เรียบร้อยแล้ว
// (แยกไว้เพราะที่เรียกใช้มี 4 จุด จะได้ไม่ต้องส่ง itemName/labelOf ซ้ำทุกที่)
// itemName / ariaLabel ไม่ส่ง = แบบเดิม ("Product") — ฟอร์ม Talent Book ส่งเป็นภาษาไทย
export default function ProductMultiSelect({ value, options = [], onChange, placeholder = '— เลือก Product —', itemName = 'Product', ariaLabel }) {
    return (
        <MultiSelect
            value={value} options={options} onChange={onChange}
            placeholder={placeholder} itemName={itemName} labelOf={productLabel} ariaLabel={ariaLabel}
        />
    );
}
