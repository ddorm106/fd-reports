# DivisionScan + fdtraining.org — Project Context

Last updated: 2026-04-09

---

## Computer / Machine Map

| Machine | Location | User Profile | Primary Use |
|---------|----------|--------------|-------------|
| Home Acer N60-180 (Ryzen 9 7900, RTX 5070, 8TB D:) | Home | `ddorm` | Primary dev, Splashtop remote target, Xcode/iOS dev |
| CFD Station computer | Centerville FD | `Training` | Day work |
| PCFD Station computer | Peach County FD | unknown | Day work |
| UGREEN NAS (DXP2800) | PCFD network 192.168.50.211 | `ddorm` | Docker containers, PCFD web stack |
| Synology NAS | CFD network | unknown | CFD web stack |
| iPad (LiDAR) | CFD/PCFD | — | DivisionScan Pro LiDAR capture |
| iPhone 15 (ddorm) | — | — | DivisionScan Pro LiDAR capture |

**Key rule:** Always pull live worker code via MCP before editing. Never assume local copy matches deployed.

---

## Cloudflare Accounts

| Account | Used For |
|---------|----------|
| centfire6 | CFD + PCFD infrastructure |
| ddorm106 | Island Doctor, fd-reports GitHub Pages |

**Account ID (centfire6):** `98f5498df757dbf9be5f714985476d8a`
**CF API Token:** cfut_REDACTED — see Cloudflare API tokens
**Anthropic API Key:** sk-ant-REDACTED — see Cloudflare Worker secrets
**GitHub Token:** github_pat_REDACTED — regenerate from GitHub settings
**GitHub Repo:** `ddorm106/fd-reports` → GitHub Pages at `ddorm106.github.io/fd-reports`

---

## DivisionScan

**Live URL:** `divisionscan.org`
**Worker:** `divisionscan-capture` (centfire6)
**D1:** `preplan-captures` — `97cf4c4a-5391-432d-b98a-86f6e8fb89ee`
**R2:** `preplan-captures`

### Purpose
CubiCasa-style building capture PWA + iOS app. Firefighters capture building via photos/video (PWA) or LiDAR scan (iOS app). AI generates architectural floor plan SVG. SVG loads into page 11 of CFD pre-plan form.

### Capture Flow (PWA)
1. Open `divisionscan.org` on phone
2. Fill building info, take labeled room photos + exterior + walkthrough video
3. Photos upload in batches of 10
4. Videos upload via 50MB chunks (init → chunk → complete → R2 multipart)
5. Auto-triggers NAS processor after upload completes

### AI Processing Pipeline

**Step 1 — NAS Processor** (`divisionscan-processor` container, port 3850):
- Triggered via `POST /api/jobs/:id/process-video` on the worker → calls `https://processor.pcfdmembers.org`
- Downloads walkthrough video from R2
- ffmpeg extracts ~15 frames at 512px every few seconds
- Downloads interior room photos, resizes to 1024px
- Uploads resized versions to R2 as `captures/:jobId/resized/` and `captures/:jobId/resized_frames/`
- Patches job with `video_frame_keys` (resized frame paths)
- Calls worker's `POST /api/jobs/:id/process` to trigger Claude

**Step 2 — Claude Vision** (in Cloudflare Worker):
- Sends resized room photos + video frames to `claude-opus-4-6`
- Prompt asks for architectural layout JSON: rooms, walls, doors, windows with pixel coordinates
- Returns structured JSON stored in `ai_form_data_json.layout`
- `generateArchitecturalSVG()` converts JSON to SVG with rooms/walls/door arcs/window notches
- SVG stored at `captures/:jobId/floor_plan.svg` in R2
- Job status → `processed`

### NAS Processor
**Container:** `divisionscan-processor`
**Port:** 3850
**Public URL:** `https://processor.pcfdmembers.org` (Cloudflare Tunnel, Zero Trust dashboard)
**Files:** `/volume1/web/divisionscan-processor/` on UGREEN NAS
**Tunnel:** `27ec0f61-d378-41de-8b12-066165034534` (PCFD tunnel)
**R2 credentials:** Access Key `3216aa37dc41f7d45bfb5d0e617dc583` / Secret in deploy.sh

**To restart container on NAS:**
```bash
cd /volume1/web/divisionscan-processor && bash rebuild.sh
```

**Worker secrets required:**
- `ANTHROPIC_API_KEY` — Claude vision
- `PROCESSOR_URL` — `https://processor.pcfdmembers.org`
- `PROCESSOR_SECRET` — `ds-proc-secret-pcfd-2026`

### iOS App (DivisionScan Pro) — NEXT PRIORITY
**Existing app** needs RoomPlan API integration:
- iPad (LiDAR) + iPhone 15 (LiDAR) both supported
- RoomPlan API gives actual room dimensions in meters, wall/door/window positions
- Output: post job JSON directly to `divisionscan.org/api/upload` in same format as PWA
- Update tomorrow from home Acer (Xcode)

### D1 Schema (capture_jobs key columns)
```
id, building_name, building_address, department, status, photo_count,
photo_manifest_json, field_data_json, video_frame_keys,
walkthrough_r2_key, ai_floor_plan_r2_key, ai_form_data_json,
ai_confidence, ai_processed_at, captured_by, floors, latitude, longitude
```

### Job Statuses
`uploaded` → `processing` → `processed` | `failed`

### Key Endpoints
- `GET /` — PWA capture UI
- `POST /api/upload` — new job + photo batch
- `POST /api/jobs/:id/video-upload/init|chunk|complete` — chunked video upload
- `GET /api/jobs/:id` — job details including layout JSON
- `GET /api/jobs?limit=20` — list jobs
- `POST /api/jobs/:id/process` — trigger Claude AI (called by NAS processor)
- `POST /api/jobs/:id/process-video` — trigger NAS processor
- `GET /job/:id/add-videos` — resume page for video uploads
- `GET /api/media/:r2key` — serve R2 object

### Add-Videos Page
`https://divisionscan.org/job/:jobId/add-videos`
- 50MB chunks, XHR with progress, 3 auto-retries per chunk
- Tested up to 721MB walkthrough video

### Bridge to Pre-Plan Form
`https://fdtraining.org/preplan/from-capture/:jobId`
- Worker fetches job server-side, maps fields to pre-plan localStorage keys
- Nukes old localStorage, writes fresh data
- Redirects to `/cfd-preplan/page1-location.html`

---

## fdtraining.org

**Worker:** `fdtraining` (centfire6)
**D1:** `prefire-plans` — `5fe41926-7001-43d1-a945-79f054a15e2d`
**KV:** `DRAFTS` — `77ae16fbcd094944ad7d874c8a85471d`
**GitHub Pages:** `ddorm106/fd-reports` → `cfd-preplan/` folder

### Pre-Plan Form
12-page form. localStorage key: `preFirePlan`.

**Key pages:**
- `page1-location.html` — building name, address, GPS
- `page11-floor-plan.html` — DivisionScan AI floor plan import + fabric.js editor

### Page 11 Floor Plan Editor
**Load AI Capture button** → fetches `divisionscan.org/api/jobs?limit=20`
→ user selects job → loads layout JSON directly into fabric.js as typed objects

**Editable elements:**
- **Rooms** — select → properties panel: change label, type (updates color), notes → Apply
- **Walls** — select → thickness slider, color (exterior/interior/partition) → Apply
- **Doors** — select → type (single/double/rollup/sliding), swing direction
- **Windows** — select to move or delete
- All existing tools still work: draw wall, add box, symbols, undo/redo, zoom

**Fabric.js version:** 5.3.1
**Custom properties:** `obj.customType` ('room'|'wall'|'door'|'window'), `obj.customData`

---

## Test Capture — Old CFD Station

**Job ID:** `8d4ec145a98b41f6`
**Building:** Centerville Fire Department (Old Station), 101 Miller Court
**Photos:** 33 ✅
**Exterior video:** 6.9MB ✅
**Walkthrough video:** 721.6MB ✅
**Video frames:** 15 extracted at 512px ✅
**Floor plan:** Generated ✅ (19 rooms, 36 walls, 20 doors — AI estimate, not surveyed)
**Add-videos URL:** `https://divisionscan.org/job/8d4ec145a98b41f6/add-videos`
**Bridge URL:** `https://fdtraining.org/preplan/from-capture/8d4ec145a98b41f6`

---

## Next Priorities

1. **DivisionScan iOS app — RoomPlan LiDAR integration** (tomorrow, home Acer + Xcode)
   - Existing app, just add RoomPlan capture + post to divisionscan.org API
   - iPad + iPhone 15 both have LiDAR — will give accurate room dimensions
2. **eDispatch → preplan integration** — email parse → match business DB → auto-show preplan on map
3. **Fix pcfdmembers.org Pre-Incident Plans tab** — inline iframe, not external link
4. **Page 11 editor improvements** — snap-to-wall for doors, save edited layout back to R2

---

## PCFD Infrastructure (Docker on UGREEN NAS 192.168.50.211)

| Container | Port | URL |
|-----------|------|-----|
| pcfd-auth | 3000 | login + response log |
| pcfd-scheduler-api | 3001 | crew scheduler |
| pcfdmembers-proxy (nginx) | 8086 | pcfdmembers.org |
| cloudflared | — | Cloudflare Tunnel (Zero Trust managed) |
| pcfd-tactical | 3803 | tactical.pcfdmembers.org |
| pcfd-preplan | 3802 | preplans.pcfdmembers.org |
| pcfd-hrrr | 3810 | hrrr.pcfdmembers.org |
| pcfd-radio | 3201 | radio.pcfdmembers.org |
| faster-whisper | 8001 | transcription |
| training_sheet_api | 8080 | training sheets |
| pcfd-recorder | 3202 | recorder |
| divisionscan-processor | 3850 | processor.pcfdmembers.org |

**NAS SSH:** `ddorm@192.168.50.211` password in memory
**Tunnel:** Zero Trust managed — add hostnames via `one.dash.cloudflare.com` → Networks → Tunnels
**Cloudflared config:** `/etc/cloudflared/config.yml` is READ-ONLY (mounted :ro). All hostname changes go through Zero Trust dashboard.
**NAS Samba web share:** `[web]` → `/volume1/web` (must re-add after every NAS reboot)

---

## Key Rules

- **Always pull live worker code via MCP before editing**
- **No docker-compose on NAS** — use manual `docker run`
- **Cloudflare Worker body limit is 100MB** — videos must use chunked upload
- **Claude vision image limit** — resize to max 1024px before sending (NAS processor handles this)
- **Cloudflared tunnel config is Zero Trust managed** — use dashboard, not local config.yml
- **Two D1 databases:** `preplan-captures` (DivisionScan) vs `prefire-plans` (fdtraining/hydrants/businesses)
- **ComfyUI API:** `127.0.0.1:8000` (NOT 8188) on home Acer
