export default {
    async fetch(request, env) {
        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // ─── SAVE PLAN ──────────────────────────────
            if (path === '/api/plans/save' && (request.method === 'POST')) {
                let body;
                try {
                    const text = await request.text();
                    body = JSON.parse(text);
                } catch {
                    return json({ error: 'Invalid JSON' }, 400, corsHeaders);
                }

                const { id, share_code, data, business_name } = body;
                const dataStr = typeof data === 'string' ? data : JSON.stringify(data || {});

                if (id) {
                    // Update existing plan
                    await env.DB.prepare(
                        `UPDATE plans SET data = ?, business_name = ?, updated_at = datetime('now') WHERE id = ?`
                    ).bind(dataStr, business_name || '', id).run();

                    // Fetch share_code for response
                    const row = await env.DB.prepare('SELECT share_code FROM plans WHERE id = ?').bind(id).first();
                    return json({ id, share_code: row?.share_code || share_code, updated: true }, 200, corsHeaders);
                }

                if (share_code) {
                    // Update by share_code (cross-device)
                    const existing = await env.DB.prepare('SELECT id FROM plans WHERE share_code = ?').bind(share_code).first();
                    if (existing) {
                        await env.DB.prepare(
                            `UPDATE plans SET data = ?, business_name = ?, updated_at = datetime('now') WHERE share_code = ?`
                        ).bind(dataStr, business_name || '', share_code).run();
                        return json({ id: existing.id, share_code, updated: true }, 200, corsHeaders);
                    }
                }

                // Create new plan
                const newId = crypto.randomUUID();
                const newCode = generateShareCode();

                await env.DB.prepare(
                    `INSERT INTO plans (id, share_code, data, business_name) VALUES (?, ?, ?, ?)`
                ).bind(newId, newCode, dataStr, business_name || '').run();

                return json({ id: newId, share_code: newCode, created: true }, 201, corsHeaders);
            }

            // ─── LOAD PLAN ──────────────────────────────
            if (path === '/api/plans/load' && request.method === 'GET') {
                const code = url.searchParams.get('code');
                const id = url.searchParams.get('id');

                let row;
                if (code) {
                    row = await env.DB.prepare('SELECT * FROM plans WHERE share_code = ?').bind(code).first();
                } else if (id) {
                    row = await env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first();
                }

                if (!row) {
                    return json({ error: 'Plan not found' }, 404, corsHeaders);
                }

                let parsedData;
                try {
                    parsedData = JSON.parse(row.data);
                } catch {
                    parsedData = row.data;
                }

                return json({
                    id: row.id,
                    share_code: row.share_code,
                    data: parsedData,
                    business_name: row.business_name,
                    updated_at: row.updated_at
                }, 200, corsHeaders);
            }

            // ─── LIST PLANS ─────────────────────────────
            if (path === '/api/plans/list' && request.method === 'GET') {
                const { results } = await env.DB.prepare(
                    'SELECT id, share_code, business_name, created_at, updated_at FROM plans ORDER BY updated_at DESC LIMIT 50'
                ).all();

                return json({ plans: results }, 200, corsHeaders);
            }

            // ─── DEFAULT ────────────────────────────────
            return json({
                service: 'Centerville FD Pre-Fire Plan API',
                endpoints: ['/api/plans/save', '/api/plans/load', '/api/plans/list']
            }, 200, corsHeaders);

        } catch (err) {
            return json({ error: err.message }, 500, corsHeaders);
        }
    }
};

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders }
    });
}

function generateShareCode() {
    // 6-char alphanumeric code (easy to type on phone)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O/0/1/I to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}
