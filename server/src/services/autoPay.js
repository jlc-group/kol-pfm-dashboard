/**
 * ทำจ่ายอัตโนมัติ (ผู้ใช้สั่ง 8 ต.ค. 2026)
 * งวดที่แนบใบแจ้งหนี้แล้ว + เลยวันทำจ่ายมาแล้ว 1 วัน → ย้ายเป็นจ่ายแล้วเอง (store.payBatches.autoPayDue)
 * รันตอนเปิด server · ทุก 10 นาที · และก่อนหน้าทำจ่ายโหลดข้อมูล (ensureFresh — เว้นอย่างน้อย 30 วิ ยกเว้นเพิ่งมีการแก้งวด · รอไม่เกิน 3 วิ)
 * ทุกรอบที่ย้ายลง Activity Log ในชื่อ "ระบบอัตโนมัติ"
 * เปิดเองเฉพาะ NODE_ENV=production — เครื่องอื่นต้องตั้ง AUTO_PAY_ENABLED=true · ตั้งค่าอื่น (false / no / ...) = ปิด ทุกที่
 */
const store = require('../store');
const { todayTH } = require('../store/logic');
const { AUTO_PAY_BY } = require('../store/pg/payBatches');

const FRESH_MS = 30 * 1000;
const INTERVAL_MS = 10 * 60 * 1000;
const WAIT_MS = 3000;    // หน้าทำจ่ายรอผลตรวจไม่เกินนี้ แล้วเปิดต่อ (ตรวจค้างก็ทำต่อเบื้องหลัง)

// สวิตช์: production เปิดเองไม่ต้องตั้งค่า · ที่อื่น (เครื่อง dev ต่อฐานจริง / เทสต์) ปิด เว้นตั้ง AUTO_PAY_ENABLED=true
// AUTO_PAY_ENABLED=false ปิดได้ทุกที่ — กัน backend ในเครื่องย้ายงวดจริงด้วยโค้ดที่ยังไม่ push
// ค่าที่ตั้งไว้แต่ไม่ใช่ true/1/on (เช่น no / disabled) = ปิด — สวิตช์ฉุกเฉินต้องปิดได้เสมอ
function enabled(env = process.env) {
    const v = String(env.AUTO_PAY_ENABLED || '').trim().toLowerCase();
    if (v) return v === 'true' || v === '1' || v === 'on';
    return env.NODE_ENV === 'production';
}
let running = null;      // promise ของรอบที่กำลังทำ — เรียกซ้อนได้ คืนรอบเดียวกัน
let lastAt = 0;          // เวลาเริ่มรอบล่าสุด (สำเร็จหรือไม่ก็ตาม — ล้มก็ไม่รัวซ้ำทุกคำขอ)
let lastRun = null;

const baht = n => Number(n || 0).toLocaleString('th-TH');

const STUCK_MS = 2 * 60 * 1000;   // รอบไหนค้างเกินนี้ (เช่น เน็ตหลุดเงียบ) ปล่อยให้รอบใหม่เริ่มได้ — ไม่ค้างถาวร
let runningAt = 0;

// ไม่ใช่ async — คำขอที่ซ้อนกันได้ promise ตัวเดียวกันจริง (async จะห่อเป็น promise ใหม่ทุกครั้ง)
function runOnce({ storeImpl = store, today = todayTH() } = {}) {
    if (running && Date.now() - runningAt < STUCK_MS) return running;
    lastAt = runningAt = Date.now();
    const me = (async () => {
        try {
            const r = await storeImpl.payBatches.autoPayDue(today);
            for (const b of r.batches) {
                try {
                    await storeImpl.activity.log({
                        user_id: null, user_name: AUTO_PAY_BY, action: 'auto_pay_batch',
                        project_id: null, project_name: 'รอบทำจ่าย',
                        summary: 'ย้ายเป็นจ่ายแล้วอัตโนมัติ (เลยวันทำจ่าย 1 วัน): ' + (b.agency || '-')
                            + ' วันที่ ' + b.pay_date + ' · ' + b.added + ' งวด ' + baht(b.amount) + ' บาท'
                            + (b.projects.length ? ' (' + b.projects.join(', ') + ')' : '')
                    });
                } catch { /* บันทึกประวัติพลาดไม่ขวางงานหลัก */ }
            }
            lastRun = { at: new Date().toISOString(), status: 'success', count: r.count, total: r.total, batches: r.batches.length };
            return r;
        } catch (error) {
            lastRun = { at: new Date().toISOString(), status: 'error', message: error.message };
            throw error;
        } finally {
            if (running === me) running = null;   // รอบที่ค้างแล้วเพิ่งจบ ไม่ไปล้างรอบใหม่ที่กำลังทำ
        }
    })();
    running = me;
    return me;
}

// ก่อนหน้าทำจ่ายอ่านข้อมูล — ให้งวดที่ถึงเวลาย้ายไปแล้วจริงตอนเปิดดู · ล้ม/ปิดสวิตช์/ช้าเกิน waitMs ก็ไม่ขวางการเปิดหน้า
async function ensureFresh({ storeImpl = store, logger = console, env = process.env, waitMs = WAIT_MS } = {}) {
    if (!enabled(env)) return null;
    if (!running && Date.now() - lastAt < FRESH_MS) return null;
    const work = runOnce({ storeImpl }).catch(error => { logger.error('Auto pay check failed: ' + error.message); return null; });
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), waitMs); });
    try { return await Promise.race([work, late]); }
    finally { clearTimeout(timer); }
}

// มีการแก้งวด / ใบแจ้งหนี้ / รอบ — ให้คำขออ่านครั้งถัดไปตรวจใหม่ทันที ไม่ต้องรอ 30 วิ
function markStale() { lastAt = 0; }

function startScheduler({ logger = console, intervalMs = INTERVAL_MS, env = process.env } = {}) {
    if (!enabled(env)) { logger.log('Auto pay is disabled (AUTO_PAY_ENABLED)'); return () => {}; }
    const execute = () => runOnce()
        .then(r => { if (r.count) logger.log(`Auto pay: ${r.count} installment(s) moved to paid in ${r.batches.length} batch(es)`); })
        .catch(error => logger.error('Auto pay check failed: ' + error.message));
    const first = setTimeout(execute, 15000), every = setInterval(execute, intervalMs);
    first.unref(); every.unref();
    return () => { clearTimeout(first); clearInterval(every); };
}

const getStatus = (env = process.env) => ({ enabled: enabled(env), running: !!running, last_run: lastRun });
const _reset = () => { running = null; lastAt = 0; runningAt = 0; lastRun = null; };
const _ageRunning = ms => { runningAt -= ms; };   // เทสต์: จำลองรอบที่ค้างนาน

module.exports = { enabled, runOnce, ensureFresh, markStale, startScheduler, getStatus, _reset, _ageRunning, FRESH_MS, INTERVAL_MS, WAIT_MS, STUCK_MS };
