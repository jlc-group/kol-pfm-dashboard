const { withTransaction, updateRow, asJson } = require('./_base');
const { pfmSourceBrands } = require('../logic');
const { normalize, record } = require('../tiktokEvidence');

const tiktokEvidence = {
    async apply(rows) {
        const at = new Date().toISOString();
        const clean = rows.map(r => normalize(r, Date.parse(at)));
        if (new Set(clean.map(r => r.id_post)).size !== clean.length) {
            const e = new Error('ID Post ซ้ำในชุดข้อมูล'); e.status = 400; throw e;
        }
        const out = { stored: 0, stale: 0, not_found: [] };
        if (!clean.length) return out;
        return withTransaction(async client => {
            const locked = await client.query(`SELECT s.* FROM submissions s JOIN projects p ON p.id=s.project_id
                WHERE s.platform ILIKE 'tiktok%' AND btrim(s.id_post)=ANY($1::text[])
                AND lower(btrim(p.brand))=ANY($2::text[]) ORDER BY s.id FOR UPDATE OF s`,
            [clean.map(r => r.id_post), pfmSourceBrands('beauterry-pfm').map(v => v.trim().toLowerCase())]);
            for (const incoming of clean) {
                const matches = locked.rows.filter(s => String(s.id_post || '').trim() === incoming.id_post);
                if (!matches.length) { out.not_found.push(incoming.id_post); continue; }
                for (const s of matches) {
                    const state = record(s.perf_sources, incoming, at);
                    if (!state) { out.stale++; continue; }
                    // Deliberately update this column only. No budget/paid/status/stamp writes.
                    await updateRow('submissions', s.id, { perf_sources: asJson(state) }, client);
                    out.stored++;
                }
            }
            return out;
        });
    }
};
module.exports = { tiktokEvidence };
