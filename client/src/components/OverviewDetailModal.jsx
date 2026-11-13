import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { ProductSummary } from './ProductChips.jsx';

// ป๊อปอัปรายละเอียดของการ์ดหน้า Overview (ผู้ใช้สั่ง 13 พ.ย. 2026 — กดการ์ดแล้วเห็นข้อมูลของการ์ดนั้น · ป๊อปอัปกลางจอ)
// ข้อมูลมาจาก /api/stats/dashboard/details ตามตัวกรองเดียวกับหน้า (แบรนด์ / ช่วงวันที่ / แคมเปญ) — ผลรวมเท่าตัวเลขบนการ์ด
// kind: budget · views · avg · cpm · cpe · campaigns · platform (arg = ชื่อ Platform) · brand (arg = ชื่อแบรนด์) · kol (arg = แถว Top Influencer)

const fmtMoney = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const fmtInt = n => (Number(n) || 0).toLocaleString('th-TH');
function fmtNum(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return String(v);
}
const money = v => (v == null ? '—' : fmtMoney(v));
const pct = v => (v == null ? '—' : v + '%');
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function fmtDate(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
    return m ? `${Number(m[3])} ${TH_MONTHS[Number(m[2]) - 1]} ${m[1].slice(2)}` : '';
}
function period(c) {
    const a = fmtDate(c.start_date), b = fmtDate(c.end_date);
    if (a && b) return a === b ? a : `${a} – ${b}`;
    return a || b || '—';
}
const STATUS_LABEL = { Draft: 'ร่าง', Active: 'กำลังทำ', Completed: 'เสร็จสิ้น', Cancelled: 'ยกเลิก' };
const TYPE_LABEL = { solo: 'KOL รายคน', other: 'Talent' };
// ลิงก์คลิปมาจากข้อมูลที่ทีม / เอเจนซี่กรอก — เปิดได้เฉพาะ http(s)
const safeUrl = u => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : null);

function Bar({ value, max }) {
    const w = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
    return <div className="ovd-bar" aria-hidden="true"><i style={{ width: w + '%' }} /></div>;
}

function Stats({ items }) {
    return (
        <div className="ovd-stats">
            {items.filter(Boolean).map(([k, v, note]) => (
                <div key={k}><span>{k}</span><b>{v}</b>{note && <small>{note}</small>}</div>
            ))}
        </div>
    );
}

function H({ children, note }) {
    return <div className="ovd-h">{children}{note && <span>{note}</span>}</div>;
}

function Table({ head, children, empty }) {
    const rows = Array.isArray(children) ? children.filter(Boolean) : children;
    if (Array.isArray(rows) && rows.length === 0) return <div className="ovd-empty">{empty || 'ยังไม่มีข้อมูลในตัวกรองนี้'}</div>;
    return (
        <div className="ovd-scroll">
            <table className="data-table ovd-table">
                <thead><tr>{head.map(([label, num], i) => <th key={i} className={num ? 'num' : undefined}>{label}</th>)}</tr></thead>
                <tbody>{rows}</tbody>
            </table>
        </div>
    );
}

function CampaignLink({ id, name, onGo }) {
    if (!id) return <span>{name || '—'}</span>;
    // กดปกติ = ไปหน้าแคมเปญแล้วปิดป๊อปอัป · Ctrl / Cmd / Shift / คลิกกลาง = เปิดแท็บใหม่ ป๊อปอัปยังอยู่
    const onClick = e => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        onGo();
    };
    return <Link className="ovd-link" to={`/projects/${id}`} onClick={onClick}>{name || `แคมเปญ #${id}`}</Link>;
}

function ClipLink({ url }) {
    const href = safeUrl(url);
    return href
        ? <a href={href} target="_blank" rel="noreferrer" className="ka-link" title="เปิดคลิป"><Icon name="eye" size={14} /></a>
        : <span className="muted" title="ยังไม่มีลิงก์คลิป">—</span>;
}

function FeeCell({ c }) {
    if (c.fee_missing) return <span className="fee-missing-chip in-cell">รอค่าตัว</span>;
    if (c.fee_free) return <span className="fee-free-txt">ได้ฟรี</span>;
    return fmtMoney(c.fee);
}

function TypeChip({ type }) {
    return TYPE_LABEL[type] ? <span className="ovd-chip">{TYPE_LABEL[type]}</span> : null;
}

// สีเทียบค่ารวม (ไม่ใช่เกณฑ์ 28 / 1.5 ของคลิปเดี่ยว — การ์ดนี้คิดจาก Reach ทั้งก้อน) · ต่างกันไม่ถึง 10% = สีปกติ
function costTone(v, overall) {
    if (v == null || !(overall > 0)) return '';
    if (v <= overall * 0.9) return ' good';
    if (v >= overall * 1.1) return ' bad';
    return '';
}
function Cost({ v, overall, digits }) {
    if (v == null) return <span className="muted">—</span>;
    const txt = digits ? '฿' + Number(v).toFixed(digits) : fmtMoney(v);
    return <span className={'ovd-cost' + costTone(v, overall)}>{txt}</span>;
}

// ---------- เนื้อหาแต่ละการ์ด ----------

function BudgetBody({ d, go, onShowTrend }) {
    const list = d.campaigns.filter(c => c.in_filter).sort((a, b) => b.budget - a.budget || b.fee - a.fee);
    const budget = list.reduce((a, c) => a + c.budget, 0);
    const fee = d.totals.fee;
    return (
        <>
            <Stats items={[
                ['งบที่ตั้งไว้', fmtMoney(budget)],
                ['ค่าจ้าง KOL ที่ใส่แล้ว', fmtMoney(fee), budget > 0 ? `${Math.round((fee / budget) * 100)}% ของงบ` : null],
                fee > budget ? ['เพิ่มระหว่างทาง', fmtMoney(fee - budget)] : ['งบคงเหลือ', fmtMoney(budget - fee)],
                ['ยังไม่ใส่ค่าตัว', `${fmtInt(d.totals.fee_missing)} คลิป`]
            ]} />
            <H note="กดชื่อแคมเปญเพื่อเปิดหน้าแคมเปญ">แยกตามแคมเปญ</H>
            <Table head={[['แคมเปญ'], ['แบรนด์'], ['งบ', 1], ['ค่าจ้างที่ใส่แล้ว', 1], ['ใช้ไป'], ['ยังไม่ใส่ค่าตัว', 1]]}>
                {list.map(c => (
                    <tr key={c.id}>
                        <td><CampaignLink id={c.id} name={c.name} onGo={go} /> <TypeChip type={c.campaign_type} /></td>
                        <td>{c.brand}</td>
                        <td className="num">{fmtMoney(c.budget)}</td>
                        <td className="num">{fmtMoney(c.fee)}</td>
                        <td className="ovd-use">
                            {c.budget > 0
                                ? <><Bar value={c.fee} max={c.budget} /><span>{Math.round((c.fee / c.budget) * 100)}%</span></>
                                : <span className="muted">ไม่ได้ตั้งงบ</span>}
                        </td>
                        <td className="num">{c.fee_missing ? `${c.fee_missing} คลิป` : '—'}</td>
                    </tr>
                ))}
            </Table>
            {onShowTrend && (
                <div className="ovd-foot">
                    <button type="button" className="btn-ghost" onClick={onShowTrend}>ดูแนวโน้มงบรายเดือน ›</button>
                </div>
            )}
        </>
    );
}

function ClipTable({ list, go, empty }) {
    return (
        <Table empty={empty} head={[['#'], ['KOL'], ['Platform'], ['แบรนด์ / แคมเปญ'], ['สินค้า'], ['ค่าตัว', 1], ['Reach', 1], ['CPM', 1], ['คลิป']]}>
            {list.map((c, i) => (
                <tr key={c.id}>
                    <td>{i + 1}</td>
                    <td><strong>{c.name || '—'}</strong></td>
                    <td>{c.platform ? <span className="tag">{c.platform}</span> : '—'}</td>
                    <td><span className="muted">{c.brand || '—'}</span> · <CampaignLink id={c.project_id} name={c.project_name} onGo={go} /></td>
                    <td><ProductSummary value={c.product} max={2} /></td>
                    <td className="num"><FeeCell c={c} /></td>
                    <td className="num">{fmtNum(c.reach)}</td>
                    <td className="num">{money(c.cpm)}</td>
                    <td><ClipLink url={c.post_url} /></td>
                </tr>
            ))}
        </Table>
    );
}

function ViewsBody({ d, go }) {
    const t = d.totals;
    const plats = d.platforms.slice().sort((a, b) => b.reach - a.reach);
    const maxP = Math.max(1, ...plats.map(p => p.reach));
    const brands = d.brands.filter(b => b.clips > 0).sort((a, b) => b.reach - a.reach);
    const maxB = Math.max(1, ...brands.map(b => b.reach));
    return (
        <>
            <Stats items={[
                ['ยอดวิวรวม (Reach จากแอด)', fmtNum(t.reach)],
                ['คลิปทั้งหมด', fmtInt(t.clips)],
                ['ยังไม่มี Reach', `${fmtInt(t.no_reach)} คลิป`, 'ยังไม่ได้ยิงแอด / ยอดยังไม่เข้า']
            ]} />
            <div className="ovd-two">
                <div>
                    <H>แยกตาม Platform</H>
                    <Table head={[['Platform'], [''], ['Reach', 1]]}>
                        {plats.map(p => (
                            <tr key={p.platform}><td>{p.platform}</td><td className="ovd-barcell"><Bar value={p.reach} max={maxP} /></td><td className="num">{fmtNum(p.reach)}</td></tr>
                        ))}
                    </Table>
                </div>
                <div>
                    <H>แยกตามแบรนด์</H>
                    <Table head={[['แบรนด์'], [''], ['Reach', 1]]}>
                        {brands.map(b => (
                            <tr key={b.brand}><td>{b.brand}</td><td className="ovd-barcell"><Bar value={b.reach} max={maxB} /></td><td className="num">{fmtNum(b.reach)}</td></tr>
                        ))}
                    </Table>
                </div>
            </div>
            <H>คลิปยอด Reach สูงสุด 10 อันดับ</H>
            <ClipTable list={d.top_reach.filter(c => c.reach > 0)} go={go} empty="ยังไม่มีคลิปที่มี Reach" />
        </>
    );
}

function AvgBody({ d, go }) {
    const t = d.totals;
    const priced = t.clips - t.fee_missing;
    const camps = d.campaigns.filter(c => c.in_filter && c.clips > 0).sort((a, b) => b.avg_cost - a.avg_cost);
    const plats = d.platforms.slice().sort((a, b) => b.avg_cost - a.avg_cost);
    return (
        <>
            <Stats items={[
                ['ค่าเฉลี่ยต่อคลิป', fmtMoney(t.avg_cost), `ค่าตัวรวม ${fmtMoney(t.fee)} ÷ ${fmtInt(t.clips)} คลิป`],
                t.fee_missing > 0 && priced > 0 ? ['ไม่นับคลิปที่ยังไม่ใส่ค่าตัว', fmtMoney(Math.round(t.fee / priced)), `${fmtInt(t.fee_missing)} คลิปยังไม่ใส่ค่าตัว (การ์ดนับเป็น 0)`] : null,
                ['ค่าเฉลี่ยต่อคน', fmtMoney(t.kols ? Math.round(t.fee / t.kols) : 0), `${fmtInt(t.kols)} คน`]
            ]} />
            <div className="ovd-two">
                <div>
                    <H>แยกตาม Tier</H>
                    <Table head={[['Tier'], ['คลิป', 1], ['เฉลี่ย / คลิป', 1]]}>
                        {d.tiers.map(r => (
                            <tr key={r.tier}><td>{r.tier}</td><td className="num">{fmtInt(r.clips)}</td><td className="num">{fmtMoney(r.avg_cost)}</td></tr>
                        ))}
                    </Table>
                </div>
                <div>
                    <H>แยกตาม Platform</H>
                    <Table head={[['Platform'], ['คลิป', 1], ['เฉลี่ย / คลิป', 1]]}>
                        {plats.map(r => (
                            <tr key={r.platform}><td>{r.platform}</td><td className="num">{fmtInt(r.clips)}</td><td className="num">{fmtMoney(r.avg_cost)}</td></tr>
                        ))}
                    </Table>
                </div>
            </div>
            <H note="เรียงจากเฉลี่ยแพงสุด">แยกตามแคมเปญ</H>
            <Table head={[['แคมเปญ'], ['แบรนด์'], ['คลิป', 1], ['ค่าตัวรวม', 1], ['เฉลี่ย / คลิป', 1], ['ยังไม่ใส่ค่าตัว', 1]]}>
                {camps.map(c => (
                    <tr key={c.id}>
                        <td><CampaignLink id={c.id} name={c.name} onGo={go} /> <TypeChip type={c.campaign_type} /></td>
                        <td>{c.brand}</td>
                        <td className="num">{fmtInt(c.clips)}</td>
                        <td className="num">{fmtMoney(c.fee)}</td>
                        <td className="num">{fmtMoney(c.avg_cost)}</td>
                        <td className="num">{c.fee_missing ? `${c.fee_missing} คลิป` : '—'}</td>
                    </tr>
                ))}
            </Table>
        </>
    );
}

function CostBody({ d, go, focus }) {
    const t = d.totals;
    const key = focus === 'cpe' ? 'cpe' : 'cpm';
    const sortBy = (a, b) => (a[key] == null) - (b[key] == null) || (a[key] || 0) - (b[key] || 0);
    const brands = d.brands.filter(b => b.clips > 0).sort(sortBy);
    const camps = d.campaigns.filter(c => c.in_filter && c.clips > 0).sort(sortBy);
    const row = r => (
        <>
            <td className="num"><Cost v={r.cpm} overall={t.cpm} /></td>
            <td className="num"><Cost v={r.cpe} overall={t.cpe} digits={2} /></td>
            <td className="num">{fmtNum(r.reach)}</td>
            <td className="num">{fmtInt(r.clips)}</td>
        </>
    );
    return (
        <>
            <Stats items={[
                ['CPM รวม', money(t.cpm), 'ค่าตัว ÷ Reach 1,000 (เฉพาะคลิปที่ใส่ค่าตัวแล้ว)'],
                ['CPE รวม', t.cpe == null ? '—' : '฿' + Number(t.cpe).toFixed(2), 'ค่าตัว ÷ engagement'],
                ['ยังไม่ใส่ค่าตัว', `${fmtInt(t.fee_missing)} คลิป`, 'ไม่นำมาคิด CPM / CPE']
            ]} />
            <div className="ovd-legend"><span className="ovd-cost good">เขียว</span> ถูกกว่าค่ารวมเกิน 10% · <span className="ovd-cost bad">แดง</span> แพงกว่าค่ารวมเกิน 10%</div>
            <H note={`เรียงจาก ${key.toUpperCase()} ถูกสุด`}>แยกตามแบรนด์</H>
            <Table head={[['แบรนด์'], ['CPM', 1], ['CPE', 1], ['Reach', 1], ['คลิป', 1]]}>
                {brands.map(b => <tr key={b.brand}><td>{b.brand}</td>{row(b)}</tr>)}
            </Table>
            <H note={`เรียงจาก ${key.toUpperCase()} ถูกสุด`}>แยกตามแคมเปญ</H>
            <Table head={[['แคมเปญ'], ['CPM', 1], ['CPE', 1], ['Reach', 1], ['คลิป', 1]]}>
                {camps.map(c => <tr key={c.id}><td><CampaignLink id={c.id} name={c.name} onGo={go} /> <span className="muted">· {c.brand}</span></td>{row(c)}</tr>)}
            </Table>
            <H note="คิดจากค่าตัว ÷ Reach ของคลิปนั้น">คลิปที่ CPM ถูกสุด 5 อันดับ</H>
            <ClipTable list={d.cpm_best} go={go} empty="ยังไม่มีคลิปที่คิด CPM ได้" />
            {/* คลิปน้อยกว่า 10 = server ไม่ส่งคลิปซ้ำกับรายการถูกสุด · ไม่เหลือ = ไม่ต้องโชว์ตาราง */}
            {d.cpm_worst.length > 0 && (
                <>
                    <H note={d.cpm_best.length + d.cpm_worst.length < 10 ? 'ไม่รวมคลิปที่อยู่ในรายการถูกสุดแล้ว' : null}>คลิปที่ CPM แพงสุด {d.cpm_worst.length} อันดับ</H>
                    <ClipTable list={d.cpm_worst} go={go} />
                </>
            )}
        </>
    );
}

function CampaignsBody({ d, go, filtered }) {
    const order = { Active: 0, Draft: 1, Completed: 2, Cancelled: 3 };
    const list = d.campaigns.slice().sort((a, b) => (b.in_filter - a.in_filter) || ((order[a.status] ?? 9) - (order[b.status] ?? 9)));
    const count = st => d.campaigns.filter(c => c.status === st).length;
    return (
        <>
            <Stats items={[
                ['ทั้งหมด', `${fmtInt(d.campaigns.length)} แคมเปญ`],
                ['กำลังทำ', fmtInt(count('Active'))],
                ['ร่าง', fmtInt(count('Draft'))],
                ['เสร็จสิ้น', fmtInt(count('Completed'))]
            ]} />
            {filtered && <div className="ovd-note">การ์ดนี้นับทุกแคมเปญที่คุณมีสิทธิ์ดู — แคมเปญที่ไม่อยู่ในตัวกรองแบรนด์ / แคมเปญตอนนี้เป็นสีจาง</div>}
            <Table head={[['แคมเปญ'], ['แบรนด์'], ['สถานะ'], ['ช่วงเวลา'], ['KOL ที่คัดเลือก', 1], ['คลิป', 1], ['งบ', 1]]}>
                {list.map(c => (
                    <tr key={c.id} className={c.in_filter ? undefined : 'ovd-dim'}>
                        <td><CampaignLink id={c.id} name={c.name} onGo={go} /> <TypeChip type={c.campaign_type} /></td>
                        <td>{c.brand}</td>
                        <td>{c.status ? <span className={`status status-${c.status}`}>{STATUS_LABEL[c.status] || c.status}</span> : '—'}</td>
                        <td>{period(c)}</td>
                        <td className="num">{fmtInt(c.kols)}{c.kol_target > 0 && <span className="muted"> / {fmtInt(c.kol_target)}</span>}</td>
                        <td className="num">{fmtInt(c.clips)}</td>
                        <td className="num">{fmtMoney(c.budget)}</td>
                    </tr>
                ))}
            </Table>
        </>
    );
}

function PlatformBody({ d, go, name }) {
    const p = d.platforms.find(x => x.platform === name);
    if (!p) return <div className="ovd-empty">ยังไม่มีคลิปของ {name} ในตัวกรองนี้</div>;
    return (
        <>
            <Stats items={[
                ['KOL', fmtInt(p.kols), `${fmtInt(p.clips)} คลิป`],
                ['Reach', fmtNum(p.reach)],
                ['Engagement', pct(p.engagement)],
                ['Avg Cost / คลิป', fmtMoney(p.avg_cost)],
                ['CPM', money(p.cpm)],
                ['CPE', p.cpe == null ? '—' : '฿' + Number(p.cpe).toFixed(2)]
            ]} />
            <div className="ovd-two">
                <div>
                    <H>แยกตามแบรนด์</H>
                    <Table head={[['แบรนด์'], ['KOL', 1], ['Reach', 1], ['Engagement', 1], ['Avg Cost', 1]]}>
                        {p.brands.map(b => (
                            <tr key={b.brand}><td>{b.brand}</td><td className="num">{fmtInt(b.kols)}</td><td className="num">{fmtNum(b.reach)}</td><td className="num">{pct(b.engagement)}</td><td className="num">{fmtMoney(b.avg_cost)}</td></tr>
                        ))}
                    </Table>
                </div>
                <div>
                    <H>แยกตาม Tier</H>
                    <Table head={[['Tier'], ['KOL', 1], ['คลิป', 1], ['Avg Cost', 1]]}>
                        {p.tiers.map(r => (
                            <tr key={r.tier}><td>{r.tier}</td><td className="num">{fmtInt(r.kols)}</td><td className="num">{fmtInt(r.clips)}</td><td className="num">{fmtMoney(r.avg_cost)}</td></tr>
                        ))}
                    </Table>
                </div>
            </div>
            <H>คลิปยอด Reach สูงสุดของ {name} 10 อันดับ</H>
            <ClipTable list={p.top.filter(c => c.reach > 0)} go={go} empty="ยังไม่มีคลิปที่มี Reach" />
        </>
    );
}

function BrandBody({ d, go, name, onFilterBrand }) {
    const b = d.brands.find(x => x.brand === name);
    const camps = d.campaigns.filter(c => c.in_filter && c.brand === name).sort((a, b2) => b2.budget - a.budget);
    return (
        <>
            {b ? (
                <Stats items={[
                    ['งบที่ตั้งไว้', fmtMoney(b.budget)],
                    ['ค่าจ้างที่ใส่แล้ว', fmtMoney(b.fee)],
                    ['KOL', fmtInt(b.kols), `${fmtInt(b.clips)} คลิป`],
                    ['Reach', fmtNum(b.reach)],
                    ['CPM', money(b.cpm)]
                ]} />
            ) : null}
            <H note="กดชื่อแคมเปญเพื่อเปิดหน้าแคมเปญ">แคมเปญของ {name}</H>
            <Table head={[['แคมเปญ'], ['สถานะ'], ['งบ', 1], ['ใช้ไป', 1], ['KOL', 1], ['Reach', 1], ['CPM', 1]]}>
                {camps.map(c => (
                    <tr key={c.id}>
                        <td><CampaignLink id={c.id} name={c.name} onGo={go} /> <TypeChip type={c.campaign_type} /></td>
                        <td>{c.status ? <span className={`status status-${c.status}`}>{STATUS_LABEL[c.status] || c.status}</span> : '—'}</td>
                        <td className="num">{fmtMoney(c.budget)}</td>
                        <td className="num">{fmtMoney(c.fee)}</td>
                        <td className="num">{fmtInt(c.kols)}</td>
                        <td className="num">{fmtNum(c.reach)}</td>
                        <td className="num">{money(c.cpm)}</td>
                    </tr>
                ))}
            </Table>
            {onFilterBrand && (
                <div className="ovd-foot">
                    <button type="button" className="btn-ghost" onClick={onFilterBrand}>กรองทั้งหน้าเป็นแบรนด์ {name} ›</button>
                </div>
            )}
        </>
    );
}

function KolBody({ k, go }) {
    // server ก่อนรีสตาร์ตยังไม่ส่ง clips — โชว์แถวที่กดอย่างเดียว
    const clips = Array.isArray(k.clips) && k.clips.length ? k.clips : [k];
    const fee = clips.reduce((a, c) => a + (Number(c.fee) || 0), 0);
    const views = clips.reduce((a, c) => a + (Number(c.views) || 0), 0);
    const reach = clips.reduce((a, c) => a + (Number(c.ad_reach) || 0), 0);
    return (
        <>
            <Stats items={[
                ['คลิป', fmtInt(clips.length)],
                ['ค่าตัวรวม', fmtMoney(fee), clips.some(c => c.fee_missing) ? 'มีคลิปที่ยังไม่ใส่ค่าตัว' : null],
                ['ยอดวิวคอนเทนต์', fmtNum(views)],
                ['Reach จากแอด', fmtNum(reach)]
            ]} />
            <H note="CPM / CPE คิดจากยอดวิวคอนเทนต์ เหมือนตาราง Top Influencer">ทุกคลิปของคนนี้ในตัวกรองที่เลือก</H>
            <Table head={[['Platform'], ['แคมเปญ'], ['สินค้า'], ['ค่าตัว', 1], ['ยอดวิว', 1], ['Reach', 1], ['Engagement', 1], ['CPM', 1], ['CPE', 1], ['คลิป']]}>
                {clips.map(c => (
                    <tr key={c.kol_id}>
                        <td>{c.platform ? <span className="tag">{c.platform}</span> : '—'}</td>
                        <td><CampaignLink id={c.project_id} name={c.project_name} onGo={go} /></td>
                        <td><ProductSummary value={c.product} max={2} /></td>
                        <td className="num"><FeeCell c={c} /></td>
                        <td className="num">{fmtNum(c.views)}</td>
                        <td className="num">{fmtNum(c.ad_reach)}</td>
                        <td className="num">{pct(c.engagement)}</td>
                        <td className="num">{c.cpm ? fmtMoney(c.cpm) : '—'}</td>
                        <td className="num">{c.cpe ? fmtMoney(c.cpe) : '—'}</td>
                        <td><ClipLink url={c.post_url} /></td>
                    </tr>
                ))}
            </Table>
        </>
    );
}

const TITLES = {
    budget: ['งบประมาณแคมเปญ', 'แยกตามแคมเปญ · งบ / ค่าจ้างที่ใส่แล้ว / คลิปที่ยังไม่ใส่ค่าตัว'],
    views: ['ยอดวิวรวม', 'Reach จากแอด แยกตาม Platform / แบรนด์ + คลิปที่ Reach สูงสุด'],
    avg: ['Avg Cost / Clip', 'ค่าเฉลี่ยต่อคลิป แยกตาม Tier / Platform / แคมเปญ'],
    cpm: ['CPM / CPE', 'ความคุ้มค่า แยกตามแบรนด์ / แคมเปญ + คลิปที่ถูกสุด / แพงสุด'],
    cpe: ['CPM / CPE', 'ความคุ้มค่า แยกตามแบรนด์ / แคมเปญ + คลิปที่ถูกสุด / แพงสุด'],
    campaigns: ['Campaign ทั้งหมด', 'สถานะ · ช่วงเวลา · KOL ที่คัดเลือก'],
    platform: [null, 'แยกตามแบรนด์ / Tier + คลิปที่ Reach สูงสุด'],
    brand: [null, 'แคมเปญของแบรนด์นี้ · งบ / ใช้ไป / Reach / CPM'],
    kol: [null, 'ทุกคลิปของคนนี้ในตัวกรองที่เลือก']
};

/**
 * detail = { kind, arg } · getDetails(): Promise<data> (แคชไว้ที่หน้า Overview ตามตัวกรอง)
 * filterLabel = ข้อความบอกตัวกรองที่ใช้อยู่ · filtered = มีตัวกรองแบรนด์ / แคมเปญไหม
 */
export default function OverviewDetailModal({ detail, getDetails, filterLabel, filtered, onClose, onFilterBrand, onShowTrend }) {
    const { kind, arg } = detail;
    const needsData = kind !== 'kol';
    const [state, setState] = useState({ loading: needsData, data: null, error: '' });
    const closeRef = useRef(null);
    const dialogRef = useRef(null);

    useEffect(() => {
        if (!needsData) return undefined;
        let alive = true;
        setState({ loading: true, data: null, error: '' });
        getDetails()
            .then(data => { if (alive) setState({ loading: false, data, error: '' }); })
            .catch(err => { if (alive) setState({ loading: false, data: null, error: err.message || 'โหลดรายละเอียดไม่สำเร็จ' }); });
        return () => { alive = false; };
    }, [needsData, getDetails]);

    // เปิด = โฟกัสปุ่มปิด · ปิด = คืนโฟกัสให้การ์ดที่กด (ถ้ายังอยู่ในหน้า — กดลิงก์ไปหน้าอื่นแล้วการ์ดหายไปก็ข้าม)
    useEffect(() => {
        const prev = document.activeElement;
        closeRef.current?.focus();
        return () => { if (prev && prev.focus && document.contains(prev)) prev.focus(); };
    }, []);

    // Esc ปิด · Tab วนอยู่ในป๊อปอัป ไม่หลุดไปการ์ดด้านหลัง
    useEffect(() => {
        const onKey = e => {
            if (e.key === 'Escape') { onClose(); return; }
            if (e.key !== 'Tab' || !dialogRef.current) return;
            const items = [...dialogRef.current.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            const inside = dialogRef.current.contains(document.activeElement);
            if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const [t0, sub] = TITLES[kind] || ['รายละเอียด', ''];
    const title = kind === 'platform' ? `${arg} — รายละเอียด`
        : kind === 'brand' ? `${arg} — งบประมาณตามแบรนด์`
            : kind === 'kol' ? `${arg.name || 'KOL'} — Top Influencer`
                : t0;
    const go = () => onClose();
    const d = state.data;

    let body;
    if (!needsData) body = <KolBody k={arg} go={go} />;
    else if (state.loading) body = <div className="ovd-empty">กำลังโหลดรายละเอียด…</div>;
    else if (state.error || !d) body = <div className="alert-error">{state.error || 'โหลดรายละเอียดไม่สำเร็จ'}</div>;
    else if (kind === 'budget') body = <BudgetBody d={d} go={go} onShowTrend={onShowTrend} />;
    else if (kind === 'views') body = <ViewsBody d={d} go={go} />;
    else if (kind === 'avg') body = <AvgBody d={d} go={go} />;
    else if (kind === 'cpm' || kind === 'cpe') body = <CostBody d={d} go={go} focus={kind} />;
    else if (kind === 'campaigns') body = <CampaignsBody d={d} go={go} filtered={filtered} />;
    else if (kind === 'platform') body = <PlatformBody d={d} go={go} name={arg} />;
    else if (kind === 'brand') body = <BrandBody d={d} go={go} name={arg} onFilterBrand={onFilterBrand} />;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div ref={dialogRef} className="modal ovd-modal" role="dialog" aria-modal="true" aria-labelledby="ovd-title" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <div>
                        <h3 id="ovd-title">{title}</h3>
                        <div className="ovd-sub">{sub}{filterLabel ? ` · ${filterLabel}` : ''}</div>
                    </div>
                    <button ref={closeRef} type="button" className="modal-x" onClick={onClose} aria-label="ปิด">×</button>
                </div>
                {body}
            </div>
        </div>
    );
}
