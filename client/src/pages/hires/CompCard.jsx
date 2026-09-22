import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fileBlobUrl } from '../../api/client.js';
import Icon from '../../components/Icon.jsx';
import { T, BOOKING_LABEL, CAND_LABEL, baht } from '../../data/talentLabels.js';

// คอมการ์ดของคนหนึ่งคนใน Talent Book — รูปแนวตั้งซ้าย ข้อมูลขวา (ตามแบบที่ผู้ใช้เลือก)
// ข้อมูลมาจาก GET /api/hires/book ที่ server รวมคนเดียวกัน (ชื่อ + ประเภทงาน) เป็นใบเดียวแล้ว — ไฟล์นี้แสดงผลอย่างเดียว ไม่แก้ข้อมูล

// สถานะย่อของ Casting — ใช้คำชุดเดียวกับใบขอให้หา คนที่เคยเห็นในใบจะอ่านออกทันที
const SUB_LABEL = {
    waiting: CAND_LABEL['เสนอ'],         // รอเลือก
    spare: T.spare,                       // สำรองไว้
    dropped: 'ไม่ได้เลือก',                // ทีมกด "ไม่เอา" ในใบ
    unavailable: 'มาไม่ได้',              // ถูกเลือกแล้ว แต่คนช่วยหาแจ้งว่าคิวไม่ว่าง (ใบขอให้หาก็โชว์คำนี้)
    talking: T.talking,                   // แถวในงานที่ยังคุยอยู่
    booking: BOOKING_LABEL.pending        // เลือกแล้ว รอยืนยันคิว / รอตัดสินค่าตัวใหม่
};
// การ์ดเป็นสี่เหลี่ยมจัตุรัส (ผู้ใช้ขอ 1:1 สามใบต่อแถว) — พื้นที่จำกัด จึงโชว์ราคา 2 บรรทัด ลิงก์งาน 2 อัน ที่เหลือเป็น "+N" (ชี้ดูชื่อได้)
const JOBS_SHOWN = 2;
const FEES_SHOWN = 2;

const str = v => String(v == null ? '' : v).trim();
// ลิงก์ที่ผู้ใช้กรอกเอง — กดได้เฉพาะ http/https (กัน javascript: / data: ที่แฝงมากับข้อมูล)
function httpUrl(v) {
    const s = str(v);
    if (!s) return '';
    try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch { return ''; }
}
// path ไฟล์ต้องเป็นเส้นไฟล์ของงานจ้างเท่านั้น (fileBlobUrl แนบ token ให้ — ไม่ยอมให้ข้อมูลพาไปเส้นอื่น)
const okPath = p => typeof p === 'string' && /^\/projects\/[^/?#]+\/hires\/[^?#]+$/.test(p) && !p.includes('..');

// ตัวอักษรย่อบนรูปว่าง — กติกาเดียวกับรูปย่อในหน้างาน (PersonDrawer): ข้ามสระนำหน้าของไทย ชื่ออังกฤษสองคำใช้สองตัว
const THAI_LEAD = /[เแโใไ]/;
function initials(name) {
    const words = str(name).split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = w => { const cs = Array.from(w); return cs.find(ch => !THAI_LEAD.test(ch)) || cs[0]; };
    const a = first(words[0]);
    if (/^[A-Za-z]/.test(a) && words[1] && /^[A-Za-z]/.test(words[1])) return (a + first(words[1])).toUpperCase();
    return a.toUpperCase();
}
const tone = name => 'c' + (Array.from(str(name)).reduce((s, ch) => s + ch.codePointAt(0), 0) % 5);

// วันที่แบบสั้น d/m/yy · ค่าที่เป็นเวลาเต็ม (เช่นเวลาที่เสนอชื่อ) แปลงเป็นวันที่ตามเวลาไทยก่อน ไม่งั้นช่วงเช้ามืดจะเป็นวันก่อนหน้า
function fmtD(d) {
    const s = str(d);
    if (!s) return '';
    let ymd = s.slice(0, 10);
    if (s.length > 10 && s.includes('T')) {
        const t = new Date(s).getTime();
        if (Number.isFinite(t)) ymd = new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10);
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    return m ? `${Number(m[3])}/${Number(m[2])}/${m[1].slice(2)}` : '';
}

// ลิงก์ Account → ข้อความสั้นที่อ่านรู้เรื่อง ("IG @nong_a") แทน URL ยาว ๆ
// at = แพลตฟอร์มที่ชื่อบัญชีขึ้นต้นด้วย @ ใน URL (ลิงก์คลิป / ลิงก์ย่อของแพลตฟอร์มนั้นจึงไม่ถูกอ่านเป็นชื่อบัญชี)
const PLATFORMS = [
    { re: /(^|\.)instagram\.com$/, name: 'IG' },
    { re: /(^|\.)tiktok\.com$/, name: 'TikTok', at: true },
    { re: /(^|\.)(facebook|fb)\.com$/, name: 'Facebook' },
    { re: /(^|\.)(youtube\.com|youtu\.be)$/, name: 'YouTube', at: true },
    { re: /(^|\.)(x|twitter)\.com$/, name: 'X' },
    { re: /(^|\.)lemon8-app\.com$/, name: 'Lemon8', at: true }
];
// ส่วนแรกของ path ที่ไม่ใช่ชื่อบัญชี (ลิงก์โพสต์ / คลิป / หน้าโปรไฟล์แบบเลข id)
const NOT_HANDLE = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'watch', 'share', 'profile.php', 'people', 'pages', 'groups', 'i', 'home', 'intent', 'search']);
export function accountOf(raw) {
    const text = str(raw);
    if (!text) return null;
    const href = httpUrl(text);
    if (!href) return { href: '', label: text };   // พิมพ์เป็นชื่อบัญชีเฉย ๆ (ไม่ใช่ลิงก์) → โชว์ตามที่พิมพ์ กดไม่ได้
    const u = new URL(href);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let seg = u.pathname.split('/').find(Boolean) || '';
    try { seg = decodeURIComponent(seg); } catch { /* ลิงก์เข้ารหัสไม่ครบ — ใช้ตามที่พิมพ์ */ }
    const pf = PLATFORMS.find(p => p.re.test(host));
    if (!pf) return { href, label: host + (seg ? '/' + seg : '') };
    const isHandle = seg && (pf.at ? seg.startsWith('@') : !NOT_HANDLE.has(seg.toLowerCase()));
    return { href, label: isHandle ? `${pf.name} @${seg.replace(/^@/, '')}` : pf.name };
}

// โหลดรูปผ่าน token เป็น blob เฉพาะตอนการ์ดเลื่อนมาใกล้จอ (หน้านี้มีคนเป็นร้อย ไม่ดึงรูปทั้งหมดตั้งแต่เปิด)
// การ์ดหลุดจากรายการ / path เปลี่ยน → คืนหน่วยความจำของรูปเดิมทันที · <img src> ตรง ๆ ใช้ไม่ได้เพราะไฟล์ต้องแนบ token
function useLazyImage(path) {
    const box = useRef(null);
    const [got, setGot] = useState({ path: '', url: '', failed: false });
    useEffect(() => {
        if (!path) return undefined;
        let alive = true;
        let made = '';
        let io = null;
        const go = () => fileBlobUrl(path).then(r => {
            // ไม่ใช่รูป (ไฟล์ถูกเปลี่ยนเป็น PDF ระหว่างนั้น) หรือการ์ดหายไปแล้ว → ไม่มีใครใช้ blob นี้ คืนทันที
            if (!alive || !String(r.type || '').startsWith('image/')) {
                URL.revokeObjectURL(r.url);
                if (alive) setGot({ path, url: '', failed: true });
                return;
            }
            made = r.url;
            setGot({ path, url: r.url, failed: false });
        }).catch(() => { if (alive) setGot({ path, url: '', failed: true }); });
        const el = box.current;
        if (el && typeof window.IntersectionObserver === 'function') {
            io = new window.IntersectionObserver(entries => {
                if (!entries.some(e => e.isIntersecting)) return;
                io.disconnect(); io = null;
                go();
            }, { rootMargin: '300px 0px' });
            io.observe(el);
        } else {
            go();
        }
        return () => {
            alive = false;
            if (io) io.disconnect();
            if (made) URL.revokeObjectURL(made);
        };
    }, [path]);
    return [box, got.path === path ? got : { url: '', failed: false }];
}

// รูปฝั่งซ้าย: รูปที่อัปไว้ (รูปย่อ กดดูใหญ่) · PDF (ปุ่มเปิดไฟล์) · ลิงก์รูป (ปุ่มเปิดแท็บใหม่ — ไม่ดึงรูปจากเว็บคนอื่นมาโชว์) · ไม่มีรูป (ตัวอักษรย่อ)
// มีคลิป → ป้าย "มีคลิป" ทับมุมรูป (เป็นปุ่มพี่น้องกับรูป ไม่ซ้อนปุ่มในปุ่ม)
function Photo({ card, onPreview }) {
    const name = str(card.name) || 'คนนี้';
    const p = card.photo || null;
    const imgPath = p && p.type === 'image' && okPath(p.path) ? p.path : '';
    const [box, img] = useLazyImage(imgPath);
    const title = `คอมการ์ดของ ${name}`;

    let tile;
    if (imgPath) {
        tile = (
            <button type="button" className={'tb-photo-btn' + (img.url ? '' : ' tb-tone ' + tone(name))}
                onClick={() => onPreview({ path: imgPath, title })} title={`ดู${title}`}>
                {img.url
                    ? <img src={img.url} alt={title} draggable="false" />
                    : <>
                        <span className="tb-initial" aria-hidden="true">{initials(name)}</span>
                        <span className="tb-photo-wait">{img.failed ? 'โหลดรูปไม่ได้ — กดเพื่อเปิดดู' : 'กำลังโหลดรูป...'}</span>
                    </>}
            </button>
        );
    } else if (p && p.type === 'pdf' && okPath(p.path)) {
        tile = (
            <button type="button" className="tb-photo-btn tb-photo-file" onClick={() => onPreview({ path: p.path, title })} title={`เปิด${title}`}>
                <Icon name="file" size={34} />
                <span>เปิดดูไฟล์</span>
                <small>คอมการ์ดเป็น PDF</small>
            </button>
        );
    } else if (p && p.type === 'link' && httpUrl(p.url)) {
        tile = (
            <a className={'tb-photo-btn tb-photo-link tb-tone ' + tone(name)} href={httpUrl(p.url)} target="_blank" rel="noopener noreferrer"
                title={`เปิด${title}จากลิงก์ (แท็บใหม่)`}>
                <span className="tb-initial" aria-hidden="true">{initials(name)}</span>
                <span className="tb-photo-chip"><Icon name="image" size={13} /> ดูรูป</span>
            </a>
        );
    } else {
        tile = (
            <div className={'tb-photo-none tb-tone ' + tone(name)}>
                <span className="tb-initial" aria-hidden="true">{initials(name)}</span>
                <small>ยังไม่มีรูป</small>
            </div>
        );
    }

    const clip = card.clip || null;
    let clipEl = null;
    if (clip && clip.type === 'file' && okPath(clip.path)) {
        clipEl = (
            <button type="button" className="tb-clip" onClick={() => onPreview({ path: clip.path, title: `คลิปของ ${name}`, kind: 'video' })}>
                <Icon name="play" size={11} /> มีคลิป
            </button>
        );
    } else if (clip && clip.type === 'link' && httpUrl(clip.url)) {
        clipEl = (
            <a className="tb-clip" href={httpUrl(clip.url)} target="_blank" rel="noopener noreferrer" title={`เปิดคลิปของ ${name} (แท็บใหม่)`}>
                <Icon name="play" size={11} /> มีคลิป
            </a>
        );
    }

    return (
        <div className="tb-photo" ref={box}>
            {tile}
            {clipEl}
        </div>
    );
}

// onPreview({ path, title, kind }) — หน้าแม่เปิดตัวดูไฟล์ในหน้า (FilePreviewModal) ตัวเดียวทั้งแกลเลอรี
export default function CompCard({ card, onPreview }) {
    const booked = card.group === 'booked';
    const sub = !booked ? SUB_LABEL[card.sub] || '' : '';
    // server ส่งมาใหม่สุดก่อน ไม่เกิน 3 บรรทัด และตัด ฿0 ออกแล้ว — กรองซ้ำกันข้อมูลหลุดรูปแบบ
    const fees = (Array.isArray(card.fees) ? card.fees : []).filter(f => f && Number(f.fee) > 0).slice(0, FEES_SHOWN);
    const acc = accountOf(card.link);
    const contact = str(card.contact);
    const team = (card.team_contacts || []).map(str).filter(Boolean);
    const by = (card.proposed_by || []).map(str).filter(Boolean);
    const projects = (card.projects || []).filter(p => p && p.id != null);
    const jobs = Number(card.jobs) || projects.length;
    const brands = (card.brands || []).filter(Boolean);
    const last = fmtD(card.last_date);
    const shownJobs = projects.slice(0, JOBS_SHOWN);
    const moreJobs = projects.slice(JOBS_SHOWN);

    return (
        <article className={'tb-card ' + (booked ? 'is-booked' : 'is-casting') + (card.sub === 'dropped' ? ' is-dropped' : '')}>
            <Photo card={card} onPreview={onPreview} />
            <div className="tb-info">
                <div className="tb-status">
                    <span className={'tb-badge ' + (booked ? 'booked' : 'casting')}>{booked ? 'Booked' : 'Casting'}</span>
                    {sub && <span className={'tb-sub s-' + card.sub}>{sub}</span>}
                </div>

                <h3 className="tb-name" title={card.name}>{card.name}</h3>

                {(card.kind || card.agency) && (
                    <div className="tb-pills">
                        {card.kind && <span className="tb-pill"><span className="tb-pill-k">ประเภทงาน :</span> {card.kind}</span>}
                        {card.agency && <span className="tb-pill"><span className="tb-pill-k">สังกัด :</span> {card.agency}</span>}
                    </div>
                )}

                {fees.length > 0 ? (
                    <ul className="tb-fees">
                        {fees.map((f, i) => (
                            <li key={i} className={'tb-fee ' + (f.kind === 'hired' ? 'hired' : 'proposed')}>
                                <b className="tb-fee-v">{baht(f.fee)}</b>
                                <span className="tb-fee-k" title={str(f.project_name)}>
                                    {f.kind === 'hired' ? 'ค่าตัว' : 'ราคาที่เสนอ'}{str(f.project_name) ? ` · ${str(f.project_name)}` : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="tb-fees tb-fee-none">ยังไม่มีราคา</div>
                )}

                {(acc || contact || team.length > 0 || by.length > 0) && (
                    <ul className="tb-rows">
                        {acc && (
                            <li title="Account / Social">
                                <Icon name="link" size={15} />
                                <span className="tb-sr">Account: </span>
                                {acc.href
                                    ? <a className="tb-acc" href={acc.href} target="_blank" rel="noopener noreferrer" title={acc.href}>{acc.label}</a>
                                    : <span className="tb-row-v">{acc.label}</span>}
                            </li>
                        )}
                        {contact && (
                            <li title={T.contact}>
                                <Icon name="phone" size={15} />
                                <span className="tb-sr">{T.contact}: </span>
                                <span className="tb-row-v" title={contact}>{contact}</span>
                            </li>
                        )}
                        {team.length > 0 && (
                            <li>
                                <Icon name="team" size={15} />
                                <span className="tb-row-v" title={team.join(', ')}><span className="tb-row-k">ผู้ติดต่อ :</span> {team.join(', ')}</span>
                            </li>
                        )}
                        {by.length > 0 && (
                            <li>
                                <Icon name="search" size={15} />
                                <span className="tb-row-v" title={by.join(', ')}><span className="tb-row-k">เสนอโดย :</span> {by.join(', ')}</span>
                            </li>
                        )}
                    </ul>
                )}

                <div className="tb-foot">
                    <div className="tb-foot-line">
                        {[`เคยเสนอให้ ${jobs} งาน`, brands.join(', '), last ? `ล่าสุด ${last}` : ''].filter(Boolean).join(' · ')}
                    </div>
                    {projects.length > 0 && (
                        <div className="tb-jobs">
                            {shownJobs.map(p => (
                                <Link key={p.id} className="tb-job" to={`/projects/${encodeURIComponent(p.id)}`} title={str(p.name)}>
                                    {str(p.name) || `งาน #${p.id}`}
                                </Link>
                            ))}
                            {moreJobs.length > 0 && (
                                <span className="tb-job more" title={moreJobs.map(p => str(p.name) || `งาน #${p.id}`).join('\n')}>
                                    +{moreJobs.length} งาน
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
}
