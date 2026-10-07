const { test } = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../server/src/config/db');
let missing = false, calls = [];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: {
    query: async q => {
        calls.push(q.text);
        if (q.text.includes('information_schema.columns')) return { rows: missing ? [] : [{}] };
        return { rows: [] };
    }
} } };
const { checkDatabase } = require('../server/src/services/readiness');
test('readiness refuses deployment without the performance evidence migration', async () => {
    missing = true;
    await assert.rejects(checkDatabase(), /Performance source migration is required/);
    missing = false;
    await checkDatabase();
    assert.equal(calls.filter(q => q.includes('information_schema.columns')).length, 2);
});
