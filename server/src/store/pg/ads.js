/**
 * ads + adsSync (PostgreSQL)
 * ย้ายมาจาก jsonStore.js บรรทัด 1477-1643 — ตรรกะเดิมทุกบรรทัด เปลี่ยนแค่ที่มาของข้อมูล
 *
 * • adsSync.apply — เขียนจริงลงตาราง submissions ใน transaction เดียว (สำเร็จทั้งชุดหรือไม่สำเร็จเลย)
 *   แต่ยังต้องคำนวณบนสำเนาในหน่วยความจำก่อน เพราะกฎ "ค่าแอดเดินหน้าอย่างเดียว" ต้องเห็นผลของ
 *   แถวก่อนหน้าในชุดเดียวกัน (ส่งซ้ำ 2 แถวชี้ submission เดียว แถวหลังต้องเทียบกับค่าที่แถวแรกเพิ่งตั้ง)
 * • ads.subContext — อ่านตรงด้วย SQL
 * • ads.list      — งานสรุปสถิติ ใช้ snapshot แล้วรันอัลกอริทึมเดิมเป๊ะ (สูตร CPM/CPE ห้ามเพี้ยน)
 */
const { query, withTransaction, updateRow, asJson } = require('./_base');
const { loadSnapshot } = require('./_snapshot');
const logic = require('../logic');
const { shouldApplyOrganicMetrics, shouldApplyCumulativeMetric } = require('../metricSync');
const {
    now, clone, scopeProjects,
    resolveGroupTarget, resolveGroupProducts, resolveGroupCtype, resolveGroupMedia, resolveGroupCampaign,
    engagementOf, clipCostMetrics, perfVerdict,
    maybeStamp, stampWaitReason, pfmManagedSpend
} = logic;

// ===== สแตมป์ Performance ตอนค่าแอดถึงเกณฑ์ =====
// ค่าแอดสะสมถึง AD_STAMP_AT (ประกาศใน logic.js) เมื่อไหร่ ให้เก็บภาพนิ่งของผลงาน ณ ตอนนั้นไว้ถาวร
// เดิมไฟล์นี้มีตัวห่อ maybeStamp + สำเนาตรรกะไว้กันบั๊ก "logic.js ไม่ได้ประกาศ AD_STAMP_AT"
// ตอนนี้ logic.js ประกาศแล้ว สำเนานั้นจึงไม่เคยถูกเรียกอีก (โค้ดตาย) และไม่มีเงื่อนไข "รอค่าตัว"
// จึงตัดทิ้ง ให้ adsSync ใช้กฎชุดเดียวกับ submissions.updateOne เป๊ะ

// ============================ ads (ติดตามการยิงแอด + สรุปค่าแอด) ============================
// รับข้อมูลจากระบบยิงแอดของบริษัท — จับคู่ด้วย Gencode หรือ ID Post
// ค่าแอดไม่ถูกแสดงที่ไหนในหน้าเว็บ ใช้เป็นตัวจุดชนวนสแตมป์อย่างเดียว
const METRIC_KEYS = ['views', 'likes', 'comments', 'saves', 'shares', 'reposts'];

const adsSync = {
    async itemIds() {
        const result = await query(
            `SELECT DISTINCT btrim(id_post) AS id_post
             FROM submissions
             WHERE platform ILIKE 'tiktok%'
               AND nullif(btrim(id_post), '') IS NOT NULL
             ORDER BY id_post`
        );
        return result.rows.map(row => String(row.id_post));
    },

    async apply(rows) {
        const out = { updated: 0, stale: 0, regressed_metrics: 0,
            stamped: 0, not_found: [], skipped: 0 };
        if (!rows || !rows.length) return out;

        const snap = await loadSnapshot(['submissions']);
        // เก็บ "คอลัมน์ที่ถูกแตะ" ต่อ submission เพื่อไม่เขียนทับฟิลด์ที่ไม่เกี่ยวข้อง
        const touched = new Map();   // subId -> { sub, cols:Set }
        const mark = (s, col) => {
            let e = touched.get(s.id);
            if (!e) { e = { sub: s, cols: new Set() }; touched.set(s.id, e); }
            e.cols.add(col);
        };

        for (const r of rows) {
            const key = String(r.gencode || r.id_post || r.submission_id || '').trim();
            if (!key) { out.skipped++; continue; }
            const s = snap.submissions.find(x =>
                (r.submission_id && x.id === Number(r.submission_id))
                || (r.gencode && String(x.gencode || '').trim() === String(r.gencode).trim())
                || (r.id_post && String(x.id_post || '').trim() === String(r.id_post).trim()));
            if (!s) { out.not_found.push(key); continue; }
            // ค่าแอดเดินหน้าอย่างเดียว กันข้อมูลย้อนหลังมาลบยอดสะสม
            if (r.ad_spend !== undefined) {
                const next = Number(r.ad_spend) || 0;
                if (next > (Number(s.ad_spend) || 0)) { s.ad_spend = next; mark(s, 'ad_spend'); }
            }
            if (r.ad_reach !== undefined) { s.ad_reach = Number(r.ad_reach) || 0; mark(s, 'ad_reach'); }
            const hasOrganicMetrics = METRIC_KEYS.some(k => r[k] !== undefined);
            // แหล่งข้อมูลเดิมที่ยังไม่ส่ง source timestamp ต้องทำงานเหมือนเดิม
            // ส่วน PFM adapter ต้องผ่าน freshness guard ก่อนเขียน organic metrics
            const acceptOrganic = !hasOrganicMetrics || !r.pfm_source
                || shouldApplyOrganicMetrics(r.source_updated_at, s.perf_synced_at);
            if (acceptOrganic) {
                for (const k of METRIC_KEYS) {
                    if (r[k] === undefined) continue;
                    const next = Number(r[k]) || 0;
                    if (!shouldApplyCumulativeMetric(next, s[k], Boolean(r.pfm_source))) {
                        out.regressed_metrics++;
                        continue;
                    }
                    s[k] = next;
                    mark(s, k);
                }
                if (hasOrganicMetrics && r.source_updated_at) {
                    s.perf_synced_at = new Date(r.source_updated_at).toISOString();
                    mark(s, 'perf_synced_at');
                }
            } else {
                out.stale++;
            }
            s.ad_synced_at = now();
            s.updated_at = now();
            mark(s, 'ad_synced_at');
            mark(s, 'updated_at');
            out.updated++;
            if (maybeStamp(s)) { out.stamped++; mark(s, 'perf_stamp'); }
        }

        // persist() ของเดิม = เขียนไฟล์ทั้งก้อน · ที่นี่ = UPDATE จริงใน transaction เดียว
        if (touched.size) {
            await withTransaction(async (client) => {
                for (const { sub, cols } of touched.values()) {
                    const patch = {};
                    for (const c of cols) {
                        patch[c] = (c === 'perf_stamp') ? asJson(sub.perf_stamp) : sub[c];
                    }
                    await updateRow('submissions', sub.id, patch, client);
                }
            });
        }
        return out;
    }
};

const adCpm = (spend, reach) => (reach > 0 ? Math.round(spend / (reach / 1000)) : 0);

const ads = {
    // หา project ของ submission (สำหรับตรวจสิทธิ์ทีม + logging)
    async subContext(subId) {
        const id = Number(subId);
        if (!Number.isFinite(id)) return null;   // ของเดิม .find() ไม่เจอ → null
        const s = (await query('SELECT * FROM submissions WHERE id = $1', [id])).rows[0];
        if (!s) return null;
        const p = (await query('SELECT * FROM projects WHERE id = $1', [s.project_id])).rows[0] || null;
        return { submission: clone(s), project_id: s.project_id, team_id: p ? p.team_id : null, brand: p ? p.brand : null, project_name: p ? p.name : null, account_name: s.account_name };
    },

    // รายการโพสต์ที่ "มีลิงก์โพสต์แล้ว" + ข้อมูลแอด พร้อมสรุปภาพรวม
    // filters: { scopeBrands, brand, status, from, to }
    async list({ scopeBrands = null, brand, status, from, to } = {}) {
        const snap = await loadSnapshot(['projects', 'submissions', 'teams']);

        const projById = {};
        snap.projects.forEach(p => { projById[p.id] = p; });

        let rows = snap.submissions
            // เฉพาะโพสต์ที่มีลิงก์แล้ว และเฉพาะแคมเปญ KOL — งานจ้างอื่น ๆ ไม่เข้าหน้ายิงแอด
            .filter(s => s.post_url && String(s.post_url).trim()
                && ((projById[s.project_id] || {}).campaign_type || 'kol') !== 'other')
            .map(s => {
                const p = projById[s.project_id];
                const team = p ? snap.teams.find(t => t.id === p.team_id) : null;
                const spend = Number(s.ad_spend) || 0;
                const reach = Number(s.ad_reach) || 0;
                // ค่าแอดถึงเกณฑ์แล้วแต่ยังสแตมป์ไม่ได้เพราะรออะไร: 'views' ยอดวิว / 'fee' ค่าตัว (ไม่ได้รอ = null)
                const waitReason = stampWaitReason(s);
                // กลุ่มโฆษณาที่ KOL คนนี้สังกัด (ผูก Target/Content Type จาก Project อัตโนมัติ)
                const grp = (p && Array.isArray(p.ad_groups)) ? p.ad_groups.find(g => g.key === s.group_key) : null;
                // Content Type ผูกกับคน (1 Platform ในกลุ่มเดียวมีได้หลายอย่าง) แถวเก่าค่อยถอยไปใช้ของกลุ่ม
                const ct = s.content_type || resolveGroupCtype(grp, s.platform);
                const media = resolveGroupMedia(grp, s.platform, ct);
                return {
                    sub_id: s.id,
                    account_name: s.account_name,
                    platform: s.platform || null,
                    product: s.product || (resolveGroupProducts(grp, s.platform).join(', ') || null),
                    // Target ตามสินค้าของคลิปนี้ (แคมเปญที่ตั้ง Target ต่อสินค้า) — ไม่รู้สินค้าใช้ Target รวมของ Platform
                    target: resolveGroupTarget(grp, s.platform, s.product),
                    campaign: resolveGroupCampaign(grp, s.platform, ct),   // คอลัมน์ CAMPAIGN (ตั้งต่อชุด Content Type)
                    content_type: ct,
                    media_type: media.media_type,
                    group_format: media.content_format,
                    gencode: s.gencode || null,
                    id_post: s.id_post || null,
                    post_url: s.post_url,
                    post_date: s.post_date || null,
                    // ใครแก้ล่าสุดเมื่อไหร่ (ว่าง = ข้อมูลเก่าก่อนมีฟีเจอร์นี้)
                    post_url_at: s.post_url_at || null, post_url_by: s.post_url_by || null,
                    gencode_at: s.gencode_at || null, gencode_by: s.gencode_by || null,
                    id_post_at: s.id_post_at || null, id_post_by: s.id_post_by || null,
                    post_date_at: s.post_date_at || null, post_date_by: s.post_date_by || null,
                    project_id: s.project_id,
                    project_name: p ? p.name : null,
                    brand: p ? (p.brand || 'อื่นๆ') : 'อื่นๆ',
                    team_id: p ? p.team_id : null,
                    team_name: team ? team.name : null,
                    ad_status: s.ad_status || 'ยังไม่ยิง',
                    ad_spend: spend,
                    ad_reach: reach,
                    // ค่าแอดมาจาก PFM อัตโนมัติ (หน้าโฆษณาไม่ให้กรอกทับ)
                    spend_from_pfm: pfmManagedSpend(s),
                    ad_start: s.ad_start || null,
                    ad_end: s.ad_end || null,
                    ad_note: s.ad_note || null,
                    cpm: adCpm(spend, reach),
                    // Performance ของคอนเทนต์ — ใช้ตัดสินว่าควรยิงต่อหรือหยุด
                    ...(() => {
                        const views = Number(s.views) || 0;
                        const eng = engagementOf(s);
                        // ยังไม่ใส่ค่าตัว = content_cpm/cpe เป็น null และยังไม่ตัดสิน (กฎเดียวกับหน้า Report — ดู clipCostMetrics)
                        const { fee_missing, cpm: cCpm, cpe: cCpe } = clipCostMetrics({ fee: s.budget, adSpend: spend, views, engagement: eng });
                        return {
                            views, engagement: eng, fee_missing,
                            content_cpm: cCpm, content_cpe: cCpe,
                            performance: views > 0 ? perfVerdict({ fee_missing, views, cpm: cCpm, cpe: cCpe }) : null,
                            perf_stamp: s.perf_stamp ? clone(s.perf_stamp) : null,
                            stamp_waiting: waitReason !== null,
                            stamp_wait_reason: waitReason
                        };
                    })(),
                    // Performance ของคอนเทนต์ — ใช้ตัดสินว่าควรยิงต่อหรือหยุด
                    // (ของเดิมเขียนบล็อกนี้ซ้ำสองรอบ ค่าที่ได้เหมือนกันทุกคีย์ — คงไว้เพื่อความเหมือนเป๊ะ)
                    ...(() => {
                        const views = Number(s.views) || 0;
                        const eng = engagementOf(s);
                        // ยังไม่ใส่ค่าตัว = content_cpm/cpe เป็น null และยังไม่ตัดสิน (กฎเดียวกับหน้า Report — ดู clipCostMetrics)
                        const { fee_missing, cpm: cCpm, cpe: cCpe } = clipCostMetrics({ fee: s.budget, adSpend: spend, views, engagement: eng });
                        return {
                            views, engagement: eng, fee_missing,
                            content_cpm: cCpm, content_cpe: cCpe,
                            performance: views > 0 ? perfVerdict({ fee_missing, views, cpm: cCpm, cpe: cCpe }) : null,
                            perf_stamp: s.perf_stamp ? clone(s.perf_stamp) : null,
                            stamp_waiting: waitReason !== null,
                            stamp_wait_reason: waitReason
                        };
                    })()
                };
            });

        rows = scopeProjects(rows, scopeBrands);
        if (brand) rows = rows.filter(r => r.brand === brand);
        if (status) rows = rows.filter(r => r.ad_status === status);
        if (from) rows = rows.filter(r => !r.post_date || r.post_date >= from);
        if (to) rows = rows.filter(r => !r.post_date || r.post_date <= to);

        rows.sort((a, b) => (b.post_date || '').localeCompare(a.post_date || ''));

        // สรุปภาพรวม
        const totalSpend = rows.reduce((s, r) => s + r.ad_spend, 0);
        const totalReach = rows.reduce((s, r) => s + r.ad_reach, 0);
        const doneCount = rows.filter(r => r.ad_status === 'ยิงแล้ว').length;

        // สรุปตามแบรนด์
        const bm = {};
        rows.forEach(r => {
            if (!bm[r.brand]) bm[r.brand] = { brand: r.brand, spend: 0, reach: 0, posts: 0 };
            bm[r.brand].spend += r.ad_spend;
            bm[r.brand].reach += r.ad_reach;
            bm[r.brand].posts += 1;
        });
        const byBrand = Object.values(bm)
            .map(b => ({ ...b, cpm: adCpm(b.spend, b.reach) }))
            .sort((a, b) => b.spend - a.spend);

        return {
            summary: {
                total_posts: rows.length,
                done_count: doneCount,
                pending_count: rows.length - doneCount,
                total_spend: totalSpend,
                total_reach: totalReach,
                cpm: adCpm(totalSpend, totalReach),
                by_brand: byBrand
            },
            rows
        };
    }
};

module.exports = { ads, adsSync };
