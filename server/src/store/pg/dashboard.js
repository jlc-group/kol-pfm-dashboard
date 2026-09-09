/**
 * dashboard + budget (PostgreSQL) — อ่านอย่างเดียว
 *
 * ทั้งสองโมดูลนี้เป็น "การคำนวณสถิติ" ล้วน ๆ (CPM/CPE/คะแนน KOL/สรุปตามแบรนด์)
 * สูตรละเอียดมากและไม่มีเทสต์คุม ถ้าเขียนใหม่เป็น SQL aggregate จะเพี้ยนแบบเงียบ ๆ
 * จึงดึงแถวจริงจาก PostgreSQL ผ่าน loadSnapshot() แล้วรันอัลกอริทึมเดิมของ jsonStore
 * แบบคำต่อคำ (เปลี่ยนแค่ db. -> snap.) เพื่อให้ผลลัพธ์ตรงกับของเดิมเป๊ะ
 */
const { loadSnapshot } = require('./_snapshot');
const { scopeProjects } = require('../logic');

// ============================ dashboard (สรุปตามตัวกรอง) ============================
const dashboard = {
    // filters: { scopeBrands, brand, from, to, projectId }
    async overview(filters = {}) {
        const snap = await loadSnapshot(['projects', 'submissions']);
        const { scopeBrands = null, brand, from, to, projectId } = filters;

        // 1) คัดกรอง projects ตามสิทธิ์ + ตัวกรอง (แบรนด์/แคมเปญ) — ไม่กรองด้วยวันที่ตรงนี้ (ไปกรองที่ตัว KOL แทน)
        let projects = snap.projects.slice();
        projects = scopeProjects(projects, scopeBrands);
        if (brand) projects = projects.filter(p => p.brand === brand);
        if (projectId) projects = projects.filter(p => p.id === Number(projectId));

        const projectIds = new Set(projects.map(p => p.id));
        const projById = {}; projects.forEach(p => { projById[p.id] = p; });

        // 2) KOL ที่คัดเลือกแล้ว (จาก submissions = ข้อมูลจริงที่เอเจนซี่ส่ง/ทีมคัดเลือก)
        //    ช่วงเวลา: กรองตามวันลงงาน (post_date) ถ้ามี — ยังไม่ลงงาน = นับรวม (คอมมิตแล้ว)
        const inRange = s => {
            const d = s.post_date;
            if (!d) return true;
            if (from && d < from) return false;
            if (to && d > to) return false;
            return true;
        };
        const subs = snap.submissions.filter(s => s.status === 'confirmed' && projectIds.has(s.project_id) && inRange(s));

        // 3) ตัวเลขรวม
        const totalBudget = projects.reduce((s, p) => s + (Number(p.budget) || 0), 0);   // งบที่วางไว้รวม
        const totalFee = subs.reduce((a, s) => a + (Number(s.budget) || 0), 0);           // ค่าใช้จ่ายจริงของ KOL
        // 1 แถว = 1 คลิป — คนเดียวกันอาจมีหลายคลิป จึงนับ "คน" จาก person_key
        const totalKols = new Set(subs.map(s => s.person_key || ('sub:' + s.id))).size;
        const totalClips = subs.length;
        // งบเก็บต่อคลิป ค่าเฉลี่ยหลักจึงเป็น "ต่อคลิป" ส่วน "ต่อคน" ไว้ดูค่าตัวรวมของคนหนึ่ง
        const avgCostPerClip = totalClips > 0 ? Math.round(totalFee / totalClips) : 0;
        const avgCostPerKol = totalKols > 0 ? Math.round(totalFee / totalKols) : 0;
        const totalViews = subs.reduce((a, s) => a + (Number(s.ad_reach) || 0), 0);       // ยอดวิว = Reach จากแอด

        // 4) แยกตามแพลตฟอร์ม
        const byPlatform = {};
        subs.forEach(s => {
            const p = s.platform || 'อื่นๆ';
            if (!byPlatform[p]) byPlatform[p] = { platform: p, count: 0, people: new Set(), views: 0, feeSum: 0 };
            const b = byPlatform[p];
            b.count += 1; b.people.add(s.person_key || ('sub:' + s.id));
            b.views += Number(s.ad_reach) || 0; b.feeSum += Number(s.budget) || 0;
        });
        const platforms = Object.values(byPlatform).map(b => ({
            platform: b.platform, kols_count: b.people.size, clips_count: b.count, views: b.views,
            engagement: null, avg_cost: b.count ? Math.round(b.feeSum / b.count) : 0
        }));
        const platformSet = new Set(subs.map(s => s.platform).filter(Boolean));

        // 5) ตัวชี้วัดความคุ้มค่า
        const cpm = totalViews > 0 ? Math.round(totalFee / (totalViews / 1000)) : 0;
        const cpe = 0; // ยังไม่มีข้อมูล engagement ราย KOL จาก submissions

        // 6) Top KOLs — ส่ง 20 อันดับ (หน้าเว็บโชว์ 5 อันดับแรก ที่เหลือกดดูเพิ่มได้)
        //
        // ยอดทั้งหมดมาจาก "คอนเทนต์จริงของคลิป" (กรอกที่แท็บ On Process)
        // ไม่ใช่จากการยิงแอด — จึงวัดได้ทั้งคนที่ยิงแอดแล้วและยังไม่ยิง
        //   CPM = ค่าตัว / (ยอดวิว / 1000)      ยิ่งต่ำยิ่งคุ้ม
        //   CPE = ค่าตัว / engagement รวม        ยิ่งต่ำยิ่งคุ้ม
        // (ไม่เดา engagement เป็น % ของ reach แบบที่หน้า Report ทำอยู่ เพราะมีตัวเลขจริงแล้ว)
        //
        // เกณฑ์จัดอันดับ = คะแนนรวม 0-100 (ไล่ระดับ ไม่ใช่ผ่าน/ไม่ผ่าน)
        //   Engagement Rate 35% · Views 25% · CPM 20% · CPE 20%
        //   CPM/CPE ยิ่งต่ำยิ่งได้คะแนนมาก · เทียบกันเองในกลุ่มที่แสดงอยู่
        //   คนที่ยังไม่กรอกผลงาน (views = 0) ไม่มีคะแนน และตกไปท้ายสุด
        // หมายเหตุ: เกณฑ์ผ่าน/ไม่ผ่าน (Good/Improve) ย้ายไปอยู่หน้า Report กับ Influencer
        const SCORE_W = { er: 0.35, views: 0.25, cpm: 0.20, cpe: 0.20 };
        const kolRows = [...subs].map(s => {
            const views = Number(s.views) || 0;        // ยอดวิวคอนเทนต์
            const likes = Number(s.likes) || 0;
            const comments = Number(s.comments) || 0;
            const saves = Number(s.saves) || 0;
            const shares = Number(s.shares) || 0;
            const reposts = Number(s.reposts) || 0;
            const engagementTotal = likes + comments + saves + shares + reposts;
            const fee = Number(s.budget) || 0;
            const adSpend = Number(s.ad_spend) || 0;
            const cost = fee + adSpend;                // ต้นทุนรวม = ค่าตัว + ค่ายิงแอด
            const cpm = views > 0 ? Number((cost / (views / 1000)).toFixed(2)) : 0;
            const cpe = engagementTotal > 0 ? Number((cost / engagementTotal).toFixed(2)) : 0;
            return {
                kol_id: s.id, name: s.account_name, platform: s.platform || null,
                brand: (projById[s.project_id] || {}).brand || null,   // แบรนด์มาจากแคมเปญที่ KOL คนนี้สังกัด
                product: s.product || null,
                post_url: s.post_url || null,
                fee, ad_spend: adSpend, cost,
                views,                                  // ยอดวิวคอนเทนต์ ไม่ใช่ reach จากแอด
                ad_reach: Number(s.ad_reach) || 0,      // เก็บไว้เทียบ ไม่ได้ใช้จัดอันดับ
                likes, comments, saves, shares, reposts,
                engagement_total: engagementTotal,
                engagement: views > 0 ? Number(((engagementTotal / views) * 100).toFixed(2)) : null,
                cpm, cpe,
                measured: views > 0                     // กรอกผลงานแล้วหรือยัง
            };
        });

        // ให้คะแนนโดยเทียบกันเองเฉพาะคนที่มีข้อมูลแล้ว
        const scored = kolRows.filter(k => k.measured);
        const spread = (arr, pick) => {
            const v = arr.map(pick);
            return { min: Math.min(...v), max: Math.max(...v) };
        };
        const norm = (val, r, lowerIsBetter) => {
            if (r.max === r.min) return 1;              // ทุกคนเท่ากัน ตัวนี้ไม่ช่วยตัดสิน
            const t = (val - r.min) / (r.max - r.min);
            return lowerIsBetter ? 1 - t : t;
        };
        if (scored.length) {
            const rEr = spread(scored, k => k.engagement || 0);
            const rVw = spread(scored, k => k.views);
            const rCpm = spread(scored, k => k.cpm);
            const withEng = scored.filter(k => k.engagement_total > 0);
            const rCpe = withEng.length ? spread(withEng, k => k.cpe) : { min: 0, max: 0 };
            // บอกว่าค่านี้ดีสุด/แย่สุดในกลุ่มไหม (ไว้อธิบายที่มาของคะแนน)
            const edge = (val, r, lowerIsBetter) => {
                if (r.max === r.min) return 'เท่ากันทั้งกลุ่ม';
                if (val === (lowerIsBetter ? r.min : r.max)) return 'ดีที่สุดในกลุ่ม';
                if (val === (lowerIsBetter ? r.max : r.min)) return 'แย่ที่สุดในกลุ่ม';
                return null;
            };
            kolRows.forEach(k => {
                if (!k.measured) { k.score = null; k.score_parts = null; return; }
                // ไม่มี engagement เลย = แย่สุดของแกน CPE (ไม่ใช่ดีสุด แม้ตัวเลข cpe จะเป็น 0)
                const nEr = norm(k.engagement || 0, rEr);
                const nVw = norm(k.views, rVw);
                const nCpm = norm(k.cpm, rCpm, true);
                const nCpe = k.engagement_total > 0 ? norm(k.cpe, rCpe, true) : 0;
                const pct = w => Math.round(w * 100);
                k.score_parts = [
                    { key: 'er', label: 'Engagement Rate', value: k.engagement || 0, unit: '%', weight: pct(SCORE_W.er), earned: Number((SCORE_W.er * nEr * 100).toFixed(1)), better: 'สูง', note: edge(k.engagement || 0, rEr, false) },
                    { key: 'views', label: 'ยอดวิว', value: k.views, unit: '', weight: pct(SCORE_W.views), earned: Number((SCORE_W.views * nVw * 100).toFixed(1)), better: 'สูง', note: edge(k.views, rVw, false) },
                    { key: 'cpm', label: 'CPM', value: k.cpm, unit: '฿', weight: pct(SCORE_W.cpm), earned: Number((SCORE_W.cpm * nCpm * 100).toFixed(1)), better: 'ต่ำ', note: edge(k.cpm, rCpm, true) },
                    { key: 'cpe', label: 'CPE', value: k.cpe, unit: '฿', weight: pct(SCORE_W.cpe), earned: Number((SCORE_W.cpe * nCpe * 100).toFixed(1)), better: 'ต่ำ', note: k.engagement_total > 0 ? edge(k.cpe, rCpe, true) : 'ยังไม่มี engagement' }
                ];
                k.score = Number(k.score_parts.reduce((a, p) => a + p.earned, 0).toFixed(1));
            });
        } else {
            kolRows.forEach(k => { k.score = null; k.score_parts = null; });
        }

        const topKols = kolRows
            .sort((a, b) =>
                (b.measured - a.measured) ||            // คนที่กรอกผลงานแล้วขึ้นก่อน
                ((b.score || 0) - (a.score || 0)) ||    // คะแนนรวมสูงกว่า
                (b.views - a.views)                     // ตัดเสมอด้วยยอดวิว
            )
            .slice(0, 20);
        // อันดับในกลุ่มที่เอามาเทียบคะแนนกัน (ใช้บอกในหน้าอธิบายคะแนน)
        let rank = 0;
        topKols.forEach(k => { k.score_rank = k.measured ? ++rank : null; });
        topKols.forEach(k => { k.score_pool = scored.length; });

        // 7) สรุปตามแบรนด์ (งบที่วางไว้ + จำนวน KOL ที่คัดเลือก)
        const brandMap = {};
        projects.forEach(p => {
            const b = p.brand || 'อื่นๆ';
            if (!brandMap[b]) brandMap[b] = { brand: b, budget: 0, projectIds: new Set() };
            brandMap[b].budget += Number(p.budget) || 0;
            brandMap[b].projectIds.add(p.id);
        });
        const brandSummary = Object.values(brandMap).map(b => ({
            brand: b.brand, budget: b.budget,
            kols_count: new Set(subs.filter(s => b.projectIds.has(s.project_id)).map(s => s.person_key || ('sub:' + s.id))).size
        })).sort((a, b) => b.budget - a.budget);

        // 8) รายการ campaign (project) สำหรับ dropdown — ตามสิทธิ์ (ไม่ผูกกับตัวกรองอื่น)
        let campaignScope = snap.projects.slice();
        campaignScope = scopeProjects(campaignScope, scopeBrands);
        const campaigns = campaignScope
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .map(p => ({ id: p.id, name: p.name, brand: p.brand }));

        return {
            total_kols: totalKols,
            total_clips: totalClips,
            total_campaigns: projects.length,   // จำนวนแคมเปญที่เอางบมารวมกัน
            total_budget: totalBudget,
            total_spent: totalFee,
            total_views: totalViews,
            avg_cost_per_kol: avgCostPerKol,
            avg_cost_per_clip: avgCostPerClip,
            cpm, cpe,
            platform_count: platformSet.size,
            platform_list: [...platformSet],
            platforms,
            top_kols: topKols,
            brand_summary: brandSummary,
            campaigns
        };
    }
};

// ============================ budget ============================
const cpmOf = (spent, views) => (views > 0 ? Math.round(spent / (views / 1000)) : 0);
const cpeOf = (spent, eng) => (eng > 0 ? Math.round(spent / eng) : 0);

// รวม fee/views/engagement ต่อ project (ใช้ร่วมกัน)
function spendMaps(snap) {
    const fee = {}, views = {}, eng = {};
    snap.project_kols.forEach(pk => {
        const k = snap.kols.find(x => x.id === pk.kol_id);
        fee[pk.project_id] = (fee[pk.project_id] || 0) + (Number(pk.fee) || 0);
        const v = Number(pk.views) || 0;
        views[pk.project_id] = (views[pk.project_id] || 0) + v;
        eng[pk.project_id] = (eng[pk.project_id] || 0) + v * ((Number(k?.engagement_rate) || 0) / 100);
    });
    return { fee, views, eng };
}

const budget = {
    async overview({ scopeBrands = null, brand, from, to } = {}) {
        const snap = await loadSnapshot(['projects', 'project_kols', 'kols', 'teams']);
        let projs = snap.projects.slice();
        projs = scopeProjects(projs, scopeBrands);
        if (brand) projs = projs.filter(p => p.brand === brand);
        if (from) projs = projs.filter(p => !p.start_date || p.start_date >= from);
        if (to) projs = projs.filter(p => !p.start_date || p.start_date <= to);

        const { fee, views, eng } = spendMaps(snap);

        const rows = projs.map(p => {
            const team = snap.teams.find(t => t.id === p.team_id);
            const spent = fee[p.id] || 0, v = views[p.id] || 0, e = eng[p.id] || 0;
            return {
                project_id: p.id, name: p.name, brand: p.brand || 'อื่นๆ',
                team_name: team ? team.name : null, status: p.status, start_date: p.start_date,
                spent, views: v, cpm: cpmOf(spent, v), cpe: cpeOf(spent, e)
            };
        });

        const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
        const totalViews = rows.reduce((s, r) => s + r.views, 0);
        const totalEng = projs.reduce((s, p) => s + (eng[p.id] || 0), 0);

        // สรุปตามแบรนด์
        const bm = {};
        projs.forEach(p => {
            const b = p.brand || 'อื่นๆ';
            if (!bm[b]) bm[b] = { brand: b, spent: 0, views: 0, eng: 0, projects: 0 };
            bm[b].spent += fee[p.id] || 0;
            bm[b].views += views[p.id] || 0;
            bm[b].eng += eng[p.id] || 0;
            bm[b].projects += 1;
        });
        const byBrand = Object.values(bm).map(b => ({
            brand: b.brand, projects: b.projects, spent: b.spent, views: b.views,
            cpm: cpmOf(b.spent, b.views), cpe: cpeOf(b.spent, b.eng)
        })).sort((a, b) => b.spent - a.spent);

        return {
            total_spent: totalSpent,
            total_views: totalViews,
            cpm: cpmOf(totalSpent, totalViews),
            cpe: cpeOf(totalSpent, totalEng),
            by_brand: byBrand,
            by_project: rows.sort((a, b) => b.spent - a.spent)
        };
    },

    // เทรนด์รายเดือน (ใช้ไป + CPM/CPE ต่อเดือน)
    async trend({ scopeBrands = null, brand, year } = {}) {
        const snap = await loadSnapshot(['projects', 'project_kols', 'kols']);
        let projs = snap.projects.slice();
        projs = scopeProjects(projs, scopeBrands);
        if (brand) projs = projs.filter(p => p.brand === brand);

        const { fee, views, eng } = spendMaps(snap);
        const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, spent: 0, views: 0, eng: 0 }));
        projs.forEach(p => {
            if (!p.start_date) return;
            const [y, m] = p.start_date.split('-').map(Number);
            if (String(y) !== String(year)) return;
            months[m - 1].spent += fee[p.id] || 0;
            months[m - 1].views += views[p.id] || 0;
            months[m - 1].eng += eng[p.id] || 0;
        });
        return months.map(m => ({
            month: m.month, spent: m.spent, views: m.views,
            cpm: cpmOf(m.spent, m.views), cpe: cpeOf(m.spent, m.eng)
        }));
    }
};

module.exports = { dashboard, budget };
