import Icon from './Icon.jsx';
import ProductChips from './ProductChips.jsx';
import ConceptLines from './ConceptLines.jsx';
import { clipCountFor, clipsFor, quotaOf, hasOwnConcepts, groupNoGencode, conceptOneLine } from '../data/adGroups.js';
import { clipCount } from '../data/clips.js';

// จำนวนคลิปของกลุ่มในขอบเขต Platform ที่ผู้ดูเห็น — ใช้ทั้งหน้าเอเจนซี่ (GroupSection) และแท็บรายชื่อฝั่งทีม (ProjectDetail)
// คิดที่เดียวกัน ตัวเลข "× N คลิป = T คลิป" สองฝั่งจะได้ไม่เพี้ยนกัน
// perClip = 1 คนทำกี่ Content (ต่าง Platform ตั้งไม่เท่ากันได้ → 0 = ไม่เท่ากัน ไม่ต้องโชว์ตัวคูณ)
// clips = ผลรวม (คนที่ต้องการ × Content ต่อคน) ของแต่ละ Platform · contentType = ตัวกรอง Content Type ของฝั่งทีม (null = ทุกอัน)
export function groupClipNeed(group, platforms = [], contentType = null) {
    const perHead = [...new Set(platforms.map(p => clipCountFor(group, p)))];
    const perClip = perHead.length === 1 ? perHead[0] : (perHead.length ? 0 : clipCount(group));
    const clips = platforms.reduce((s, p) => s + quotaOf(group, p, contentType) * clipCountFor(group, p), 0);
    return { perClip, clips };
}

// หัวการ์ดกลุ่ม "ต้องการกี่คน / ส่งแล้วกี่คน" — หน้าตาเดียวกันทั้งหน้าเอเจนซี่และแท็บรายชื่อฝั่งทีม
// ตัวเลขทุกตัวคิดมาจากหน้าที่เรียกใช้ตามขอบเขตของตัวเอง (เอเจนซี่เห็นเฉพาะ Platform ที่รับผิดชอบ ทีมเห็นทุก Platform ตามตัวกรอง)
// ตัวนี้แค่วาด — แก้หน้าตาที่นี่ที่เดียว สองหน้าจะไม่ต่างกัน
// products / platforms = สินค้า / Platform ในขอบเขต (ใช้กับ Concept ต่อสินค้าด้วย)
// need / needClips = ต้องการกี่คน / กี่คลิป · sent / sentClips = ส่งแล้วกี่คน / กี่คลิป
// progExtra = บรรทัดเสริมใต้ตัวเลขด้านขวา (ฝั่งทีมใช้โชว์ "คัดเลือกแล้ว" — เอเจนซี่ไม่มี)
export default function GroupNeedHead({ group, gi, products = [], platforms = [], need = 0, perClip = 1, needClips = 0, sent = 0, sentClips = 0, progExtra = null }) {
    // ชื่อคลิปตั้งแยกต่อ Platform — group.clips เก็บแค่ของ Platform แรก (server ก็ห้ามอ่านตรง ๆ) จึงอ่านของ Platform ในขอบเขต
    // โชว์เฉพาะตอนทุก Platform ในขอบเขตใช้ชุดชื่อเดียวกัน ไม่งั้นจะบอกชื่อคลิปของอีก Platform ผิด ๆ
    const lists = (platforms.length ? platforms.map(p => clipsFor(group, p)) : [group.clips || []])
        .map(l => (l || []).map(c => String(c || '').trim()).filter(Boolean));
    const clipNames = lists.every(l => l.join('\n') === lists[0].join('\n')) ? lists[0] : [];
    return (
        <>
            <div className="ag-group-head">
                <div>
                    <span className="ag-group-no">กลุ่มที่ {gi + 1} <span className="adg-count">({products.length} สินค้า)</span></span>
                    {/* เป้าจำนวนคน/คลิป อยู่ที่หัวกลุ่ม — เดิมอยู่ในแถบงบ ซึ่งบัญชีเอเจนซี่ไม่เห็นแล้ว */}
                    {need > 0 && (
                        <div className="ag-group-need">
                            ต้องการ {need} คน
                            {perClip > 1 && <span className="ag-clip-note"> × {perClip} คลิป = {needClips} คลิป</span>}
                        </div>
                    )}
                    {/* Concept แยกต่อสินค้า — บรีฟ KOL ตามสินค้าของแต่ละคนได้ (เฉพาะสินค้าในขอบเขตที่เห็น) */}
                    {hasOwnConcepts(group, products, platforms)
                        ? <div className="ag-concept-top">📝 Concept ตามสินค้า<ConceptLines group={group} products={products} platforms={platforms} className="ag" /></div>
                        : group.concept && <div className="ag-concept-top">📝 Concept: <b>{conceptOneLine(group.concept)}</b></div>}
                    {/* ทีมตั้ง "-" ในฟอร์มแคมเปญ — บอกตั้งแต่หัวกลุ่มว่าไม่ต้องหา Gencode มากรอก */}
                    {groupNoGencode(group) && <div className="ag-concept-top">กลุ่มนี้ไม่ต้องใช้ Gencode</div>}
                    <div style={{ marginTop: 8 }}>
                        <ProductChips products={products} />
                    </div>
                </div>
                <div className="ag-group-prog">
                    <div className="ag-group-prog-num">{sent}<span>/{need}</span></div>
                    <div className="ag-group-prog-lbl">คน · ส่งแล้ว / ต้องการ</div>
                    {perClip > 1 && <div className="ag-group-prog-clip">{sentClips}/{needClips} คลิป</div>}
                    {progExtra}
                </div>
            </div>

            {group.brief && <a className="brief-link ag-group-brief" href={group.brief} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /> เปิดบรีฟกลุ่มนี้</a>}
            {clipNames.length > 1 && <div className="ag-clip-names">🎬 ต้องส่ง {clipNames.join(' · ')}</div>}
        </>
    );
}
