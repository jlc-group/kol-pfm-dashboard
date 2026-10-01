import Icon from '../../components/Icon.jsx';
import useLazyImage from '../../utils/useLazyImage.js';
import { baht } from '../../data/talentLabels.js';
import { normalizeSocials, socialLabel, SOCIAL_SHORT } from '../../data/talentSocials.js';
import { jobsCountOf } from '../../data/talentJobs.js';

// คอมการ์ดของคนหนึ่งคนใน Talent Book — รูปแนวตั้งซ้าย ข้อมูลขวา (ตามแบบที่ผู้ใช้เลือก)
// ผู้ใช้สั่ง 1 ต.ค. 2026: หน้าการ์ด = ข้อมูลของ KOL อย่างเดียว — รูป · ชื่อ · ช่องทาง Social (กดเปิดลิงก์ได้ทีละช่องทาง) · เรทราคา
//   + ป้าย "จ้างแล้ว N งาน" · ปุ่มแก้ไข · ประเภทงานเป็นบรรทัดเล็กเหนือชื่อ (ไว้กวาดตาหา)
//   รายละเอียดอื่น (แบรนด์ / เอเจนซี่ / ผู้ติดต่อ / Scope / หมายเหตุ / คลิป / งานที่จ้าง) อยู่ในหน้ารายละเอียด — กดตรงไหนของการ์ดก็เปิด (onOpen)
// ข้อมูลมาจาก GET /api/hires/book ที่ server รวมคนเดียวกัน (ชื่อ + ประเภทงาน) เป็นใบเดียวแล้ว — ไฟล์นี้แสดงผลอย่างเดียว ไม่แก้ข้อมูล
// ช่องทาง Social: card.socials (หรือ talent.socials) · แถวรุ่นเก่า/การ์ดจากงานเก่ามีแค่ link ช่องเดียว → ใช้เป็น 1 ช่องทาง (normalizeSocials)

// การ์ดเป็นสี่เหลี่ยมจัตุรัส (สามใบต่อแถว) — ช่องทางโชว์ได้ 3 บรรทัด ที่เหลือเป็น "+N ช่องทาง" (ชี้ดูได้ / เปิดดูครบในรายละเอียด)
const SOCIALS_SHOWN = 3;
// สีของป้ายแพลตฟอร์ม (คลาส tb-soc-pf p-xx)
export const PLATFORM_CLASS = { TikTok: 'tt', Instagram: 'ig', Facebook: 'fb', YouTube: 'yt', X: 'x', Lemon8: 'l8' };

export const str = v => String(v == null ? '' : v).trim();
// ลิงก์ที่ผู้ใช้กรอกเอง — กดได้เฉพาะ http/https (กัน javascript: / data: ที่แฝงมากับข้อมูล)
export function httpUrl(v) {
    const s = str(v);
    if (!s) return '';
    try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch { return ''; }
}
// path ไฟล์ต้องเป็นเส้นไฟล์ของงานจ้าง หรือไฟล์ของคนที่เพิ่มเข้า Talent Book เอง เท่านั้น (fileBlobUrl แนบ token ให้ — ไม่ยอมให้ข้อมูลพาไปเส้นอื่น)
export const okPath = p => typeof p === 'string' && !p.includes('..')
    && (/^\/projects\/[^/?#]+\/hires\/[^?#]+$/.test(p) || /^\/hires\/talents\/\d+\/(image|clip)(\?v=\d+)?$/.test(p));

// ตัวอักษรย่อบนรูปว่าง — กติกาเดียวกับรูปย่อในหน้างาน (PersonDrawer): ข้ามสระนำหน้าของไทย ชื่ออังกฤษสองคำใช้สองตัว
const THAI_LEAD = /[เแโใไ]/;
export function initials(name) {
    const words = str(name).split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = w => { const cs = Array.from(w); return cs.find(ch => !THAI_LEAD.test(ch)) || cs[0]; };
    const a = first(words[0]);
    if (/^[A-Za-z]/.test(a) && words[1] && /^[A-Za-z]/.test(words[1])) return (a + first(words[1])).toUpperCase();
    return a.toUpperCase();
}
export const tone = name => 'c' + (Array.from(str(name)).reduce((s, ch) => s + ch.codePointAt(0), 0) % 5);

// ช่องทาง Social ของการ์ด (ใช้ทั้งหน้าการ์ด / ค้นหา / รายละเอียด)
export const cardSocials = card => normalizeSocials(card && (card.socials || (card.talent && card.talent.socials)), card && card.link);

// ป้ายแพลตฟอร์ม + ชื่อบัญชี (กดเปิดลิงก์ในแท็บใหม่ · ไม่มีลิงก์ = ข้อความเฉย ๆ)
export function SocialLine({ s, full = false }) {
    const href = httpUrl(s.url);
    const label = socialLabel(s);
    return (
        <>
            <span className={'tb-soc-pf p-' + (PLATFORM_CLASS[s.platform] || 'ot')} title={s.platform}>
                {full ? s.platform : (SOCIAL_SHORT[s.platform] || s.platform)}
            </span>
            {href
                ? <a className="tb-acc" href={href} target="_blank" rel="noopener noreferrer" title={href}
                    onClick={e => e.stopPropagation()}>{label}</a>
                : <span className="tb-row-v" title={label}>{label}</span>}
        </>
    );
}

// รูปของคน: รูปที่อัปไว้ (โหลดแบบ lazy) · PDF · ลิงก์รูป · ไม่มีรูป (ตัวอักษรย่อ)
// หน้าการ์ด (onPreview ไม่ส่ง): รูปเป็นแค่ภาพ กดแล้วเปิดรายละเอียดตามการ์ด
// หน้ารายละเอียด (onPreview): กดรูป = ดูใหญ่ · PDF = เปิดไฟล์ · ลิงก์รูป = เปิดแท็บใหม่ (ไม่ดึงรูปจากเว็บคนอื่นมาโชว์)
export function Photo({ card, onPreview = null, className = 'tb-photo' }) {
    const name = str(card.name) || 'คนนี้';
    const p = card.photo || null;
    const imgPath = p && p.type === 'image' && okPath(p.path) ? p.path : '';
    const [box, img] = useLazyImage(imgPath);
    const title = `คอมการ์ดของ ${name}`;

    let tile;
    if (imgPath) {
        const inner = img.url
            ? <img src={img.url} alt={title} draggable="false" />
            : <>
                <span className="tb-initial" aria-hidden="true">{initials(name)}</span>
                <span className="tb-photo-wait">{img.failed ? 'โหลดรูปไม่ได้' : 'กำลังโหลดรูป...'}</span>
            </>;
        tile = onPreview
            ? <button type="button" className={'tb-photo-btn' + (img.url ? '' : ' tb-tone ' + tone(name))}
                onClick={() => onPreview({ path: imgPath, title })} title={`ดู${title}`}>{inner}</button>
            : <div className={'tb-photo-btn' + (img.url ? '' : ' tb-tone ' + tone(name))}>{inner}</div>;
    } else if (p && p.type === 'pdf' && okPath(p.path)) {
        const inner = <><Icon name="file" size={34} /><span>{onPreview ? 'เปิดดูไฟล์' : 'คอมการ์ด PDF'}</span><small>คอมการ์ดเป็น PDF</small></>;
        tile = onPreview
            ? <button type="button" className="tb-photo-btn tb-photo-file" onClick={() => onPreview({ path: p.path, title })} title={`เปิด${title}`}>{inner}</button>
            : <div className="tb-photo-btn tb-photo-file">{inner}</div>;
    } else if (p && p.type === 'link' && httpUrl(p.url)) {
        const inner = <><span className="tb-initial" aria-hidden="true">{initials(name)}</span><span className="tb-photo-chip"><Icon name="image" size={13} /> ดูรูป</span></>;
        tile = onPreview
            ? <a className={'tb-photo-btn tb-photo-link tb-tone ' + tone(name)} href={httpUrl(p.url)} target="_blank" rel="noopener noreferrer"
                title={`เปิด${title}จากลิงก์ (แท็บใหม่)`}>{inner}</a>
            : <div className={'tb-photo-btn tb-photo-link tb-tone ' + tone(name)}>{inner}</div>;
    } else {
        tile = (
            <div className={'tb-photo-none tb-tone ' + tone(name)}>
                <span className="tb-initial" aria-hidden="true">{initials(name)}</span>
                <small>ยังไม่มีรูป</small>
            </div>
        );
    }
    return <div className={className} ref={box}>{tile}</div>;
}

// onOpen(card) — หน้าแม่เปิดหน้ารายละเอียด · onEdit(talentId) — เปิดฟอร์มแก้ไข (เฉพาะคนที่เพิ่มการ์ด / admin)
export default function CompCard({ card, onOpen, onEdit }) {
    const talent = card.talent || null;
    const socials = cardSocials(card);
    const shown = socials.slice(0, SOCIALS_SHOWN);
    const more = socials.slice(SOCIALS_SHOWN);
    const rate = talent && Number(talent.rate) > 0 ? Number(talent.rate) : 0;
    // ไม่มีเรทที่ใส่เอง (การ์ดจากงานเก่า) → ราคาล่าสุดจากงาน (server ส่งมาใหม่สุดก่อน ตัด ฿0 แล้ว)
    const fee = rate ? null : (Array.isArray(card.fees) ? card.fees : []).find(f => f && Number(f.fee) > 0) || null;
    const jobs = jobsCountOf(card);
    const open = () => onOpen && onOpen(card);

    return (
        // กดตรงไหนของการ์ดก็เปิดรายละเอียด (ยกเว้นลิงก์ / ปุ่มในการ์ด) · คีย์บอร์ดใช้ปุ่มชื่อ
        <article className={'tb-card' + (onOpen ? ' is-open' : '')}
            onClick={e => { if (!e.target.closest('a, button')) open(); }}>
            <Photo card={card} />
            <div className="tb-info">
                <div className="tb-status">
                    {card.kind && <span className="tb-kind" title={`ประเภทงาน : ${card.kind}`}>{card.kind}</span>}
                    {talent && talent.editable && onEdit && (
                        <button type="button" className="tb-edit" onClick={() => onEdit(talent.id)} title="แก้ข้อมูลที่เพิ่มไว้ใน Talent Book">✎ แก้ไข</button>
                    )}
                </div>

                <h3 className="tb-name" title={card.name}>
                    <button type="button" className="tb-name-btn" onClick={open} aria-label={`ดูรายละเอียดของ ${card.name}`}>{card.name}</button>
                </h3>

                {jobs > 0 && <div className="tb-hired"><Icon name="check" size={12} /> จ้างแล้ว {jobs} งาน</div>}

                {socials.length > 0 ? (
                    <ul className="tb-socials" aria-label="ช่องทาง Social">
                        {shown.map((s, i) => <li key={i}><SocialLine s={s} /></li>)}
                        {more.length > 0 && (
                            <li className="tb-soc-more" title={more.map(socialLabel).join('\n')}>+{more.length} ช่องทาง</li>
                        )}
                    </ul>
                ) : (
                    <div className="tb-soc-none">ยังไม่มีช่องทาง Social</div>
                )}

                <div className="tb-fees">
                    {rate > 0 ? (
                        <div className="tb-fee rate">
                            <b className="tb-fee-v">{baht(rate)}</b>
                            <span className="tb-fee-k">เรท{talent.rate_unit ? ' ' + talent.rate_unit : ''}</span>
                        </div>
                    ) : fee ? (
                        <div className={'tb-fee ' + (fee.kind === 'hired' ? 'hired' : 'proposed')}>
                            <b className="tb-fee-v">{baht(fee.fee)}</b>
                            <span className="tb-fee-k">{fee.kind === 'hired' ? 'ค่าตัวล่าสุด' : 'ราคาที่เสนอล่าสุด'}</span>
                        </div>
                    ) : (
                        <div className="tb-fee-none">ยังไม่มีเรทราคา</div>
                    )}
                </div>

                <div className="tb-foot">
                    <span className="tb-open-hint" aria-hidden="true">ดูรายละเอียด{jobs > 0 ? ' / งานที่จ้าง' : ''} ›</span>
                </div>
            </div>
        </article>
    );
}
