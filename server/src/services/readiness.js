const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');
const schema = fs.readFileSync(path.join(__dirname, '../models/schema.sql'), 'utf8');
const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map(match => match[1]);

async function checkDatabase() {
    // A connection alone is insufficient: a fresh empty DB must fail readiness.
    const result = await pool.query({
        text: 'SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass(name) IS NULL',
        values: [tables], query_timeout: 5000
    });
    if (result.rows.length) throw new Error('Database schema is not ready');
}

module.exports = { checkDatabase };
