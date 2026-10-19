const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// แก้ลิงก์ / ID Post / Gencode / Platform ของโพสต์ IG / FB แล้ว — คะแนน KOL PFM / เกรด / รูปปกจาก WeBoostX เป็นของโพสต์เดิม
// ต้องล้างทิ้ง (ไม่ค้างโชว์กับโพสต์ใหม่) · แก้ช่องอื่น / ตัวตนไม่เปลี่ยน = ไม่แตะ · ฐานที่ยังไม่มีคอลัมน์ = ไม่แตะ (19 ต.ค. 2026)
// + ตัวดาวน์โหลดเขียนฐานแบบล็อกแถวเรียง id (กัน deadlock กับรอบซิงก์)
// ฐานจำลองทั้งหมด
process.env.NODE_ENV = 'test';
const SRC = path.join(__dirname, '../server/src');
const { pool } = require(path.join(SRC, 'config/db'));
pool.query = pool.connect = async () => { throw new Error('Unexpected real DB access'); };
after(() => pool.end());

const base = require(path.join(SRC, 'store/pg/_base'));
let current = null;
const writes = [];
const sqls = [];
const fakeClient = {
    async query(q, vals = []) {
        sqls.push(q);
        if (/^SELECT \* FROM submissions WHERE id = \$1( AND project_id = \$2)? FOR UPDATE/.test(q)) return { rows: current ? [structuredClone(current)] : [] };
        if (/^UPDATE submissions SET/.test(q)) {
            const cols = [...q.matchAll(/"?(\w+)"? = \$(\d+)/g)].map(m => [m[1], vals[Number(m[2]) - 1]]);
            writes.push(Object.fromEntries(cols));
            return { rows: [{ ...current, ...Object.fromEntries(cols) }] };
        }
        if (/FROM projects/.test(q)) return { rows: [{ brand: 'Jernis', campaign_type: 'kol' }] };
        throw new Error('unexpected SQL: ' + q.slice(0, 90));
    }
};
base.withTransaction = async fn => fn(fakeClient);
let lastQuery = null;
base.query = async (q, vals) => { lastQuery = { q, vals }; return { rows: [], rowCount: 2 }; };
const subs = require(path.join(SRC, 'store/pg/submissions'));
const wxStore = require(path.join(SRC, 'store/pg/weboostxSync'));

const STUDIO = { weboostx_pfm: '7.70', weboostx_pfm_grade: 'A', weboostx_thumbnail_path: '/api/v1/integrations/kol-pfm/thumbnail/12',
    thumbnail_local: 'wx0123456789abcdef.jpg', thumbnail_fetched_at: '2026-10-19T08:00:00Z', thumbnail_error: null };
const ig = (over = {}) => ({ id: 5, project_id: 9, platform: 'Instagram', post_url: 'https://www.instagram.com/reel/AAA/', id_post: '1789',
    gencode: null, ad_status: 'ยังไม่ยิง', ad_spend: 0, status: 'confirmed', post_check: null, ...STUDIO, ...over });
const KEYS = Object.keys(STUDIO);
const cleared = w => KEYS.filter(k => k in w && w[k] === null);

test('แก้ลิงก์โพสต์ IG เป็นโพสต์อื่น → ล้างคะแนน / เกรด / path / สำเนารูป ที่มีค่าอยู่', async () => {
    current = ig(); writes.length = 0;
    await subs.update(5, 9, { post_url: 'https://www.instagram.com/reel/BBB/' }, 'ทีม', { actor: 'team' });
    assert.deepEqual(cleared(writes[0]).sort(), ['thumbnail_fetched_at', 'thumbnail_local', 'weboostx_pfm', 'weboostx_pfm_grade', 'weboostx_thumbnail_path'].sort());
    assert.equal(writes[0].post_url, 'https://www.instagram.com/reel/BBB/');
});

test('ตัวตนโพสต์ไม่เปลี่ยน (แก้ช่องอื่น / ส่งลิงก์เดิม / เติม Gencode ทั้งที่มีลิงก์อยู่แล้ว) → ไม่แตะ', async () => {
    for (const fields of [{ draft_link: 'https://drive.example/x' }, { post_url: 'https://www.instagram.com/reel/AAA/' }, { gencode: 'ADCODE1' }, { post_date: '2026-10-10' }]) {
        current = ig(); writes.length = 0;
        await subs.update(5, 9, fields, 'ทีม', { actor: 'team' });
        assert.deepEqual(writes.length ? cleared(writes[0]) : [], [], JSON.stringify(fields));
    }
});

test('ไม่มีลิงก์โพสต์ (ใช้ ID Post) แล้วแก้ ID Post / เปลี่ยน Platform → ล้าง', async () => {
    current = ig({ post_url: null, id_post: '1789' }); writes.length = 0;
    await subs.update(5, 9, { id_post: '1790' }, 'ทีม', { actor: 'team' });
    assert.ok(cleared(writes[0]).includes('weboostx_pfm'));
    current = ig(); writes.length = 0;
    await subs.update(5, 9, { platform: 'TikTok' }, 'ทีม', { actor: 'team' });
    assert.ok(cleared(writes[0]).includes('thumbnail_local'));
});

test('ไม่มีข้อมูลจาก WeBoostX อยู่แล้ว / ฐานยังไม่มีคอลัมน์ → ไม่เขียนช่องพวกนี้เลย', async () => {
    current = ig({ weboostx_pfm: null, weboostx_pfm_grade: null, weboostx_thumbnail_path: null, thumbnail_local: null, thumbnail_fetched_at: null });
    writes.length = 0;
    await subs.update(5, 9, { post_url: 'https://www.instagram.com/reel/CCC/' }, 'ทีม', { actor: 'team' });
    assert.deepEqual(KEYS.filter(k => k in writes[0]), []);
    const old = ig({ post_url: 'https://www.instagram.com/reel/AAA/' });
    KEYS.forEach(k => { delete old[k]; });
    current = old; writes.length = 0;
    await subs.update(5, 9, { post_url: 'https://www.instagram.com/reel/DDD/' }, 'ทีม', { actor: 'team' });
    assert.deepEqual(KEYS.filter(k => k in writes[0]), [], 'ฐานที่ยังไม่ setup-db ต้องไม่ถูกสั่งเขียนคอลัมน์ที่ไม่มี');
});

test('ตัวดาวน์โหลดเขียนฐาน: ล็อกแถวเรียงตาม id ก่อน (ลำดับเดียวกับรอบซิงก์) · ไม่แตะสำเนาเดิมตอนล้ม', async () => {
    await wxStore.thumbSaved('/api/v1/integrations/kol-pfm/thumbnail/12', 'wx0123456789abcdef.jpg');
    assert.match(lastQuery.q, /ORDER BY id FOR UPDATE/);
    assert.deepEqual(lastQuery.vals, ['/api/v1/integrations/kol-pfm/thumbnail/12', 'wx0123456789abcdef.jpg']);
    await wxStore.thumbFailed('/api/v1/integrations/kol-pfm/thumbnail/12', 'http_404');
    assert.match(lastQuery.q, /ORDER BY id FOR UPDATE/);
    assert.equal(/thumbnail_local/.test(lastQuery.q), false);
});
