import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import DatePicker from '../components/DatePicker.jsx';
import BudgetTrendModal from '../components/BudgetTrendModal.jsx';
import { ProductSummary } from '../components/ProductChips.jsx';
import ScoreModal from '../components/ScoreModal.jsx';

const BRANDS = ["Jula's Herb", 'Code Lab', 'Jdent', 'Jarvit', 'Beauterry', 'Jernis', 'Dermiq', 'Minimii', 'Any Skin'];
const TOP_PREVIEW = 5;   // Top Influencer แสดงกี่อันดับก่อนกดดูเพิ่ม

const PLATFORM_CARDS = [
    { key: 'TikTok', label: 'TikTok', badge: '♪', color: '#010101', bar: '#010101' },
    { key: 'Instagram', label: 'Instagram', badge: '◉', color: '#fff', bar: 'linear-gradient(90deg,#f09433,#dc2743,#bc1888)', badgeBg: 'linear-gradient(135deg,#f09433,#dc2743,#bc1888)' },
    { key: 'Facebook', label: 'Facebook', badge: 'f', color: '#fff', bar: '#1877f2', badgeBg: '#1877f2' },
    { key: 'Lemon8', label: 'Lemon8', badge: '🍋', color: '#000', bar: '#f5c518', badgeBg: '#f5c518' }
];

function fmtNum(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return String(v);
}
const fmtMoney = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');

// หน้าภาพรวมเริ่มต้นที่ "ทั้งหมด" — อยากดูรายเดือนค่อยกดเลือกช่วงวันที่เอง
// (เดิมตั้งต้นเป็นเดือนปัจจุบัน ทำให้การ์ดสรุปโชว์แค่บางส่วนของแคมเปญ
//  แต่ช่องงบด้านบนเป็นยอดทั้งแคมเปญ อ่านคู่กันแล้วเข้าใจผิดว่าเหลืองบเยอะ)
const ALL_TIME = { from: '', to: '' };

export default function Dashboard() {
    const [filters, setFilters] = useState({ brand: '', from: ALL_TIME.from, to: ALL_TIME.to, projectId: '' });
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [showTrend, setShowTrend] = useState(false);
    const [showAllKols, setShowAllKols] = useState(false);   // Top Influencer: 5 อันดับแรก vs ทั้ง 20
    const [scoreOf, setScoreOf] = useState(null);            // แถวที่กำลังเปิดดูที่มาของคะแนน

    useEffect(() => {
        const q = new URLSearchParams();
        if (filters.brand) q.set('brand', filters.brand);
        if (filters.from) q.set('from', filters.from);
        if (filters.to) q.set('to', filters.to);
        if (filters.projectId) q.set('project_id', filters.projectId);
        api(`/stats/dashboard?${q.toString()}`)
            .then(res => setData(res.data))
            .catch(err => setError(err.message));
    }, [filters]);

    function setF(patch) { setFilters(f => ({ ...f, ...patch })); }

    const platformMap = {};
    (data?.platforms || []).forEach(p => { platformMap[p.platform] = p; });

    // Top Influencer — server ส่งมา 20 อันดับ แสดง 5 อันดับแรกก่อน กดดูที่เหลือได้
    const topKols = data?.top_kols || [];
    const shownKols = showAllKols ? topKols : topKols.slice(0, TOP_PREVIEW);

    const budgetUsedPct = data && data.total_budget > 0
        ? Math.min(100, Math.round((data.total_spent / data.total_budget) * 100)) : 0;
    const maxBrandBudget = Math.max(1, ...(data?.brand_summary || []).map(b => b.budget));

    return (
        <div>
            <header className="page-head with-action">
                <div>
                    <h1>Dashboard Overview</h1>
                    <p className="page-sub">Campaign Performance &amp; KOL Metrics</p>
                </div>
                <div className="filter-controls">
                    <div className="date-range">
                        <Icon name="dashboard" size={15} />
                        <DatePicker value={filters.from} onChange={v => setF({ from: v })} placeholder="ตั้งแต่" />
                        <span>–</span>
                        <DatePicker value={filters.to} onChange={v => setF({ to: v })} placeholder="ถึง" />
                    </div>
                    <select className="campaign-select" value={filters.projectId} onChange={e => setF({ projectId: e.target.value })}>
                        <option value="">ทุก Campaign</option>
                        {(data?.campaigns || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
            </header>

            {error && <div className="alert-error">{error}</div>}

            {/* ตัวกรองแบรนด์ */}
            <div className="brand-filter">
                <span className="brand-filter-label">▼ แบรนด์:</span>
                <button className={'brand-chip' + (filters.brand === '' ? ' active' : '')} onClick={() => setF({ brand: '' })}>ทุกแบรนด์</button>
                {BRANDS.map(b => (
                    <button key={b} className={'brand-chip' + (filters.brand === b ? ' active' : '')} onClick={() => setF({ brand: b })}>{b}</button>
                ))}
            </div>

            {/* โซน 1: Bento สรุปภาพรวม */}
            <div className="dash-section"><span className="dash-bar" /> สรุปภาพรวม</div>
            <div className="dash-bento">
                {/* การ์ดใหญ่ (ไล่สีมินต์) */}
                <div className="bento-hero">
                    <div className="bento-hero-top">
                        <span className="bento-hero-label">งบประมาณแคมเปญทั้งหมด</span>
                        <div className="bento-hero-ico"><Icon name="coins" size={20} /></div>
                    </div>
                    <div className="bento-hero-value">{data ? fmtMoney(data.total_budget) : '—'}</div>
                    {/* ค่าจ้างจริงเกินงบเมื่อไหร่ต้องเห็นทันที ไม่ใช่ต้องไปนั่งลบเอง */}
                    {data && data.total_budget > 0 && data.total_spent > data.total_budget && (
                        <div className="bento-hero-over">
                            ⚠️ ค่าจ้างจริง {fmtMoney(data.total_spent)} · เกินงบ {fmtMoney(data.total_spent - data.total_budget)}
                        </div>
                    )}
                    <div className="bento-hero-stats">
                        <div><div className="bh-k">จำนวน KOL</div><div className="bh-v">
                            {data ? data.total_kols : '—'}
                            {data && data.total_clips > data.total_kols && <span className="bh-sub"> · {data.total_clips} คลิป</span>}
                        </div></div>
                        <div><div className="bh-k">แคมเปญ</div><div className="bh-v">{data ? data.total_campaigns : '—'}</div></div>
                        <div><div className="bh-k">ค่าจ้าง KOL ที่ใช้ไป</div><div className="bh-v">{data ? fmtMoney(data.total_spent) : '—'}</div></div>
                    </div>
                </div>

                {/* การ์ดเล็กซ้อน */}
                <div className="bento-stack">
                    <div className="bento-mini">
                        <div className="bento-mini-top"><span className="summary-label">ยอดวิวรวม</span><div className="mini-ico"><Icon name="eye" size={18} /></div></div>
                        <div className="bento-mini-value">{data ? fmtNum(data.total_views) : '—'}</div>
                        <div className="summary-sub">จากทุกแพลตฟอร์ม</div>
                    </div>
                    <div className="bento-mini">
                        <div className="bento-mini-top"><span className="summary-label">Avg Cost / Clip</span><div className="mini-ico"><Icon name="star" size={18} /></div></div>
                        <div className="bento-mini-value">{data ? fmtMoney(data.avg_cost_per_clip ?? data.avg_cost_per_kol) : '—'}</div>
                        <div className="summary-sub">
                            ค่าเฉลี่ยต่อคลิป (ใช้คิดงบยิงแอด)
                            {data && data.total_clips > data.total_kols && <><br />ต่อคน {fmtMoney(data.avg_cost_per_kol)}</>}
                        </div>
                    </div>
                </div>
            </div>

            {/* การ์ดเมตริกไอคอน */}
            <div className="metric-tiles">
                <div className="metric-tile">
                    <div className="metric-tile-ico g1"><Icon name="bars" size={22} /></div>
                    <div><div className="metric-tile-val">{data ? fmtMoney(data.cpm) : '—'}</div><div className="metric-tile-label">CPM · ต่อ 1,000 วิว</div></div>
                </div>
                <div className="metric-tile">
                    <div className="metric-tile-ico g2"><Icon name="target" size={22} /></div>
                    <div><div className="metric-tile-val">{data ? fmtMoney(data.cpe) : '—'}</div><div className="metric-tile-label">CPE · ต่อ engagement</div></div>
                </div>
                <div className="metric-tile">
                    <div className="metric-tile-ico g4"><Icon name="folder" size={20} /></div>
                    <div><div className="metric-tile-val">{data ? (data.campaigns || []).length : '—'}</div><div className="metric-tile-label">Campaign ทั้งหมด</div></div>
                </div>
            </div>

            {/* โซน 2: ผลงานตามแพลตฟอร์ม */}
            <div className="dash-section"><span className="dash-bar" /> ผลงานตามแพลตฟอร์ม <span className="dash-section-sub">จำนวน KOL · ยอดวิว · Engagement · ค่าเฉลี่ย</span></div>
            <div className="platform-grid">
                {PLATFORM_CARDS.map(pc => {
                    const m = platformMap[pc.key];
                    return (
                        <div className="platform-card" key={pc.key}>
                            <div className="platform-bar" style={{ background: pc.bar }} />
                            <div className="platform-card-body">
                                <div className="platform-badge" style={{ background: pc.badgeBg || pc.color, color: pc.badgeBg ? '#fff' : '#fff' }}>{pc.badge}</div>
                                <div className="platform-name">{pc.label.toUpperCase()}</div>
                                <div className="platform-count">{m ? m.kols_count : 0}</div>
                                <div className="platform-count-label">KOLS COUNT</div>
                                <div className="platform-metrics">
                                    <div className="pm-row"><span>Views</span><span>{m && m.views ? fmtNum(m.views) : '-'}</span></div>
                                    <div className="pm-row"><span>Engagement</span><span>{m && m.engagement != null ? m.engagement + '%' : '-'}</span></div>
                                    <div className="pm-row"><span>Avg Cost</span><span>{m && m.avg_cost ? fmtMoney(m.avg_cost) : '-'}</span></div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* โซน 3: งบประมาณตามแบรนด์ */}
            <div className="dash-section"><span className="dash-bar" /> งบประมาณตามแบรนด์ <span className="dash-section-sub">เทียบงบ + จำนวน KOL แต่ละแบรนด์</span></div>
            <div className="panel">
                <div className="brand-bars">
                    {(data?.brand_summary || []).length === 0 ? (
                        <div className="empty-illus">
                            <div className="empty-illus-icon"><Icon name="coins" size={28} /></div>
                            <div className="empty-illus-title">ยังไม่มีข้อมูลงบประมาณ</div>
                            <p className="empty-illus-sub">เมื่อมีแคมเปญและ KOL ในช่วงที่เลือก กราฟเทียบงบแต่ละแบรนด์จะแสดงที่นี่</p>
                        </div>
                    ) : data.brand_summary.map(b => (
                        <div className="brand-bar-row" key={b.brand}>
                            <div className="brand-bar-name">{b.brand}</div>
                            <div className="brand-bar-track">
                                <div className="brand-bar-fill" style={{ width: `${Math.round((b.budget / maxBrandBudget) * 100)}%` }} />
                            </div>
                            <div className="brand-bar-val">{fmtMoney(b.budget)} <span className="muted">· {b.kols_count} KOL</span></div>
                        </div>
                    ))}
                </div>
            </div>

            {/* โซน 4: อันดับ Influencer */}
            <div className="dash-section"><span className="dash-bar" /> Top Influencer <span className="dash-section-sub">อันดับตามยอดวิว</span></div>
            <div className="panel no-pad">
                <div className="ti-scroll">
                    <table className="data-table ti-table">
                        <thead>
                            <tr>
                                <th>#</th><th>ชื่อ</th><th>คลิป</th><th>แพลตฟอร์ม</th><th>Brand</th><th>Product</th>
                                <th className="num">ค่าตัวรวม</th>
                                <th className="num">Views</th><th className="num">Likes</th><th className="num">Comments</th>
                                <th className="num">Saves</th><th className="num">Shares</th>
                                <th className="num">Engagement</th>
                                <th className="num">CPM</th><th className="num">CPE</th>
                                <th className="num">Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topKols.length === 0 ? (
                                <tr><td colSpan="16" className="empty">ยังไม่มีข้อมูล</td></tr>
                            ) : shownKols.map((k, i) => (
                                <tr key={k.kol_id}>
                                    <td><span className={'rank rank-' + (i + 1)}>{i + 1}</span></td>
                                    <td><strong>{k.name}</strong></td>
                                    <td>
                                        {k.post_url
                                            ? <a href={k.post_url} target="_blank" rel="noreferrer" className="ka-link" title="เปิดคลิป"><Icon name="eye" size={15} /></a>
                                            : <span className="muted" title="ยังไม่มีลิงก์คลิป">—</span>}
                                    </td>
                                    <td>{k.platform ? <span className="tag">{k.platform}</span> : '—'}</td>
                                    <td>{k.brand ? <span className="tag">{k.brand}</span> : '—'}</td>
                                    <td><ProductSummary value={k.product} max={2} /></td>
                                    <td className="num">{fmtMoney(k.fee)}</td>
                                    <td className="num">{fmtNum(k.views)}</td>
                                    <td className="num">{fmtNum(k.likes)}</td>
                                    <td className="num">{fmtNum(k.comments)}</td>
                                    <td className="num">{fmtNum(k.saves)}</td>
                                    <td className="num">{fmtNum(k.shares)}</td>
                                    <td className="num">{k.engagement != null ? k.engagement + '%' : '—'}</td>
                                    <td className="num">{k.cpm ? fmtMoney(k.cpm) : '—'}</td>
                                    <td className="num">{k.cpe ? fmtMoney(k.cpe) : '—'}</td>
                                    <td className="num">
                                        {k.score == null
                                            ? <span className="muted" title="ยังไม่ได้กรอกผลงานคอนเทนต์">—</span>
                                            : <button type="button" className="ti-score" onClick={() => setScoreOf(k)}
                                                title="กดดูว่าคะแนนนี้มาจากไหน">{k.score}</button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {topKols.length > TOP_PREVIEW && (
                    <button type="button" className="ti-more" onClick={() => setShowAllKols(v => !v)}>
                        {showAllKols
                            ? '▲ ย่อกลับเหลือ 5 อันดับแรก'
                            : `▼ ดูอันดับ ${TOP_PREVIEW + 1}-${topKols.length} (อีก ${topKols.length - TOP_PREVIEW} คน)`}
                    </button>
                )}
            </div>

            {showTrend && <BudgetTrendModal brand={filters.brand} onClose={() => setShowTrend(false)} />}
            {scoreOf && <ScoreModal k={scoreOf} onClose={() => setScoreOf(null)} />}
        </div>
    );
}
