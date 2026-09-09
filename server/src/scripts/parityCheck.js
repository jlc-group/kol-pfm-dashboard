/**
 * [เครื่องมือช่วงย้ายข้อมูล — ใช้งานเสร็จแล้ว]
 *
 * ตรวจว่า pgStore ให้ผลเหมือน jsonStore ทุกประการ ผลล่าสุด: ผ่าน 88/88
 * ตอนนี้ db.json ถูกลบแล้ว สคริปต์จึงไม่มีอะไรให้เทียบ (จะแจ้งแล้วจบการทำงาน)
 * เก็บไว้เป็นหลักฐานว่าการย้ายข้อมูลถูกตรวจสอบมาแล้วอย่างไร
 *
 * รัน: npm run parity
 *
 * วิธีตรวจ: เรียก method เดียวกัน อาร์กิวเมนต์เดียวกัน ทั้งสองไดรเวอร์ แล้วเทียบผลแบบลึก
 * ค่าที่ต่างกันโดยธรรมชาติ (เวลาที่สร้าง ณ วินาทีนั้น, token สุ่ม) จะถูกปรับให้เทียบกันได้ก่อน
 *
 * ตรวจ 2 ชั้น:
 *   1) READ  — อ่านทุก method ที่ไม่เปลี่ยนข้อมูล แล้วเทียบผล
 *   2) WRITE — สร้าง/แก้/ลบ ด้วยข้อมูลชุดเดียวกันทั้งสองฝั่ง แล้วอ่านกลับมาเทียบ
 *              (พิสูจน์ว่า "บันทึกลง PostgreSQL ได้จริง" ไม่ใช่แค่อ่านได้)
 */
process.env.DATA_DRIVER = 'json';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'db.json');
const BACKUP = DATA_FILE + '.parity-backup';

// ทั้งสองฝั่งต้องเริ่มจากข้อมูลชุดเดียวกันเป๊ะ ไม่งั้น id จะเหลื่อมกันแล้วรายงานว่า "ต่างกัน" ทั้งที่โค้ดถูก
// จึงสำรอง db.json ไว้ แล้วย้ายข้อมูลชุดนั้นเข้า PostgreSQL ทับของเดิมก่อนเริ่มทดสอบ
if (!fs.existsSync(DATA_FILE)) {
    console.error('ℹ️  เครื่องมือนี้ใช้ตรวจตอน "ย้ายข้อมูลจากไฟล์ JSON เข้า PostgreSQL" ซึ่งทำเสร็จไปแล้ว');
    console.error('   ตอนนี้ไฟล์ server/data/db.json ถูกลบทิ้งแล้ว (ข้อมูลจริงอยู่ในฐาน kol_dashboard)');
    console.error('   จึงไม่มีอะไรให้เทียบอีก — เก็บสคริปต์ไว้เป็นบันทึกว่าเคยตรวจผ่าน 88/88');
    process.exit(0);
}
console.log('🔄 เตรียมข้อมูลให้สองฝั่งเท่ากันก่อนเริ่ม...');
fs.copyFileSync(DATA_FILE, BACKUP);
execFileSync('node', [path.join(__dirname, 'migrateToPostgres.js'), '--force'], { stdio: 'pipe' });
console.log('   เรียบร้อย\n');

const restore = () => {
    // คืน db.json กลับสภาพก่อนทดสอบ — ไม่ให้แถวทดสอบค้างสะสมทุกครั้งที่รัน
    try { fs.copyFileSync(BACKUP, DATA_FILE); fs.unlinkSync(BACKUP); } catch { /* ไม่มีไฟล์สำรองก็ข้าม */ }
};

const jsonStore = require('../store/jsonStore');
const pgStore = require('../store/pgStore');
const { pool } = require('../config/db');

let pass = 0, fail = 0;
const failures = [];

// ---------- ปรับค่าที่ต่างกันโดยธรรมชาติ ----------
const VOLATILE = new Set([
    'created_at', 'updated_at', 'added_at', 'submitted_at', 'at', 'uploaded_at',
    'list_updated_at', 'work_updated_at', 'draft_updated_at', 'decided_at',
    'gencode_at', 'post_url_at', 'id_post_at', 'post_date_at', 'ad_synced_at',
    'edited_at', 'deleted_at', 'team_read_at', 'agency_read_at', 'payment_date'
]);

function normalize(v, key) {
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) return v.map(x => normalize(x));
    if (typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v).sort()) {
            const val = v[k];
            // pg คืนทุกคอลัมน์ของตาราง ส่วน json มีเฉพาะคีย์ที่เคยถูกเซ็ต
            // จึงถือว่า "ไม่มีคีย์" กับ "คีย์ที่เป็น null" เท่ากัน (ตรวจแล้วว่าทั้ง route และหน้าเว็บ
            // ไม่มีที่ไหนใช้ 'in' / hasOwnProperty / === undefined กับข้อมูลพวกนี้เลย)
            if (val === null || val === undefined) continue;
            // เวลาแค่ต้องมี/ไม่มีให้ตรงกัน ค่าจริงต่างกันไม่กี่มิลลิวินาทีเป็นเรื่องปกติ
            if (VOLATILE.has(k)) { out[k] = '<ts>'; continue; }
            out[k] = normalize(val, k);
        }
        return out;
    }
    if (typeof v === 'number') return Number(v.toFixed(6));   // กันค่าทศนิยมปัดต่างกันเล็กน้อย
    // id ของข้อความ/ไฟล์รายงานสร้างจากเวลา+เลขสุ่ม จึงต่างกันทุกครั้งโดยธรรมชาติ
    // เทียบแค่ว่า "รูปแบบถูก" พอ
    if (typeof v === 'string' && /^r[a-z0-9]{10,16}$/.test(v)) return '<id>';
    if (typeof v === 'string' && /^p[a-z0-9]{6,10}$/.test(v)) return '<person>';
    return v;
}

const show = v => JSON.stringify(v);

/** ไล่หาเส้นทางแรกที่ค่าต่างกัน เพื่อให้รู้ว่าพังตรงไหนจริง ๆ ไม่ใช่เดาจากสตริงยาว ๆ */
function firstDiff(a, b, path = '') {
    if (JSON.stringify(a) === JSON.stringify(b)) return null;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return `${path || '(ราก)'}: json=${show(a)} · pg=${show(b)}`;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return `${path}: ชนิดต่างกัน (array กับ object)`;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return `${path}: จำนวนสมาชิกต่างกัน json=${a.length} pg=${b.length}`;
        for (let i = 0; i < a.length; i++) {
            const d = firstDiff(a[i], b[i], `${path}[${i}]`);
            if (d) return d;
        }
        return null;
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const d = firstDiff(a[k], b[k], path ? `${path}.${k}` : k);
        if (d) return d;
    }
    return null;
}

async function cmp(label, fn) {
    let a, b, ea = null, eb = null;
    try { a = await fn(jsonStore); } catch (e) { ea = e; }
    try { b = await fn(pgStore); } catch (e) { eb = e; }

    if (ea || eb) {
        // ทั้งคู่ต้อง error เหมือนกัน (ข้อความ + code + status)
        const sa = ea ? `${ea.code || ''}|${ea.status || ''}|${ea.message}` : '<ไม่ error>';
        const sb = eb ? `${eb.code || ''}|${eb.status || ''}|${eb.message}` : '<ไม่ error>';
        if (sa === sb) { pass++; return; }
        fail++; failures.push({ label, json: sa, pg: sb, kind: 'error ต่างกัน' });
        return;
    }
    const na = show(normalize(a)), nb = show(normalize(b));
    if (na === nb) { pass++; return; }
    fail++;
    failures.push({ label, kind: 'ผลต่างกัน', where: firstDiff(normalize(a), normalize(b)) });
}

(async () => {
    console.log('🔍 เทียบ jsonStore ↔ pgStore\n');

    // ---------- 1) READ ----------
    console.log('── ชั้นที่ 1: อ่านข้อมูล ──');
    await cmp('teams.listWithMemberCount', s => s.teams.listWithMemberCount());
    await cmp('teams.findById(1)', s => s.teams.findById(1));
    await cmp('teams.findById(9999)', s => s.teams.findById(9999));
    await cmp('teams.memberCounts', s => s.teams.memberCounts());
    await cmp('meta.teamCount', s => s.meta.teamCount());

    await cmp('users.listWithTeam', s => s.users.listWithTeam());
    await cmp('users.findById(1)', s => s.users.findById(1));
    await cmp('users.findById(9999)', s => s.users.findById(9999));
    await cmp('users.findByUsername(admin)', s => s.users.findByUsername('admin'));
    await cmp('users.findByUsername(ไม่มี)', s => s.users.findByUsername('ไม่มีคนนี้'));
    await cmp('users.listAgencies', s => s.users.listAgencies());
    await cmp('users.countPending', s => s.users.countPending());

    await cmp('kols.list()', s => s.kols.list());
    await cmp('kols.list({search})', s => s.kols.list({ search: 'น้อง' }));
    await cmp('kols.findById(1)', s => s.kols.findById(1));
    await cmp('kols.findById(9999)', s => s.kols.findById(9999));
    await cmp('kols.count', s => s.kols.count());
    await cmp('kols.platformCounts', s => s.kols.platformCounts());
    await cmp('kols.analytics()', s => s.kols.analytics());
    await cmp('kols.usedWithCampaigns(1)', s => s.kols.usedWithCampaigns(1));
    await cmp('kols.detailWithUsages(1)', s => s.kols.detailWithUsages(1));

    await cmp('projects.list(null)', s => s.projects.list(null));
    await cmp('projects.list([Jdent])', s => s.projects.list(['Jdent']));
    await cmp('projects.list([])', s => s.projects.list([]));
    await cmp('projects.findTeamId(1)', s => s.projects.findTeamId(1));
    await cmp('projects.findByIdFull(1)', s => s.projects.findByIdFull(1));
    await cmp('projects.findByIdFull(9999)', s => s.projects.findByIdFull(9999));
    await cmp('projects.count(null)', s => s.projects.count(null));
    await cmp('projects.statusCounts(null)', s => s.projects.statusCounts(null));
    await cmp('projects.listAgencyLinks(1)', s => s.projects.listAgencyLinks(1));
    await cmp('projects.listTeamChats(null)', s => s.projects.listTeamChats(null));
    await cmp('projects.resolveToken(ไม่มี)', s => s.projects.resolveToken('ไม่มี-token'));

    await cmp('dashboard.overview({})', s => s.dashboard.overview({}));
    await cmp('dashboard.overview(brand)', s => s.dashboard.overview({ scopeBrands: null, brand: 'Jdent' }));
    await cmp('budget.overview({})', s => s.budget.overview({}));
    await cmp('budget.trend({year})', s => s.budget.trend({ scopeBrands: null, year: '2026' }));
    await cmp('reports.campaigns({})', s => s.reports.campaigns({}));
    await cmp('reports.detail(1,null)', s => s.reports.detail(1, null));
    await cmp('reports.detail(9999,null)', s => s.reports.detail(9999, null));

    await cmp('submissions.listByProject(1)', s => s.submissions.listByProject(1));
    await cmp('submissions.get(9999)', s => s.submissions.get(9999));
    await cmp('submissions.countPending(1)', s => s.submissions.countPending(1));

    await cmp('payments.listWithProjects(null)', s => s.payments.listWithProjects(null));
    await cmp('installments.list()', s => s.installments.list());
    await cmp('installments.listByProject(1)', s => s.installments.listByProject(1));
    await cmp('installments.listManual()', s => s.installments.listManual());
    await cmp('payBatches.list()', s => s.payBatches.list());
    await cmp('payBatches.get(9999)', s => s.payBatches.get(9999));
    await cmp('rateRequests.list(null)', s => s.rateRequests.list(null));
    await cmp('activity.list({})', s => s.activity.list({}));
    await cmp('activity.actors()', s => s.activity.actors());
    await cmp('ads.list({})', s => s.ads.list({}));
    await cmp('ads.subContext(1)', s => s.ads.subContext(1));

    console.log(`   อ่าน: ผ่าน ${pass} / ไม่ผ่าน ${fail}\n`);

    // ---------- 2) WRITE ----------
    console.log('── ชั้นที่ 2: เขียนข้อมูล (พิสูจน์ว่าบันทึกลง PostgreSQL ได้จริง) ──');
    const before = { pass, fail };
    const TAG = 'PARITY-TEST';

    // teams
    await cmp('teams.create', s => s.teams.create({ name: TAG + '-ทีม', description: 'ทดสอบ' }));
    await cmp('teams.create ซ้ำ (ต้อง error 23505)', s => s.teams.create({ name: TAG + '-ทีม' }));
    const jt = (await jsonStore.teams.listWithMemberCount()).find(t => t.name === TAG + '-ทีม');
    const pt = (await pgStore.teams.listWithMemberCount()).find(t => t.name === TAG + '-ทีม');
    await cmp('teams.update', s => s.teams.update(s === jsonStore ? jt.id : pt.id, { description: 'แก้แล้ว' }));

    // kols
    await cmp('kols.create', s => s.kols.create({ kol_code: TAG + '-K', name: TAG + ' คนทดสอบ', platform: 'TikTok', followers: 1234, engagement_rate: 3.21, category: 'Test' }));
    const jk = (await jsonStore.kols.list({ search: TAG }))[0] || (await jsonStore.kols.list()).find(k => k.kol_code === TAG + '-K');
    const pk = (await pgStore.kols.list({ search: TAG }))[0] || (await pgStore.kols.list()).find(k => k.kol_code === TAG + '-K');
    await cmp('kols.update', s => s.kols.update(s === jsonStore ? jk.id : pk.id, { followers: 5678, category: 'Updated' }));
    await cmp('kols.findById(หลังแก้)', s => s.kols.findById(s === jsonStore ? jk.id : pk.id));

    // projects
    await cmp('projects.create', s => s.projects.create({
        team_id: 1, created_by: 1, name: TAG + ' แคมเปญ', brand: 'Jdent',
        budget: 55000, kol_target: 3, start_date: '2026-08-01', end_date: '',
        products: ['สินค้า A'], status: 'Draft'
    }));
    const jp = (await jsonStore.projects.list(null)).find(p => p.name === TAG + ' แคมเปญ');
    const pp = (await pgStore.projects.list(null)).find(p => p.name === TAG + ' แคมเปญ');
    const pid = s => (s === jsonStore ? jp.id : pp.id);
    await cmp('projects.update', s => s.projects.update(pid(s), { budget: 77000, status: 'Active', updated_by: 1 }));
    await cmp('projects.findByIdFull(ใหม่)', s => s.projects.findByIdFull(pid(s)));

    // project_kols
    await cmp('projectKols.add', s => s.projectKols.add({ project_id: pid(s), kol_id: 1, fee: 9000, views: 1000 }));
    await cmp('projectKols.add ซ้ำ (ต้อง error)', s => s.projectKols.add({ project_id: pid(s), kol_id: 1, fee: 1 }));
    const jl = (await jsonStore.projects.findByIdFull(jp.id)).kols[0];
    const pl = (await pgStore.projects.findByIdFull(pp.id)).kols[0];
    await cmp('projectKols.update', s => s.projectKols.update(s === jsonStore ? jl.id : pl.id, pid(s), { fee: 12000, views: 4321, status: 'Posted' }));

    // agency link + submissions
    // ใช้ token เดียวกันทั้งสองฝั่งได้ เพราะเป็นคนละที่เก็บ ไม่ชนกัน — จะได้เทียบผลกันตรง ๆ
    const tok = () => TAG + '-token';
    await cmp('projects.addAgencyLink', s => s.projects.addAgencyLink(pid(s), 'เอเจนซี่ทดสอบ', tok(), { platforms: ['TikTok'], products: ['สินค้า A'], kol_count: 2 }));
    await cmp('projects.listAgencyLinks(ใหม่)', s => s.projects.listAgencyLinks(pid(s)));
    await cmp('submissions.addPerson', s => s.submissions.addPerson({
        project_id: pid(s), account_name: TAG + ' บัญชี', followers: 2000, platform: 'TikTok',
        product: 'สินค้า A', budget: 3000, agency: 'เอเจนซี่ทดสอบ', agency_token: tok(), content_type: 'Review'
    }, ['คลิป 1', 'คลิป 2']));
    const jsub = (await jsonStore.submissions.listByProject(jp.id));
    const psub = (await pgStore.submissions.listByProject(pp.id));
    // ลำดับของ jsonStore ที่นี่ไม่แน่นอน (เวลาสองแถวต่างกันบ้างเท่ากันบ้างตามจังหวะเขียนไฟล์)
    // จึงเรียงตาม id ก่อนเทียบ เพื่อดู "เนื้อหา" ว่าตรงกันไหม ไม่ใช่ไปติดกับลำดับที่เดิมก็ไม่คงที่อยู่แล้ว
    const byId = r => [...r].sort((x, y) => x.id - y.id);
    await cmp('submissions.listByProject(ใหม่)', async s => byId(await s.submissions.listByProject(pid(s))));
    const sid = s => (s === jsonStore ? Math.min(...jsub.map(x => x.id)) : Math.min(...psub.map(x => x.id)));
    await cmp('submissions.update', s => s.submissions.update(sid(s), pid(s), { status: 'confirmed', gencode: 'GC-001', views: 50000, likes: 900, ad_spend: 700 }, 'ผู้ทดสอบ'));
    await cmp('submissions.get(หลังแก้)', s => s.submissions.get(sid(s)));
    await cmp('submissions.countPending(ใหม่)', s => s.submissions.countPending(pid(s)));

    // chat
    await cmp('projects.addAgencyMessage', s => s.projects.addAgencyMessage(pid(s), tok(), { from: 'team', by: 'ผู้ทดสอบ', text: 'สวัสดี' }));
    await cmp('projects.listAgencyMessages', s => s.projects.listAgencyMessages(pid(s), tok()));
    await cmp('projects.markAgencyRead', s => s.projects.markAgencyRead(pid(s), tok(), 'team'));

    // installments / batches
    await cmp('installments.setPlan', s => s.installments.setPlan(pid(s), 'เอเจนซี่ทดสอบ', null, [
        { no: 1, of: 2, title: 'งวดแรก', percent: 50, amount: 5000, due_date: '2026-09-30' },
        { no: 2, of: 2, title: 'งวดสอง', percent: 50, amount: 5000, due_date: '2026-10-31' }
    ]));
    await cmp('installments.listByProject(ใหม่)', s => s.installments.listByProject(pid(s)));
    await cmp('payBatches.create', s => s.payBatches.create({ agency: 'เอเจนซี่ทดสอบ', pay_date: '2026-10-01', note: TAG, created_by: 'ผู้ทดสอบ' }));

    // activity / rate requests
    await cmp('activity.log', s => s.activity.log({ user_id: 1, user_name: 'ผู้ทดสอบ', team_id: 1, project_id: pid(s), project_name: TAG, action: 'test', summary: 'ทดสอบ' }));
    await cmp('rateRequests.create', s => s.rateRequests.create({ team_id: 1, brand: 'Jdent', kol_name: TAG, platforms: ['TikTok'], products: ['สินค้า A'], budget: 1000, scope: 'ทดสอบ', created_by: 'ผู้ทดสอบ' }));

    // อ่านซ้ำหลังเขียน — ยืนยันว่าข้อมูลลงจริงและสรุปตรงกัน
    await cmp('dashboard.overview (หลังเขียน)', s => s.dashboard.overview({}));
    await cmp('reports.campaigns (หลังเขียน)', s => s.reports.campaigns({}));
    await cmp('budget.overview (หลังเขียน)', s => s.budget.overview({}));
    await cmp('ads.list (หลังเขียน)', s => s.ads.list({}));
    await cmp('activity.list (หลังเขียน)', s => s.activity.list({}));

    // ลบ
    await cmp('projects.remove', s => s.projects.remove(pid(s)));
    await cmp('kols.remove', s => s.kols.remove(s === jsonStore ? jk.id : pk.id));
    await cmp('teams.remove', s => s.teams.remove(s === jsonStore ? jt.id : pt.id));

    console.log(`   เขียน: ผ่าน ${pass - before.pass} / ไม่ผ่าน ${fail - before.fail}\n`);

    // ---------- สรุป ----------
    console.log('═'.repeat(60));
    console.log(`ผลรวม: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    if (failures.length) {
        console.log(`\n❌ รายการที่ไม่ตรงกัน (${failures.length}):\n`);
        for (const f of failures) {
            console.log(`▸ ${f.label}  [${f.kind}]`);
            if (f.where) console.log(`   จุดที่ต่าง → ${f.where}\n`);
            else { console.log(`   json: ${f.json}`); console.log(`   pg  : ${f.pg}\n`); }
        }
    } else {
        console.log('\n🎉 ทุก method ให้ผลตรงกันทั้งหมด');
    }
    await pool.end();
    restore();
    console.log('\n🔄 คืน db.json กลับสภาพเดิมแล้ว (ข้อมูลใน PostgreSQL ยังมีแถวทดสอบอยู่ — รัน npm run migrate -- --force เพื่อล้าง)');
    process.exit(fail ? 1 : 0);
})().catch(async e => {
    console.error('\n❌ ตัวตรวจล้มเหลว:', e.message);
    console.error(e.stack);
    try { await pool.end(); } catch { /* ปิดไม่ได้ก็ข้าม */ }
    restore();
    process.exit(1);
});
