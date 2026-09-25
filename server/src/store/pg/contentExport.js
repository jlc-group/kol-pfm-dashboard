const { query } = require('./_base');
const { resolveGroupProducts, resolveGroupTarget } = require('../logic');

const AD_STATUS = 'ยังไม่ยิง';

async function listCandidates({ brand, limit = 100, updatedSince = null } = {}) {
    const values = [brand, AD_STATUS, Math.max(1, Math.min(Number(limit) || 100, 501))];
    const where = [
        'p.brand = $1',
        's.ad_status = $2',
        "s.platform ILIKE 'tiktok%'",
        "NULLIF(BTRIM(s.id_post), '') IS NOT NULL",
        "BTRIM(s.id_post) ~ '^[0-9]+$'"
    ];

    if (updatedSince) {
        values.push(updatedSince);
        where.push(`COALESCE(s.updated_at, s.submitted_at) > $${values.length}`);
    }

    const result = await query(
        `WITH candidates AS (
             SELECT DISTINCT ON (BTRIM(s.id_post))
                    s.id AS submission_id,
                    BTRIM(s.id_post) AS id_post,
                    NULLIF(BTRIM(s.gencode), '') AS gencode,
                    p.brand,
                    s.platform,
                    s.status,
                    s.ad_status,
                    s.post_check,
                    s.post_url,
                    s.post_date,
                    s.product,
                    s.group_key,
                    p.ad_groups,
                    COALESCE(s.updated_at, s.submitted_at) AS updated_at
               FROM submissions s
               JOIN projects p ON p.id = s.project_id
              WHERE ${where.join(' AND ')}
              ORDER BY BTRIM(s.id_post), COALESCE(s.updated_at, s.submitted_at) DESC, s.id DESC
        )
        SELECT *
          FROM candidates
         ORDER BY updated_at, submission_id
         LIMIT $3`,
        values
    );

    return result.rows.map(row => {
        // Same Product/Target the /ads page shows for this clip.
        const grp = Array.isArray(row.ad_groups) ? row.ad_groups.find(g => g && g.key === row.group_key) : null;
        const target = resolveGroupTarget(grp, row.platform, row.product);
        return {
        submission_id: row.submission_id,
        id_post: String(row.id_post),
        gencode: row.gencode || null,
        brand: row.brand,
        platform: row.platform,
        status: row.status,
        ad_status: row.ad_status,
        post_check: row.post_check || null,
        post_url: row.post_url || null,
        post_date: row.post_date || null,
        product: row.product || (resolveGroupProducts(grp, row.platform).join(', ') || null),
        target: Array.isArray(target) ? target : (target ? [target] : []),
        updated_at: row.updated_at || null
        };
    });
}

module.exports = { contentExport: { listCandidates } };
