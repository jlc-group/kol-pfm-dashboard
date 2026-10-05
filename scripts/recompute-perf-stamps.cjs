/**
 * คิด CPM / CPE / ผลตัดสิน ของผลที่ล็อกไว้ (submissions.perf_stamp 🔒) ใหม่ ตามสูตรค่าตัวอย่างเดียว (ผู้ใช้สั่ง 5 ต.ค. 2026)
 *
 * สูตรเดิมตอนล็อก: CPM = (ค่าตัว + ค่าแอด) ÷ (วิว ÷ 1,000) · CPE = (ค่าตัว + ค่าแอด) ÷ engagement
 * สูตรใหม่:        CPM = ค่าตัว ÷ (วิว ÷ 1,000)          · CPE = ค่าตัว ÷ engagement   (logic.js clipCostMetrics)
 *
 * ค่าตัวที่ใช้ = ค่าตัว ณ วันที่ล็อก ถอดจากผลที่ล็อกไว้เอง (total_cost − ad_spend) ไม่ใช่ค่าตัววันนี้
 *   — ผลที่ล็อกยังเป็นภาพ ณ วันนั้นตามเจตนาเดิม · ช่อง at / ad_spend / views / engagement / er / total_cost ไม่แตะ
 * ผลที่ค่าตัว ณ วันล็อกเป็น 0 (KOL รายคนได้ฟรี) คิดสูตรใหม่ไม่ได้ → ไม่แตะ แค่รายงานให้รู้
 *
 * ใช้:
 *   node scripts/recompute-perf-stamps.cjs            ดูอย่างเดียว (ค่าเริ่มต้น) — บอกว่าแถวไหนจะเปลี่ยน ไม่เขียนอะไร
 *   node scripts/recompute-perf-stamps.cjs --write    เขียนจริง ในธุรกรรมเดียว (ล็อกแถว · ตรวจซ้ำก่อน COMMIT)
 *                                                     และเก็บสำเนาผลเดิมไว้เป็นไฟล์ perf-stamps-backup-<เวลา>.json ก่อนเขียน
 * ต่อฐานด้วยค่าเดียวกับตัวแอป (server/src/config/env.js อ่าน .env ที่ root และ server/) · ไม่พิมพ์รหัสผ่านออกมา
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server');
const { GOOD_CPM, GOOD_CPE } = require(path.join(SERVER, 'src/store/logic'));

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = v => Number(v.toFixed(2));

// คิดใหม่ 1 ผล — คืน null ถ้าคิดไม่ได้ (ไม่ใช่ object / ค่าตัว ณ วันล็อก ≤ 0 / ไม่มียอดวิว)
// คืน { cpm, cpe, verdict, fee } (fee = ค่าตัว ณ วันล็อก ไว้รายงาน ไม่ได้เขียนลง stamp)
function recomputeStamp(stamp) {
    if (!stamp || typeof stamp !== 'object') return null;
    const fee = num(stamp.total_cost) - num(stamp.ad_spend);
    const views = num(stamp.views);
    const engagement = num(stamp.engagement);
    if (fee <= 0 || views <= 0) return null;
    const cpm = r2(fee / (views / 1000));
    const cpe = engagement > 0 ? r2(fee / engagement) : 0;
    const verdict = (cpm > 0 && cpm <= GOOD_CPM && cpe > 0 && cpe <= GOOD_CPE) ? 'Pass' : 'Fail';
    return { cpm, cpe, verdict, fee: r2(fee) };
}

// แผนของทั้งชุด: [{ id, before, after, change }] + แถวที่ข้าม
function planAll(rows) {
    const plan = [], skipped = [];
    for (const row of rows) {
        const st = row.perf_stamp;
        const next = recomputeStamp(st);
        if (!next) {
            const free = st && typeof st === 'object' && st.total_cost != null && num(st.total_cost) - num(st.ad_spend) <= 0;
            skipped.push({ id: row.id, reason: free ? 'ค่าตัว ณ วันล็อกเป็น 0 (ได้ฟรี)' : 'ข้อมูลในผลที่ล็อกไม่ครบ' });
            continue;
        }
        const same = num(st.cpm) === next.cpm && num(st.cpe) === next.cpe && st.verdict === next.verdict;
        if (same) continue;
        plan.push({
            id: row.id,
            before: { cpm: st.cpm, cpe: st.cpe, verdict: st.verdict },
            after: { cpm: next.cpm, cpe: next.cpe, verdict: next.verdict },
            fee: next.fee,
            stamp: { ...st, cpm: next.cpm, cpe: next.cpe, verdict: next.verdict }
        });
    }
    return { plan, skipped };
}

async function main() {
    const write = process.argv.includes('--write');
    require(path.join(SERVER, 'src/config/env.js'));
    const { Client } = require(require.resolve('pg', { paths: [SERVER] }));
    if (!process.env.DB_HOST || !process.env.DB_NAME) throw new Error('ไม่เจอค่าฐานข้อมูล (DB_HOST / DB_NAME) ใน .env');
    const c = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: false, connectionTimeoutMillis: 15000 });
    console.log(`ฐานข้อมูล: ${process.env.DB_NAME} @ ${process.env.DB_HOST}:${process.env.DB_PORT || 5432} · โหมด: ${write ? 'เขียนจริง (--write)' : 'ดูอย่างเดียว'}`);
    await c.connect();
    try {
        await c.query(write ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const rows = (await c.query(`SELECT id, perf_stamp FROM submissions WHERE perf_stamp IS NOT NULL ORDER BY id${write ? ' FOR UPDATE' : ''}`)).rows;
        const { plan, skipped } = planAll(rows);
        console.log(`ผลที่ล็อกทั้งหมด ${rows.length} แถว · จะเปลี่ยน ${plan.length} · ไม่ต้องเปลี่ยน ${rows.length - plan.length - skipped.length} · ข้าม ${skipped.length}`);
        for (const p of plan) {
            console.log(`  #${p.id} ค่าตัว ${p.fee.toLocaleString('th-TH')} · CPM ${p.before.cpm} → ${p.after.cpm} · CPE ${p.before.cpe} → ${p.after.cpe} · ${p.before.verdict} → ${p.after.verdict}`);
        }
        for (const s of skipped) console.log(`  ข้าม #${s.id}: ${s.reason}`);
        if (!write) { await c.query('ROLLBACK'); console.log('\nยังไม่ได้เขียนอะไร — รันซ้ำด้วย --write เพื่อเขียนจริง'); return; }
        if (!plan.length) { await c.query('ROLLBACK'); console.log('ไม่มีอะไรต้องเขียน'); return; }

        // สำเนาผลเดิมก่อนเขียน (ไว้ย้อนกลับได้)
        const backup = path.join(process.cwd(), `perf-stamps-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(backup, JSON.stringify(rows.filter(r => plan.some(p => p.id === r.id)), null, 2));
        console.log('เก็บสำเนาผลเดิมไว้ที่ ' + backup);

        for (const p of plan) {
            const res = await c.query('UPDATE submissions SET perf_stamp = $1::jsonb WHERE id = $2 AND perf_stamp IS NOT NULL', [JSON.stringify(p.stamp), p.id]);
            if (res.rowCount !== 1) throw new Error('เขียนแถว #' + p.id + ' ไม่สำเร็จ — ยกเลิกทั้งหมด');
        }
        // ตรวจซ้ำในธุรกรรมเดียวกันก่อน COMMIT: คิดใหม่แล้วต้องไม่เหลืออะไรให้เปลี่ยน · ช่องอื่นต้องเหมือนเดิม
        const after = (await c.query('SELECT id, perf_stamp FROM submissions WHERE id = ANY($1::int[])', [plan.map(p => p.id)])).rows;
        const again = planAll(after).plan;
        const keysOk = after.every(a => {
            const was = rows.find(r => r.id === a.id).perf_stamp;
            return ['at', 'ad_spend', 'views', 'engagement', 'er', 'total_cost'].every(k => JSON.stringify(a.perf_stamp[k]) === JSON.stringify(was[k]));
        });
        if (again.length || !keysOk) throw new Error('ตรวจซ้ำไม่ผ่าน — ยกเลิกทั้งหมด ไม่มีอะไรถูกเขียน');
        await c.query('COMMIT');
        console.log(`✅ เขียนแล้ว ${plan.length} แถว (ธุรกรรมเดียว)`);
    } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        await c.end();
    }
}

if (require.main === module) {
    main().catch(e => { console.error('❌ ' + String(e.message).replace(/postgres(ql)?:\/\/\S+/gi, '[ซ่อน]')); process.exit(1); });
}

module.exports = { recomputeStamp, planAll };
