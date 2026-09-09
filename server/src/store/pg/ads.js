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
const {
    now, clone, scopeProjects,
    resolveGroupTarget, resolveGroupProducts, resolveGroupCtype, resolveGroupMedia,
    engagementOf, GOOD_CPM, GOOD_CPE
} = logic;

// ===== สแตมป์ Performance ตอนค่าแอดถึงเกณฑ์ =====
// ค่าแอดสะสมถึง 10,000 เมื่อไหร่ ให้เก็บภาพนิ่งของผลงาน ณ ตอนนั้นไว้ถาวร
// (jsonStore.js:1278 — logic.js ใช้ค่านี้เหมือนกันแต่ "ลืมประกาศ" จึงต้องมีสำเนาไว้ที่นี่)
const AD_STAMP_AT = 10000;

/**
 * ตัวห่อของ logic.maybeStamp
 *
 * บั๊กใน logic.js: ฟังก์ชัน maybeStamp อ้างตัวแปร AD_STAMP_AT ที่ไม่ได้ประกาศไว้ในไฟล์นั้น
 * (มีแต่ใน jsonStore.js) → เรียกทีไรก็โยน ReferenceError ทุกครั้งที่ submission ยังไม่มี perf_stamp
 * โชคดีที่มันโยนก่อนแตะข้อมูลใด ๆ (บรรทัดแรกคืน null ไปแล้วถ้ามี perf_stamp) จึงปลอดภัยที่จะ
 * ถอยมาใช้สำเนาตรรกะเดิมจาก jsonStore.js:1286-1307 แบบเป๊ะบรรทัดต่อบรรทัด
 * วันไหน logic.js ถูกแก้ให้ประกาศ AD_STAMP_AT ตัวห่อนี้จะกลับไปใช้ของกลางเองอัตโนมัติ
 */
function maybeStamp(s) {
    try {
        return logic.maybeStamp(s);
    } catch (err) {
        if (!(err instanceof ReferenceError)) throw err;
    }
    if (!s || s.perf_stamp) return null;                       // สแตมป์แล้วห้ามแตะซ้ำ
    const spend = Number(s.ad_spend) || 0;
    if (spend < AD_STAMP_AT) return null;
    const views = Number(s.views) || 0;
    // ถึงเกณฑ์แล้วแต่ยังไม่มีผลงาน -> รอไว้ก่อน ไม่งั้นจะล็อกค่าว่างค้างถาวร
    if (views <= 0) return null;
    const engagement = engagementOf(s);
    const totalCost = (Number(s.budget) || 0) + spend;
    const cpm = Number((totalCost / (views / 1000)).toFixed(2));
    const cpe = engagement > 0 ? Number((totalCost / engagement).toFixed(2)) : 0;
    s.perf_stamp = {
        at: now(),
        ad_spend: spend,
        views, engagement,
        er: Number(((engagement / views) * 100).toFixed(2)),
        total_cost: totalCost,
        cpm, cpe,
        verdict: (cpm > 0 && cpm <= GOOD_CPM && cpe > 0 && cpe <= GOOD_CPE) ? 'Pass' : 'Fail'
    };
    return s.perf_stamp;
}

// ============================ ads (ติดตามการยิงแอด + สรุปค่าแอด) ============================
// รับข้อมูลจากระบบยิงแอดของบริษัท — จับคู่ด้วย Gencode หรือ ID Post
// ค่าแอดไม่ถูกแสดงที่ไหนในหน้าเว็บ ใช้เป็นตัวจุดชนวนสแตมป์อย่างเดียว
const METRIC_KEYS = ['views', 'likes', 'comments', 'saves', 'shares', 'reposts'];

const adsSync = {
    async apply(rows) {
        const out = { updated: 0, stamped: 0, not_found: [], skipped: 0 };
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
            for (const k of METRIC_KEYS) {
                if (r[k] !== undefined) { s[k] = Number(r[k]) || 0; mark(s, k); }
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
            .filter(s => s.post_url && String(s.post_url).trim())     // เฉพาะโพสต์ที่มีลิงก์แล้ว
            .map(s => {
                const p = projById[s.project_id];
                const team = p ? snap.teams.find(t => t.id === p.team_id) : null;
                const spend = Number(s.ad_spend) || 0;
                const reach = Number(s.ad_reach) || 0;
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
                    target: resolveGroupTarget(grp, s.platform),
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
                    ad_start: s.ad_start || null,
                    ad_end: s.ad_end || null,
                    ad_note: s.ad_note || null,
                    cpm: adCpm(spend, reach),
                    // Performance ของคอนเทนต์ — ใช้ตัดสินว่าควรยิงต่อหรือหยุด
                    ...(() => {
                        const views = Number(s.views) || 0;
                        const eng = engagementOf(s);
                        const totalCost = (Number(s.budget) || 0) + spend;
                        const cCpm = views > 0 ? Number((totalCost / (views / 1000)).toFixed(2)) : 0;
                        const cCpe = eng > 0 ? Number((totalCost / eng).toFixed(2)) : 0;
                        return {
                            views, engagement: eng,
                            content_cpm: cCpm, content_cpe: cCpe,
                            performance: views > 0
                                ? ((cCpm > 0 && cCpm <= GOOD_CPM && cCpe > 0 && cCpe <= GOOD_CPE) ? 'Good' : 'Improve')
                                : null,
                            perf_stamp: s.perf_stamp ? clone(s.perf_stamp) : null,
                            stamp_waiting: !s.perf_stamp && spend >= AD_STAMP_AT && views <= 0
                        };
                    })(),
                    // Performance ของคอนเทนต์ — ใช้ตัดสินว่าควรยิงต่อหรือหยุด
                    // (ของเดิมเขียนบล็อกนี้ซ้ำสองรอบ ค่าที่ได้เหมือนกันทุกคีย์ — คงไว้เพื่อความเหมือนเป๊ะ)
                    ...(() => {
                        const views = Number(s.views) || 0;
                        const eng = engagementOf(s);
                        const totalCost = (Number(s.budget) || 0) + spend;
                        const cCpm = views > 0 ? Number((totalCost / (views / 1000)).toFixed(2)) : 0;
                        const cCpe = eng > 0 ? Number((totalCost / eng).toFixed(2)) : 0;
                        return {
                            views, engagement: eng,
                            content_cpm: cCpm, content_cpe: cCpe,
                            performance: views > 0
                                ? ((cCpm > 0 && cCpm <= GOOD_CPM && cCpe > 0 && cCpe <= GOOD_CPE) ? 'Good' : 'Improve')
                                : null,
                            perf_stamp: s.perf_stamp ? clone(s.perf_stamp) : null,
                            stamp_waiting: !s.perf_stamp && spend >= AD_STAMP_AT && views <= 0
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
