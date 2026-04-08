# DivisionScan + fdtraining.org — Project Context

Last updated: 2026-04-08

---

## Computer / Machine Map

| Machine | Location | User Profile | Primary Use |
|---------|----------|--------------|-------------|
| Home Acer N60-180 (Ryzen 9 7900, RTX 5070, 8TB D:) | Home | `ddorm` | Primary dev — Splashtop remote target |
| CFD Station computer | Centerville FD | `Training` | Day work, remote into home Acer |
| PCFD Station computer | Peach County FD | unknown | Day work at Peach |
| UGREEN NAS (DXP2800) | PCFD network 192.168.50.211 | `ddorm` / SSH | Docker containers, PCFD web stack |
| Synology NAS | CFD network | unknown | CFD web stack |

**Key rule:** The fd-reports GitHub repo and all Cloudflare workers are the source of truth — not any local machine. Always pull live worker code via MCP or wrangler before editing.

---

## Cloudflare Accounts

| Account | Handle | Used For |
|---------|--------|----------|
| centfire6 | centfire6@gmail.com | CFD + PCFD infrastructure (DivisionScan, fdtraining, hydrants, etc.) |
| ddorm106 | ddorm106 | Island Doctor (ddormgames.org), fd-reports GitHub Pages |

**Account ID (centfire6):** `98f5498df757dbf9be5f714985476d8a`
**CF API Token:** `cfut_REDACTED-see-Cloudflare-API-tokens`
**Anthropic API Key:** `sk-ant-api03-REDACTED-see-Cloudflare-worker-secrets`
**GitHub Token:** `github_pat_REDACTED-regenerate-from-github-settings`
**GitHub Repo:** `ddorm106/fd-reports` → GitHub Pages at `ddorm106.github.io/fd-reports`

---

## DivisionScan

**Live URL:** `divisionscan.org`
**Worker:** `divisionscan-capture` (centfire6 account)
**D1:** `preplan-captures` — ID `97cf4c4a-5391-432d-b98a-86f6e8fb89ee`
**R2:** `preplan-captures`

### Purpose
CubiCasa-style building capture PWA. Firefighters walk through a building taking labeled room photos and video. AI generates an architectural floor plan SVG (walls, doors, windows). The SVG loads into page 11 of the CFD pre-plan form on fdtraining.org.

### Capture Flow
1. Firefighter opens `divisionscan.org` on phone
2. Fills building info, toggles, takes labeled room photos + exterior video + interior walkthrough video
3. Photos upload in batches of 10 via chunked upload
4. Videos upload via 50MB chunked upload (init → chunks → complete → R2 multipart assembly)
5. After upload: auto-triggers `/api/jobs/:id/process` on divisionscan-capture worker
6. Process endpoint sends photos + video frames to Claude vision → architectural SVG → stored in R2

### AI Processing Pipeline
- **Photos only (current):** Worker fetches interior room photos via URL source, sends to Claude claude-opus-4-6, gets back architectural JSON (rooms, walls, doors, windows), generates SVG
- **With video frames (pending NAS deploy):** NAS processor extracts frames via ffmpeg, uploads to R2 as `captures/:jobId/video_frames/frame_NNNN.jpg`, patches `video_frame_keys` on job, re-triggers process endpoint which includes frames in Claude call

### NAS Processor (PENDING — deploy when at PCFD tomorrow)
**Container:** `divisionscan-processor`
**Port:** 3850
**Files:** `C:\Users\Training\divisionscan-processor\` on CFD station computer (or copy from here)
**Deploy steps:**
1. Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token (Object Read & Write on `preplan-captures`) — get Access Key ID + Secret Access Key
2. Copy files to NAS: `/volume1/web/divisionscan-processor/`
3. SSH: `ssh ddorm@192.168.50.211`
4. Edit deploy.sh: fill in `R2_ACCESS_KEY` and `R2_SECRET_KEY`
5. Run: `bash /volume1/web/divisionscan-processor/deploy.sh`
6. Note the `API_SECRET` printed — set it as `PROCESSOR_SECRET` on divisionscan-capture Cloudflare Worker
7. Set `PROCESSOR_URL=http://192.168.50.211:3850` on divisionscan-capture worker
8. Add port 3850 to cloudflared tunnel config on NAS

### D1 Schema (capture_jobs key columns)
```
id, building_name, building_address, department, status, photo_count,
photo_manifest_json, field_data_json, video_frame_keys,
walkthrough_r2_key, ai_floor_plan_r2_key, ai_form_data_json,
ai_confidence, ai_processed_at, captured_by, floors, latitude, longitude
```

### Job Statuses
`uploaded` → `queued` → `processing` → `processed` | `failed`

### Add-Videos Page
`https://divisionscan.org/job/:jobId/add-videos`
- Uploads videos in 50MB chunks with XHR progress + 3 auto-retries per chunk
- Exterior video: small, single PUT is fine
- Walkthrough video: chunked (tested up to 721MB)

### Bridge to Pre-Plan Form
`https://fdtraining.org/preplan/from-capture/:jobId`
- fdtraining worker fetches job server-side (no CORS issues)
- Maps field data to pre-plan localStorage keys
- Nukes old localStorage, writes fresh data
- Redirects to `/cfd-preplan/page1-location.html`

---

## fdtraining.org

**Worker:** `fdtraining` (centfire6 account)
**D1:** `prefire-plans` — ID `5fe41926-7001-43d1-a945-79f054a15e2d`
**KV:** `DRAFTS` — ID `77ae16fbcd094944ad7d874c8a85471d`
**GitHub Pages source:** `ddorm106/fd-reports` → `cfd-preplan/` folder

### Pre-Plan Form
12-page form. localStorage key: `preFirePlan`. Pages served from GitHub Pages, proxied through fdtraining worker which injects toolbar HTML.

**Key pages:**
- `page1-location.html` — building name, address, GPS
- `page4-construction.html` — construction type, stories, roof
- `page5-fireprotect.html` — sprinkler, alarm, standpipe, knox box (currently 404 on GitHub Pages — needs fix)
- `page11-floor-plan.html` — DivisionScan AI floor plan import + fabric.js editor

### Load AI Capture (page11)
- Button calls `divisionscan.org/api/jobs?limit=20` (fixed 2026-04-08 — was `?status=processed` which excluded `uploaded` jobs)
- Selects job → calls `divisionscan.org/api/jobs/:id`
- If SVG exists: loads into fabric.js canvas
- If no SVG: opens blank canvas (fixed 2026-04-08 — was hard-failing)
- Also writes building data to localStorage

### Old DivisionScan iOS App Scans
Stored in `scans` table in `prefire-plans` D1. Separate from new capture system. `importFromServer()` function on page11 loads these. Keep both systems working.

---

## SVG Floor Plan Format

The architectural SVG contains:
- Room fills (colored rectangles by type with labels)
- Walls (thick lines, `class="wall"`, `data-idx`)
- Windows (triple-line notation, `class="window"`)
- Doors (line + arc swing, `class="door"`, rollup doors for apparatus bays)
- Side A label at bottom
- Header with building name, address, system info

**Intended:** fabric.js on page11 should make walls/doors/windows individually selectable and editable. **This editor upgrade is NOT yet built** — next priority after NAS processor deploy.

---

## Today's Test Capture (Old CFD Station)

**Job ID:** `8d4ec145a98b41f6`
**Building:** Centerville Fire Department (Old Station), 101 Miller Court
**Photos:** 33 ✅
**Exterior video:** 6.9MB ✅
**Walkthrough video:** 721.6MB ✅ (uploaded via chunked upload)
**Floor plan:** Generated ✅ (20 rooms, photos only — no video frames yet)
**Video frames:** Not yet extracted (needs NAS processor)
**Add-videos URL:** `https://divisionscan.org/job/8d4ec145a98b41f6/add-videos`
**Bridge URL:** `https://fdtraining.org/preplan/from-capture/8d4ec145a98b41f6`

---

## Next Priorities

1. **Deploy NAS processor at PCFD** (tomorrow) — extract video frames, re-process old station job with frames included
2. **Upgrade page11 fabric.js editor** — make walls/doors/windows individually editable (select, move, delete, add)
3. **Fix pages 5-12** of pre-plan form (currently 404 on GitHub Pages — they exist somewhere but not in the repo)
4. **eDispatch → preplan integration** — email parse → match business DB → auto-show preplan on map
5. **Fix pcfdmembers.org Pre-Incident Plans tab** — inline iframe, not external link

---

## PCFD Infrastructure (Docker on UGREEN NAS 192.168.50.211)

| Container | Port | URL |
|-----------|------|-----|
| pcfd-auth | 3000 | login + response log |
| pcfd-scheduler-api | 3001 | crew scheduler |
| pcfdmembers-proxy (nginx) | 8086 | pcfdmembers.org |
| cloudflared | — | Cloudflare Tunnel |
| pcfd-tactical | 3803 | tactical.pcfdmembers.org |
| pcfd-preplan | 3802 | preplans.pcfdmembers.org |
| pcfd-hrrr | 3810 | radar/HRRR |
| pcfd-radio | 3201 | radio |
| faster-whisper | 8001 | transcription |
| training_sheet_api | 8080 | training sheets |
| pcfd-recorder | 3202 | recorder |
| divisionscan-processor | 3850 | **PENDING DEPLOY** |

**NAS SSH:** `ddorm@192.168.50.211` password `Melissa106@`
**NAS Samba web share:** `[web]` → `/volume1/web` (must re-add after every NAS reboot)

---

## Key Rules

- **Always pull live worker code via MCP tool before editing** — never assume local copy matches deployed
- **No docker-compose on NAS** — use manual `docker run --env-file`
- **fd-reports GitHub Pages** is the static source for pre-plan form pages; fdtraining worker proxies and injects toolbar
- **Two separate D1 databases:** `preplan-captures` (DivisionScan new system) vs `prefire-plans` (fdtraining, old iOS app scans, hydrants, businesses)
- **Cloudflare Worker body limit is 100MB** — videos must use chunked upload
- **ComfyUI API runs at 127.0.0.1:8000** (NOT 8188) on home Acer
