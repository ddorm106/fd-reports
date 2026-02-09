# Pre-Fire Plan API Worker

Cloudflare Worker that provides cloud sync for pre-fire plan data.

## Deploy

1. Install wrangler: `npm install -g wrangler`
2. Login: `wrangler login`
3. Deploy: `wrangler deploy`

The D1 database `prefire-plans` is already created and the schema is set up.

Worker URL: https://prefire-api.centfire6.workers.dev

## API Endpoints

- `POST /api/plans/save` - Save/update a plan
- `GET /api/plans/load?code=XXXXXX` - Load plan by share code
- `GET /api/plans/load?id=uuid` - Load plan by ID
- `GET /api/plans/list` - List all plans
