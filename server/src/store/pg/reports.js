/**
 * reports (PostgreSQL) — อ่านอย่างเดียว
 *
 * หน้ารายงานเป็นการคำนวณสถิติล้วน ๆ (CPM/CPE/ER/คะแนน Performance/จัดกลุ่มตามสินค้า-ฟอร์แมต-เอเจนซี่)
 * สูตรละเอียดและไม่มีเทสต์คุม ถ้าเขียนใหม่เป็น SQL aggregate จะเพี้ยนแบบเงียบ ๆ
 * จึงดึงแถวจริงจาก PostgreSQL ผ่าน loadSnapshot() แล้วรันอัลกอริทึมเดิมของ jsonStore
 * แบบคำต่อคำ (เปลี่ยนแค่ db. -> snap.) เพื่อให้ผลลัพธ์ตรงกับของเดิมเป๊ะ
 */
const { loadSnapshot } = require('./_snapshot');
const { clone, inScope, scopeProjects, GOOD_CPM, GOOD_CPE } = require('../logic');

const reports = {
    // รายการแคมเปญ + ตัวเลขสรุปสำหรับหน้ารายงาน (KOLS / BUDGET / USED / POST RATE)
    async campaigns({ scopeBrands = null, brand } = {}) {
        const snap = await loadSnapshot(['projects', 'submissions', 'teams']);

        let projs = snap.projects.slice();
        projs = scopeProjects(projs, scopeBrands);
        if (brand) projs = projs.filter(p => p.brand === brand);

        return projs
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .map(p => {
                const subs = snap.submissions.filter(s => s.project_id === p.id && s.status === 'confirmed');
                const kols = subs.length;
                const used = subs.reduce((sum, s) => sum + (Number(s.budget) || 0), 0);
                const posted = subs.filter(s => s.post_url && String(s.post_url).trim()).length;
                const post_rate = kols > 0 ? Math.round((posted / kols) * 100) : 0;
                const team = snap.teams.find(t => t.id === p.team_id);
                return {
                    id: p.id, name: p.name, brand: p.brand || null, status: p.status,
                    start_date: p.start_date || null, end_date: p.end_date || null,
                    team_name: team ? team.name : null,
                    kols, budget: Number(p.budget) || 0, used, post_rate
                };
            });
    },

    // รายงานเชิงลึกของ 1 แคมเปญ (Report Analysis)
    async detail(projectId, scopeBrands = null) {
        const snap = await loadSnapshot(['projects', 'submissions']);

        const p = snap.projects.find(x => x.id === Number(projectId));
        if (!p) return null;
        if (!inScope(p, scopeBrands)) return null;

        const subs = snap.submissions.filter(s => s.project_id === p.id && s.status === 'confirmed');
        const rows = subs.map((s, i) => {
            // กลุ่มโฆษณาที่ KOL คนนี้สังกัด — เอา Content Format ที่บรีฟไว้มาใช้
            const grp = Array.isArray(p.ad_groups) ? p.ad_groups.find(g => g.key === s.group_key) : null;
            // ผลงานคอนเทนต์ — ตัวเลขจริงจากคลิป ไม่ใช่จากการยิงแอด
            const views = Number(s.views) || 0;
            const likes = Number(s.likes) || 0, comments = Number(s.comments) || 0, saves = Number(s.saves) || 0, shares = Number(s.shares) || 0;
            const engagement = likes + comments + saves + shares;
            const er = views > 0 ? Number(((engagement / views) * 100).toFixed(2)) : 0;

            const fee = Number(s.budget) || 0;
            const adSpend = Number(s.ad_spend) || 0;
            const cost = fee + adSpend;                 // ต้นทุนรวม = ค่าตัว + ค่ายิงแอด
            const reach = Number(s.ad_reach) || 0;
            // CPM/CPE คิดจากยอดคอนเทนต์จริง (เดิมใช้ reach และเดา engagement เป็น 2% ของ reach)
            const cpm = views > 0 ? Number((cost / (views / 1000)).toFixed(2)) : 0;
            const cpe = engagement > 0 ? Number((cost / engagement).toFixed(2)) : 0;
            const posted = !!(s.post_url && String(s.post_url).trim());
            const boosted = s.ad_status === 'ยิงแล้ว';
            // เกณฑ์ผ่าน/ไม่ผ่าน อยู่ที่หน้านี้กับหน้า Influencer (หน้า Dashboard ใช้คะแนนไล่ระดับแทน)
            const good = views > 0 && cpm > 0 && cpm <= GOOD_CPM && cpe > 0 && cpe <= GOOD_CPE;
            return {
                idx: i + 1, name: s.account_name, platform: s.platform || null,
                product: s.product || null, agency: s.agency || null,
                cost: fee, ad_spend: adSpend, total_cost: cost, reach,
                link: s.post_url || s.link_account || null,
                cpm, cpe, performance: good ? 'Good' : 'Improve', posted, boosted,
                views, likes, comments, saves, shares, engagement, er,
                // Content Format ยึดจากที่บรีฟไว้ตอนตั้งแคมเปญ
                // s.content_format คือของเก่าที่เคยกรอกมือก่อนเปลี่ยนวิธี เก็บไว้เป็น fallback
                format: (grp && grp.content_format) || s.content_format || null
            };
        });

        // ---------- คะแนน Performance ต่อคน (สูตรเดียวกับ Top Influencer หน้า Dashboard) ----------
        // ให้น้ำหนัก ER มากสุด เพราะวัดว่าคนดูมีส่วนร่วมจริงแค่ไหน ไม่ใช่แค่ยอดวิวเยอะ
        // เทียบกันเองภายในแคมเปญ (ดีสุดในกลุ่ม = เต็ม, แย่สุด = 0) ไม่ได้เทียบกับเกณฑ์ตายตัว
        const RW = { er: 0.35, views: 0.25, cpm: 0.20, cpe: 0.20 };
        // "มีข้อมูล" = กรอกยอดวิว หรือ engagement มาแล้วอย่างน้อยอย่างหนึ่ง
        // คนที่ยังไม่กรอกอะไรเลยจะไม่มีคะแนน และตกไปอยู่ท้ายรายการเสมอ
        rows.forEach(r => { r.measured = r.views > 0 || r.engagement > 0; });
        const rated = rows.filter(r => r.measured);
        if (rated.length) {
            const span = (arr, f) => {
                const v = arr.map(f);
                return { min: Math.min(...v), max: Math.max(...v) };
            };
            const nrm = (val, r, lowerIsBetter) => {
                if (r.max === r.min) return 1;   // ทุกคนเท่ากัน แกนนี้ไม่ช่วยตัดสิน
                const t = (val - r.min) / (r.max - r.min);
                return lowerIsBetter ? 1 - t : t;
            };
            const rEr = span(rated, r => r.er);
            const rVw = span(rated, r => r.views);
            const withCpm = rated.filter(r => r.cpm > 0);
            const withCpe = rated.filter(r => r.cpe > 0);
            const rCpm = withCpm.length ? span(withCpm, r => r.cpm) : { min: 0, max: 0 };
            const rCpe = withCpe.length ? span(withCpe, r => r.cpe) : { min: 0, max: 0 };
            rows.forEach(r => {
                if (!r.measured) { r.score = null; return; }
                // ยังไม่มี CPM/CPE (เพราะยังไม่มีวิว/engagement) = แย่สุดของแกนนั้น ไม่ใช่ดีสุด
                const nCpm = r.cpm > 0 ? nrm(r.cpm, rCpm, true) : 0;
                const nCpe = r.cpe > 0 ? nrm(r.cpe, rCpe, true) : 0;
                r.score = Number(((RW.er * nrm(r.er, rEr) + RW.views * nrm(r.views, rVw)
                    + RW.cpm * nCpm + RW.cpe * nCpe) * 100).toFixed(1));
            });
        } else {
            rows.forEach(r => { r.score = null; });
        }
        const kols = rows.length;
        const kol_cost = rows.reduce((a, r) => a + r.cost, 0);
        const ads_cost = rows.reduce((a, r) => a + r.ad_spend, 0);
        const withReach = rows.filter(r => r.reach > 0);
        const avg_cpm = withReach.length ? Number((withReach.reduce((a, r) => a + r.cpm, 0) / withReach.length).toFixed(2)) : 0;
        const avg_cpe = withReach.length ? Number((withReach.reduce((a, r) => a + r.cpe, 0) / withReach.length).toFixed(2)) : 0;
        const postedCount = rows.filter(r => r.posted).length;

        const platOrder = ['TikTok', 'Instagram', 'Facebook', 'Lemon8'];
        const platforms = platOrder.map(pl => ({ platform: pl, count: rows.filter(r => r.platform === pl).length }));

        const groupBy = (key) => {
            const m = {};
            rows.forEach(r => { const k = r[key] || '—'; (m[k] = m[k] || []).push(r); });
            return m;
        };
        // ===== ผลงานคอนเทนต์ (Views/Engagement) =====
        const total_views = rows.reduce((a, r) => a + r.views, 0);
        const total_engagement = rows.reduce((a, r) => a + r.engagement, 0);
        const measured = rows.filter(r => r.views > 0);
        const avg_views = measured.length ? Math.round(total_views / measured.length) : 0;
        const engagement_rate = total_views > 0 ? Number(((total_engagement / total_views) * 100).toFixed(2)) : 0;
        const pctV = v => (total_views > 0 ? Number(((v / total_views) * 100).toFixed(1)) : 0);
        const erOf = (v, e) => (v > 0 ? Number(((e / v) * 100).toFixed(2)) : 0);

        const pm = groupBy('product');
        const by_product = Object.entries(pm).map(([product, rs]) => {
            const v = rs.reduce((a, r) => a + r.views, 0);
            const e = rs.reduce((a, r) => a + r.engagement, 0);
            const meas = rs.filter(r => r.views > 0).length;
            return {
                product, kols: rs.length, contents: rs.length, budget: rs.reduce((a, r) => a + r.cost, 0),
                posted: rs.filter(r => r.posted).length, total: rs.length, ads: rs.filter(r => r.boosted).length,
                views: v, share: pctV(v), avg_views: meas ? Math.round(v / meas) : 0,
                likes: rs.reduce((a, r) => a + r.likes, 0), engagement: e, er: erOf(v, e)
            };
        }).sort((a, b) => b.views - a.views || b.budget - a.budget);

        // แยกตาม Content Format
        const fm = groupBy('format');
        const by_format = Object.entries(fm).filter(([f]) => f && f !== '—').map(([format, rs]) => {
            const v = rs.reduce((a, r) => a + r.views, 0);
            const e = rs.reduce((a, r) => a + r.engagement, 0);
            const meas = rs.filter(r => r.views > 0).length;
            return {
                format, videos: rs.length, channels: new Set(rs.map(r => r.name)).size,
                views: v, share: pctV(v), avg_views: meas ? Math.round(v / meas) : 0, er: erOf(v, e)
            };
        }).sort((a, b) => b.avg_views - a.avg_views);

        // Top คลิป + Top channel — เอาอันดับ 1 อย่างละอัน
        const top_videos = [...rows].filter(r => r.views > 0).sort((a, b) => b.views - a.views).slice(0, 1)
            .map(r => ({ name: r.name, product: r.product, format: r.format, views: r.views, likes: r.likes, saves: r.saves, shares: r.shares, link: r.link }));
        const cm = groupBy('name');
        const top_channels = Object.entries(cm).map(([name, rs]) => {
            const v = rs.reduce((a, r) => a + r.views, 0);
            const e = rs.reduce((a, r) => a + r.engagement, 0);
            return { name, videos: rs.length, views: v, er: erOf(v, e), products: [...new Set(rs.map(r => r.product).filter(Boolean))] };
        }).filter(c => c.views > 0).sort((a, b) => b.views - a.views).slice(0, 1);

        // Engagement breakdown + View distribution
        const engagement_breakdown = {
            likes: rows.reduce((a, r) => a + r.likes, 0), comments: rows.reduce((a, r) => a + r.comments, 0),
            saves: rows.reduce((a, r) => a + r.saves, 0), shares: rows.reduce((a, r) => a + r.shares, 0)
        };
        const buckets = [
            { label: '1M+', min: 1000000, max: Infinity }, { label: '500K–999K', min: 500000, max: 999999 },
            { label: '100K–499K', min: 100000, max: 499999 }, { label: 'ต่ำกว่า 100K', min: 1, max: 99999 }
        ];
        const view_distribution = buckets.map(b => {
            const rs = rows.filter(r => r.views >= b.min && r.views <= b.max);
            const v = rs.reduce((a, r) => a + r.views, 0);
            return { label: b.label, videos: rs.length, views: v, share: pctV(v) };
        });

        const am = groupBy('agency');
        const by_agency = Object.entries(am).map(([agency, rs]) => ({
            agency, kols: rs.length, budget: rs.reduce((a, r) => a + r.cost, 0),
            posted: rs.filter(r => r.posted).length, total: rs.length
        }));

        const products = Array.isArray(p.products) ? p.products.map(x => (typeof x === 'string' ? x : x.name)) : [];

        return clone({
            campaign: {
                id: p.id, name: p.name, brand: p.brand || null, budget: Number(p.budget) || 0, used: kol_cost,
                product: products.join(', ') || '—', total_kols: kols,
                start_date: p.start_date || null, end_date: p.end_date || null, status: p.status
            },
            platforms, all_count: kols,
            post_rate: { rate: kols > 0 ? Math.round((postedCount / kols) * 100) : 0, posted: postedCount, total: kols },
            ads_boosted: rows.filter(r => r.boosted).length,
            good_performance: { good: rows.filter(r => r.performance === 'Good').length, total: kols },
            cost: { kol_cost, ads_cost, avg_cpm, avg_cpe, total: kol_cost + ads_cost },
            // ผลงานคอนเทนต์
            performance: {
                total_views, total_engagement, avg_views, engagement_rate,
                measured_count: measured.length, contents: kols
            },
            by_format, top_videos, top_channels, engagement_breakdown, view_distribution,
            by_product, by_agency, kols: rows
        });
    }
};

module.exports = { reports };
