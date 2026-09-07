import { useEffect, useState, useCallback } from 'react';
import ColumnFilter from '../components/ColumnFilter.jsx';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import Avatar from '../components/Avatar.jsx';
import { productLabel, asTargetArray } from '../data/products.js';
import { ProductSummary } from '../components/ProductChips.jsx';
import { fmtDate } from '../utils/date.js';

// ค่าที่เก็บเป็นสตริงคั่นด้วย , (เช่น content_format) → แยกเป็นรายตัว
const splitCsv = v => (v ? String(v).split(',').map(x => x.trim()).filter(Boolean) : []);

const BRANDS = ["Jula's Herb", 'Code Lab', 'Jdent', 'Jarvit', 'Beauterry', 'Jernis', 'Dermiq', 'Minimii', 'Any Skin'];
const STATUSES = ['ยังไม่ยิง', 'ยิงแล้ว'];

const fmtMoney = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const fmtNum = n => {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return String(v);
};
// ระดับความช้าจากจำนวนวัน — ใช้ทั้งสีป้ายในตารางและตัวกรอง จะได้ไม่หลุดกัน
//   เขียว ≤ 3 วัน (รวมยิงตรงวัน) · เหลือง 4-5 วัน · แดง 6 วันขึ้นไป
const lateLevel = d => (d <= 3 ? 'ontime' : d <= 5 ? 'warn' : 'bad');
const LATE_OPTS = [
    ['ontime', 'ไม่เกิน 3 วัน'],
    ['warn', 'ช้า 4-5 วัน'],
    ['bad', 'ช้า 6 วันขึ้นไป'],
];
// จำนวนวันระหว่าง 2 วันที่ (to - from) เป็นจำนวนวัน (คืน null ถ้าข้อมูลไม่ครบ)
function daysBetween(from, to) {
    if (!from || !to) return null;
    const a = new Date(from + 'T00:00:00');
    const b = new Date(to + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
}
function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function monthToRange(m) {
    if (!m) return { from: '', to: '' };
    const [y, mo] = m.split('-').map(Number);
    const last = new Date(y, mo, 0).getDate();
    const pad = n => String(n).padStart(2, '0');
    return { from: `${y}-${pad(mo)}-01`, to: `${y}-${pad(mo)}-${pad(last)}` };
}

// บรรทัดเล็กใต้ช่อง บอกว่าใครแก้ล่าสุดเมื่อไหร่
// ไม่มีข้อมูล = บันทึกไว้ก่อนระบบเริ่มเก็บ จึงไม่แสดงอะไร ดีกว่าเดาให้ผิด
function EnteredAt({ at, by, has }) {
    if (!has || !at) return null;
    const d = new Date(at);
    if (isNaN(d)) return null;
    const full = d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
    return (
        <span className="ads-entered" title={`แก้ล่าสุด ${full}${by ? ` โดย ${by}` : ''}`}>
            {by ? `${by} · ` : ''}{fmtDate(at)}
        </span>
    );
}

// โค้ด + ปุ่มคัดลอก (Gencode / ID Post)
function CopyCode({ value }) {
    const [copied, setCopied] = useState(false);
    if (!value) return <span className="muted">—</span>;
    const copy = () => {
        navigator.clipboard?.writeText(String(value))
            .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })
            .catch(() => {});
    };
    return (
        <span className="ads-code-wrap">
            <span className="ads-code" title={value}>{value}</span>
            <button type="button" className={'ads-copy' + (copied ? ' done' : '')} onClick={copy} title={copied ? 'คัดลอกแล้ว' : 'คัดลอก'}>
                {copied ? <Icon name="check" size={13} /> : <Icon name="copy" size={13} />}
            </button>
        </span>
    );
}

// ปุ่มกรองเล็ก ๆ บนหัวคอลัมน์ (แบบเดียวกับตารางใน Excel)
// เมนูใช้ position:fixed เพราะหัวตารางอยู่ในกรอบที่เลื่อนแนวนอน ถ้าใช้ absolute จะโดนตัด

// แถวตาราง: อัปเดตข้อมูลแอดของโพสต์ 1 อัน (บันทึกเมื่อออกจากช่อง)
function AdRow({ row, onSaved }) {
    const [adStatus, setAdStatus] = useState(row.ad_status || 'ยังไม่ยิง');
    const [end, setEnd] = useState(row.ad_end || '');
    const [note, setNote] = useState(row.ad_note || '');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // ยิง PUT (route อัปเดตเฉพาะ field ที่ส่งมา จึงแยกบันทึกสถานะ/ตัวเลขได้โดยไม่ทับกัน)
    async function put(body) {
        setSaving(true); setSaved(false);
        try {
            await api(`/ads/${row.sub_id}`, { method: 'PUT', body });
            setSaved(true); onSaved();
            setTimeout(() => setSaved(false), 1600);
        } catch (err) { alert(err.message); }
        finally { setSaving(false); }
    }

    // บันทึกหมายเหตุ (เช่น Gencode ใช้ไม่ได้ / ยิงแอดไม่ได้) — เฉพาะเมื่อมีการเปลี่ยน
    const saveNote = () => { if (note !== (row.ad_note || '')) put({ ad_note: note || null }); };

    // สลับสถานะ — เมื่อกด "ยิงแล้ว" ให้ลงวันยิงแอด (ad_end) เป็นวันนี้อัตโนมัติ, ยกเลิกให้ล้างวันที่
    function toggleStatus() {
        const next = adStatus === 'ยิงแล้ว' ? 'ยังไม่ยิง' : 'ยิงแล้ว';
        setAdStatus(next);
        if (next === 'ยิงแล้ว') {
            const d = new Date(); // วันที่ปัจจุบันตามเครื่องผู้ใช้ (local)
            const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            setEnd(today);
            put({ ad_status: next, ad_end: today });
        } else {
            setEnd('');
            put({ ad_status: next, ad_end: null });
        }
    }

    // ยิงแอดช้าไปกี่วันหลังวันลงคลิป (นับจาก Post Date → วันยิงแอด)
    const lateDays = (adStatus === 'ยิงแล้ว' && row.post_date && end) ? daysBetween(row.post_date, end) : null;
    // แจ้งเข้าระบบช้าไปกี่วันหลัง KOL ลงงานจริง — แยกให้เห็นว่ายิงแอดช้าเพราะเราช้าหรือเพราะเพิ่งได้รับแจ้ง
    const reportLag = (row.post_date && row.post_date_at)
        ? daysBetween(row.post_date, String(row.post_date_at).slice(0, 10))
        : null;

    return (
        <div className="ads-row">
            <div className="ads-name">
                <Avatar name={row.account_name || '?'} size={36} />
                <div className="ads-name-meta">
                    <span className="ads-acc">{row.account_name}</span>
                    <span className="ads-plat">{row.platform || '—'}</span>
                </div>
            </div>
            <div className="ads-cell ads-camp">
                <span className="ads-camp-name">{row.project_name || '—'}</span>
                {row.brand && <span className="tag">{row.brand}</span>}
            </div>
            <div className="ads-cell ads-prod">
                <ProductSummary value={row.product} max={2} />
            </div>
            <div className="ads-cell ads-prod">
                {asTargetArray(row.target).length > 0
                    ? asTargetArray(row.target).map(t => <span className="proc-ads-tgt" key={t} title={t}>🎯 {t}</span>)
                    : <span className="muted">—</span>}
            </div>
            <div className="ads-cell">
                {row.content_type ? (
                    <span className="proc-ctype-chip">{row.content_type}</span>
                ) : <span className="muted">—</span>}
            </div>
            <div className="ads-cell">
                {row.media_type || row.group_format ? (
                    <>
                        {row.media_type && <span className="proc-ctype-chip media">{row.media_type}</span>}
                        {splitCsv(row.group_format).map(x => <span className="proc-ctype-chip fmt" key={x}>{x}</span>)}
                    </>
                ) : <span className="muted">—</span>}
            </div>
            <div className="ads-cell ads-post">
                {row.post_url
                    ? <a href={row.post_url} target="_blank" rel="noreferrer" title="เปิดโพสต์"><Icon name="eye" size={16} /></a>
                    : <span className="muted">—</span>}
                <EnteredAt at={row.post_url_at} by={row.post_url_by} has={row.post_url} />
            </div>
            <div className="ads-cell">
                <CopyCode value={row.gencode} />
                <EnteredAt at={row.gencode_at} by={row.gencode_by} has={row.gencode} />
            </div>
            <div className="ads-cell">
                {row.id_post ? <span className="ads-code" title={row.id_post}>{row.id_post}</span> : <span className="muted">—</span>}
                <EnteredAt at={row.id_post_at} by={row.id_post_by} has={row.id_post} />
            </div>
            <div className="ads-cell">
                {row.post_date ? <span className="ads-postdate">{fmtDate(row.post_date)}</span> : <span className="muted">—</span>}
                <EnteredAt at={row.post_date_at} by={row.post_date_by} has={row.post_date} />
                {reportLag !== null && reportLag >= 2 && (
                    <span className={'ads-lag ' + (reportLag <= 3 ? 'warn' : 'bad')}
                        title={`KOL ลงงาน ${fmtDate(row.post_date)} แต่เพิ่งแจ้งเข้าระบบ ${fmtDate(row.post_date_at)} — ช้าไป ${reportLag} วัน ทำให้เริ่มยิงแอดได้ช้าตามไปด้วย`}>
                        แจ้งช้า {reportLag} วัน
                    </span>
                )}
            </div>
            <div className="ads-cell">
                <button type="button" className={'ads-status ' + (adStatus === 'ยิงแล้ว' ? 'done' : 'pending')} onClick={toggleStatus} disabled={saving}>
                    {adStatus === 'ยิงแล้ว' ? '✓ ยิงแล้ว' : 'ยังไม่ยิง'}
                </button>
                {/* ย้ายตัวบอกสถานะการบันทึกมาจากช่อง CPM ที่เอาออกไป */}
                {saving ? <span className="proc-status">…</span> : saved ? <span className="proc-status ok">✓</span> : null}
            </div>
            {/* แก้เองไม่ได้ — ระบบลงวันที่ให้ตอนกดปุ่มสถานะเป็น "ยิงแล้ว" และล้างให้เมื่อกดกลับเป็น "ยังไม่ยิง" */}
            <div className="ads-cell">
                {end
                    ? <span className="ads-postdate" title="ลงอัตโนมัติจากวันที่กดยิงแอด">{fmtDate(end)}</span>
                    : <span className="muted" title="กดปุ่มสถานะเป็น 'ยิงแล้ว' แล้ววันที่จะขึ้นเอง">—</span>}
            </div>
            <div className="ads-cell ads-late">
                {lateDays === null
                    ? <span className="muted">—</span>
                    : lateDays <= 0
                        ? <span className="late-chip ontime" title="ยิงแอดในวันเดียวกับที่ลงคลิป">ตรงเวลา</span>
                        : <span className={'late-chip ' + lateLevel(lateDays)} title={`ยิงแอดช้ากว่าวันลงคลิป ${lateDays} วัน`}>ช้า {lateDays} วัน</span>}
            </div>
            <div className="ads-cell ads-note">
                <input value={note} onChange={e => setNote(e.target.value)} onBlur={saveNote}
                    placeholder="เช่น Gencode ใช้ไม่ได้ / ยิงไม่ได้" title={note || 'หมายเหตุจากทีมยิงแอด'} />
            </div>
        </div>
    );
}

export default function Ads() {
    const [month, setMonth] = useState(currentMonth());
    const [allTime, setAllTime] = useState(true);
    const [brand, setBrand] = useState('');
    const [status, setStatus] = useState('');
    const [platform, setPlatform] = useState('');
    const [late, setLate] = useState('');   // '' | ontime | warn | bad
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(() => {
        const q = new URLSearchParams();
        if (!allTime && month) {
            const { from, to } = monthToRange(month);
            q.set('from', from); q.set('to', to);
        }
        if (brand) q.set('brand', brand);
        // สถานะ/แพลตฟอร์ม/ความช้า กรองฝั่งหน้าเว็บทั้งหมด จะได้นับจำนวนบนปุ่มให้ตรงกันได้
        api(`/ads?${q.toString()}`)
            .then(res => setData(res.data))
            .catch(err => setError(err.message));
    }, [month, allTime, brand]);

    useEffect(() => { load(); }, [load]);

    const s = data?.summary;
    const allRows = data?.rows || [];

    // จัดกลุ่มความช้า — นับเฉพาะโพสต์ที่ยิงแล้วและมีวันครบทั้งสองฝั่ง
    // เขียว = ช้าไม่เกิน 3 วัน (รวมยิงตรงวัน) · เหลือง = 4-5 วัน · แดง = 6 วันขึ้นไป
    const lateBucket = r => {
        if (r.ad_status !== 'ยิงแล้ว' || !r.post_date || !r.ad_end) return null;
        const d = daysBetween(r.post_date, r.ad_end);
        if (d === null) return null;
        return lateLevel(d);
    };
    // skip = ข้ามตัวกรองตัวนั้น ใช้ตอนนับเลขบนปุ่ม (เลขบอกว่า "ถ้ากดปุ่มนี้จะเหลือกี่รายการ")
    const matches = (r, skip) =>
        (skip === 'platform' || !platform || r.platform === platform) &&
        (skip === 'status' || !status || r.ad_status === status) &&
        (skip === 'late' || !late || lateBucket(r) === late);

    // เรียง: ยังไม่ยิง อยู่บน, ยิงแล้ว ลงไปอยู่ล่าง (ของเดิมในกลุ่มเดียวกันคงลำดับตาม data)
    const rows = allRows.filter(r => matches(r))
        .sort((a, b) => (a.ad_status === 'ยิงแล้ว' ? 1 : 0) - (b.ad_status === 'ยิงแล้ว' ? 1 : 0));

    const countIf = (skip, pred) => allRows.filter(r => matches(r, skip) && pred(r)).length;
    const platformOptions = [...new Set(allRows.map(r => r.platform).filter(Boolean))].sort();
    const hasFilter = !!(platform || status || late);
    // ค่า insight เพิ่มเติม (คำนวณจากข้อมูลที่มี)
    const topBrand = s && s.by_brand && s.by_brand.length ? s.by_brand[0] : null;
    const donePct = s && s.total_posts ? Math.round((s.done_count / s.total_posts) * 100) : 0;
    const maxBrandSpend = s && s.by_brand ? Math.max(1, ...s.by_brand.map(b => b.spend)) : 1;

    return (
        <div>
            <header className="page-head">
                <div>
                    <h1>ADS</h1>
                    <p className="page-sub">ติดตามสถานะการยิงแอดของแต่ละโพสต์ และสรุปค่าแอด</p>
                </div>
            </header>

            {/* ตัวกรอง */}
            <div className="toolbar" style={{ flexWrap: 'wrap' }}>
                <label className="bud-month">
                    เดือน:
                    <input type="month" value={month} disabled={allTime} onChange={e => setMonth(e.target.value)} />
                </label>
                <button className={'brand-chip' + (allTime ? ' active' : '')} onClick={() => setAllTime(a => !a)}>
                    {allTime ? '✓ ทุกเดือน' : 'ดูทุกเดือน'}
                </button>
            </div>

            <div className="brand-filter">
                <span className="brand-filter-label">▼ แบรนด์:</span>
                <button className={'brand-chip' + (brand === '' ? ' active' : '')} onClick={() => setBrand('')}>ทุกแบรนด์</button>
                {BRANDS.map(b => (
                    <button key={b} className={'brand-chip' + (brand === b ? ' active' : '')} onClick={() => setBrand(b)}>{b}</button>
                ))}
            </div>

            {/* กรอง Platform — เดิมซ่อนอยู่ในหัวคอลัมน์ KOL มองไม่เห็น
                ใช้ state ตัวเดียวกับตัวกรองในหัวคอลัมน์ กดที่ไหนก็ตรงกัน */}
            {platformOptions.length > 1 && (
                <div className="brand-filter">
                    <span className="brand-filter-label">▼ Platform:</span>
                    <button className={'brand-chip' + (platform === '' ? ' active' : '')} onClick={() => setPlatform('')}>
                        ทุก Platform ({countIf('platform', () => true)})
                    </button>
                    {platformOptions.map(pf => (
                        <button key={pf} className={'brand-chip' + (platform === pf ? ' active' : '')} onClick={() => setPlatform(pf)}>
                            {pf} ({countIf('platform', r => r.platform === pf)})
                        </button>
                    ))}
                </div>
            )}

            {error && <div className="alert-error">{error}</div>}

            {/* การ์ดสรุปค่าแอด */}
            <div className="summary-grid">
                <div className="summary-card">
                    <div className="summary-label">ยิงแอดแล้ว</div>
                    <div className="summary-value">{s ? `${s.done_count}/${s.total_posts}` : '—'}</div>
                    <div className="ads-progress"><span style={{ width: `${donePct}%` }} /></div>
                    <div className="summary-sub">{s ? `เหลือยังไม่ยิง ${s.pending_count} โพสต์ · ${donePct}%` : '—'}</div>
                </div>
                <div className="summary-card">
                    <div className="summary-label">Reach / วิว รวม (จากแอด)</div>
                    <div className="summary-value">{s ? fmtNum(s.total_reach) : '—'}</div>
                    <div className="summary-sub">ยอดที่ได้จากการยิงแอด</div>
                </div>
                <div className="summary-card">
                    <div className="summary-label">CPM แอด (ต้นทุน/1,000 วิว)</div>
                    <div className="summary-value">{s ? fmtMoney(s.cpm) : '—'}</div>
                    <div className="summary-sub">ยิ่งต่ำยิ่งคุ้ม</div>
                </div>
                <div className="summary-card">
                    <div className="summary-label">CPE แอด (ต้นทุน/1 engagement)</div>
                    <div className="summary-value">{s ? fmtMoney(s.cpe || 0) : '—'}</div>
                    <div className="summary-sub">ยิ่งต่ำยิ่งคุ้ม</div>
                </div>
            </div>

            {/* ตารางติดตามการยิงแอดรายโพสต์ */}
            <div className="panel">
                <div className="dash-section-head">
                    <h3>ติดตามการยิงแอดรายโพสต์ <span className="dash-section-sub">
                        {hasFilter ? `แสดง ${rows.length} จาก ${allRows.length} โพสต์` : 'กดปุ่ม ▾ ที่หัวคอลัมน์เพื่อกรอง · กรอกข้อมูลแล้วคลิกออกจากช่องเพื่อบันทึก'}
                    </span></h3>
                    {hasFilter && (
                        <button type="button" className="btn-clearfilter" onClick={() => { setPlatform(''); setStatus(''); setLate(''); }}>
                            ✕ ล้างตัวกรอง
                        </button>
                    )}
                </div>
                {!data ? (
                    <p className="empty" style={{ padding: '20px 0' }}>กำลังโหลด...</p>
                ) : rows.length === 0 ? (
                    <div className="empty-illus">
                        <div className="empty-illus-icon"><Icon name="target" size={30} /></div>
                        <div className="empty-illus-title">{hasFilter ? 'ไม่มีโพสต์ตรงกับตัวกรอง' : 'ยังไม่มีโพสต์ที่ยิงแอด'}</div>
                        <p className="empty-illus-sub">
                            {hasFilter
                                ? 'ลองกด "ล้างตัวกรอง" หรือเลือกเงื่อนไขอื่นดู'
                                : 'เมื่อ KOL ลงงานและทีมใส่ลิงก์โพสต์ในแท็บ On Process แล้ว โพสต์จะขึ้นมาที่นี่ให้ติดตามค่าแอดอัตโนมัติ'}
                        </p>
                    </div>
                ) : (
                    <div className="ads-tbl-scroll">
                        <div className="ads-tbl">
                            <div className="ads-tbl-head">
                                <span>KOL
                                    <ColumnFilter label="Platform" value={platform} onPick={setPlatform}
                                        options={[{ value: '', label: 'ทุก Platform', count: countIf('platform', () => true) },
                                        ...platformOptions.map(p => ({ value: p, label: p, count: countIf('platform', r => r.platform === p) }))]} />
                                </span>
                                <span>แคมเปญ</span><span>PRODUCT</span><span>TARGET</span><span>CONTENT TYPE</span><span>CONTENT FORMAT</span><span>โพสต์</span><span>GENCODE</span><span>ID POST</span><span>Post Date</span>
                                <span>สถานะ
                                    <ColumnFilter label="สถานะยิงแอด" value={status} onPick={setStatus}
                                        options={[{ value: '', label: 'ทุกสถานะ', count: countIf('status', () => true) },
                                        ...STATUSES.map(st => ({ value: st, label: st === 'ยิงแล้ว' ? '✓ ยิงแล้ว' : st, count: countIf('status', r => r.ad_status === st) }))]} />
                                </span>
                                <span>วันยิงแอด</span>
                                <span>ยิงช้า
                                    <ColumnFilter label="ความช้า" value={late} onPick={setLate}
                                        options={[{ value: '', label: 'ทั้งหมด', count: countIf('late', () => true) },
                                        ...LATE_OPTS.map(([v, l]) => ({ value: v, label: l, dot: v, count: countIf('late', r => lateBucket(r) === v) }))]} />
                                </span>
                                <span>หมายเหตุ</span>
                            </div>
                            {rows.map(r => <AdRow key={r.sub_id} row={r} onSaved={load} />)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
