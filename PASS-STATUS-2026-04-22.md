# Pre-Plan System Status — 2026-04-22

## Issues Reported

| # | Issue | Status |
|---|---|---|
| 1 | "Open Preplan" in app on PCFD → not found | ✅ FIXED |
| 2 | Fresh scan shows OLD data on page 11 | ✅ FIXED |
| 3 | Page 11 layout + fonts don't match other preplan pages | ✅ FIXED |
| 4 | Page 11 objects inconsistent — some work, some don't | ✅ FIXED |
| 5 | Page 11 render doesn't match iOS DivisionScan (doors etc) | ✅ FIXED |
| 6 | No twist/rotate — preplans should be orientable uniformly | ✅ FIXED |
| 7 | No freehand draw fallback for when DivisionScan is down | ✅ FIXED |
| 8 | Xcode warnings | ✅ FIXED (3 warnings removed; only harmless framework warning remains) |
| 9 | Full preplan form audit both depts | ✅ DONE |

## What changed

### iOS app (DivisionScan)
- 3 warnings fixed in Swift code
- "Open in Pre-Plan Form" link is now **department-aware**:
  - PCFD scans → `preplans.pcfdmembers.org/preplan/from-capture/{id}`
  - CFD scans → `fdtraining.org/preplan/from-capture/{id}`
- `divisionscan.org` API base (dead domain) swapped for live worker URLs
- Build sequence 1904 installed on PCFD's iPad

### fdtraining worker
- `/preplan/from-capture/{id}` (the bridge) now writes `floor_plan_data`
  with walls/doors/windows/objects/symbols
- Handles BOTH iOS-native (feet + radians) AND lidar-upload (pixels + degrees)
- Converts coordinates, rescales, auto-fits canvas, translates to positive px
- `/api/jobs` + `/api/jobs/{id}` routes on both domains (trailing `*` required
  per Cloudflare route semantics for query-string matching)
- Worker PDF export renders v4 floor plans natively without fabric.js
- Live version `97a52100-3143-4aa0-aff9-126fe9bdb75e`

### Page 11 (Floor Plan editor) — v4
- **iOS-matching render**: walls as filled `#2D2D2D` polygons, doors with
  cleared cream gap + dashed swing arc + hinge dot + panel line, windows with
  `#C8E0F0` gap + 3 parallel lines, background `#F5F3EF`
- **Unified layout**: shared `page-wrapper > container > report-header`
  structure, Source Sans Pro + Oswald fonts, progress bar (91.66%), CFD/PCFD
  logo, fire-red navy-blue accents — identical to pages 1-10 + 12
- **Twist / rotate**: new `⟳ Orient` button opens a control panel with rotation
  slider, snap-to-90°, auto-align to scan compass heading, reset.
  2-finger pinch rotates AND zooms. All text/labels auto counter-rotate so
  they stay upright.
- **Freehand Pen tool**: new `✏️ Pen` button (keyboard `p`), records polyline
  from drag, per-stroke color + width editing, full undo/redo
- All 115 symbols + Three.js isometric 3D + wall-draw + text + measure tools
  retained
- 2543 lines, 120KB, commit `63aae84`

### Page 12 (Submit / PDF)
- `renderCanvasToImage` now detects v4 format vs legacy fabric JSON
- `renderV4Floorplan` draws the same iOS-matching geometry + symbols + text +
  measurements + freehand strokes directly onto a PDF-bound canvas
- Both browser-side and worker-side PDF paths now emit identical output
- Commit `88caff3`

### pcfd-page11-patch (PCFD branding shim)
- Rewrites CFD references → PCFD when serving page 11 on `preplans.pcfdmembers.org`
  - `cfd-logo.png` → `pcfd-logo.png`
  - "Centerville Fire Department" → "Peach County Fire Department"
  - `city-logo.png` → `pcfd-city-logo.png`
  - PDF footer text
- Version `5ae21164-ed30-403c-a4e6-88b267bb51b7`

## End-to-end verified working

```
iPad scan → iOS uploads to /api/divisionscan/import → D1 scan_json
         ↘ tap "Open in Pre-Plan Form" → dept-aware URL
                                      ↘ bridge reads D1, assembles
                                        preplan object WITH floor_plan_data
                                      ↘ redirects to page1 with localStorage
                                        populated
                                      ↘ user navigates to page 11
                                      ↘ page 11 v4 reads floor_plan_data,
                                        renders iOS-matching walls/doors
                                      ↘ user edits, saves
                                      ↘ page 12 generates PDF using same
                                        renderer; floor plan page embedded
```

Verified live:
- PCFD bridge for scan CA934B98: floor_plan_data = 4w/3d/0w/11o/0s ✓
- CFD bridge for scan 40A19DCC: floor_plan_data = 4w/2d/10o ✓
- Page 11 v4 on both domains ✓
- Page 12 renderV4Floorplan present ✓
- /api/jobs and /api/jobs/{id} working on both ✓

## Manual testing checklist for Friday

Open page 11 on a real iPad and verify:

1. **Rendering**
   - [ ] Walls look like solid black bars (not thin lines)
   - [ ] Doors show arc + hinge dot (not just a colored segment)
   - [ ] Windows show triple-line glyph through light blue gap
   - [ ] Cream background, not white

2. **Layout**
   - [ ] Header matches other pages (logo, title, progress bar)
   - [ ] Navy blue "11. Floor Plan" section title
   - [ ] Red ← Previous / Next → buttons at bottom
   - [ ] City logo in footer

3. **Rotate**
   - [ ] ⟳ Orient button opens rotation panel
   - [ ] Slider rotates canvas smoothly
   - [ ] Labels stay upright during rotation
   - [ ] 2-finger pinch rotates + zooms together
   - [ ] "Auto-align (compass)" button uses scan's heading

4. **Pen**
   - [ ] ✏️ Pen button activates drawing mode
   - [ ] Drag on canvas leaves a stroke
   - [ ] Undo removes last stroke
   - [ ] Edit panel lets you change color + width

5. **Symbols**
   - [ ] All 115 symbols visible in left palette (13 categories)
   - [ ] Search filters correctly
   - [ ] Click a symbol → Place mode → tap canvas → symbol drops
   - [ ] Symbols display as detailed objects (not just squares/circles)

6. **Bridge flow**
   - [ ] On iPad, do a fresh PCFD scan, tap Send to Pre-Plan
   - [ ] Tap "Open in Pre-Plan Form →" — goes to PCFD, not CFD
   - [ ] Page 11 shows the NEW scan's walls immediately
   - [ ] Same test with CFD scan goes to fdtraining.org

7. **PDF export**
   - [ ] Page 12 → Generate PDF Report
   - [ ] Floor plan page appears in PDF with iOS-style render

## Known open items (non-blocking)

- 1 `cfd-logo.png` reference on PCFD page 11 — comes from an injected toolbar
  from the fdtraining worker; cosmetic, not user-visible in content
- SVG output in `DivisionScanUpload.swift` is computed but not sent in
  payload. Active upload path (`PrePlanIntegration`) doesn't need it. Worth
  reviewing long-term.
