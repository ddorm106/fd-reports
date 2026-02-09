# Pre-Plan Fixes - Deployment Guide

## What's Fixed

### 1. Page 7 (Special Rescue) - `page7-special-rescue.html`
- ✅ REMOVED "Plan Conducted By", "Date", and "Additional Notes" section
- ✅ Kept: Confined Space, High Angle, Water Rescue, NFPA 704 Diamond
- ✅ Removed duplicate save/resume toolbar (worker injects it automatically)

### 2. Page 8 (Fire Flow) - `page8-fire-flow.html`
- ✅ RESTORED full tabbed interface with 3 tabs:
  - **Tab 1: ISO Needed Fire Flow (NFF) Calculator**
    - Full formula: NFF = C × O × [1 + (X + P)]
    - Construction classes 1-6 with F factors
    - Occupancy combustibility C-1 through C-5
    - Exposure/communication with 0.60 max
    - Wood shingle roof +500 GPM option
    - Auto-calculates duration (2-4 hours)
    - Auto-fills summary fields
  - **Tab 2: ISO Hydrant Flow Test Calculator**
    - Q = 29.83 × C × d² × √p formula
    - AFF = Q × [(S-20)/(S-R)]^0.54
    - Coefficient, diameter, outlet options
    - GPS capture, date, witness fields
  - **Tab 3: Hydrant Database & GPS Matching**
    - GPS coordinates auto-load from page 1
    - "Get GPS" button for current location
    - "Find Nearest" calls /api/hydrants/nearest API
    - Shows top 10 nearest hydrants with distance
    - One-click "Add" to populate hydrant table
- ✅ Hydrant table with auto-calculate Q and AFF per row
- ✅ Building/Area Fire Flow summary section

### 3. Page 12 (Review & Submit) - `page12-submit.html`
- ✅ ADDED "Plan Conducted By" section (moved from page 7)
  - Conducted By, Date, Reviewed By, Additional Notes
- ✅ ADDED PDF Generation button (opens print-friendly report)
  - Full formatted report with all sections
  - NFPA diamond rendering
  - Hydrant table
  - Plan information footer
  - Auto-triggers browser print dialog (Save as PDF)
- ✅ ADDED Print button
- ✅ ADDED Import from PDF link (goes to /preplan/import)
- ✅ Stats bar showing completion count
- ✅ Styled review sections with edit links

## How to Deploy

### Step 1: Upload fixed pages to GitHub
1. Go to https://github.com/ddorm106/fd-reports
2. Navigate to `cfd-preplan/` folder
3. Upload and replace these 3 files:
   - page7-special-rescue.html
   - page8-fire-flow.html
   - page12-submit.html

### Step 2: Fix hydrant admin header (optional)
In the Cloudflare worker, find:
```
<p>Peach County Fire Department &mdash; Flow Test Database Management</p>
```
Change to:
```
<p>Centerville Fire Department &mdash; Flow Test Database Management</p>
```

### Step 3: Test
- Page 7: Verify no "Plan Conducted By" section
- Page 8: Test NFF calculator, hydrant flow calculator, GPS nearest lookup
- Page 12: Test PDF generation, verify "Plan Conducted By" is here
- Hydrant admin: fdtraining.org/hydrants/admin

## DivisionScan Status
- Database has 1 scan (PCFD Station 3, 58 walls, 15 doors, 11 rooms)
- Viewer works at /preplans
- Scan renderer works at /preplans/scan/{id}
- If you're seeing "no scans" on a different test, let me know what URL
