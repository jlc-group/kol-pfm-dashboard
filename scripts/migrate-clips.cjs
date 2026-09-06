const fs = require('fs');
const P = './server/data/db.json';
const db = JSON.parse(fs.readFileSync(P, 'utf8'));

const PID = 10;
const TWO_CLIP_GROUP = 'ga7zsdin';        // "ตัวเล็ก (Tiktok)" — 1 คน 2 คลิป
const NAMES = ['EVENT', 'BOX SET'];

const proj = db.projects.find(p => p.id === PID);
if (!proj) throw new Error('ไม่เจอแคมเปญ');

// 1) ตั้งชื่อคลิปที่กลุ่ม
const grp = (proj.ad_groups || []).find(g => g.key === TWO_CLIP_GROUP);
if (!grp) throw new Error('ไม่เจอกลุ่ม ' + TWO_CLIP_GROUP);
grp.clips = [...NAMES];
(proj.ad_groups || []).forEach(g => { if (g.key !== TWO_CLIP_GROUP && !g.clips) g.clips = []; });

// 2) แปลงแถวเดิม
const newKey = () => 'p' + Math.random().toString(36).slice(2, 10);
let nextId = (db._seq.submissions || 0) + 1;
const rows = db.submissions.filter(s => s.project_id === PID);
const created = [];
let split = 0;

rows.forEach(s => {
    if (s.person_key) return;                       // แปลงไปแล้ว ข้าม
    s.person_key = newKey();
    s.clip_no = 1;
    if (s.group_key !== TWO_CLIP_GROUP) { s.clip_name = null; return; }

    // กลุ่ม 2 คลิป: แถวเดิมเป็นคลิป EVENT แล้วสร้าง BOX SET เพิ่ม
    s.clip_name = NAMES[0];
    const full = Number(s.budget) || 0;
    const first = Math.round(full / 2);
    s.budget = first;                               // งบเป็นต่อคลิป — หารครึ่ง ยอดรวมต่อคนเท่าเดิม
    split++;

    created.push({
        ...s,
        id: nextId++,
        clip_no: 2,
        clip_name: NAMES[1],
        budget: full - first,
        // ข้อมูล "ตัวงาน" ของคลิปใหม่ต้องเริ่มจากศูนย์ ไม่ก็อปของคลิปแรกมา
        gencode: null, post_url: null, post_date: null, id_post: null,
        draft_link: null, draft_link2: null, draft_link3: null, draft_link4: null, draft_link5: null,
        feedback: null, feedback2: null, feedback3: null, feedback4: null, feedback5: null,
        approved: false, draft_status: null,
        ad_status: 'ยังไม่ยิง', ad_spend: 0, ad_reach: 0, ad_start: null, ad_end: null, ad_note: null,
        views: 0, likes: 0, comments: 0, saves: 0, shares: 0, perf_synced_at: null,
        team_note: null, agency_note: null,
        work_updated_at: null, draft_updated_at: null
    });
});

db.submissions.push(...created);
db._seq.submissions = nextId - 1;
fs.writeFileSync(P, JSON.stringify(db, null, 2));

console.log('ตั้งชื่อคลิปกลุ่ม "' + grp.concept + '":', grp.clips.join(' / '));
console.log('แถวที่แปลง:', rows.length, '| หารงบครึ่ง:', split, 'แถว | สร้างคลิป 2 เพิ่ม:', created.length, 'แถว');
