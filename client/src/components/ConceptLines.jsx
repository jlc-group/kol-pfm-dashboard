import { conceptRows, isSplitConcept, conceptParts } from '../data/adGroups.js';
import { productLabel } from '../data/products.js';

// Concept ของกลุ่มที่แยกต่อสินค้า — 1 แถว = สินค้าที่ใช้ Concept เดียวกัน (สินค้าที่ไม่ได้ใส่ใช้ Concept หลักของกลุ่ม)
// products / platforms = จำกัดเฉพาะสินค้า / Platform ที่ผู้ดูเห็น (เช่นลิงก์เอเจนซี่ที่ดูแลบาง Platform)
// ไม่มี Platform ไหนแยก Concept → ไม่แสดงอะไร (หน้าที่เรียกใช้โชว์ Concept ของกลุ่มแบบเดิมเอง)
export default function ConceptLines({ group, products, platforms, className = '' }) {
    if (!isSplitConcept(group, platforms)) return null;
    const all = conceptRows(group, products, platforms);
    if (!all.length) return null;
    // สินค้าที่มี Concept ของตัวเองขึ้นก่อน · สินค้าที่ใช้ Concept หลักอยู่ท้ายสุดและย่อเป็นชิป "สินค้าอื่น ๆ" (เอาเมาส์ชี้ดูรหัส)
    const own = all.filter(r => !r.main);
    // เปิดแยกแต่ยังไม่มีสินค้าไหนใส่ของตัวเอง = ไม่ต่างจาก Concept เดียว (หน้าที่เรียกใช้โชว์ Concept ของกลุ่มเอง)
    if (!own.length) return null;
    const rows = [...own, ...all.filter(r => r.main)];
    return (
        <div className={'concept-lines ' + className}>
            {rows.map(r => (
                <div className="concept-line" key={r.concept}>
                    <span className="concept-codes">
                        {r.main && own.length
                            ? <span className="concept-code rest" title={r.items.map(it => it.label).join(', ')}>สินค้าอื่น ๆ ({r.items.length})</span>
                            : r.items.map(it => <span className="concept-code" key={it.label} title={productLabel(it.code)}>{it.label}</span>)}
                    </span>
                    {/* 1 สินค้ามีได้หลาย Concept — แยกบรรทัดให้อ่านง่าย มีเลขนำเมื่อมีตั้งแต่ 2 อัน
                        คอนเซปต์เดียว (ข้อมูลเดิมทั้งหมด) ต้องออกมาหน้าตาเดิมเป๊ะ จึงไม่ขึ้นบรรทัดและป้ายต่อท้ายเหมือนเดิม */}
                    {(() => {
                        const parts = conceptParts(r.concept);
                        const list = parts.length ? parts : [r.concept];
                        return (
                            <span className={'concept-text' + (list.length > 1 ? ' multi' : '')}>
                                {list.map((t, ci) => (
                                    <span className="concept-one" key={ci}>
                                        {list.length > 1 && <em className="concept-no">{ci + 1}</em>}{t}
                                        {r.main && ci === list.length - 1 && <small className="concept-main"> (Concept หลัก)</small>}
                                    </span>
                                ))}
                            </span>
                        );
                    })()}
                </div>
            ))}
        </div>
    );
}
