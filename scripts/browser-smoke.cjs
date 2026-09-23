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
        store.ads.list = async () => ({
            summary: { total_posts: 1, done_count: 1, pending_count: 0,
                total_spend: 1234.56, total_reach: 0, cpm: 0, by_brand: [] },
            rows: [{ sub_id: 17, account_name: 'Fixture KOL', platform: 'TikTok',
                brand: 'Beauterry', project_name: 'Fixture campaign',
                post_url: 'https://example.invalid/post', ad_status: 'ยังไม่ยิง',
                ad_status_shown: 'ยิงแล้ว', ad_spend: 1234.56, ad_reach: 0,
                spend_from_pfm: true }]
        });
        await page.setViewportSize({ width: 1200, height: 711 });
        await page.goto(base + '/ads');
        await page.locator('.ads-row').first().waitFor();
        assert.equal(await page.locator('.ads-row').count(), 1);
        assert.match(await page.locator('.summary-grid').innerText(), /ค่าแอดสะสม ฿1,234\.56/);
        assert.match(await page.locator('.summary-grid').innerText(), /PFM ยังไม่ส่ง Reach/);
        assert.match(await page.locator('.summary-grid').innerText(), /PFM ยังไม่ส่ง Engagement/);
        assert.doesNotMatch(await page.locator('.summary-grid').innerText(), /฿0/);
        await page.getByRole('button', { name: '↓ ดูรายการ' }).click();
        await page.waitForFunction(() => {
            const row = document.querySelector('.ads-row');
            return row && row.getBoundingClientRect().top >= 0
                && row.getBoundingClientRect().top < window.innerHeight;
        });
        await page.setViewportSize({ width: 390, height: 844 });

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
