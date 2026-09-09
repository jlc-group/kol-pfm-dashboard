/**
 * ย้ายข้อมูลทั้งหมดจากไฟล์ JSON (server/data/db.json) เข้า PostgreSQL
 * รัน: npm run migrate
 *
 * หลักการ
 *   • คง id เดิมทุกแถว เพื่อให้ลิงก์ระหว่างตารางไม่ขาด และลิงก์เอเจนซี่ที่ส่งออกไปแล้วยังใช้ได้
 *   • ทำทั้งหมดใน transaction เดียว — สำเร็จทั้งหมด หรือไม่เข้าเลย ไม่มีสภาพย้ายค้างครึ่งทาง
 *   • ของที่เดิมซ้อนใน projects (agency_links → messages/reports) แตกออกเป็นตารางลูก
 *   • จบแล้วตั้ง sequence ให้เลยเลข id สูงสุด ไม่งั้นแถวใหม่จะได้ id ชนของเดิม
 *   • รันซ้ำได้ (--force จะล้างข้อมูลเดิมในฐานก่อนย้ายใหม่)
 */
const fs = require('fs');
const path = require('path');
const { pool, withTransaction } = require('../config/db');
const { asDate, asNum, asNumOrNull, asText, asJson, resyncSequences } = require('../store/pg/_base');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'db.json');
const FORCE = process.argv.includes('--force');

// ลำดับการล้าง = ย้อนจากลูกไปหาแม่ (ไม่งั้นติด foreign key)
const TRUNCATE_ORDER = [
    'activity_logs', 'rate_requests', 'installments', 'pay_batches', 'payments',
    'submissions', 'agency_reports', 'agency_messages', 'agency_links',
    'project_kols', 'projects', 'kols', 'users', 'teams'
];

const stats = {};
const count = (t, n = 1) => { stats[t] = (stats[t] || 0) + n; };

async function insert(c, table, cols, row) {
    const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
    const names = cols.map(x => (x === 'of' ? '"of"' : x)).join(', ');
    await c.query(`INSERT INTO ${table} (${names}) VALUES (${ph})`, cols.map(k => row[k]));
    count(table);
}

(async () => {
    if (!fs.existsSync(DATA_FILE)) {
        console.error('❌ ไม่พบไฟล์ข้อมูล:', DATA_FILE);
        process.exit(1);
    }
    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log('📖 อ่าน db.json แล้ว');
    for (const k of Object.keys(db)) {
        if (k !== '_seq' && Array.isArray(db[k]) && db[k].length) console.log(`   ${k}: ${db[k].length} แถว`);
    }

    await withTransaction(async (c) => {
        const existing = await c.query('SELECT COUNT(*) AS n FROM teams');
        if (Number(existing.rows[0].n) > 0 && !FORCE) {
            throw new Error('ฐานข้อมูลมีข้อมูลอยู่แล้ว — ถ้าต้องการย้ายทับ ให้รันด้วย --force');
        }
        if (FORCE) {
            for (const t of TRUNCATE_ORDER) await c.query(`DELETE FROM ${t}`);
            console.log('🧹 ล้างข้อมูลเดิมในฐานแล้ว (--force)');
        }

        // ---------- teams ----------
        for (const t of db.teams || []) {
            await insert(c, 'teams', ['id', 'name', 'description', 'created_at', 'updated_at'], {
                id: t.id, name: t.name, description: asText(t.description),
                created_at: t.created_at, updated_at: t.updated_at || t.created_at
            });
        }

        // ---------- users ----------
        const teamIds = new Set((db.teams || []).map(t => t.id));
        for (const u of db.users || []) {
            await insert(c, 'users',
                ['id', 'username', 'password_hash', 'full_name', 'nickname', 'role', 'status',
                 'brands', 'agency_tokens', 'team_id', 'is_active', 'created_at', 'updated_at'], {
                id: u.id, username: u.username, password_hash: u.password_hash,
                full_name: asText(u.full_name), nickname: asText(u.nickname),
                role: u.role || 'member', status: u.status || 'active',
                brands: asJson(u.brands, []), agency_tokens: asJson(u.agency_tokens, []),
                team_id: teamIds.has(u.team_id) ? u.team_id : null,
                is_active: u.is_active !== false,
                created_at: u.created_at, updated_at: u.updated_at || u.created_at
            });
        }

        // ---------- kols ----------
        for (const k of db.kols || []) {
            await insert(c, 'kols',
                ['id', 'kol_code', 'name', 'username', 'platform', 'avatar', 'followers',
                 'engagement_rate', 'category', 'tags', 'contact_info', 'extra_data', 'created_at', 'updated_at'], {
                id: k.id, kol_code: asText(k.kol_code), name: k.name, username: asText(k.username),
                platform: asText(k.platform), avatar: asText(k.avatar),
                followers: asNum(k.followers), engagement_rate: asNumOrNull(k.engagement_rate),
                category: asText(k.category),
                tags: k.tags == null ? null : asJson(k.tags),
                contact_info: k.contact_info == null ? null : asJson(k.contact_info),
                extra_data: k.extra_data == null ? null : asJson(k.extra_data),
                created_at: k.created_at, updated_at: k.updated_at || k.created_at
            });
        }

        // ---------- projects (+ ลิงก์เอเจนซี่ที่ซ้อนอยู่ข้างใน) ----------
        const userIds = new Set((db.users || []).map(u => u.id));
        const uid = v => (userIds.has(v) ? v : null);
        for (const p of db.projects || []) {
            await insert(c, 'projects',
                ['id', 'team_id', 'created_by', 'updated_by', 'name', 'brand', 'objective', 'product',
                 'products', 'ad_groups', 'owner', 'creator', 'brief_link', 'brief_file',
                 'product_briefs', 'platform_briefs', 'platform_budgets', 'kol_target', 'budget',
                 'start_date', 'end_date', 'status', 'description', 'share_token', 'created_at', 'updated_at'], {
                id: p.id, team_id: p.team_id, created_by: uid(p.created_by), updated_by: uid(p.updated_by),
                name: p.name, brand: asText(p.brand), objective: asText(p.objective), product: asText(p.product),
                products: asJson(p.products, []), ad_groups: asJson(p.ad_groups, []),
                owner: asText(p.owner), creator: asText(p.creator),
                brief_link: asText(p.brief_link),
                brief_file: p.brief_file == null ? null : asJson(p.brief_file),
                product_briefs: asJson(p.product_briefs, {}),
                platform_briefs: asJson(p.platform_briefs, {}),
                platform_budgets: asJson(p.platform_budgets, {}),
                kol_target: asNum(p.kol_target), budget: asNum(p.budget),
                start_date: asDate(p.start_date), end_date: asDate(p.end_date),
                status: p.status || 'Draft', description: asText(p.description),
                share_token: asText(p.share_token),
                created_at: p.created_at, updated_at: p.updated_at || p.created_at
            });

            for (const l of (p.agency_links || [])) {
                const r = await c.query(
                    `INSERT INTO agency_links
                       (project_id, token, name, groups, products, platforms, kol_count,
                        team_read_at, agency_read_at, created_at, updated_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
                    [p.id, l.token, asText(l.name), asJson(l.groups, []), asJson(l.products, []),
                     asJson(l.platforms, []), asNum(l.kol_count),
                     l.team_read_at || null, l.agency_read_at || null,
                     l.created_at, l.updated_at || null]);
                const linkId = r.rows[0].id;
                count('agency_links');

                for (const m of (l.messages || [])) {
                    await insert(c, 'agency_messages',
                        ['id', 'link_id', 'msg_from', 'by_name', 'text', 'image', 'thumb', 'at', 'edited_at', 'deleted_at'], {
                        id: m.id, link_id: linkId, msg_from: asText(m.from), by_name: asText(m.by),
                        text: asText(m.text), image: asText(m.image), thumb: asText(m.thumb),
                        at: m.at, edited_at: m.edited_at || null, deleted_at: m.deleted_at || null
                    });
                }
                for (const rp of (l.reports || [])) {
                    await insert(c, 'agency_reports',
                        ['id', 'link_id', 'kind', 'filename', 'original', 'url', 'size', 'note', 'uploaded_at'], {
                        id: rp.id, link_id: linkId, kind: asText(rp.kind), filename: asText(rp.filename),
                        original: asText(rp.original), url: asText(rp.url), size: asNumOrNull(rp.size),
                        note: asText(rp.note), uploaded_at: rp.uploaded_at
                    });
                }
            }
        }

        // ---------- project_kols ----------
        const projIds = new Set((db.projects || []).map(p => p.id));
        const kolIds = new Set((db.kols || []).map(k => k.id));
        for (const pk of db.project_kols || []) {
            if (!projIds.has(pk.project_id) || !kolIds.has(pk.kol_id)) {
                console.warn(`   ⚠️  ข้าม project_kols id=${pk.id} (ชี้ไปยังแคมเปญ/KOL ที่ไม่มีอยู่)`);
                continue;
            }
            await insert(c, 'project_kols',
                ['id', 'project_id', 'kol_id', 'fee', 'views', 'likes', 'comments', 'shares',
                 'post_link', 'posted_date', 'status', 'notes', 'added_at'], {
                id: pk.id, project_id: pk.project_id, kol_id: pk.kol_id,
                fee: asNum(pk.fee), views: asNum(pk.views), likes: asNum(pk.likes),
                comments: asNum(pk.comments), shares: asNum(pk.shares),
                post_link: asText(pk.post_link), posted_date: asDate(pk.posted_date),
                status: pk.status || 'Pending', notes: asText(pk.notes), added_at: pk.added_at
            });
        }

        // ---------- submissions ----------
        const SUB_TEXT = ['agency_token', 'person_key', 'clip_name', 'account_name', 'platform', 'product',
            'agency', 'link_account', 'group_key', 'tier', 'content_type', 'content_format', 'draft_status',
            'draft_link', 'draft_link2', 'draft_link3', 'draft_link4', 'draft_link5',
            'feedback', 'feedback2', 'feedback3', 'feedback4', 'feedback5', 'concept', 'gen_date',
            'gencode', 'gencode_by', 'post_url', 'post_url_by', 'id_post', 'id_post_by',
            'post_date', 'post_date_by', 'ad_start', 'ad_end', 'ad_note', 'perf_synced_at',
            'team_note', 'agency_note', 'decided_by'];
        const SUB_NUM = ['followers', 'budget', 'clip_no', 'code_expire', 'ad_spend', 'ad_reach',
            'views', 'likes', 'comments', 'saves', 'shares', 'reposts'];
        const SUB_TS = ['gencode_at', 'post_url_at', 'id_post_at', 'post_date_at', 'ad_synced_at',
            'submitted_at', 'decided_at', 'list_updated_at', 'work_updated_at', 'draft_updated_at', 'updated_at'];
        for (const s of db.submissions || []) {
            if (!projIds.has(s.project_id)) {
                console.warn(`   ⚠️  ข้าม submissions id=${s.id} (แคมเปญไม่มีอยู่)`);
                continue;
            }
            const row = { id: s.id, project_id: s.project_id, status: s.status || 'submitted',
                approved: !!s.approved, ad_status: s.ad_status || 'ยังไม่ยิง',
                perf_stamp: s.perf_stamp == null ? null : asJson(s.perf_stamp) };
            for (const f of SUB_TEXT) row[f] = asText(s[f]);
            for (const f of SUB_NUM) row[f] = asNum(s[f], f === 'clip_no' ? 1 : (f === 'code_expire' ? 60 : 0));
            for (const f of SUB_TS) row[f] = s[f] || null;
            await insert(c, 'submissions', Object.keys(row), row);
        }

        // ---------- pay_batches (ต้องมาก่อน installments เพราะ batch_id ชี้มาที่นี่) ----------
        for (const b of db.pay_batches || []) {
            await insert(c, 'pay_batches',
                ['id', 'agency', 'pay_date', 'note', 'slip', 'total', 'created_by', 'created_at', 'updated_at'], {
                id: b.id, agency: asText(b.agency), pay_date: asDate(b.pay_date), note: asText(b.note),
                slip: b.slip == null ? null : asJson(b.slip), total: asNum(b.total),
                created_by: asText(b.created_by), created_at: b.created_at, updated_at: b.updated_at || null
            });
        }

        // ---------- installments ----------
        const batchIds = new Set((db.pay_batches || []).map(b => b.id));
        for (const i of db.installments || []) {
            if (!projIds.has(i.project_id)) {
                console.warn(`   ⚠️  ข้าม installments id=${i.id} (แคมเปญไม่มีอยู่)`);
                continue;
            }
            await insert(c, 'installments',
                ['id', 'project_id', 'agency', 'group_key', 'manual_id', 'no', 'of', 'title', 'percent',
                 'amount', 'due_date', 'status', 'batch_id', 'invoice', 'invoice_link', 'note',
                 'created_at', 'updated_at'], {
                id: i.id, project_id: i.project_id, agency: asText(i.agency), group_key: asText(i.group_key),
                manual_id: asText(i.manual_id), no: asNumOrNull(i.no), of: asNumOrNull(i.of),
                title: asText(i.title), percent: asNumOrNull(i.percent), amount: asNum(i.amount),
                due_date: asDate(i.due_date), status: i.status || 'pending',
                batch_id: batchIds.has(i.batch_id) ? i.batch_id : null,
                invoice: i.invoice == null ? null : asJson(i.invoice),
                invoice_link: asText(i.invoice_link), note: asText(i.note),
                created_at: i.created_at, updated_at: i.updated_at || null
            });
        }

        // ---------- payments ----------
        for (const p of db.payments || []) {
            if (!projIds.has(p.project_id)) {
                console.warn(`   ⚠️  ข้าม payments id=${p.id} (แคมเปญไม่มีอยู่)`);
                continue;
            }
            await insert(c, 'payments',
                ['id', 'project_id', 'agency_name', 'status', 'payment_date', 'notes',
                 'quotation', 'quotation_link', 'invoice', 'created_at', 'updated_at'], {
                id: p.id, project_id: p.project_id, agency_name: asText(p.agency_name),
                status: asText(p.status), payment_date: asDate(p.payment_date), notes: asText(p.notes),
                quotation: p.quotation == null ? null : asJson(p.quotation),
                quotation_link: asText(p.quotation_link),
                invoice: p.invoice == null ? null : asJson(p.invoice),
                created_at: p.created_at || p.updated_at || new Date().toISOString(),
                updated_at: p.updated_at || null
            });
        }

        // ---------- rate_requests ----------
        for (const r of db.rate_requests || []) {
            await insert(c, 'rate_requests',
                ['id', 'team_id', 'brand', 'kol_name', 'link_account', 'platforms', 'products',
                 'budget', 'no_budget', 'scope', 'brief_link', 'brief_note', 'status', 'created_by', 'created_at'], {
                id: r.id, team_id: teamIds.has(r.team_id) ? r.team_id : null,
                brand: asText(r.brand), kol_name: asText(r.kol_name), link_account: asText(r.link_account),
                platforms: asJson(r.platforms, []), products: asJson(r.products, []),
                budget: asNumOrNull(r.budget), no_budget: !!r.no_budget, scope: asText(r.scope),
                brief_link: asText(r.brief_link), brief_note: asText(r.brief_note),
                status: r.status || 'open', created_by: asText(r.created_by), created_at: r.created_at
            });
        }

        // ---------- activity_logs ----------
        for (const a of db.activity_logs || []) {
            await insert(c, 'activity_logs',
                ['id', 'user_id', 'user_name', 'team_id', 'project_id', 'project_name',
                 'action', 'summary', 'created_at'], {
                // ประวัติไม่มี FK แล้ว จึงเก็บ id ดิบตามเดิมทุกตัว แม้ของที่มันอ้างถึงจะถูกลบไปแล้ว
                id: a.id, user_id: a.user_id ?? null, user_name: asText(a.user_name),
                team_id: a.team_id ?? null,
                project_id: a.project_id ?? null,
                project_name: asText(a.project_name), action: asText(a.action),
                summary: asText(a.summary), created_at: a.created_at
            });
        }

        // ส่งตัวนับเดิมเข้าไปด้วย เพื่อให้ id ถัดไปต่อจากของเดิมจริง ๆ ไม่ใช่ต่อจาก MAX(id)
        await resyncSequences(c, db._seq || {});
    });

    console.log('\n✅ ย้ายข้อมูลเข้า PostgreSQL สำเร็จ (ทั้งหมดอยู่ใน transaction เดียว)');
    for (const t of Object.keys(stats).sort()) console.log(`   ${t}: ${stats[t]} แถว`);
    await pool.end();
    process.exit(0);
})().catch(async (err) => {
    console.error('\n❌ ย้ายข้อมูลไม่สำเร็จ — ฐานข้อมูลถูกย้อนกลับทั้งหมด ไม่มีข้อมูลค้าง');
    console.error('   สาเหตุ:', err.message);
    try { await pool.end(); } catch { /* ปิด pool ไม่ได้ก็ไม่เป็นไร */ }
    process.exit(1);
});
