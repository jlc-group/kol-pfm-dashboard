/**
 * คลังสินค้า / Target ที่ Admin เพิ่ม-ซ่อนเอง (หน้า Products & Targets · ผู้ใช้สั่ง 7 ต.ค. 2026)
 *
 * เก็บเฉพาะ "ส่วนต่าง" จากรายการตั้งต้นในโค้ด (client/src/data/products.js) — หน้าเว็บเอาไปรวมเอง (applyCatalogOverlay)
 *   catalog_products: สินค้าที่เพิ่มใหม่ หรือแถวซ่อนสินค้าตั้งต้น (สินค้าตั้งต้นใช้แค่ hidden — ชื่อ/แบรนด์ยึดตามโค้ด)
 *   catalog_targets : Target ที่เพิ่มให้สินค้า หรือแถวซ่อน Target ตั้งต้น
 * ไม่มีการลบ — เอาออก = ซ่อน (แคมเปญเก่าที่เลือกไปแล้วยังอ่านได้) · รหัสสินค้าแก้ไม่ได้ (แคมเปญอ้างด้วยรหัส)
 * ตารางยังไม่ถูกสร้าง (ยังไม่รัน setup-db): อ่าน = ว่าง (ready: false) · เขียน = error 503 บอกให้รัน setup-db
 */
const { query, withTransaction, asJson } = require('./_base');
const { renameTargetInGroups, previewRename, usesTarget } = require('../targetRename');

const noTable = e => !!e && e.code === '42P01';
const notReady = () => {
    const e = new Error('ยังไม่ได้สร้างตารางของหน้านี้ในฐานข้อมูล — ต้องรัน setup-db ก่อน ถึงจะบันทึกได้');
    e.status = 503;
    return e;
};
const intId = id => { const n = Number(id); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };
const PRODUCT_COLS = 'code, name, brand, hidden, created_by, updated_by, created_at, updated_at';
const TARGET_COLS = 'id, product_code, target, hidden, created_by, updated_by, created_at, updated_at';

// รหัสเรียงแบบตัวเลข (BTA4-08 ก่อน BTA4-10) — หน้าเว็บ / ฟีด PFM ใช้ลำดับเดียวกัน
const byCode = (a, b) => String(a.code).localeCompare(String(b.code), 'en', { numeric: true });

// เพิ่ม / ซ่อน / เอากลับ Target 1 ตัวของสินค้า 1 ตัว (ใน transaction ของคนเรียก) — ชื่อเดิม (ไม่สนตัวพิมพ์/ช่องว่าง) อัปเดตแถวเดิม
async function upsertTarget(client, code, target, hidden, byId, byName) {
    const r = await client.query(
        `INSERT INTO catalog_targets (product_code, target, hidden, created_by_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (product_code, (lower(btrim(target))))
         DO UPDATE SET hidden = EXCLUDED.hidden, updated_at = now(), updated_by = EXCLUDED.updated_by
         RETURNING ${TARGET_COLS}`,
        [code, target, hidden === true, intId(byId), byName || null]);
    return r.rows[0];
}

const catalog = {
    // ส่วนต่างทั้งหมด → { ready, products, targets }
    async overlay() {
        try {
            const products = (await query(`SELECT ${PRODUCT_COLS} FROM catalog_products`)).rows.sort(byCode);
            const targets = (await query(`SELECT ${TARGET_COLS} FROM catalog_targets ORDER BY id`)).rows;
            return { ready: true, products, targets };
        } catch (e) {
            if (noTable(e)) return { ready: false, products: [], targets: [] };
            throw e;
        }
    },

    // สินค้าที่ใช้คิดกลุ่มสี (ฟีด PFM) — รวมที่ซ่อนด้วย (คลิปเก่าที่รีวิวสีนั้นยังต้องกางครบ)
    // แถวที่ไม่มี code / brand เป็นข้อความ (เช่น ตัวจำลองในเทสต์คืนแถวอื่นมา) ทิ้งไป
    async familyProducts() {
        try {
            const rows = (await query('SELECT code, brand FROM catalog_products')).rows || [];
            return rows.filter(r => r && typeof r.code === 'string' && typeof r.brand === 'string').sort(byCode);
        } catch (e) {
            if (noTable(e)) return [];
            throw e;
        }
    },

    async findProduct(code) {
        try {
            return (await query(`SELECT ${PRODUCT_COLS} FROM catalog_products WHERE code = $1`, [code])).rows[0] || null;
        } catch (e) {
            if (noTable(e)) throw notReady();
            throw e;
        }
    },

    // เพิ่มสินค้าใหม่ + Target ที่เลือกมา (targets = [ชื่อ]) ใน transaction เดียว — สำเร็จทั้งชุดหรือไม่มีอะไรถูกบันทึก
    // รหัสซ้ำในตาราง = error 23505 (เส้น API ตอบ 409)
    async addProduct({ code, name, brand }, { byId, byName } = {}, targets = []) {
        try {
            return await withTransaction(async client => {
                const r = await client.query(
                    `INSERT INTO catalog_products (code, name, brand, hidden, created_by_id, created_by, updated_by)
                     VALUES ($1, $2, $3, false, $4, $5, $5) RETURNING ${PRODUCT_COLS}`,
                    [code, name, brand, intId(byId), byName || null]);
                for (const t of targets || []) await upsertTarget(client, code, t, false, byId, byName);
                return r.rows[0];
            });
        } catch (e) {
            if (noTable(e)) throw notReady();
            throw e;
        }
    },

    // ซ่อน / เอากลับ สินค้า (ตั้งต้นที่ยังไม่มีแถว = เพิ่มแถวใหม่โดยใช้ชื่อ/แบรนด์ที่ส่งมา) · แก้ชื่อได้เฉพาะสินค้าที่เพิ่มเอง (name ส่งมา)
    async setProduct(code, { hidden, name, brand }, { byId, byName } = {}) {
        try {
            return await withTransaction(async client => {
                const cur = (await client.query('SELECT code FROM catalog_products WHERE code = $1 FOR UPDATE', [code])).rows[0];
                if (!cur) {
                    // ยังไม่มีแถว FOR UPDATE ไม่ได้ล็อกอะไร — 2 คนกดซ่อนพร้อมกัน คนหลังชนรหัสซ้ำ → ON CONFLICT ให้กลายเป็นอัปเดตแทน error
                    const r = await client.query(
                        `INSERT INTO catalog_products (code, name, brand, hidden, created_by_id, created_by, updated_by)
                         VALUES ($1, $2, $3, $4, $5, $6, $6)
                         ON CONFLICT (code) DO UPDATE SET updated_at = now(), updated_by = EXCLUDED.updated_by${hidden !== undefined ? ', hidden = EXCLUDED.hidden' : ''}
                         RETURNING ${PRODUCT_COLS}`,
                        [code, name, brand, hidden === true, intId(byId), byName || null]);
                    return r.rows[0];
                }
                const sets = ['updated_at = now()', 'updated_by = $2'];
                const vals = [code, byName || null];
                if (hidden !== undefined) { vals.push(hidden === true); sets.push(`hidden = $${vals.length}`); }
                if (name !== undefined) { vals.push(name); sets.push(`name = $${vals.length}`); }
                const r = await client.query(`UPDATE catalog_products SET ${sets.join(', ')} WHERE code = $1 RETURNING ${PRODUCT_COLS}`, vals);
                return r.rows[0];
            });
        } catch (e) {
            if (noTable(e)) throw notReady();
            throw e;
        }
    },

    // แคมเปญที่ใช้ Target ชื่อนี้กับสินค้าที่เลือก (หน้าต่างแก้ไข Target บอกก่อนบันทึก) — อ่านอย่างเดียว · กติกาเดียวกับตอนแก้จริง
    // bundled = รหัสที่ไม่ได้เลือกแต่จะโดนด้วยเพราะอยู่ในชุดเดียวกับสินค้าที่เลือก
    async targetUsage(codes, from) {
        const rows = (await query(`SELECT id, name, brand, ad_groups FROM projects ORDER BY id`)).rows;
        const campaigns = [];
        const bundled = new Set();
        for (const r of rows) {
            const p = previewRename(r.ad_groups, codes, from);
            if (!p.changed) continue;
            campaigns.push({ id: r.id, name: r.name, brand: r.brand });
            p.bundled.forEach(c => bundled.add(c));
        }
        return { campaigns, bundled: [...bundled] };
    },

    // แก้ชื่อ Target ของสินค้าที่เลือก + แคมเปญเดิมที่ใช้ชื่อเดิมกับสินค้านั้น (ผู้ใช้สั่ง 21 ต.ค. 2026 "เปลี่ยนตามด้วย")
    // transaction เดียว: คลังกับแคมเปญเปลี่ยนพร้อมกัน หรือไม่เปลี่ยนอะไรเลย
    //   คลัง: ชื่อใหม่ต่างจากเดิมแค่ตัวพิมพ์/ช่องว่าง = แก้ตัวสะกดของแถวเดิม · ชื่ออื่น = ซ่อนชื่อเดิม + เพิ่มชื่อใหม่ (ชื่อใหม่มีอยู่แล้ว = รวมเป็นอันเดียว)
    //   แคมเปญ: store/targetRename.js — ล็อกแคมเปญที่โดนทีละแถวเรียง id ก่อนเขียน (กันชนกับคนที่กำลังบันทึกฟอร์มแคมเปญ)
    //   keep = รหัสในคลังที่ยังใช้ชื่อเดิมหลังแก้ (ใช้ตัดสินบล็อกแบบเก่าที่ Target ก้อนเดียวใช้กับหลายสินค้า)
    //   ข้อจำกัด: คนที่เปิดฟอร์มแคมเปญค้างไว้ก่อนแก้แล้วกดบันทึกทีหลัง จะเขียนชื่อเดิมกลับ (ฟอร์มแคมเปญไม่มีเช็คชนกัน)
    async renameTarget(codes, from, to, { byId, byName, keep } = {}) {
        const sameKey = from.trim().toLowerCase() === to.trim().toLowerCase();
        try {
            return await withTransaction(async client => {
                for (const code of codes) {
                    if (sameKey) {
                        await client.query(
                            `INSERT INTO catalog_targets (product_code, target, hidden, created_by_id, created_by, updated_by)
                             VALUES ($1, $2, false, $3, $4, $4)
                             ON CONFLICT (product_code, (lower(btrim(target))))
                             DO UPDATE SET target = EXCLUDED.target, hidden = false, updated_at = now(), updated_by = EXCLUDED.updated_by`,
                            [code, to, intId(byId), byName || null]);
                    } else {
                        await upsertTarget(client, code, from, true, byId, byName);
                        await upsertTarget(client, code, to, false, byId, byName);
                    }
                }
                const all = (await client.query(`SELECT id, ad_groups FROM projects ORDER BY id`)).rows;
                const ids = all.filter(r => usesTarget(r.ad_groups, codes, from)).map(r => r.id);
                const campaigns = [];
                for (const id of ids) {
                    const r = (await client.query(`SELECT id, name, brand, team_id, ad_groups FROM projects WHERE id = $1 FOR UPDATE`, [id])).rows[0];
                    if (!r) continue;
                    const res = renameTargetInGroups(r.ad_groups, codes, from, to, { keep });
                    if (!res.changed) continue;
                    await client.query(`UPDATE projects SET ad_groups = $1, updated_by = $2, updated_at = now() WHERE id = $3`,
                        [asJson(res.groups), intId(byId), r.id]);
                    campaigns.push({ id: r.id, name: r.name, brand: r.brand, team_id: r.team_id, places: res.places });
                }
                return { campaigns };
            });
        } catch (e) {
            if (noTable(e)) throw notReady();
            throw e;
        }
    },

    // ตั้ง Target ของสินค้า (เพิ่มใหม่ / ซ่อน / เอากลับ) — ชื่อเดิม (ไม่สนตัวพิมพ์/ช่องว่าง) อัปเดตแถวเดิม ไม่เพิ่มซ้ำ
    // codes = หลายสินค้าในครั้งเดียว (เพิ่ม Target ให้ทั้งแบรนด์) · ทำใน transaction เดียว สำเร็จทั้งชุดหรือไม่สำเร็จเลย
    async setTargets(codes, target, hidden, { byId, byName } = {}) {
        try {
            return await withTransaction(async client => {
                const out = [];
                for (const code of codes) out.push(await upsertTarget(client, code, target, hidden, byId, byName));
                return out;
            });
        } catch (e) {
            if (noTable(e)) throw notReady();
            throw e;
        }
    }
};

module.exports = { catalog };
