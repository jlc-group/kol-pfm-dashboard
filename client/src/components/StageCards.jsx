import { countStages, STAGES } from '../data/workStage.js';

/**
 * การ์ดสรุปขั้นงาน 4 ใบ (รอส่งดราฟ / รอตรวจดราฟ / Approve แล้ว / ลงงานแล้ว)
 * กดเพื่อกรองตาราง On Process ด้านล่าง กดซ้ำ = ดูทั้งหมด
 * ใช้ร่วมกันทั้งหน้าแคมเปญ (ทีม) และหน้าลิงก์เอเจนซี่ จะได้นับด้วยเกณฑ์เดียวกัน
 *
 * subs   = submissions ทั้งหมดของหน้านั้น (กรองเฉพาะ confirmed ให้เอง)
 * value  = ขั้นที่เลือกอยู่ ('all' = ไม่กรอง)
 */
export default function StageCards({ subs = [], value = 'all', onChange }) {
    const st = countStages(subs.filter(s => s.status === 'confirmed'));
    return (
        <div className="proc-stat-grid">
            {STAGES.map(({ key, label }) => (
                <button type="button" key={key}
                    className={'proc-stat-card ' + key + (value === key ? ' on' : '')}
                    aria-pressed={value === key}
                    title={value === key ? 'กดอีกครั้งเพื่อดูทั้งหมด' : `ดูเฉพาะ${label}`}
                    onClick={() => onChange(value === key ? 'all' : key)}>
                    <span className="proc-stat-num">{st[key]}</span>
                    <span className="proc-stat-lbl">{label}</span>
                </button>
            ))}
        </div>
    );
}
