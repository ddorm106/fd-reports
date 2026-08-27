/* fp2-app.js — the Floor Plan editor controller (v5).
 *
 * Owns the document, the tools, the panels and the save path. Geometry lives in
 * fp2-geom.js, the document shape in fp2-model.js, imports in fp2-io.js and
 * pixels in fp2-render.js — this file is the wiring between them and the DOM.
 *
 * Two outside contracts this file MUST keep:
 *   window.FP           — fp-markers.js reads state/draw/screenToData/SYMBOLS…
 *   window.__FP_OVERLAY — called at the tail of every frame (see fp2-render.js)
 * Both predate the rebuild and other code depends on them.
 */
(function () {
  'use strict';

  var G = window.FPGeom, M = window.FPModel, IO = window.FPIO;
  var SYMBOLS = window.FP_SYMBOLS;

  /* ------------------------------------------------------------ DOM refs */
  var $ = function (id) { return document.getElementById(id); };
  var wrap = $('canvas-wrap'), canvas = $('fp-canvas');
  var stage = $('stage'), emptyState = $('empty-state'), toastEl = $('toast');
  var editPanel = $('edit-panel'), textOverlay = $('text-input-overlay');

  /* --------------------------------------------------------- shared state */
  var state = {
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    view: { zoom: 1, panX: 0, panY: 0, rotation: 0, width: 800, height: 560 },
    tool: 'select',
    selected: null,
    drawing: null,
    snap: null,
    guides: [],
    hover: null,
    threeD: false,
    threeDView: { rotate: 45, tilt: 45, wallH: 9, showFurniture: true },
    visibleLayers: {},
    activeSymbolId: null,
    snapping: true,
    ortho: false,
    pendingCalibration: null
  };

  var doc = null;          // FPModel.Doc
  var renderer = null;
  var three = null;
  var saveTimer = null;

  /* ============================================================== helpers */

  function showToast(msg, kind) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'fp-toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.className = 'fp-toast'; }, 2600);
  }

  function uid(p) { return M.uid(p); }
  function draw() { if (renderer) renderer.draw(); }

  function fmtSqFt(n) {
    if (!n) return '0 sq ft';
    return Math.round(n).toLocaleString() + ' sq ft';
  }

  /* ============================================================== storage */

  /* A picture of the drawing, for the Book and the report.
   *
   * This goes to floor_plan_render. It used to go to floor_plan_image — the
   * SAME key the Worker's floor-sheet uploader writes — so saving the drawing
   * destroyed any plan sheet somebody had uploaded, and the uploader fought
   * back with a timer that rewrote it every 1.5s. Two different documents were
   * sharing one key and taking turns winning.
   *
   * floor_plan_image is still written when it does not hold an upload, because
   * older readers know that key and only that key. floor_plan_src_1 is set by
   * the uploader to say where the sheet came from. */
  function snapshot() {
    try {
      draw();
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch (e) { return null; }
  }

  function sheetIsUploaded() {
    try { return M.readPlan().floor_plan_src_1 === 'upload'; } catch (e) { return false; }
  }

  function saveToStorage(opts) {
    if (!doc) return;
    opts = opts || {};
    var extra = {};
    if (opts.withImage !== false) {
      var img = snapshot();
      if (img) {
        extra.floor_plan_render = img;
        if (!sheetIsUploaded()) extra.floor_plan_image = img;
      }
    }
    doc.save(extra);
    updateAreaBar();
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveToStorage({ withImage: false }); }, 700);
  }

  function commit(label) {
    updateCounts();
    saveToStorage({ withImage: false });
    draw();
    if (label) showToast(label, 'ok');
  }

  function ppPlanId() {
    try {
      var u = new URLSearchParams(location.search).get('plan_id');
      if (u) return u;
      var p = M.readPlan();
      return p._edit_id || '';
    } catch (e) { return ''; }
  }
  function ppDept() { return IO.dept(); }

  /* Push the drawing to the pre-plan record, same endpoint the v4 page used. */
  function ppSyncToRecord() {
    var pid = ppPlanId();
    if (!pid || !doc) return;
    try {
      fetch('/api/preplans/' + encodeURIComponent(pid) + '/floorplan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: (function () {
          var img = snapshot();
          var payload = {
            floor_plan_data: doc.serialize(),
            scan_id: (doc.data.scan_meta && doc.data.scan_meta.scan_id) || null,
            floor_plan_render: img
          };
          /* Same rule as local storage: never push the snapshot into the key
           * that is holding somebody's uploaded sheet. */
          if (!sheetIsUploaded()) payload.floor_plan_image = img;
          return JSON.stringify(payload);
        })()
      }).catch(function () {});
    } catch (e) {}
  }

  window.ppSaveBeforeLeaving = function () {
    try { saveToStorage(); } catch (e) {}
  };

  /* ========================================================= layers / UI */

  function initLayers() {
    var boxes = document.querySelectorAll('#layers input[data-layer]');
    Array.prototype.forEach.call(boxes, function (b) {
      var key = b.getAttribute('data-layer');
      var stored = doc && doc.data.layers ? doc.data.layers[key] : undefined;
      if (stored !== undefined) b.checked = !!stored;
      state.visibleLayers[key] = b.checked;
      b.addEventListener('change', function () {
        state.visibleLayers[key] = b.checked;
        if (doc) { doc.data.layers[key] = b.checked; saveSoon(); }
        draw();
      });
    });
  }

  function updateCounts() {
    if (!doc) return;
    var c = doc.counts();
    ['walls', 'doors', 'windows', 'objects', 'symbols', 'texts', 'measurements', 'freehand', 'zones']
      .forEach(function (k) {
        var el = $('ct-' + k);
        if (el) el.textContent = c[k] || 0;
      });
  }

  function updateAreaBar() {
    var bar = $('area-bar');
    if (!bar || !doc) return;
    var f = doc.floor();
    var floorArea = doc.floorAreaSqFt();
    var bldg = doc.buildingAreaSqFt();
    var zones = (f.zones || []).length;
    /* Primary first, then detail marked .sec — a narrow screen drops the detail
     * instead of clipping a word in half. */
    var parts = [];
    parts.push('<span><b>' + fmtSqFt(floorArea) + '</b> on ' + escapeHTML(f.name) + '</span>');
    if (doc.data.floors.length > 1) {
      parts.push('<span class="sep sec"></span><span class="sec">Building total <b>' + fmtSqFt(bldg) + '</b></span>');
    }
    parts.push('<span class="sep sec"></span><span class="sec">' + zones + ' area' + (zones === 1 ? '' : 's') + '</span>');
    parts.push('<span class="sep sec"></span><span class="sec">Scale ' +
      (Math.round((doc.data.scale_px_per_ft || 12) * 10) / 10) + ' px/ft</span>');
    if (floorArea > 0) {
      parts.push('<span class="sep"></span><button class="fp-tbtn sm" id="area-to-p8">Use for fire flow →</button>');
    }
    bar.innerHTML = parts.join('');
    var btn = $('area-to-p8');
    if (btn) btn.addEventListener('click', pushAreaToFireFlow);
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Page 8's ISO fire-flow calc needs the building's square footage, and until
   * now that number was typed in by hand while the drawing sitting next to it
   * already knew it. */
  function pushAreaToFireFlow() {
    if (!doc) return;
    var total = doc.buildingAreaSqFt();
    if (!total) { showToast('No areas measured yet', 'err'); return; }
    if (!confirm('Send ' + fmtSqFt(total) + ' to the Fire Flow page as the building area?')) return;
    var plan = M.readPlan();
    plan.building_area = String(Math.round(total));
    plan.total_square_feet = String(Math.round(total));
    localStorage.setItem('preFirePlan', JSON.stringify(plan));
    showToast('Sent ' + fmtSqFt(total) + ' to Fire Flow', 'ok');
  }

  function updateMeta() {
    var el = $('fp-meta');
    if (!el || !doc) return;
    var m = doc.data.scan_meta;
    var f = doc.floor();
    var bits = [];
    if (m && m.building_name) bits.push(escapeHTML(m.building_name));
    if (m && m.scan_date) {
      var dt = new Date(m.scan_date);
      if (!isNaN(dt)) bits.push('scanned ' + dt.toLocaleDateString());
    }
    bits.push(doc.data.floors.length + ' floor' + (doc.data.floors.length === 1 ? '' : 's'));
    bits.push('editing ' + escapeHTML(f.name));
    if (f.underlay) bits.push('tracing an underlay' + (f.underlay.calibrated ? ' (scaled)' : ' — not scaled yet'));
    el.textContent = bits.join(' · ');
    if (window.FPShell) window.FPShell.sync();
  }

  function showEmpty() { if (emptyState) emptyState.classList.remove('hidden'); }
  function hideEmpty() { if (emptyState) emptyState.classList.add('hidden'); }

  function refreshEmptyState() {
    if (!doc) { showEmpty(); return; }
    if (doc.isEmpty()) showEmpty(); else hideEmpty();
  }

  /* The hint strip tells you what the current tool does, including modifiers.
   * A tool whose keyboard modifiers are invisible is a tool nobody uses. */
  var HINTS = {
    select: 'Drag to move. Drag a wall end to reshape it. <kbd>Del</kbd> removes the selection.',
    pan: 'Drag to pan. Pinch or scroll to zoom.',
    wall: 'Drag out one wall. Hold <kbd>Shift</kbd> for straight. Type a length after drawing to set it exactly.',
    chain: 'Tap corner to corner around the building. Tap the green dot to close it. <kbd>Enter</kbd> finishes, <kbd>Esc</kbd> cancels, <kbd>Backspace</kbd> undoes a corner.',
    room: 'Drag out a rectangle — it becomes four walls.',
    door: 'Tap a wall to drop a door into it. It stays in that wall when the wall moves.',
    window: 'Tap a wall to drop a window into it.',
    zone: 'Tap inside any closed room to measure and name it. Areas need the walls to actually meet — use Weld corners if a room will not take.',
    place: 'Tap to place the selected symbol.',
    text: 'Tap where the label goes.',
    measure: 'Drag between two points to measure.',
    pen: 'Draw freehand.',
    delete: 'Tap anything to delete it.',
    calibrate: 'Drag along something you know the real length of, then type that length.'
  };

  function updateHint() {
    var el = $('hint-bar');
    if (el) el.innerHTML = HINTS[state.tool] || '';
  }

  /* ============================================================== floors */

  function renderFloors() {
    var host = $('floor-tabs');
    if (!host || !doc) return;
    host.innerHTML = '';
    doc.data.floors.forEach(function (f) {
      var btn = document.createElement('button');
      var counts = ['walls', 'zones', 'symbols'].reduce(function (t, k) { return t + (f[k] || []).length; }, 0);
      btn.className = 'fp-ftab' + (f.id === doc.data.active_floor ? ' active' : '') + (counts ? ' has-content' : '');
      var area = (f.zones || []).reduce(function (t, z) { return t + (z.exclude_from_total ? 0 : (z.area_sqft || 0)); }, 0);
      btn.innerHTML = '<span class="dot"></span>' + escapeHTML(f.name) +
        (area ? ' <span class="area">' + Math.round(area).toLocaleString() + ' sf</span>' : '');
      btn.addEventListener('click', function () {
        if (f.id === doc.data.active_floor) return;
        doc.setActiveFloor(f.id);
        state.selected = null;
        hideEditPanel();
        syncUnderlayPanel();
        renderFloors();
        updateCounts(); updateAreaBar(); updateMeta(); refreshEmptyState();
        renderer.fitToView();
        saveSoon();
      });
      host.appendChild(btn);
    });
    if (window.FPShell) window.FPShell.sync();
  }

  function initFloorButtons() {
    $('btn-floor-add').addEventListener('click', function () {
      var name = prompt('Name for the new floor:', 'Floor ' + (doc.data.floors.length + 1));
      if (name === null) return;
      doc.pushUndo();
      doc.addFloor(name.trim() || ('Floor ' + (doc.data.floors.length + 1)));
      state.selected = null;
      renderFloors(); updateCounts(); updateAreaBar(); updateMeta(); refreshEmptyState();
      commit('Floor added');
      renderer.fitToView();
    });
    $('btn-floor-rename').addEventListener('click', function () {
      var f = doc.floor();
      var name = prompt('Rename this floor:', f.name);
      if (name === null) return;
      doc.pushUndo();
      f.name = name.trim() || f.name;
      renderFloors(); updateMeta(); commit('Renamed');
    });
    $('btn-floor-dup').addEventListener('click', function () {
      doc.pushUndo();
      doc.duplicateFloor(doc.data.active_floor);
      renderFloors(); updateCounts(); updateAreaBar(); updateMeta();
      commit('Floor duplicated');
    });
    $('btn-floor-del').addEventListener('click', function () {
      if (doc.data.floors.length < 2) { showToast('A plan needs at least one floor', 'err'); return; }
      var f = doc.floor();
      if (!confirm('Delete "' + f.name + '" and everything drawn on it?')) return;
      doc.pushUndo();
      doc.removeFloor(f.id);
      state.selected = null;
      renderFloors(); updateCounts(); updateAreaBar(); updateMeta(); refreshEmptyState();
      commit('Floor deleted');
      renderer.fitToView();
    });
  }

  /* ============================================================== palette */

  var activeCategoryId = null, searchQuery = '';

  function buildPalette() {
    var tabs = $('cat-tabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    var all = document.createElement('button');
    all.className = 'fp-cat-tab active';
    all.textContent = 'All';
    all.onclick = function () { activeCategoryId = null; renderPaletteBody(); refreshTabActive(); };
    tabs.appendChild(all);
    SYMBOLS.CATEGORIES.forEach(function (cat) {
      var t = document.createElement('button');
      t.className = 'fp-cat-tab';
      t.textContent = cat.label;
      t.dataset.cat = cat.id;
      t.onclick = function () { activeCategoryId = cat.id; renderPaletteBody(); refreshTabActive(); };
      tabs.appendChild(t);
    });
    renderPaletteBody();
  }

  function refreshTabActive() {
    Array.prototype.forEach.call(document.querySelectorAll('#cat-tabs .fp-cat-tab'), function (t) {
      var isAll = !t.dataset.cat;
      t.classList.toggle('active', (activeCategoryId === null && isAll) || t.dataset.cat === activeCategoryId);
    });
  }

  function renderPaletteBody() {
    var body = $('sym-body');
    if (!body) return;
    body.innerHTML = '';
    var q = searchQuery.trim().toLowerCase();
    SYMBOLS.all.forEach(function (def) {
      if (activeCategoryId && def.cat !== activeCategoryId) return;
      if (q && String(def.label || '').toLowerCase().indexOf(q) < 0 &&
          String(def.id || '').toLowerCase().indexOf(q) < 0) return;
      var cell = document.createElement('button');
      cell.className = 'fp-sym-chip' + (state.activeSymbolId === def.id ? ' active' : '');
      cell.title = def.label || def.id;
      var c = document.createElement('canvas');
      var S = 40;
      c.width = S * state.dpr; c.height = S * state.dpr;
      c.style.width = S + 'px'; c.style.height = S + 'px';
      var cx = c.getContext('2d');
      cx.scale(state.dpr, state.dpr);
      cx.translate(S / 2, S / 2);
      var sc = (S - 8) / Math.max(def.w, def.h);
      cx.scale(sc, sc);
      try { def.draw(cx, def.w, def.h); } catch (e) {}
      cell.appendChild(c);
      var lab = document.createElement('span');
      lab.textContent = def.label || def.id;
      cell.appendChild(lab);
      cell.onclick = function () { selectSymbol(def.id); };
      body.appendChild(cell);
    });
  }

  function selectSymbol(id, spec) {
    state.activeSymbolId = id;
    /* Cleared unless a spec is handed in, or a built-in picked after a
     * generated one would silently carry the generated artwork. */
    state.activeSymbolSpec = spec || null;
    if (!spec && window.FP_SYMBOLS && FP_SYMBOLS.byId[id] && FP_SYMBOLS.byId[id].spec) {
      state.activeSymbolSpec = FP_SYMBOLS.byId[id].spec;
    }
    /* fp-markers.js highlights its own palette off state.selectedSymbolId.
     * Keeping both names in step costs one line and stops the fire-service
     * palette showing nothing selected after a pick. */
    state.selectedSymbolId = id;
    var placeBtn = document.querySelector('[data-tool="place"]');
    if (placeBtn) placeBtn.disabled = !id;
    setTool('place');
    renderPaletteBody();
  }



  /* The catalog's door and window symbols predate the Door and Window tools.
   * Placing a picture of a door beside a real one that sits IN the wall, moves
   * with it and prints its swing is a trap — two things that look the same and
   * are not. They come out of the palettes.
   *
   * They stay in byId, because plans already exist that placed them and a
   * missing definition would draw a bare pin where a door used to be. Palettes
   * are built from .all; drawing goes through .byId. */
  var SUPERSEDED = ['door-l', 'door-r', 'door-d', 'door-roll', 'door-slide',
                    'door-pocket', 'door-bifold', 'door-revolve',
                    'win-3', 'win-4', 'win-6'];

  function retireSupersededSymbols() {
    if (!SYMBOLS || !SYMBOLS.all) return 0;
    var drop = {}, n = 0;
    SUPERSEDED.forEach(function (id) { drop[id] = 1; });
    for (var i = SYMBOLS.all.length - 1; i >= 0; i--) {
      if (drop[SYMBOLS.all[i].id]) { SYMBOLS.all.splice(i, 1); n++; }
    }
    return n;
  }

  /* Drafted line-art by default, matching the doors and windows the editor
   * draws. Stored on the plan rather than the device, so the drawing and its
   * printed copy always agree. */
  function symbolStyle() {
    return (doc && doc.data.sheet && doc.data.sheet.symbol_style) || 'draft';
  }

  function applySymbolStyle() {
    if (!window.FPDraft || !SYMBOLS) return;
    if (symbolStyle() === 'draft') FPDraft.applyTo(SYMBOLS);
    else FPDraft.revert(SYMBOLS);
  }

  function toggleSymbolStyle() {
    if (!doc) return symbolStyle();
    doc.data.sheet = doc.data.sheet || {};
    doc.data.sheet.symbol_style = (symbolStyle() === 'draft') ? 'colour' : 'draft';
    applySymbolStyle();
    saveSoon();
    draw();
    showToast(symbolStyle() === 'draft' ? 'Drafted symbols' : 'Original coloured symbols', 'ok');
    return symbolStyle();
  }

  /* ===================================================== symbol generator */

  /* Put saved custom symbols into the catalog before anything renders a
   * palette — fp-markers.js builds its own from FP_SYMBOLS at boot, so late
   * additions would not appear until the next load. */
  function registerCustomSymbols() {
    if (!window.FPSymGen || !SYMBOLS) return 0;
    var lib = FPSymGen.loadLibrary(), added = 0;
    lib.forEach(function (entry) {
      if (!entry || !entry.spec || SYMBOLS.byId[entry.id]) return;
      var def = FPSymGen.defFromSpec(entry.spec, entry.id);
      SYMBOLS.byId[entry.id] = def;
      SYMBOLS.all.push(def);
      added++;
    });
    return added;
  }

  function initSymbolGenerator() {
    var toggle = $('sg-toggle'), body = $('sg-body'), input = $('sg-input');
    if (!toggle || !window.FPSymGen) return;
    var pending = null;

    function status(msg, isErr) {
      var el = $('sg-status');
      el.textContent = msg || '';
      el.className = 'fpx-symgen-status' + (isErr ? ' err' : '');
    }
    function showPreview(spec) {
      pending = spec;
      var host = $('sg-thumb');
      host.innerHTML = '';
      host.appendChild(FPSymGen.thumbnail(spec, 52, state.dpr));
      $('sg-name').textContent = spec.label || 'Custom symbol';
      $('sg-preview').classList.remove('hidden');
    }
    function hidePreview() { pending = null; $('sg-preview').classList.add('hidden'); }

    toggle.addEventListener('click', function () {
      body.classList.toggle('hidden');
      if (!body.classList.contains('hidden')) input.focus();
    });
    $('sg-cancel').addEventListener('click', function () {
      body.classList.add('hidden'); hidePreview(); status('');
    });

    function run() {
      var desc = (input.value || '').trim();
      if (!desc) { status('Describe what you want first.', true); return; }
      hidePreview();
      status('Drawing “' + desc + '”…');
      $('sg-go').disabled = true;
      FPSymGen.generate(desc).then(function (spec) {
        status('');
        showPreview(spec);
      }).catch(function (e) {
        status(e.message || 'Could not make that symbol.', true);
      }).then(function () { $('sg-go').disabled = false; });
    }
    $('sg-go').addEventListener('click', run);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    $('sg-retry').addEventListener('click', run);

    $('sg-keep').addEventListener('click', function () {
      if (!pending) return;
      var entry = FPSymGen.saveToLibrary(pending);
      var def = FPSymGen.defFromSpec(entry.spec, entry.id);
      SYMBOLS.byId[def.id] = def;
      SYMBOLS.all.push(def);
      selectSymbol(def.id, entry.spec);
      hidePreview();
      status('');
      body.classList.add('hidden');
      if (window.FPShell) FPShell.closeDrawer();
      showToast('Tap the plan to place “' + def.label + '”', 'ok');
    });
  }

  /* ================================================================ tools */

  function setTool(t) {
    /* Leaving a multi-click tool mid-shape must not strand the shape. */
    if (state.drawing && (state.drawing.kind === 'chain' || state.drawing.kind === 'zone')) finishChain(false);
    state.tool = t;
    state.drawing = null;
    state.snap = null;
    state.guides = [];
    Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tool') === t);
    });
    if (wrap) {
      wrap.style.cursor = (t === 'pan') ? 'grab'
        : (t === 'select') ? 'default'
        : (t === 'delete') ? 'not-allowed' : 'crosshair';
    }
    updateHint();
    draw();
  }

  /* Snap the raw pointer position using the current modifiers. */
  function snapped(pt, opts) {
    opts = opts || {};
    var f = doc.floor();
    if (!state.snapping) { state.snap = null; state.guides = []; return pt; }
    var tolPx = 12 / state.view.zoom;
    var res = G.snapPoint(pt.x, pt.y, {
      walls: f.walls || [],
      tol: tolPx,
      alignTol: 8 / state.view.zoom,
      gridSize: (doc.data.scale_px_per_ft || 12),
      useGrid: !!state.visibleLayers.grid,
      useAlign: opts.align !== false,
      excludeWallId: opts.excludeWallId
    });
    state.snap = res.snap ? res : null;
    state.guides = res.guides || [];
    return { x: res.x, y: res.y };
  }

  /* ------------------------------------------------------- chain drawing */

  function finishChain(close) {
    var d = state.drawing;
    if (!d || (d.kind !== 'chain' && d.kind !== 'zone')) { state.drawing = null; return; }
    var pts = d.points || [];

    if (d.kind === 'zone') {
      if (pts.length >= 3) {
        doc.pushUndo();
        var z = doc.addZone(pts.map(function (p) { return { x: p.x, y: p.y }; }), {});
        state.drawing = null;
        selectByKind('zone', doc.list('zones').length - 1);
        commit('Area drawn — ' + fmtSqFt(z.area_sqft));
        renderFloors();
      } else {
        state.drawing = null;
        draw();
      }
      return;
    }

    if (pts.length >= 2) {
      doc.pushUndo();
      var walls = doc.list('walls');
      for (var i = 1; i < pts.length; i++) {
        walls.push({ id: uid('w_'), x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y });
      }
      if (close && pts.length >= 3) {
        walls.push({ id: uid('w_'), x1: pts[pts.length - 1].x, y1: pts[pts.length - 1].y, x2: pts[0].x, y2: pts[0].y });
      }
      state.drawing = null;
      hideEmpty();
      commit(close ? 'Outline closed — tap inside it with the Zone tool to measure it' : 'Walls added');
    } else {
      state.drawing = null;
      draw();
    }
  }

  /* Typed dimension: re-place the last corner at an exact distance while
   * keeping the direction that was drawn. */
  function askLastSegmentLength() {
    var d = state.drawing;
    var scale = doc.data.scale_px_per_ft || 12;
    if (d && d.kind === 'chain' && d.points && d.points.length >= 2) {
      var pts = d.points;
      var a = pts[pts.length - 2], b = pts[pts.length - 1];
      var cur = G.pxToFeet(G.dist(a.x, a.y, b.x, b.y), scale);
      var val = prompt('Length of that wall in feet:', (Math.round(cur * 100) / 100).toString());
      if (val === null) return;
      var ft = parseFloat(val);
      if (!(ft > 0)) { showToast('That is not a length', 'err'); return; }
      var np = G.pointAtDistance(a.x, a.y, b.x, b.y, ft * scale);
      pts[pts.length - 1] = np;
      draw();
      return;
    }
    if (state.selected && state.selected.kind === 'wall') {
      var w = doc.list('walls')[state.selected.index];
      if (!w) return;
      var curLen = G.pxToFeet(G.dist(w.x1, w.y1, w.x2, w.y2), scale);
      var v2 = prompt('Length of this wall in feet:', (Math.round(curLen * 100) / 100).toString());
      if (v2 === null) return;
      var ft2 = parseFloat(v2);
      if (!(ft2 > 0)) { showToast('That is not a length', 'err'); return; }
      doc.pushUndo();
      var np2 = G.pointAtDistance(w.x1, w.y1, w.x2, w.y2, ft2 * scale);
      w.x2 = np2.x; w.y2 = np2.y;
      commit('Wall set to ' + G.formatFeet(ft2));
    }
  }

  /* ----------------------------------------------------------- selection */

  function selectByKind(kind, index) {
    state.selected = { kind: kind, index: index };
    if (kind === 'zone') showZonePanel();
    else { hideZonePanel(); showEditPanel(state.selected); }
    draw();
  }

  function deleteSelected() {
    if (!state.selected || !doc) return;
    var k = state.selected.kind;
    var arr = doc.list(k);
    if (!arr || !arr[state.selected.index]) return;
    doc.pushUndo();
    var removed = arr.splice(state.selected.index, 1)[0];
    /* A wall's openings would otherwise become orphans pointing at nothing. */
    if (k === 'wall' && removed && removed.id) {
      ['doors', 'windows'].forEach(function (lk) {
        var list = doc.list(lk);
        for (var i = list.length - 1; i >= 0; i--) {
          if (list[i].wallId === removed.id) list.splice(i, 1);
        }
      });
    }
    state.selected = null;
    hideEditPanel();
    hideZonePanel();
    refreshEmptyState();
    renderFloors();
    commit('Deleted');
  }

  /* ============================================================= pointer */

  var pointers = new Map();
  var drag = null;
  var lastPinch = 0;

  /* ---------------------------------------------------------- the pencil
   *
   * Drawing with an Apple Pencil puts your PALM on the glass too. The old code
   * counted every contact, so palm + pencil looked like two pointers, which
   * looked like a pinch — and the pinch branch cancels whatever is being drawn.
   * The pencil therefore did nothing at all.
   *
   * So: a pen contact wins. Touches are ignored while it is down, and a pinch
   * needs two FINGERS, never a finger and a pencil. */
  function penIsDown() {
    var yes = false;
    pointers.forEach(function (p) { if (p.pointerType === 'pen') yes = true; });
    return yes;
  }

  function touchCount() {
    var n = 0;
    pointers.forEach(function (p) { if (p.pointerType === 'touch') n++; });
    return n;
  }

  /* A palm usually lands BEFORE the tip does, so when the pen arrives any touch
   * already registered is discarded along with whatever drag it began. */
  function dropTouchContacts() {
    var ids = [];
    pointers.forEach(function (p, id) { if (p.pointerType === 'touch') ids.push(id); });
    ids.forEach(function (id) { pointers.delete(id); });
    if (!ids.length) return 0;

    if (drag && drag.mode === 'pan') drag = null;

    /* A palm lands a moment before the tip, and with a multi-tap tool it has
     * already dropped a corner where the heel of your hand was. Take back any
     * corner a touch placed in the last half second — long enough to catch the
     * palm, short enough that a chain genuinely started by finger and continued
     * with the pencil keeps its points. */
    var d = state.drawing;
    if (d && d.points && d.points.length) {
      var now = Date.now();
      while (d.points.length && d.points[d.points.length - 1]._pt === 'touch' &&
             (now - (d.points[d.points.length - 1]._t || 0)) < 500) {
        d.points.pop();
      }
      if (!d.points.length) state.drawing = null;
    } else if (d && d.startedBy === 'touch') {
      state.drawing = null;                      // a drag tool begun by the palm
    }
    return ids.length;
  }

  function evPos(e) {
    var r = canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  function onPointerDown(e) {
    if (!doc) return;
    /* Palm rejection, both orderings. */
    if (e.pointerType === 'touch' && penIsDown()) return;
    if (e.pointerType === 'pen') dropTouchContacts();

    /* Capture is an optimisation, not a requirement — but an unguarded call
     * throws NotFoundError for some pointers and takes the whole handler down
     * with it, so the tool silently does nothing. Never let it. */
    try { if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, e);
    /* Two fingers is a pinch. A finger and a pencil is a pencil. */
    if (touchCount() >= 2) { state.drawing = null; drag = null; return; }

    var p = evPos(e);
    var pt = renderer.screenToData(p.sx, p.sy);
    var t = state.tool;

    /* The north arrow is a control, whatever tool is live. Drag it round to
     * point at true north — that is how you orient a plan on scene, not by
     * typing a bearing into a panel three menus deep. */
    if (state.northHit && doc.data.sheet && doc.data.sheet.show_north !== false) {
      var nh = state.northHit;
      if (Math.hypot(p.sx - nh.x, p.sy - nh.y) <= nh.r) {
        doc.pushUndo();
        state.draggingNorth = true;
        drag = { mode: 'north' };
        draw();
        return;
      }
    }

    if (t === 'pan') { drag = { mode: 'pan', sx: p.sx, sy: p.sy, panX: state.view.panX, panY: state.view.panY }; return; }

    if (t === 'delete') {
      var hit = renderer.hitTest(p.sx, p.sy);
      if (hit) { state.selected = hit; deleteSelected(); }
      return;
    }

    if (t === 'select') { beginSelectDrag(p, pt); return; }

    if (t === 'chain' || t === 'zone') {
      var sp = snapped(pt);
      /* Provenance, so a palm that lands a fraction before the pencil can have
       * its stray corner taken back out again. */
      sp._pt = e.pointerType; sp._t = Date.now();
      if (!state.drawing) {
        state.drawing = { kind: t === 'chain' ? 'chain' : 'zone', points: [sp], cursor: sp };
      } else {
        var pts = state.drawing.points;
        var first = pts[0];
        var closeTol = 12 / state.view.zoom;
        if (pts.length >= 2 && G.dist(sp.x, sp.y, first.x, first.y) <= closeTol) {
          finishChain(true);
          return;
        }
        pts.push(sp);
      }
      draw();
      return;
    }

    if (t === 'door' || t === 'window') { placeOpening(t, pt); return; }

    if (t === 'place') {
      if (!state.activeSymbolId) { showToast('Pick a symbol first', 'err'); return; }
      doc.pushUndo();
      var rec = { id: uid('s_'), symbolId: state.activeSymbolId, x: pt.x, y: pt.y, angle: 0, label: '' };
      /* A generated symbol travels WITH the plan. Storing only an id would
       * leave a blank where the symbol was on any other device. */
      if (state.activeSymbolSpec) rec.spec = state.activeSymbolSpec;
      doc.list('symbols').push(rec);
      hideEmpty();
      commit('Placed');
      return;
    }

    if (t === 'text') { openTextInput(pt); return; }

    if (t === 'wall' || t === 'measure' || t === 'room' || t === 'calibrate') {
      var s0 = (t === 'calibrate') ? pt : snapped(pt);
      state.drawing = { kind: t === 'calibrate' ? 'calibrate' : t, x1: s0.x, y1: s0.y,
                        x2: s0.x, y2: s0.y, startedBy: e.pointerType };
      return;
    }

    if (t === 'pen') { state.drawing = { kind: 'pen', points: [pt], startedBy: e.pointerType }; return; }
  }

  function beginSelectDrag(p, pt) {
    var hit = renderer.hitTest(p.sx, p.sy);
    var f = doc.floor();

    /* An unlocked underlay is grabbable, but only when nothing else is under
     * the cursor — otherwise tracing would drag the picture instead of drawing. */
    if (!hit && f.underlay && !f.underlay.locked) {
      var u = f.underlay;
      if (pt.x >= u.x && pt.x <= u.x + u.w && pt.y >= u.y && pt.y <= u.y + u.h) {
        var corner = nearUnderlayCorner(pt, u);
        doc.pushUndo();
        drag = corner
          ? { mode: 'underlay-scale', corner: corner, start: pt, u0: Object.assign({}, u) }
          : { mode: 'underlay-move', start: pt, u0: Object.assign({}, u) };
        return;
      }
    }

    if (!hit) {
      state.selected = null;
      hideEditPanel(); hideZonePanel();
      drag = { mode: 'pan', sx: p.sx, sy: p.sy, panX: state.view.panX, panY: state.view.panY };
      draw();
      return;
    }

    selectByKind(hit.kind, hit.index);

    if (hit.kind === 'wall') {
      var w = doc.list('walls')[hit.index];
      var dEnd1 = G.dist(pt.x, pt.y, w.x1, w.y1), dEnd2 = G.dist(pt.x, pt.y, w.x2, w.y2);
      var grabTol = 14 / state.view.zoom;
      doc.pushUndo();
      if (dEnd1 < grabTol) drag = { mode: 'wall-end', wall: w, end: 1 };
      else if (dEnd2 < grabTol) drag = { mode: 'wall-end', wall: w, end: 2 };
      else drag = { mode: 'wall-move', wall: w, start: pt, w0: { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 } };
      return;
    }

    if (hit.kind === 'zone') {
      var z = doc.list('zones')[hit.index];
      doc.pushUndo();
      drag = { mode: 'zone-move', zone: z, start: pt, poly0: JSON.parse(JSON.stringify(z.poly)) };
      return;
    }

    if (hit.kind === 'door' || hit.kind === 'window') {
      var op = doc.list(hit.kind + 's')[hit.index];
      doc.pushUndo();
      drag = { mode: 'opening-slide', op: op };
      return;
    }

    var el = doc.list(hit.kind)[hit.index];
    if (el && typeof el.x === 'number') {
      doc.pushUndo();
      drag = { mode: 'move', el: el, start: pt, x0: el.x, y0: el.y };
    }
  }

  function nearUnderlayCorner(pt, u) {
    var tol = 12 / state.view.zoom;
    var corners = { nw: { x: u.x, y: u.y }, ne: { x: u.x + u.w, y: u.y },
                    se: { x: u.x + u.w, y: u.y + u.h }, sw: { x: u.x, y: u.y + u.h } };
    for (var k in corners) {
      if (G.dist(pt.x, pt.y, corners[k].x, corners[k].y) < tol) return k;
    }
    return null;
  }

  function onPointerMove(e) {
    if (!doc) return;
    if (e.pointerType === 'touch' && penIsDown()) return;      // palm dragging
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);

    if (touchCount() >= 2) { handlePinch(); return; }

    var p = evPos(e);
    var pt = renderer.screenToData(p.sx, p.sy);

    if (drag) {
      applyDrag(drag, p, pt, e);
      draw();
      return;
    }

    var d = state.drawing;
    if (d) {
      if (d.kind === 'chain' || d.kind === 'zone') {
        d.cursor = snapped(pt);
      } else if (d.kind === 'pen') {
        d.points.push(pt);
      } else if (d.kind === 'calibrate') {
        d.x2 = pt.x; d.y2 = pt.y;
      } else {
        var sp = pt;
        if (e.shiftKey || state.ortho) {
          var c = G.constrainAngle(d.x1, d.y1, pt.x, pt.y, { ortho: true });
          sp = { x: c.x, y: c.y };
        } else {
          sp = snapped(pt, { align: true });
        }
        d.x2 = sp.x; d.y2 = sp.y;
      }
      draw();
      return;
    }

    /* Idle hover: show the snap the next click would take. */
    if (state.tool === 'chain' || state.tool === 'wall' || state.tool === 'zone' || state.tool === 'room') {
      snapped(pt);
      draw();
    } else if (state.snap || (state.guides && state.guides.length)) {
      state.snap = null; state.guides = []; draw();
    }
  }

  function applyDrag(dr, p, pt, e) {
    if (dr.mode === 'pan') {
      state.view.panX = dr.panX + (p.sx - dr.sx);
      state.view.panY = dr.panY + (p.sy - dr.sy);
      return;
    }
    if (dr.mode === 'north') {
      var nh2 = state.northHit || { x: state.view.width - 46, y: 46 };
      var ang = Math.atan2(p.sy - nh2.y, p.sx - nh2.x) * 180 / Math.PI + 90;
      /* The arrow is drawn at sheet.north + view rotation, so back the view
       * rotation out or north would drift every time the plan is turned. */
      var bearing = ang - (state.view.rotation || 0);
      while (bearing < 0) bearing += 360;
      while (bearing >= 360) bearing -= 360;
      if (e && e.shiftKey) bearing = Math.round(bearing / 15) * 15;   // 15 deg steps
      doc.data.sheet.north = Math.round(bearing * 10) / 10;
      var nd = $('vc-northdeg');
      if (nd) nd.value = doc.data.sheet.north;
      var nl = $('north-readout');
      if (nl) nl.textContent = Math.round(doc.data.sheet.north) + '°';
      return;
    }
    if (dr.mode === 'move') {
      dr.el.x = dr.x0 + (pt.x - dr.start.x);
      dr.el.y = dr.y0 + (pt.y - dr.start.y);
      return;
    }
    if (dr.mode === 'wall-end') {
      var sp = (e && e.shiftKey)
        ? G.constrainAngle(dr.end === 1 ? dr.wall.x2 : dr.wall.x1,
                           dr.end === 1 ? dr.wall.y2 : dr.wall.y1, pt.x, pt.y, { ortho: true })
        : snapped(pt, { excludeWallId: dr.wall.id });
      if (dr.end === 1) { dr.wall.x1 = sp.x; dr.wall.y1 = sp.y; }
      else { dr.wall.x2 = sp.x; dr.wall.y2 = sp.y; }
      return;
    }
    if (dr.mode === 'wall-move') {
      var dx = pt.x - dr.start.x, dy = pt.y - dr.start.y;
      dr.wall.x1 = dr.w0.x1 + dx; dr.wall.y1 = dr.w0.y1 + dy;
      dr.wall.x2 = dr.w0.x2 + dx; dr.wall.y2 = dr.w0.y2 + dy;
      return;
    }
    if (dr.mode === 'zone-move') {
      var zx = pt.x - dr.start.x, zy = pt.y - dr.start.y;
      dr.zone.poly = dr.poly0.map(function (q) { return { x: q.x + zx, y: q.y + zy }; });
      doc.recomputeZone(dr.zone);
      return;
    }
    if (dr.mode === 'opening-slide') {
      /* Slide along the host wall — an opening cannot leave its wall by drag,
       * which is the whole point of hosting it. */
      var w = doc.wallsById()[dr.op.wallId];
      if (w) dr.op.t = G.projT(pt.x, pt.y, w.x1, w.y1, w.x2, w.y2);
      else { dr.op.x = pt.x; dr.op.y = pt.y; }
      return;
    }
    if (dr.mode === 'underlay-move') {
      var u = doc.floor().underlay;
      u.x = dr.u0.x + (pt.x - dr.start.x);
      u.y = dr.u0.y + (pt.y - dr.start.y);
      return;
    }
    if (dr.mode === 'underlay-scale') {
      var uu = doc.floor().underlay;
      var anchor = { nw: { x: dr.u0.x + dr.u0.w, y: dr.u0.y + dr.u0.h },
                     ne: { x: dr.u0.x, y: dr.u0.y + dr.u0.h },
                     se: { x: dr.u0.x, y: dr.u0.y },
                     sw: { x: dr.u0.x + dr.u0.w, y: dr.u0.y } }[dr.corner];
      var nw = Math.abs(pt.x - anchor.x), nh = Math.abs(pt.y - anchor.y);
      /* Uniform scale: a stretched plan is a wrong plan. */
      var k = Math.max(nw / dr.u0.w, nh / dr.u0.h);
      k = Math.max(0.05, k);
      uu.w = dr.u0.w * k; uu.h = dr.u0.h * k;
      uu.x = Math.min(anchor.x, anchor.x + (pt.x >= anchor.x ? uu.w : -uu.w));
      uu.y = Math.min(anchor.y, anchor.y + (pt.y >= anchor.y ? uu.h : -uu.h));
      uu.calibrated = false;
      return;
    }
  }

  function handlePinch() {
    /* Fingers only — including the pencil here is what made palm + pencil
     * register as a two-finger zoom. */
    var it = [];
    pointers.forEach(function (p) { if (p.pointerType === 'touch') it.push(p); });
    if (it.length < 2) return;
    var r = canvas.getBoundingClientRect();
    var a = { x: it[0].clientX - r.left, y: it[0].clientY - r.top };
    var b = { x: it[1].clientX - r.left, y: it[1].clientY - r.top };
    var d = Math.hypot(b.x - a.x, b.y - a.y);
    if (lastPinch > 0 && d > 0) {
      var factor = d / lastPinch;
      if (factor > 0.2 && factor < 5) {
        renderer.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, factor);
      }
    }
    lastPinch = d;
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (touchCount() < 2) lastPinch = 0;

    if (drag) {
      var mode = drag.mode;
      drag = null;
      if (mode === 'north') {
        state.draggingNorth = false;
        commit('North set to ' + Math.round(doc.data.sheet.north) + '°');
        return;
      }
      if (mode !== 'pan') {
        if (mode === 'zone-move') renderFloors();
        commit();
      }
      return;
    }

    var d = state.drawing;
    if (!d) return;
    if (d.kind === 'chain' || d.kind === 'zone') return;   // multi-click tools finish elsewhere

    var scale = doc.data.scale_px_per_ft || 12;

    if (d.kind === 'wall') {
      if (G.dist(d.x1, d.y1, d.x2, d.y2) > 4) {
        doc.pushUndo();
        doc.list('walls').push({ id: uid('w_'), x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 });
        state.drawing = null;
        hideEmpty();
        commit();
        state.selected = { kind: 'wall', index: doc.list('walls').length - 1 };
        showEditPanel(state.selected);
        draw();
        return;
      }
    } else if (d.kind === 'room') {
      if (Math.abs(d.x2 - d.x1) > 5 && Math.abs(d.y2 - d.y1) > 5) {
        doc.pushUndo();
        var ax = Math.min(d.x1, d.x2), ay = Math.min(d.y1, d.y2);
        var bx = Math.max(d.x1, d.x2), by = Math.max(d.y1, d.y2);
        var walls = doc.list('walls');
        walls.push({ id: uid('w_'), x1: ax, y1: ay, x2: bx, y2: ay });
        walls.push({ id: uid('w_'), x1: bx, y1: ay, x2: bx, y2: by });
        walls.push({ id: uid('w_'), x1: bx, y1: by, x2: ax, y2: by });
        walls.push({ id: uid('w_'), x1: ax, y1: by, x2: ax, y2: ay });
        state.drawing = null;
        hideEmpty();
        /* A rectangle drawn as a room is unambiguously a room, so measure it
         * immediately rather than making the user go and click it again. */
        var poly = [{ x: ax, y: ay }, { x: bx, y: ay }, { x: bx, y: by }, { x: ax, y: by }];
        var z = doc.addZone(poly, {});
        commit('Room drawn — ' + fmtSqFt(z.area_sqft));
        renderFloors();
        return;
      }
    } else if (d.kind === 'measure') {
      if (G.dist(d.x1, d.y1, d.x2, d.y2) > 4) {
        doc.pushUndo();
        doc.list('measurements').push({ id: uid('m_'), x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 });
        state.drawing = null;
        commit();
        return;
      }
    } else if (d.kind === 'pen') {
      if ((d.points || []).length > 1) {
        doc.pushUndo();
        doc.list('freehand').push({ id: uid('f_'), points: d.points, width: 2, color: '#0f172a' });
        state.drawing = null;
        hideEmpty();
        commit();
        return;
      }
    } else if (d.kind === 'calibrate') {
      var px = G.dist(d.x1, d.y1, d.x2, d.y2);
      state.drawing = null;
      if (px < 8) { showToast('Drag a longer line', 'err'); draw(); return; }
      var ans = prompt('How long is that in feet, really?', '20');
      if (ans === null) { draw(); return; }
      var ft = parseFloat(ans);
      if (!(ft > 0)) { showToast('That is not a length', 'err'); draw(); return; }
      var u = doc.floor().underlay;
      if (!u) { showToast('No underlay to scale', 'err'); draw(); return; }
      doc.pushUndo();
      IO.calibrateUnderlay(u, { x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }, ft, scale);
      setTool('select');
      syncUnderlayPanel();
      updateMeta();
      commit('Underlay scaled — ' + G.formatFeet(ft) + ' now measures right');
      return;
    }
    state.drawing = null;
    draw();
  }

  /* --------------------------------------------------- openings on walls */

  function placeOpening(kind, pt) {
    var f = doc.floor();
    var host = G.hostOpening(pt.x, pt.y, f.walls || [], 26 / state.view.zoom + 12);
    if (!host) { showToast('Tap on a wall to put a ' + kind + ' in it', 'err'); return; }
    doc.pushUndo();
    var scale = doc.data.scale_px_per_ft || 12;
    var rec = {
      id: uid(kind === 'door' ? 'd_' : 'n_'),
      wallId: host.wallId,
      t: host.t,
      width: (kind === 'door' ? 3 : 3.5) * scale,
      type: kind === 'door' ? 'single' : undefined
    };
    var r = G.resolveOpening(rec, doc.wallsById());
    if (r) { rec.x = r.x; rec.y = r.y; rec.angle = r.angle; }
    doc.list(kind + 's').push(rec);
    hideEmpty();
    commit();
    selectByKind(kind, doc.list(kind + 's').length - 1);
  }

  /* ================================================================ zones */

  var ZONE_COLORS = ['#3b82f6', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#64748b', '#db2777'];

  function zoneAtClick(pt) {
    var f = doc.floor();
    if (!(f.walls || []).length) {
      showToast('Draw some walls first', 'err');
      return;
    }
    /* Clicking an existing zone selects it rather than stacking another. */
    for (var i = (f.zones || []).length - 1; i >= 0; i--) {
      if (f.zones[i].poly && G.pointInPoly(pt.x, pt.y, f.zones[i].poly)) {
        selectByKind('zone', i);
        return;
      }
    }
    var scale = doc.data.scale_px_per_ft || 12;
    var poly = G.faceAtPoint(f.walls, pt.x, pt.y, { closeGap: Math.max(6, scale * 0.5) });
    if (!poly) {
      showToast('That area is not closed — try Weld corners, or check for a gap', 'err');
      return;
    }
    doc.pushUndo();
    var z = doc.addZone(poly, { color: ZONE_COLORS[(f.zones.length) % ZONE_COLORS.length] });
    hideEmpty();
    commit();
    renderFloors();
    selectByKind('zone', doc.list('zones').length - 1);
    showToast(fmtSqFt(z.area_sqft), 'ok');
  }

  function showZonePanel() {
    var p = $('zone-panel');
    if (!p || !state.selected || state.selected.kind !== 'zone') return;
    var z = doc.list('zones')[state.selected.index];
    if (!z) return;
    p.classList.remove('hidden');
    $('zp-area').textContent = fmtSqFt(z.area_sqft);
    $('zp-sub').textContent = 'Perimeter ' + G.formatFeet(z.perimeter_ft || 0) +
      ' · ' + (z.poly ? z.poly.length : 0) + ' corners' +
      (z.source === 'scan' ? ' · from the scan' : '');
    $('zp-name').value = z.name || '';
    $('zp-use').value = z.use || '';
    $('zp-exclude').checked = !!z.exclude_from_total;
    var host = $('zp-colors');
    host.innerHTML = '';
    ZONE_COLORS.forEach(function (c) {
      var s = document.createElement('span');
      s.className = 'fp-swatch' + (z.color === c ? ' sel' : '');
      s.style.background = c;
      s.onclick = function () {
        doc.pushUndo(); z.color = c; showZonePanel(); commit();
      };
      host.appendChild(s);
    });
  }

  function hideZonePanel() { var p = $('zone-panel'); if (p) p.classList.add('hidden'); }

  function initZonePanel() {
    $('zp-name').addEventListener('input', function () {
      var z = currentZone(); if (!z) return;
      z.name = this.value; saveSoon(); draw(); renderFloors();
    });
    $('zp-use').addEventListener('change', function () {
      var z = currentZone(); if (!z) return;
      doc.pushUndo(); z.use = this.value; commit();
    });
    $('zp-exclude').addEventListener('change', function () {
      var z = currentZone(); if (!z) return;
      doc.pushUndo(); z.exclude_from_total = this.checked;
      commit(); updateAreaBar(); renderFloors();
    });
    $('zp-recompute').addEventListener('click', function () {
      var z = currentZone(); if (!z) return;
      var f = doc.floor();
      var c = G.polyCentroid(z.poly);
      var poly = G.faceAtPoint(f.walls, c.x, c.y, { closeGap: Math.max(6, (doc.data.scale_px_per_ft || 12) * 0.5) });
      if (!poly) { showToast('Still not closed at that point', 'err'); return; }
      doc.pushUndo();
      z.poly = poly;
      doc.recomputeZone(z);
      showZonePanel(); commit('Re-solved — ' + fmtSqFt(z.area_sqft));
      renderFloors();
    });
    $('zp-delete').addEventListener('click', deleteSelected);
  }

  function currentZone() {
    if (!state.selected || state.selected.kind !== 'zone') return null;
    return doc.list('zones')[state.selected.index] || null;
  }

  function detectRooms() {
    var f = doc.floor();
    if (!(f.walls || []).length) { showToast('Draw some walls first', 'err'); return; }
    showToast('Looking for rooms…');
    /* Deferred a frame so the toast paints before the sweep blocks. */
    setTimeout(function () {
      var scale = doc.data.scale_px_per_ft || 12;
      var found = G.detectAllFaces(f.walls, {
        closeGap: Math.max(6, scale * 0.5),
        minAreaPx: scale * scale * 12          // ignore anything under ~12 sq ft
      });
      if (!found.length) { showToast('No closed rooms found', 'err'); return; }
      doc.pushUndo();
      var added = 0;
      found.forEach(function (r) {
        var dup = (f.zones || []).some(function (z) {
          return z.poly && G.pointInPoly(r.centroid.x, r.centroid.y, z.poly);
        });
        if (dup) return;
        doc.addZone(r.poly, { color: ZONE_COLORS[(f.zones.length + added) % ZONE_COLORS.length] });
        added++;
      });
      updateCounts(); updateAreaBar(); renderFloors();
      commit(added ? ('Found ' + added + ' room' + (added === 1 ? '' : 's')) : 'Nothing new found');
    }, 30);
  }

  /* ============================================================ underlay */

  function syncUnderlayPanel() {
    var f = doc ? doc.floor() : null;
    var u = f && f.underlay;
    var st = $('ul-status'), cal = $('ul-cal-status');
    if (!st) return;
    if (!u) {
      st.textContent = 'Nothing loaded on ' + (f ? f.name : 'this floor') + '.';
      if (cal) cal.textContent = '';
      $('ul-lock').checked = false;
      return;
    }
    st.textContent = 'Loaded on ' + f.name + ' (' + u.natural_w + '×' + u.natural_h + ').';
    $('ul-opacity').value = Math.round((u.opacity == null ? 0.55 : u.opacity) * 100);
    $('ul-rot').value = u.rot || 0;
    $('ul-lock').checked = !!u.locked;
    if (cal) {
      cal.textContent = u.calibrated
        ? 'Scaled: ' + G.formatFeet(u.calibration.feet) + ' measured true.'
        : 'Not scaled yet — set the scale before tracing or every length will be wrong.';
      cal.style.color = u.calibrated ? 'var(--slate-500)' : '#b45309';
    }
  }

  function initUnderlayPanel() {
    $('ul-pick').addEventListener('click', function () { $('ul-file').click(); });
    $('ul-file').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (file) loadUnderlay(file);
      this.value = '';
    });
    $('ul-remove').addEventListener('click', function () {
      var f = doc.floor();
      if (!f.underlay) return;
      if (!confirm('Remove the tracing underlay from ' + f.name + '? The drawing stays.')) return;
      doc.pushUndo();
      f.underlay = null;
      syncUnderlayPanel(); updateMeta(); refreshEmptyState();
      commit('Underlay removed');
    });
    $('ul-opacity').addEventListener('input', function () {
      var u = doc.floor().underlay; if (!u) return;
      u.opacity = parseInt(this.value, 10) / 100;
      draw(); saveSoon();
    });
    $('ul-rot').addEventListener('input', function () {
      var u = doc.floor().underlay; if (!u) return;
      u.rot = parseFloat(this.value);
      draw(); saveSoon();
    });
    $('ul-lock').addEventListener('change', function () {
      var u = doc.floor().underlay; if (!u) return;
      u.locked = this.checked;
      draw(); saveSoon();
    });
    $('ul-calibrate').addEventListener('click', function () {
      if (!doc.floor().underlay) { showToast('Load a plan image first', 'err'); return; }
      setTool('calibrate');
      showToast('Drag along something you know the length of');
    });
  }

  function loadUnderlay(file) {
    showToast('Reading ' + file.name + '…');
    IO.readUnderlayFile(file, 1).then(function (img) {
      doc.pushUndo();
      var f = doc.floor();
      f.underlay = IO.fitUnderlay(img, doc.data.canvas_width, doc.data.canvas_height);
      hideEmpty();
      syncUnderlayPanel();
      updateMeta();
      renderer.fitToView();
      commit('Underlay loaded — now set its scale');
      openPanel('underlay-panel');
    }).catch(function (err) {
      showToast(err.message || 'Could not read that file', 'err');
    });
  }

  /* ============================================================== import */

  function openImportPanel() {
    openPanel('import-panel');
    $('imp-warnings').innerHTML = '';
    $('imp-list').innerHTML = '';
  }

  function importMode() { return $('imp-mode').value || 'floor'; }

  function showWarnings(warnings) {
    var host = $('imp-warnings');
    if (!host) return;
    host.innerHTML = '';
    (warnings || []).forEach(function (w) {
      var div = document.createElement('div');
      div.className = 'fp-warn';
      div.textContent = w;
      host.appendChild(div);
    });
  }

  function applyImport(parsed, sourceLabel) {
    if (!parsed.ok) { showToast(parsed.error || 'Could not read that capture', 'err'); showWarnings(parsed.warnings); return; }
    doc.pushUndo();
    IO.applyParsed(doc, parsed, importMode());
    /* Layer flags live on the document, so a fresh import must not inherit a
     * stale set from whatever was loaded before. */
    doc.data.layers = Object.assign({}, M.DEFAULT_LAYERS, doc.data.layers || {});
    state.selected = null;
    hideEmpty();
    renderFloors(); updateCounts(); updateAreaBar(); updateMeta(); syncUnderlayPanel();
    renderer.fitToView();
    saveToStorage();
    showWarnings(parsed.warnings);
    var s = parsed.stats;
    showToast('Imported ' + (sourceLabel || 'capture') + ': ' + s.walls + ' walls, ' +
              s.doors + ' doors, ' + s.zones + ' areas', 'ok');
    if (!parsed.warnings.length) closePanel('import-panel');
  }

  function initImportPanel() {
    $('imp-latest').addEventListener('click', function () {
      showToast('Fetching the latest capture…');
      IO.listCaptures(1).then(function (jobs) {
        if (!jobs.length) { showToast('No captures on the server', 'err'); return; }
        return IO.fetchCapture(jobs[0].id).then(function (job) {
          applyImport(IO.parseScan(job), jobs[0].building_name || jobs[0].id);
        });
      }).catch(function (e) { showToast('Load failed: ' + (e.message || e), 'err'); });
    });

    $('imp-browse').addEventListener('click', function () {
      var list = $('imp-list');
      list.innerHTML = '<div class="hint">Loading…</div>';
      IO.listCaptures(25).then(function (jobs) {
        list.innerHTML = '';
        if (!jobs.length) { list.innerHTML = '<div class="hint">No captures found.</div>'; return; }
        jobs.forEach(function (j) {
          var row = document.createElement('div');
          row.className = 'fp-imp-opt';
          var when = j.created_at ? new Date(j.created_at) : null;
          row.innerHTML = '<b>' + escapeHTML(j.building_name || j.id) + '</b><span>' +
            (when && !isNaN(when) ? when.toLocaleString() : '') + '</span>';
          row.onclick = function () {
            showToast('Loading…');
            IO.fetchCapture(j.id).then(function (job) {
              applyImport(IO.parseScan(job), j.building_name || j.id);
            }).catch(function (e) { showToast('Load failed: ' + (e.message || e), 'err'); });
          };
          list.appendChild(row);
        });
      }).catch(function (e) { list.innerHTML = '<div class="hint">Could not reach the server: ' + escapeHTML(e.message || '') + '</div>'; });
    });

    $('imp-file').addEventListener('click', function () { $('imp-fileinput').click(); });
    $('imp-fileinput').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      IO.readScanFile(file).then(function (parsed) { applyImport(parsed, file.name); })
        .catch(function (e) { showToast(e.message || 'Could not read that file', 'err'); });
    });
  }

  /* --------------------------------------------------------- drag & drop */

  function initDropZone() {
    var dz = $('drop-zone');
    var depth = 0;
    ['dragenter', 'dragover'].forEach(function (ev) {
      stage.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === 'dragenter') depth++;
        dz.classList.add('on');
      });
    });
    stage.addEventListener('dragleave', function () {
      depth = Math.max(0, depth - 1);
      if (!depth) dz.classList.remove('on');
    });
    stage.addEventListener('drop', function (e) {
      e.preventDefault();
      depth = 0;
      dz.classList.remove('on');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      var name = (file.name || '').toLowerCase();
      if (/\.json$/.test(name) || file.type === 'application/json') {
        IO.readScanFile(file).then(function (parsed) { applyImport(parsed, file.name); })
          .catch(function (err) { showToast(err.message || 'Could not read that file', 'err'); });
      } else {
        loadUnderlay(file);
      }
    });
  }

  /* ========================================================== edit panel */

  function hideEditPanel() { if (editPanel) editPanel.classList.add('hidden'); }

  function showEditPanel(hit) {
    if (!hit || !editPanel) return;
    var el = doc.list(hit.kind)[hit.index];
    if (!el) return;
    var scale = doc.data.scale_px_per_ft || 12;
    $('ep-title').textContent = hit.kind.charAt(0).toUpperCase() + hit.kind.slice(1);
    var body = $('ep-body');
    body.innerHTML = '';
    var sub = '';

    function field(label, value, onChange, type) {
      var l = document.createElement('label');
      l.className = 'fld';
      l.textContent = label;
      var i = document.createElement('input');
      i.type = type || 'text';
      i.value = value == null ? '' : value;
      i.addEventListener('change', function () { doc.pushUndo(); onChange(i.value); commit(); });
      if (type === 'number') i.step = 'any';
      body.appendChild(l);
      body.appendChild(i);
    }

    if (hit.kind === 'wall') {
      var len = G.pxToFeet(G.dist(el.x1, el.y1, el.x2, el.y2), scale);
      sub = G.formatFeet(len);
      field('Length (ft)', Math.round(len * 100) / 100, function (v) {
        var ft = parseFloat(v);
        if (!(ft > 0)) return;
        var np = G.pointAtDistance(el.x1, el.y1, el.x2, el.y2, ft * scale);
        el.x2 = np.x; el.y2 = np.y;
      }, 'number');
      var openings = [];
      ['doors', 'windows'].forEach(function (k) {
        doc.list(k).forEach(function (op) { if (op.wallId === el.id) openings.push(k); });
      });
      if (openings.length) {
        var note = document.createElement('div');
        note.className = 'hint';
        note.textContent = openings.length + ' opening' + (openings.length === 1 ? '' : 's') +
          ' sit in this wall and move with it.';
        body.appendChild(note);
      }
    } else if (hit.kind === 'door' || hit.kind === 'window') {
      sub = G.formatFeet(G.pxToFeet(el.width || 32, scale)) + ' wide' + (el.wallId ? ' · in a wall' : ' · loose');
      field('Width (ft)', Math.round(G.pxToFeet(el.width || 32, scale) * 100) / 100, function (v) {
        var ft = parseFloat(v);
        if (ft > 0) el.width = ft * scale;
      }, 'number');
      if (hit.kind === 'door') {
        var sel = document.createElement('select');
        [['single', 'Single'], ['double', 'Double'], ['rollup', 'Roll-up / overhead'],
         ['entryway', 'Open doorway (no leaf)']].forEach(function (t) {
          var o = document.createElement('option');
          o.value = t[0]; o.textContent = t[1];
          if ((el.type || 'single') === t[0]) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          doc.pushUndo(); el.type = sel.value; commit();
          showEditPanel(hit);            // swing controls appear/disappear with the type
        });
        var dl = document.createElement('label');
        dl.className = 'fld'; dl.textContent = 'Type';
        body.appendChild(dl); body.appendChild(sel);

        /* Which way the door swings. A roll-up has no leaf and an open doorway
         * has no door, so neither has a swing to set. */
        var t = el.type || 'single';
        if (t === 'single' || t === 'double') {
          var sl = document.createElement('label');
          sl.className = 'fld';
          sl.textContent = 'Swing';
          body.appendChild(sl);

          var row = document.createElement('div');
          row.className = 'row';

          /* Two flips rather than four named states: "left hand reverse" means
           * nothing to most people, and the door visibly moves on the plan the
           * moment you tap, which explains itself. A single door has both; a
           * double swings as a pair, so only the side applies. */
          if (t === 'single') {
            var hb = document.createElement('button');
            hb.className = 'fp-tbtn sm';
            hb.textContent = '⇄ Hinge side';
            hb.title = 'Move the hinge to the other end of the opening';
            hb.addEventListener('click', function () {
              doc.pushUndo();
              el.hinge = (el.hinge === 'end') ? 'start' : 'end';
              commit();
              showEditPanel(hit);
            });
            row.appendChild(hb);
          }

          var sb = document.createElement('button');
          sb.className = 'fp-tbtn sm';
          sb.textContent = '⤺ Swing side';
          sb.title = 'Swing the door to the other side of the wall';
          sb.addEventListener('click', function () {
            doc.pushUndo();
            el.swing = (el.swing === -1) ? 1 : -1;
            commit();
            showEditPanel(hit);
          });
          row.appendChild(sb);
          body.appendChild(row);

          var state_ = document.createElement('div');
          state_.className = 'hint';
          state_.textContent = 'Hinged at the ' + ((el.hinge === 'end') ? 'far' : 'near') +
            ' end, opening ' + ((el.swing === -1) ? 'one' : 'the other') + ' way. ' +
            'Tap to flip — the plan updates as you go.';
          body.appendChild(state_);
        }
      }
      if (!el.wallId) {
        var warn = document.createElement('div');
        warn.className = 'hint';
        warn.textContent = 'Not attached to a wall — it will not follow if the wall moves.';
        body.appendChild(warn);
      }
    } else if (hit.kind === 'text') {
      sub = el.text || '';
      field('Text', el.text, function (v) { el.text = v; });
      field('Size', el.size || 14, function (v) { var n = parseFloat(v); if (n > 0) el.size = n; }, 'number');
    } else if (hit.kind === 'symbol') {
      var def = SYMBOLS.byId[el.symbolId];
      sub = (el.spec && el.spec.label) || (def && def.label) || el.symbolId;
      field('Label', el.label, function (v) { el.label = v; });
      field('Note', el.note, function (v) { el.note = v; });
      field('Rotation (°)', el.angle || 0, function (v) { el.angle = parseFloat(v) || 0; }, 'number');

      /* Size. A symbol is placed at one nominal size, but a walk-in cooler and
       * a smoke detector are not the same size on a real building, and a
       * generated symbol has no way of knowing the scale of the plan it lands
       * on. Live slider, because you size this by eye against the walls. */
      var sizeLabel = document.createElement('label');
      sizeLabel.className = 'fld';
      var pct = Math.round((el.scale || 1) * 100);
      sizeLabel.textContent = 'Size — ' + pct + '%';
      var slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '25'; slider.max = '400'; slider.step = '5';
      slider.value = String(pct);
      slider.style.width = '100%';
      var pushed = false;
      slider.addEventListener('input', function () {
        /* One undo step for the whole drag, not one per pixel of travel. */
        if (!pushed) { doc.pushUndo(); pushed = true; }
        el.scale = parseInt(slider.value, 10) / 100;
        sizeLabel.textContent = 'Size — ' + slider.value + '%';
        draw();
      });
      slider.addEventListener('change', function () {
        pushed = false;
        commit();
      });
      body.appendChild(sizeLabel);
      body.appendChild(slider);

      var reset = document.createElement('button');
      reset.className = 'fp-tbtn sm';
      reset.textContent = 'Reset size';
      reset.addEventListener('click', function () {
        doc.pushUndo();
        el.scale = 1;
        commit();
        showEditPanel(hit);
      });
      body.appendChild(reset);
    } else if (hit.kind === 'object') {
      sub = el.label || el.type || 'Object';
      field('Label', el.label, function (v) { el.label = v; });
      field('Width (ft)', Math.round(G.pxToFeet(el.width || 24, scale) * 100) / 100,
        function (v) { var n = parseFloat(v); if (n > 0) el.width = n * scale; }, 'number');
      field('Depth (ft)', Math.round(G.pxToFeet(el.depth || 24, scale) * 100) / 100,
        function (v) { var n = parseFloat(v); if (n > 0) el.depth = n * scale; }, 'number');
      field('Rotation (°)', el.angle || 0, function (v) { el.angle = parseFloat(v) || 0; }, 'number');
    } else if (hit.kind === 'measurement') {
      sub = G.formatFeet(G.pxToFeet(G.dist(el.x1, el.y1, el.x2, el.y2), scale));
      field('Label', el.label, function (v) { el.label = v; });
    }

    $('ep-sub').textContent = sub;
    editPanel.classList.remove('hidden');
  }

  /* ============================================================= text tool */

  var pendingTextPos = null;

  function openTextInput(pt) {
    pendingTextPos = pt;
    var s = renderer.dataToScreen(pt.x, pt.y);
    textOverlay.style.left = Math.max(4, s.sx - 60) + 'px';
    textOverlay.style.top = Math.max(4, s.sy - 18) + 'px';
    textOverlay.classList.add('open');
    var inp = $('text-input');
    inp.value = '';
    setTimeout(function () { inp.focus(); }, 30);
  }

  function commitText() {
    var v = $('text-input').value.trim();
    textOverlay.classList.remove('open');
    if (!v || !pendingTextPos) { pendingTextPos = null; return; }
    doc.pushUndo();
    doc.list('texts').push({
      id: uid('t_'), x: pendingTextPos.x, y: pendingTextPos.y,
      text: v, size: 14, color: '#475569', angle: 0
    });
    pendingTextPos = null;
    hideEmpty();
    commit();
  }

  /* ============================================================== panels */

  function openPanel(id) {
    var p = $(id);
    if (p) p.classList.remove('hidden');
  }
  function closePanel(id) {
    var p = $(id);
    if (p) p.classList.add('hidden');
  }
  function togglePanel(id) {
    var p = $(id);
    if (p) p.classList.toggle('hidden');
  }

  function initPanelCloses() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (el) {
      el.addEventListener('click', function () { closePanel(el.getAttribute('data-close')); });
    });
  }

  /* ============================================================ keyboard */

  var KEYS = {
    v: 'select', h: 'pan', b: 'chain', w: 'wall', r: 'room', d: 'door',
    n: 'window', z: 'zone', p: 'place', t: 'text', m: 'measure', f: 'pen', x: 'delete'
  };

  function initKeyboard() {
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        if (e.key === 'Enter' && t.id === 'text-input') commitText();
        if (e.key === 'Escape' && t.id === 'text-input') textOverlay.classList.remove('open');
        return;
      }
      var meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) { if (doc.redo()) { afterUndoRedo('Redo'); } }
        else { if (doc.undo()) { afterUndoRedo('Undo'); } }
        return;
      }
      if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); saveToStorage(); showToast('Saved', 'ok'); return; }

      if (e.key === 'Escape') {
        if (state.drawing) { state.drawing = null; draw(); }
        else { state.selected = null; hideEditPanel(); hideZonePanel(); draw(); }
        return;
      }
      if (e.key === 'Enter') {
        if (state.drawing && (state.drawing.kind === 'chain' || state.drawing.kind === 'zone')) {
          e.preventDefault();
          finishChain(false);
        }
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (state.drawing && state.drawing.points && state.drawing.points.length) {
          e.preventDefault();
          state.drawing.points.pop();
          if (!state.drawing.points.length) state.drawing = null;
          draw();
          return;
        }
        if (state.selected) { e.preventDefault(); deleteSelected(); }
        return;
      }
      if (e.key === 'l' || e.key === 'L') {
        /* Typed dimension on the segment just drawn or the selected wall. */
        e.preventDefault();
        askLastSegmentLength();
        return;
      }
      if (e.key === 'Shift') { state.ortho = true; return; }

      var k = String(e.key || '').toLowerCase();
      if (KEYS[k] && !meta) {
        if (k === 'p' && !state.activeSymbolId) return;
        setTool(KEYS[k]);
      }
    });
    document.addEventListener('keyup', function (e) {
      if (e.key === 'Shift') state.ortho = false;
    });
  }

  function afterUndoRedo(label) {
    state.selected = null;
    hideEditPanel(); hideZonePanel();
    renderFloors(); updateCounts(); updateAreaBar(); updateMeta(); syncUnderlayPanel(); refreshEmptyState();
    saveToStorage({ withImage: false });
    draw();
    showToast(label, 'ok');
  }

  /* ============================================================== toolbar */

  function initToolbar() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (b) {
      b.addEventListener('click', function () { setTool(b.getAttribute('data-tool')); });
    });

    $('btn-undo').addEventListener('click', function () { if (doc.undo()) afterUndoRedo('Undo'); });
    $('btn-redo').addEventListener('click', function () { if (doc.redo()) afterUndoRedo('Redo'); });
    $('btn-fit').addEventListener('click', function () { renderer.fitToView(); });
    $('btn-zoom-in').addEventListener('click', function () { renderer.zoomAt(state.view.width / 2, state.view.height / 2, 1.25); });
    $('btn-zoom-out').addEventListener('click', function () { renderer.zoomAt(state.view.width / 2, state.view.height / 2, 0.8); });
    $('btn-layers').addEventListener('click', function () { togglePanel('layers'); });
    $('btn-view').addEventListener('click', function () { togglePanel('view-controls'); });
    $('btn-underlay').addEventListener('click', function () { togglePanel('underlay-panel'); syncUnderlayPanel(); });
    $('btn-import').addEventListener('click', openImportPanel);
    $('btn-detect-rooms').addEventListener('click', detectRooms);

    $('btn-weld').addEventListener('click', function () {
      var f = doc.floor();
      var scale = doc.data.scale_px_per_ft || 12;
      var tol = Math.max(4, scale * 0.5);          // half a foot, the app's rule
      doc.pushUndo();
      var moved = G.weldCorners(f.walls || [], tol);
      commit(moved ? ('Pulled ' + moved + ' wall end' + (moved === 1 ? '' : 's') + ' together') : 'Nothing needed welding');
    });

    $('btn-save').addEventListener('click', function () {
      saveToStorage();
      ppSyncToRecord();
      showToast('Saved', 'ok');
    });

    $('btn-export').addEventListener('click', function () {
      var plan = M.readPlan();
      var name = (plan.business_name || 'floor-plan').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      IO.downloadText(name + '-floorplan.json', IO.exportJSON(doc, {
        business_name: plan.business_name || '', address: plan.address || ''
      }));
      showToast('Exported', 'ok');
    });

    $('btn-scan').addEventListener('click', function () {
      var p = M.readPlan();
      location.href = 'divisionscan://scan?plan_id=' + encodeURIComponent(ppPlanId()) +
        '&dept=' + ppDept() +
        '&name=' + encodeURIComponent(p.business_name || '') +
        '&addr=' + encodeURIComponent(p.address || '') +
        '&return=page11';
    });

    $('btn-clear').addEventListener('click', function () {
      if (!confirm('Clear the drawing on ' + doc.floor().name + '? Other floors are left alone.')) return;
      doc.pushUndo();
      var f = doc.floor();
      M.FLOOR_LISTS.forEach(function (k) { f[k] = []; });
      f.underlay = null;
      state.selected = null;
      hideEditPanel(); hideZonePanel(); syncUnderlayPanel();
      updateCounts(); updateAreaBar(); renderFloors(); refreshEmptyState();
      commit('Cleared');
    });

    $('btn-3d').addEventListener('click', toggle3D);

    $('ep-close').addEventListener('click', function () { hideEditPanel(); state.selected = null; draw(); });
    $('ep-delete').addEventListener('click', deleteSelected);
    $('text-confirm').addEventListener('click', commitText);
    $('text-cancel').addEventListener('click', function () {
      textOverlay.classList.remove('open');
      pendingTextPos = null;
    });

    $('es-draw').addEventListener('click', function () { hideEmpty(); setTool('chain'); showToast('Tap each corner of the building'); });
    $('es-trace').addEventListener('click', function () { openPanel('underlay-panel'); syncUnderlayPanel(); $('ul-file').click(); });
    $('es-import').addEventListener('click', openImportPanel);

    $('sym-search').addEventListener('input', function () { searchQuery = this.value; renderPaletteBody(); });
  }

  /* ------------------------------------------------------------- orient */

  function initOrient() {
    var slider = $('vc-rotate'), val = $('rot-val');
    slider.addEventListener('input', function () {
      state.view.rotation = parseFloat(slider.value) || 0;
      val.textContent = Math.round(state.view.rotation) + '°';
      draw();
    });
    slider.addEventListener('change', function () {
      if (doc) { doc.data.view_rotation = state.view.rotation; saveSoon(); }
    });
    $('vc-snap').addEventListener('click', function () {
      state.view.rotation = Math.round(state.view.rotation / 90) * 90;
      slider.value = state.view.rotation;
      val.textContent = Math.round(state.view.rotation) + '°';
      doc.data.view_rotation = state.view.rotation;
      saveSoon(); draw();
    });
    $('vc-north').addEventListener('click', function () {
      var h = doc.data.scan_meta && doc.data.scan_meta.compass_heading;
      if (h == null) { showToast('No compass heading in this plan', 'err'); return; }
      state.view.rotation = -h;
      slider.value = state.view.rotation;
      val.textContent = Math.round(state.view.rotation) + '°';
      doc.data.view_rotation = state.view.rotation;
      saveSoon(); draw();
      showToast('Aligned to the scan compass', 'ok');
    });
    $('vc-reset').addEventListener('click', function () {
      state.view.rotation = 0;
      slider.value = 0; val.textContent = '0°';
      doc.data.view_rotation = 0;
      saveSoon(); renderer.fitToView();
    });
    $('vc-northdeg').addEventListener('change', function () {
      doc.data.sheet.north = parseFloat(this.value) || 0;
      var nl = $('north-readout');
      if (nl) nl.textContent = Math.round(doc.data.sheet.north) + '°';
      saveSoon(); draw();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-north]'), function (b) {
      b.addEventListener('click', function () {
        doc.pushUndo();
        var v = b.getAttribute('data-north');
        if (v === 'scan') {
          var h = doc.data.scan_meta && doc.data.scan_meta.compass_heading;
          if (h == null) { showToast('No compass heading in this plan', 'err'); return; }
          doc.data.sheet.north = ((h % 360) + 360) % 360;
        } else {
          doc.data.sheet.north = parseFloat(v) || 0;
        }
        $('vc-northdeg').value = doc.data.sheet.north;
        var nl = $('north-readout');
        if (nl) nl.textContent = Math.round(doc.data.sheet.north) + '°';
        commit('North ' + Math.round(doc.data.sheet.north) + '°');
      });
    });
    $('vc-shownorth').addEventListener('change', function () {
      doc.data.sheet.show_north = this.checked; saveSoon(); draw();
    });
    $('vc-showscale').addEventListener('change', function () {
      doc.data.sheet.show_scalebar = this.checked; saveSoon(); draw();
    });
  }

  /* ------------------------------------------------------------------ 3D */

  function toggle3D() {
    state.threeD = !state.threeD;
    $('threed-wrap').classList.toggle('on', state.threeD);
    $('btn-3d').classList.toggle('active', state.threeD);
    togglePanel('threeD-controls');
    if (state.threeD) {
      if (!three) {
        three = window.FP3D.create({
          state: state, wrap: wrap, threeCanvas: $('three-canvas'),
          symbols: SYMBOLS,
          beforeRebuild: function () { renderer.buildViewModel(); }
        });
      }
      three.initOrUpdate();
      three.startLoop();
    } else if (three) {
      three.stop();
    }
  }

  function init3DControls() {
    function bind(id, key, parse) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        state.threeDView[key] = parse ? parse(el.value) : el.value;
        if (three && state.threeD) { three.rebuild(); three.updateCamera(); }
      });
    }
    bind('td-rotate', 'rotate', parseFloat);
    bind('td-tilt', 'tilt', parseFloat);
    bind('td-wall-h', 'wallH', parseFloat);
    var fur = $('td-furniture');
    if (fur) fur.addEventListener('change', function () {
      state.threeDView.showFurniture = fur.checked;
      if (three && state.threeD) three.rebuild();
    });
    var rst = $('td-reset');
    if (rst) rst.addEventListener('click', function () {
      state.threeDView.rotate = 45; state.threeDView.tilt = 45;
      $('td-rotate').value = 45; $('td-tilt').value = 45;
      if (three && state.threeD) { three.rebuild(); three.updateCamera(); }
    });
  }

  /* The contract other scripts rely on. fp-markers.js reads most of this.
   * Assigned at SCRIPT EVALUATION time, not inside init(): fp-markers.js reads
   * window.FP the moment its own tag runs and disables itself if it is absent. */
  window.FP = {
    state: state,
    draw: draw,
    fitToView: function () { if (renderer) renderer.fitToView(); },
    loadLatestCapture: function () { var b = $('imp-latest'); if (b) b.click(); },
    SYMBOLS: SYMBOLS,
    wrap: wrap, canvas: canvas,
    /* renderer does not exist until init(), so this is resolved on read. */
    get ctx() { return renderer ? renderer.ctx : null; },
    emptyData: M.emptyPlan,
    pushUndo: function () { if (doc) doc.pushUndo(); },
    saveToStorage: function () { saveToStorage({ withImage: false }); },
    updateCounts: updateCounts,
    hideEmpty: hideEmpty,
    showToast: showToast,
    setTool: setTool,
    screenToData: function (sx, sy) { return renderer ? renderer.screenToData(sx, sy) : { x: sx, y: sy }; },
    dataToScreen: function (x, y) { return renderer ? renderer.dataToScreen(x, y) : { sx: x, sy: y }; },
    degToRad: function (d) { return d * Math.PI / 180; },
    uid: uid,
    selectSymbol: selectSymbol,
    hitTest: function (sx, sy) { return renderer ? renderer.hitTest(sx, sy) : null; },
    deleteElement: function (hit) { state.selected = hit; deleteSelected(); },
    showEditPanel: showEditPanel,
    /* v5 additions, for anything that wants them later. */
    doc: function () { return doc; },
    symbolStyle: symbolStyle,
    toggleSymbolStyle: toggleSymbolStyle,
    renderer: function () { return renderer; },
    get tool() { return state.tool; },
    set tool(t) { setTool(t); }
  };

  /* =============================================================== boot */

  function attachCanvasEvents() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', function (e) {
      if (!drag && !state.drawing) { state.snap = null; state.guides = []; draw(); }
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = canvas.getBoundingClientRect();
      renderer.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 0.89);
    }, { passive: false });
    canvas.addEventListener('click', function (e) {
      if (state.tool !== 'zone') return;
      var p = evPos(e);
      zoneAtClick(renderer.screenToData(p.sx, p.sy));
    });
    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (state.drawing && (state.drawing.kind === 'chain' || state.drawing.kind === 'zone')) finishChain(false);
    });
  }

  function resize() {
    renderer.resizeCanvas(wrap);
    if (three && state.threeD) three.resize(state.view.width, state.view.height);
    draw();
  }

  function init() {
    /* The Worker used to inject a panel that painted `floor_plan_image` — the
     * saved snapshot of THIS drawing — underneath the canvas as a
     * "background", putting a stale ghost of the drawing under the live one on
     * every load. The hook was removed from the Worker on 2026-08-27, but a
     * cached copy of the old panel can still be served for a while, so this
     * stays: non-writable, so the old script's assignment cannot revive it. */
    try {
      Object.defineProperty(window, 'fpBgLoad', {
        value: function () {}, writable: false, configurable: false
      });
    } catch (e) {}

    doc = M.loadDoc();
    if (!doc) doc = new M.Doc(null);

    state.view.rotation = doc.data.view_rotation || 0;

    renderer = window.FPRender.create({
      canvas: canvas,
      state: state,
      symbols: SYMBOLS,
      getDoc: function () { return doc; },
      onStatus: function () {}
    });

    registerCustomSymbols();
    retireSupersededSymbols();
    applySymbolStyle();
    initLayers();
    buildPalette();
    initSymbolGenerator();
    initToolbar();
    initPanelCloses();
    initZonePanel();
    initUnderlayPanel();
    initImportPanel();
    initDropZone();
    initOrient();
    init3DControls();
    initFloorButtons();
    initKeyboard();
    attachCanvasEvents();

    $('vc-rotate').value = state.view.rotation;
    $('rot-val').textContent = Math.round(state.view.rotation) + '°';
    $('vc-northdeg').value = (doc.data.sheet && doc.data.sheet.north) || 0;
    var nr0 = $('north-readout');
    if (nr0) nr0.textContent = Math.round((doc.data.sheet && doc.data.sheet.north) || 0) + '°';
    $('vc-shownorth').checked = doc.data.sheet.show_north !== false;
    $('vc-showscale').checked = doc.data.sheet.show_scalebar !== false;

    window.addEventListener('resize', resize);
    resize();

    renderFloors();
    updateCounts();
    updateAreaBar();
    updateMeta();
    syncUnderlayPanel();
    refreshEmptyState();
    updateHint();
    renderer.fitToView();
    requestAnimationFrame(function () {
      resize();
      renderer.fitToView();
    });

    /* Save on the way out. A drawing that only lives in memory is a drawing
     * somebody is going to lose. */
    window.addEventListener('beforeunload', function () {
      try { saveToStorage({ withImage: false }); } catch (e) {}
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { try { saveToStorage({ withImage: false }); } catch (e) {} }
    });

    /* ?job=<id> opens a specific capture, the link the app sends people back on. */
    try {
      var jid = new URLSearchParams(location.search).get('job');
      if (jid) {
        IO.fetchCapture(jid).then(function (job) {
          applyImport(IO.parseScan(job), 'capture ' + jid);
        }).catch(function (e) { showToast('Could not load that capture: ' + (e.message || e), 'err'); });
      }
    } catch (e) {}

    draw();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
