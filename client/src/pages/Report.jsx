import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import { productLabel } from '../data/products.js';
import { ProductSummary } from '../components/ProductChips.jsx';
import { fmtRange } from '../utils/date.js';

const B = n => '฿' + (Number(n) || 0).toLocaleString('th-TH');
const N = n => (Number(n) || 0).toLocaleString('th-TH');
const PLAT_ICON = { TikTok: '♪', Instagram: '◉', Facebook: 'f', Lemon8: '🍋' };

export default function Report() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [plat, setPlat] = useState(''); // '' = All

    useEffect(() => {
        api(`/stats/reports/${id}`).then(res => setD(res.data)).catch(err => setError(err.message));
    }, [id]);

    if (error) return <div className="alert-error">{error}</div>;
    if (!d) return <div className="empty" style={{ padding: 40 }}>กำลังโหลด...</div>;

    const c = d.campaign;
    const kolRows = plat ? d.kols.filter(k => k.platform === plat) : d.kols;

    // จัดอันดับจากคะแนน Performance ที่ server คิดมาให้ (สูตรเดียวกับ Top Influencer หน้า Dashboard)
    // คนที่กรอกผลงานแล้วขึ้นก่อนคนที่ยังไม่กรอกเสมอ — เพราะยังไม่มีอะไรให้ตัดสิน ไม่ใช่ว่าทำได้แย่
    // เสมอกันตัดด้วย engagement รวม แล้วค่อยยอดวิว
    const kolRank = [...kolRows]
        .sort((a, b) =>
            (b.measured === true) - (a.measured === true)
            || ((b.score ?? -1) - (a.score ?? -1))
            || (b.engagement - a.engagement)
            || (b.views - a.views))
        .slice(0, 10);
    const medal = i => ['🥇', '🥈', '🥉'][i] || `#${i + 1}`;
    const fmtV = n => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); };
    const perf = d.performance || {};
    const eb = d.engagement_breakdown || { likes: 0, comments: 0, saves: 0, shares: 0 };
    const ebTotal = eb.likes + eb.comments + eb.saves + eb.shares;
    const ebPct = v => (ebTotal > 0 ? Math.round((v / ebTotal) * 100) : 0);

    return (
        <div className="report-page">
            <header className="page-head"><h1>Report Analysis</h1></header>
            {/* หัวรายงานเฉพาะตอนพิมพ์ — บนกระดาษไม่มี sidebar/แท็บ จึงต้องบอกบริบทให้ครบในตัวเอง */}
            <div className="print-only rpt-print-head">
                <div className="rpt-print-title">Report Analysis — {c.name}</div>
                <div className="rpt-print-meta">
                    ช่วงแคมเปญ: {fmtRange(c.start_date, c.end_date, ' ถึง ')}
                    {' · '}แพลตฟอร์ม: {plat || 'ทั้งหมด'}
                    {' · '}ออกรายงาน: {new Date().toLocaleString('th-TH')}
                </div>
            </div>

            <div className="rpt-campaign">
                <span>Campaign: <strong>{c.name}</strong></span>
                <div className="rpt-actions">
                    <button className="btn-ghost" onClick={() => window.print()} title="เปิดหน้าต่างพิมพ์ แล้วเลือกปลายทางเป็น Save as PDF">
                        <Icon name="download" size={15} /> บันทึกเป็น PDF
                    </button>
                    <button className="btn-ghost" onClick={() => navigate('/budget')}><Icon name="back" size={15} /> Back to List</button>
                </div>
            </div>

            {/* แถบสรุปบน */}
            <div className="rpt-topbar">
                <div className="rpt-top-item"><div className="rpt-top-k">BUDGET (THB)</div><div className="rpt-top-v">{N(c.budget)}</div></div>
                <div className="rpt-top-item"><div className="rpt-top-k">USED BUDGET</div><div className="rpt-top-v red">{N(c.used)}</div></div>
                <div className="rpt-top-item"><div className="rpt-top-k">PRODUCT</div><div className="rpt-top-v sm">{c.product && c.product !== '—' ? <ProductSummary value={c.product} /> : '—'}</div></div>
                <div className="rpt-top-item"><div className="rpt-top-k">TOTAL KOLS</div><div className="rpt-top-v">{c.total_kols}</div></div>
                <div className="rpt-top-item"><div className="rpt-top-k">PERIOD</div><div className="rpt-top-v sm">{fmtRange(c.start_date, c.end_date)}</div></div>
            </div>

            {/* ฟิลเตอร์แพลตฟอร์ม */}
            <div className="rpt-plat-tabs">
                <button className={'rpt-plat' + (plat === '' ? ' active' : '')} onClick={() => setPlat('')}>≡ All ({d.all_count})</button>
                {d.platforms.map(p => (
                    <button key={p.platform} className={'rpt-plat' + (plat === p.platform ? ' active' : '')} onClick={() => setPlat(p.platform)}>
                        {PLAT_ICON[p.platform] || ''} {p.platform} ({p.count})
                    </button>
                ))}
            </div>

            {/* การ์ด performance */}
            <div className="rpt-perf-grid">
                <div className="rpt-perf">
                    <div className="rpt-perf-k">POST RATE</div>
                    <div className="rpt-perf-v">{d.post_rate.rate}%</div>
                    <div className="rpt-perf-sub">{d.post_rate.posted}/{d.post_rate.total} posted</div>
                </div>
                <div className="rpt-perf dark">
                    <div className="rpt-perf-k">★ GOOD PERFORMANCE</div>
                    <div className="rpt-perf-v">{d.good_performance.good} / {d.good_performance.total}</div>
                    <div className="rpt-perf-sub">CPM ≤ 28 &amp; CPE ≤ 1.5</div>
                </div>
            </div>

            {/* ===== ผลงานคอนเทนต์ (Views / Engagement) ===== */}
            <div className="panel">
                <h3>📊 ผลงานคอนเทนต์ / Content Performance <span className="dash-section-sub">{perf.measured_count || 0}/{perf.contents || 0} คลิปมีข้อมูล</span></h3>
                <div className="rpt-cost-grid" style={{ marginTop: 12 }}>
                    <div className="rpt-cost c-green"><div className="rpt-cost-k">TOTAL VIEWS</div><div className="rpt-cost-v">{fmtV(perf.total_views)}</div><div className="rpt-cost-sub">{N(perf.total_views)} วิว</div></div>
                    <div className="rpt-cost c-blue"><div className="rpt-cost-k">TOTAL ENGAGEMENT</div><div className="rpt-cost-v">{fmtV(perf.total_engagement)}</div><div className="rpt-cost-sub">ไลก์ + คอมเมนต์ + Bookmark + แชร์</div></div>
                    <div className="rpt-cost c-orange"><div className="rpt-cost-k">AVG VIEWS / คลิป</div><div className="rpt-cost-v">{N(perf.avg_views)}</div><div className="rpt-cost-sub">เฉลี่ยต่อคลิปที่มีข้อมูล</div></div>
                    <div className="rpt-cost c-green"><div className="rpt-cost-k">ENGAGEMENT RATE</div><div className="rpt-cost-v">{perf.engagement_rate}%</div><div className="rpt-cost-sub">Engagement / Views</div></div>
                </div>
            </div>

            {/* Content Format */}
            {d.by_format && d.by_format.length > 0 && (
                <div className="panel">
                    <h3>🎬 ผลงานตาม Content Format</h3>
                    <div className="rpt-fmt-grid">
                        {d.by_format.map(f => (
                            <div className="rpt-fmt" key={f.format}>
                                <div className="rpt-fmt-name">{f.format}</div>
                                <div className="rpt-fmt-v">{N(f.avg_views)}</div>
                                <div className="rpt-fmt-sub">avg views/คลิป</div>
                                <div className="rpt-fmt-meta">{f.videos} คลิป · {f.channels} ช่อง · ER {f.er}%</div>
                                <div className="rpt-fmt-meta">{fmtV(f.views)} วิว ({f.share}%)</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Top Videos + Top Channels */}
            <div className="rpt-two-col">
                <div className="panel no-pad">
                    <div className="panel-head"><h3>🏆 Top คลิป by Views</h3></div>
                    {(!d.top_videos || d.top_videos.length === 0) ? <div className="rank-empty" style={{ padding: 16 }}>— ยังไม่มีข้อมูลวิว</div> : (
                        <table className="data-table">
                            <thead><tr><th>#</th><th>KOC</th><th>PRODUCT</th><th>FORMAT</th><th className="num">VIEWS</th><th className="num">LIKES</th></tr></thead>
                            <tbody>{d.top_videos.map((v, i) => (
                                <tr key={i}>
                                    <td>{i + 1}</td>
                                    <td><strong>{v.link ? <a className="work-link" href={v.link} target="_blank" rel="noreferrer">{v.name}</a> : v.name}</strong></td>
                                    <td className="muted"><ProductSummary value={v.product} max={2} /></td>
                                    <td className="muted">{v.format || '—'}</td>
                                    <td className="num">{fmtV(v.views)}</td>
                                    <td className="num muted">{N(v.likes)}</td>
                                </tr>
                            ))}</tbody>
                        </table>
                    )}
                </div>
                <div className="panel no-pad">
                    <div className="panel-head"><h3>⭐ Top ช่อง by Views</h3></div>
                    {(!d.top_channels || d.top_channels.length === 0) ? <div className="rank-empty" style={{ padding: 16 }}>— ยังไม่มีข้อมูลวิว</div> : (
                        <div style={{ padding: 10 }}>
                            {d.top_channels.map((ch, i) => (
                                <div className="rank-item" key={ch.name}>
                                    <span className={'rank-no r' + (i + 1)}>{medal(i)}</span>
                                    <div className="rank-main"><b>{ch.name}</b><span className="rank-sub">{ch.videos} คลิป · {ch.products.join(', ') || '—'}</span></div>
                                    <div className="rank-metric">{fmtV(ch.views)}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Engagement Breakdown + View Distribution */}
            <div className="rpt-two-col">
                <div className="panel">
                    <h3>❤️ Engagement Breakdown</h3>
                    <div className="rpt-eng-grid">
                        {[['ไลก์', eb.likes], ['Bookmark', eb.saves], ['แชร์', eb.shares], ['คอมเมนต์', eb.comments]].map(([lbl, v]) => (
                            <div className="rpt-eng" key={lbl}><div className="rpt-eng-v">{fmtV(v)}</div><div className="rpt-eng-k">{lbl}</div><div className="rpt-eng-sub">{ebPct(v)}%</div></div>
                        ))}
                    </div>
                </div>
                <div className="panel">
                    <h3>📈 การกระจายยอดวิว</h3>
                    <div style={{ marginTop: 8 }}>
                        {d.view_distribution.map(b => (
                            <div className="rpt-dist" key={b.label}>
                                <span className="rpt-dist-lbl">{b.label}</span>
                                <div className="rpt-dist-bar"><span style={{ width: `${b.share}%` }} /></div>
                                <span className="rpt-dist-val">{b.videos} คลิป · {b.share}%</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Cost Summary */}
            <div className="panel">
                <h3>💰 สรุปค่าใช้จ่าย / Cost Summary</h3>
                <div className="rpt-cost-grid">
                    <div className="rpt-cost c-orange"><div className="rpt-cost-k">KOL COST</div><div className="rpt-cost-v">{B(d.cost.kol_cost)}</div><div className="rpt-cost-sub">ค่าจ้าง KOL ทั้งหมด</div></div>
                    <div className="rpt-cost c-green"><div className="rpt-cost-k">AVG CPM / คน</div><div className="rpt-cost-v">{B(d.cost.avg_cpm)}</div><div className="rpt-cost-sub">เฉลี่ย Cost per 1K Reach ต่อคน</div></div>
                    <div className="rpt-cost c-blue"><div className="rpt-cost-k">AVG CPE / คน</div><div className="rpt-cost-v">{B(d.cost.avg_cpe)}</div><div className="rpt-cost-sub">เฉลี่ย Cost per Engagement ต่อคน</div></div>
                </div>
            </div>

            {/* อันดับ Performance ดีที่สุด (ราย KOL) */}
            <div className="panel">
                <div className="panel-head"><h3>🏆 อันดับ Performance ดีที่สุด <span className="dash-section-sub">คะแนนจาก ER 35% · ยอดวิว 25% · CPM 20% · CPE 20% เทียบกันเองในแคมเปญ</span></h3></div>
                <div className="rank-grid">
                    <div className="rank-col">
                        <div className="rank-col-title">👤 Top KOL</div>
                        {kolRank.length === 0 ? <div className="rank-empty">— ยังไม่มีข้อมูล</div> : kolRank.map((k, i) => (
                            <div className={'rank-item' + (i < 3 ? ' top' : '')} key={k.idx}>
                                <span className={'rank-no r' + (i + 1)}>{medal(i)}</span>
                                <div className="rank-main">
                                    <b>{k.name}</b>
                                    <span className="rank-sub">
                                        {k.platform || '—'} ·{' '}
                                        {k.measured
                                            ? <b className="rank-score" title="คะแนนเทียบกับคนอื่นในแคมเปญนี้ เต็ม 100">{k.score} คะแนน</b>
                                            : <span className="rank-nodata" title="ยังไม่ได้กรอกผลงานคอนเทนต์ จึงยังไม่มีคะแนน — ไม่ได้แปลว่าทำได้แย่">ยังไม่กรอกผลงาน</span>}
                                        {k.boosted ? ' · ยิงแอดแล้ว' : ''}
                                    </span>
                                </div>
                                <div className="rank-stats">
                                    <span><i>views</i><b>{fmtV(k.views)}</b></span>
                                    <span><i>likes</i><b>{fmtV(k.likes)}</b></span>
                                    <span><i>comments</i><b>{fmtV(k.comments)}</b></span>
                                    <span><i>bookmark</i><b>{fmtV(k.saves)}</b></span>
                                    <span><i>shares</i><b>{fmtV(k.shares)}</b></span>
                                    <span className="sep"><i>CPM</i><b>{Number(k.cpm) > 0 ? B(k.cpm) : '—'}</b></span>
                                    <span><i>CPE</i><b>{Number(k.cpe) > 0 ? B(k.cpe) : '—'}</b></span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* สรุปตาม Product */}
            <div className="panel no-pad">
                <div className="panel-head"><h3>🎯 สรุปตาม Product</h3></div>
                <table className="data-table">
                    <thead><tr><th>PRODUCT</th><th className="num">KOLS</th><th className="num">VIEWS</th><th className="num">% VIEWS</th><th className="num">AVG/คลิป</th><th className="num">ER</th><th className="num">BUDGET</th><th className="num">POSTED</th></tr></thead>
                    <tbody>
                        {d.by_product.map(p => (
                            <tr key={p.product}>
                                <td>{p.product === '—' ? <span className="muted">—</span> : <ProductSummary value={p.product} />}</td>
                                <td className="num">{p.kols}</td>
                                <td className="num">{fmtV(p.views)}</td>
                                <td className="num muted">{p.share}%</td>
                                <td className="num">{N(p.avg_views)}</td>
                                <td className="num muted">{p.er}%</td>
                                <td className="num">{B(p.budget)}</td>
                                <td className="num">{p.posted}/{p.total}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* รายละเอียด KOL */}
            <div className="panel no-pad">
                <div className="panel-head"><h3>📋 รายละเอียด KOL ทั้งหมด</h3></div>
                <table className="data-table">
                    <thead><tr><th>#</th><th>KOL NAME</th><th>PRODUCT</th><th>KOL CONTACT</th><th className="num">COST</th><th>LINK</th><th className="num">CPM</th><th className="num">CPE</th><th>PERFORMANCE</th></tr></thead>
                    <tbody>
                        {kolRows.length === 0 ? (
                            <tr><td colSpan="9" className="empty">ไม่มี KOL ในแพลตฟอร์มนี้</td></tr>
                        ) : kolRows.map(k => (
                            <tr key={k.idx}>
                                <td>{k.idx}</td>
                                <td><strong>{k.name}</strong></td>
                                <td className="muted"><ProductSummary value={k.product} /></td>
                                <td className="muted">{k.agency || '—'}</td>
                                <td className="num">{B(k.cost)}</td>
                                <td>{k.link ? <a className="work-link" href={k.link} target="_blank" rel="noreferrer"><Icon name="eye" size={12} /> เปิด</a> : '-'}</td>
                                <td className="num">{k.cpm}</td>
                                <td className="num">{k.cpe}</td>
                                <td>
                                    {k.performance === 'Good'
                                        ? <span className="perf-good">✓ Good</span>
                                        : <span className="perf-improve">📈 Improve</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
