const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { chromium } = require('playwright');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-browser-test-'));
process.env.UPLOAD_DIR = temp;
const { pool } = require('../server/src/config/db');
pool.query = async () => { throw new Error('Browser test must not query a real database'); };
pool.connect = async () => { throw new Error('Browser test must not connect to a real database'); };
const bcrypt = require('../server/node_modules/bcryptjs');
const store = require('../server/src/store');
const password = crypto.randomBytes(16).toString('hex');
const user = { id: 42, username: 'browser-fixture', role: 'member', status: 'pending', is_active: true,
    password_hash: bcrypt.hashSync(password, 4), brands: [], agency_tokens: [] };
store.users.findByUsername = async name => name === user.username ? user : null;
store.users.findById = async id => Number(id) === user.id ? user : null;
const app = require('../server/src/app');

(async () => {
    let server, browser;
    try {
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/projects/123');
        await page.waitForURL('**/login');
        await page.getByRole('heading', { name: 'KOL Dashboard' }).waitFor();
        await page.getByRole('link', { name: 'ขอสิทธิ์เข้าใช้งาน' }).click();
        await page.waitForURL('**/register');
        await page.reload();
        assert.equal(new URL(page.url()).pathname, '/register');
        await page.goto(base + '/login');
        await page.getByPlaceholder('กรอก Username').fill(user.username);
        await page.getByPlaceholder('กรอก Password').fill('incorrect');
        await page.getByRole('button', { name: '➜ เข้าสู่ระบบ' }).click();
        await page.getByText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', { exact: false }).waitFor();
        await page.getByPlaceholder('กรอก Password').fill(password);
        await page.getByRole('button', { name: '➜ เข้าสู่ระบบ' }).click();
        await page.getByRole('heading', { name: 'รออนุมัติ' }).waitFor();
        await page.reload();
        await page.getByRole('heading', { name: 'รออนุมัติ' }).waitFor();

        // Promote the same fixture so the authenticated application shell can be
        // checked without connecting to production data. API panels may fail,
        // but the responsive navigation and layout must still remain usable.
        user.status = 'active';
        await page.reload();
        await page.getByRole('heading', { name: 'ภาพรวมแคมเปญ' }).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        const menuButton = page.getByRole('button', { name: 'เปิดเมนูหลัก' });
        await menuButton.click();
        await page.locator('#primary-sidebar').waitFor({ state: 'visible' });
        await page.locator('.sidebar-close').click();
        await page.locator('#primary-sidebar').waitFor({ state: 'hidden' });

        // Admin pages have dense filters and tables. Keep their primary controls
        // inside the mobile viewport so actions never become unreachable.
        user.role = 'admin';
        for (const route of ['/kols', '/budget', '/payments', '/users']) {
            await page.goto(base + route);
            await page.locator('h1').waitFor();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${route} overflows mobile viewport`);
        }
        const paymentTabsFit = await page.goto(base + '/payments').then(async () => {
            await page.locator('.pay-tabs').waitFor();
            return page.locator('.pay-tab').evaluateAll(items => items.every(item => item.getBoundingClientRect().right <= window.innerWidth));
        });
        assert.equal(paymentTabsFit, true, 'payment tabs must all be reachable without horizontal scrolling');
        await page.goto(base + '/users');
        await page.getByRole('button', { name: 'เพิ่มผู้ใช้' }).click();
        await page.locator('.modal').waitFor({ state: 'visible' });
        await page.getByRole('button', { name: 'ยกเลิก' }).click();

        // Ads data and its rows must remain visible even when paid Reach is unavailable.
        let savedPerf = null;
        store.projects.findByIdFull = async () => ({ id: 55, brand: 'Beauterry', campaign_type: 'kol' });
        const adFixtures = Array.from({ length: 93 }, (_, i) => ({ sub_id: 17 + i, id: 17 + i, account_name: `Fixture KOL ${i + 1}`, platform: 'TikTok',
                brand: 'Beauterry', project_name: 'Fixture campaign', project_id: 55,
                gencode: 'fixture-code', id_post: '7691273256392854792', views: 0,
                likes: 12, comments: 7, saves: 8, shares: 9,
                post_date: '2026-10-10', ad_end: '2026-10-06', stamp_at: 3000,
                post_url: 'https://example.invalid/post', ad_status: 'ยังไม่ยิง',
                ad_status_shown: 'ยิงแล้ว', ad_spend: 1234.56, ad_reach: 0,
                spend_from_pfm: true }));
        Object.assign(adFixtures[1], { platform:'Instagram', status_auto:false, post_date:'2026-10-03', ad_end:null, ad_spend:0, ad_has_spend:false, ad_status_shown:'ยังไม่ยิง' });
        Object.assign(adFixtures[2], { platform:'Instagram', status_auto:false, post_date:'2026-10-03', ad_end:'2026-10-05', ad_status:'ยิงแล้ว', ad_has_spend:true });
        store.ads.subContext = async id => ({submission:adFixtures.find(r => r.id === Number(id)),team_id:1,project_id:55,brand:'Beauterry'});
        store.submissions.update = async (id, projectId, payload) => {
            savedPerf = { id, projectId, payload };
            const row = adFixtures.find(r => r.id === Number(id));
            Object.assign(row, payload);
            row.ad_status_shown = row.ad_spend > 0 || row.ad_status === 'ยิงแล้ว' ? 'ยิงแล้ว' : 'ยังไม่ยิง';
            return {...row};
        };
        store.ads.list = async () => ({
            summary: { total_posts: 93, done_count: 1, pending_count: 92,
                total_spend: 1234.56, total_reach: 0, cpm: 0, by_brand: [] },
            rows: adFixtures.map(r => ({...r}))
        });
        await page.setViewportSize({ width: 1200, height: 711 });
        // Common ad blockers hide elements named ads-row. The data row must
        // remain visible even when that browser-side cosmetic rule is present.
        await page.goto(base + '/ads');
        await page.locator('.kol-track-entry').first().waitFor({ state: 'visible' });
        await page.addStyleTag({ content: '.ads-row, .ads-code, .ads-note { display: none !important; }' });
        assert.equal(await page.locator('.kol-track-entry').count(), 93);
        assert.ok(await page.locator('.kol-track-entry').first().evaluate(el => el.getBoundingClientRect().height > 0));
        const firstRow = page.locator('.kol-track-entry').first();
        assert.equal(await firstRow.locator('.kol-track-code').first().isVisible(), true);
        assert.equal(await firstRow.locator('.kol-track-note input').isVisible(), true);
        assert.match(await firstRow.locator('.ads-late').innerText(), /ต้องตรวจวันที่/);
        assert.match(await firstRow.locator('.ads-late').innerText(), /ก่อนลงโพสต์/);
        await firstRow.getByRole('button', { name: 'กรอกผลงาน', exact: true }).click();
        await page.locator('.modal').waitFor({ state: 'visible' });
        assert.equal(await page.getByRole('button', { name: 'ดึงจาก TikTok อัตโนมัติ' }).count(), 0);
        const perfInputs = page.locator('.modal input');
        assert.equal(await perfInputs.nth(1).inputValue(), '12');
        await perfInputs.nth(0).fill('500');
        await page.getByRole('button', { name: /บันทึก/ }).click();
        await page.locator('.modal').waitFor({ state: 'hidden' });
        assert.equal(Number(savedPerf.id), 17);
        assert.equal(Number(savedPerf.projectId), 55);
        assert.equal(savedPerf.payload.views, 500);
        assert.equal(savedPerf.payload.likes, 12);
        assert.equal(savedPerf.payload.comments, 7);
        assert.equal(savedPerf.payload.saves, 8);
        assert.equal(savedPerf.payload.shares, 9);
        assert.equal(savedPerf.payload.budget, undefined);
        assert.match(await page.locator('.summary-grid').innerText(), /ค่าแอดสะสม ฿1,234\.56/);
        assert.match(await page.locator('.summary-grid').innerText(), /ยังไม่มีข้อมูล Reach/);
        assert.match(await page.locator('.summary-grid').innerText(), /ยังไม่มีโพสต์ที่มี Engagement/);
        assert.doesNotMatch(await page.locator('.summary-grid').innerText(), /฿0/);
        await page.getByRole('button', { name: '↓ ดูรายการ' }).click();
        await page.waitForFunction(() => {
            const row = document.querySelector('.kol-track-entry');
            return row && row.getBoundingClientRect().top >= 0
                && row.getBoundingClientRect().top < window.innerHeight;
        });
        await page.setViewportSize({ width: 390, height: 844 });

        // A real UI save chooses a start date explicitly; cancelling has no write.
        const manualRow = page.locator('.kol-track-entry').nth(1);
        await manualRow.getByRole('button',{name:'แจ้งการเริ่มยิง',exact:true}).click();
        let confirmation = page.getByRole('dialog');
        await confirmation.getByLabel('การยืนยันของทีม').selectOption('yes');
        assert.equal(await confirmation.getByLabel('วันเริ่มยิงจริง').inputValue(),'');
        const priorWrite = savedPerf;
        await confirmation.getByRole('button',{name:'ยกเลิก',exact:true}).click();
        assert.equal(savedPerf,priorWrite);
        await manualRow.getByRole('button',{name:'แจ้งการเริ่มยิง',exact:true}).click();
        confirmation = page.getByRole('dialog');
        await confirmation.getByLabel('การยืนยันของทีม').selectOption('yes');
        await confirmation.getByLabel('วันเริ่มยิงจริง').fill('2026-10-04');
        assert.equal(await confirmation.evaluate(el => el.getBoundingClientRect().right <= window.innerWidth),true,'mobile confirmation must fit');
        await confirmation.getByRole('button',{name:'บันทึกการยืนยัน',exact:true}).click();
        await confirmation.waitFor({state:'hidden'});
        assert.equal(savedPerf.payload.ad_end,'2026-10-04');
        assert.equal(savedPerf.payload.ad_status,'ยิงแล้ว');
        await manualRow.getByText('ทีมยืนยันว่าเริ่มยิงแล้ว',{exact:true}).waitFor();
        // Cancelling a team's confirmation cannot erase paid evidence or its start date.
        const paidRow = page.locator('.kol-track-entry').nth(2);
        await paidRow.getByRole('button',{name:'แก้การยืนยัน',exact:true}).click();
        confirmation = page.getByRole('dialog');
        await confirmation.getByLabel('การยืนยันของทีม').selectOption('no');
        await confirmation.getByRole('button',{name:'บันทึกการยืนยัน',exact:true}).click();
        await confirmation.waitFor({state:'hidden'});
        assert.equal(savedPerf.payload.ad_status,'ยังไม่ยิง');
        assert.equal(savedPerf.payload.ad_end,'2026-10-05');
        await paidRow.getByText('มีค่าแอดแล้ว',{exact:true}).waitFor();
        await paidRow.getByText('ทีมยังไม่ยืนยัน',{exact:true}).waitFor();

        await page.goto(base + '/');
        await menuButton.click();
        await page.locator('#primary-sidebar').waitFor({ state: 'visible' });
        await page.getByRole('button', { name: 'Log out' }).click();
        await page.waitForURL('**/login');
        assert.deepEqual(errors, []);
        console.log('Browser smoke passed: deep link, registration, login states, responsive drawer, logout, mobile width; no JS errors.');
    } finally {
        if (browser) await browser.close();
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        await pool.end();
        fs.rmSync(temp, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
