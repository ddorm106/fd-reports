/* ===========================================================================
 * fp-markers.js — page 11 for the fire service, and a way to not get lost
 *
 * TWO COMPLAINTS, BOTH FAIR
 * -------------------------
 * "The CAD objects suck." The symbol library is 124 items and 80 of them are
 * furniture, shop fittings and mechanical plant — sofas, display racks, washer
 * dryers. That is a floor-plan-drawing library. Nobody pre-planning a building
 * needs to draw a sofa, and hunting past twenty of them to find the FDC is
 * work that produces nothing.
 *
 * "It's easy to get lost in it." The canvas pans, zooms AND rotates, on a plan
 * that can be 4000 px wide, with no overview and no way back. Two flicks and
 * you are looking at empty grid with no idea which way is up.
 *
 * WHAT THIS DOES
 * --------------
 * 1. Puts the fire-service symbols first and on their own — FDC, hydrant,
 *    Knox, riser, standpipe, FACP, shutoffs, exits, stairs, hazmat — as big
 *    labelled buttons. The rest of the library is still there, one tap away,
 *    for anyone who does want to draw the shop fittings.
 * 2. Adds a "Where am I" panel: a live minimap with the viewport drawn on it,
 *    a Fit button, and a list of everything placed that you tap to fly to.
 * 3. Locks rotation at north-up by default. Rotation is the single fastest way
 *    to lose your bearings on a plan, and it is off unless asked for.
 *
 * Reaches the host editor through window.FP only. Nothing about the saved data
 * changes: these are the same symbols with the same ids, just findable.
 * ======================================================================== */

(function () {
  'use strict';

  var FP = window.FP;
  if (!FP || !FP.state || !FP.SYMBOLS) {
    console.warn('[fp-markers] window.FP not available; not initialising');
    return;
  }

  var state = FP.state;

  // Categories that belong on a pre-plan, in the order a size-up wants them.
  var FIRE_CATS = ['fire', 'utilities', 'access', 'hazmat', 'compass'];

  // Symbols worth promoting to the top of the list regardless of category —
  // the ones that get looked for on every single building.
  var PRIORITY = ['fdc', 'hydrant', 'knox', 'sprinkler', 'standpipe', 'facp',
                  'annunciator', 'gas', 'electric', 'water', 'shutoff'];

  function fireSymbols() {
    var all = FP.SYMBOLS.all || [];
    var picked = all.filter(function (s) { return FIRE_CATS.indexOf(s.cat) >= 0; });
    picked.sort(function (a, b) {
      var ai = PRIORITY.indexOf(a.id), bi = PRIORITY.indexOf(b.id);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      var ac = FIRE_CATS.indexOf(a.cat), bc = FIRE_CATS.indexOf(b.cat);
      if (ac !== bc) return ac - bc;
      return a.label.localeCompare(b.label);
    });
    return picked;
  }

  function otherSymbols() {
    return (FP.SYMBOLS.all || []).filter(function (s) { return FIRE_CATS.indexOf(s.cat) < 0; });
  }

  // ------------------------------------------------------------- palette
  var showingOther = false;

  function renderPalette() {
    var tabs = document.getElementById('cat-tabs');
    var body = document.getElementById('sym-body');
    if (!tabs || !body) return;

    tabs.innerHTML = '';
    [['Fire service', false], ['Everything else', true]].forEach(function (t) {
      var el = document.createElement('div');
      el.className = 'fp-cat-tab' + (showingOther === t[1] ? ' active' : '');
      el.textContent = t[0];
      el.addEventListener('click', function () { showingOther = t[1]; renderPalette(); });
      tabs.appendChild(el);
    });

    var syms = showingOther ? otherSymbols() : fireSymbols();
    body.innerHTML = '';
    body.classList.add('fp-marker-grid');

    syms.forEach(function (sym) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'fp-marker' + (state.selectedSymbolId === sym.id ? ' active' : '');
      chip.dataset.symbolId = sym.id;

      var c = document.createElement('canvas');
      c.width = 54; c.height = 54;
      var g = c.getContext('2d');
      g.save(); g.translate(27, 27);
      var k = Math.min(40 / sym.w, 40 / sym.h);
      g.scale(k, k);
      try { sym.draw(g, sym.w, sym.h); } catch (e) {}
      g.restore();
      chip.appendChild(c);

      var lbl = document.createElement('span');
      lbl.textContent = sym.label;
      chip.appendChild(lbl);

      chip.addEventListener('click', function () {
        FP.selectSymbol(sym.id);
        renderPalette();
      });
      body.appendChild(chip);
    });
  }

  // ------------------------------------------------ where-am-I / minimap
  var mini, miniCtx, listEl;

  function planBounds() {
    var d = state.data;
    if (!d) return null;
    return { x: 0, y: 0, w: d.canvas_width || 1000, h: d.canvas_height || 700 };
  }

  function drawMini() {
    if (!mini || !miniCtx || !state.data) return;
    var b = planBounds();
    var W = mini.width, H = mini.height;
    miniCtx.setTransform(1, 0, 0, 1, 0, 0);
    miniCtx.clearRect(0, 0, W, H);
    miniCtx.fillStyle = '#f8fafc';
    miniCtx.fillRect(0, 0, W, H);

    var k = Math.min(W / b.w, H / b.h) * 0.92;
    var ox = (W - b.w * k) / 2, oy = (H - b.h * k) / 2;

    // the building
    miniCtx.strokeStyle = '#334155';
    miniCtx.lineWidth = 1;
    (state.data.walls || []).forEach(function (w) {
      miniCtx.beginPath();
      miniCtx.moveTo(ox + w.x1 * k, oy + w.y1 * k);
      miniCtx.lineTo(ox + w.x2 * k, oy + w.y2 * k);
      miniCtx.stroke();
    });
    // markers
    miniCtx.fillStyle = '#dc2626';
    (state.data.symbols || []).forEach(function (s) {
      miniCtx.beginPath();
      miniCtx.arc(ox + s.x * k, oy + s.y * k, 2, 0, Math.PI * 2);
      miniCtx.fill();
    });

    // where the screen currently is, in plan coordinates
    var tl = FP.screenToData(0, 0);
    var br = FP.screenToData(state.view.width, state.view.height);
    miniCtx.strokeStyle = '#f97316';
    miniCtx.lineWidth = 2;
    miniCtx.strokeRect(ox + tl.x * k, oy + tl.y * k,
                       (br.x - tl.x) * k, (br.y - tl.y) * k);
  }

  /** Centre the view on a plan coordinate without changing zoom. */
  function flyTo(x, y) {
    var z = state.view.zoom;
    var cw = state.data.canvas_width, ch = state.data.canvas_height;
    var cx = cw / 2, cy = ch / 2;
    var r = FP.degToRad(state.view.rotation);
    var dx = x - cx, dy = y - cy;
    var rx = dx * Math.cos(r) - dy * Math.sin(r);
    var ry = dx * Math.sin(r) + dy * Math.cos(r);
    state.view.panX = state.view.width / 2 - (rx + cx) * z;
    state.view.panY = state.view.height / 2 - (ry + cy) * z;
    FP.draw();
  }

  function elementList() {
    var d = state.data;
    if (!d) return [];
    var out = [];
    (d.symbols || []).forEach(function (s, i) {
      var sym = FP.SYMBOLS.byId ? FP.SYMBOLS.byId[s.symbolId] : null;
      out.push({ kind: 'symbol', i: i, x: s.x, y: s.y,
                 label: (s.label || (sym && sym.label) || s.symbolId || 'Marker') });
    });
    (d.texts || []).forEach(function (t, i) {
      out.push({ kind: 'text', i: i, x: t.x, y: t.y, label: t.text || 'Label' });
    });
    (d.objects || []).forEach(function (o, i) {
      if (!o.label) return;
      out.push({ kind: 'object', i: i, x: o.x, y: o.y, label: o.label });
    });
    return out;
  }

  function renderList() {
    if (!listEl) return;
    var items = elementList();
    listEl.innerHTML = '';
    if (!items.length) {
      var e = document.createElement('div');
      e.className = 'fp-nav-empty';
      e.textContent = 'Nothing placed yet. Markers and labels show up here so you can jump straight to them.';
      listEl.appendChild(e);
      return;
    }
    items.forEach(function (it) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'fp-nav-row';
      row.innerHTML = '<span class="fp-nav-kind ' + it.kind + '"></span><span>' +
                      String(it.label).replace(/[<>&]/g, '') + '</span>';
      row.addEventListener('click', function () { flyTo(it.x, it.y); });
      listEl.appendChild(row);
    });
  }

  function buildNavPanel() {
    var host = document.getElementById('layers');
    if (!host || !host.parentNode) return;

    var panel = document.createElement('div');
    panel.className = 'fp-panel';
    panel.id = 'fp-nav-panel';
    panel.innerHTML =
      '<h4>Where am I</h4>' +
      '<canvas id="fp-mini" width="200" height="140"></canvas>' +
      '<div class="fp-nav-btns">' +
        '<button class="fp-tbtn sm" id="fp-fit">Fit building</button>' +
        '<label class="fp-nav-lock"><input type="checkbox" id="fp-lock-rot" checked> North up</label>' +
      '</div>' +
      '<div class="fp-nav-list" id="fp-nav-list"></div>';
    host.parentNode.insertBefore(panel, host);

    mini = document.getElementById('fp-mini');
    miniCtx = mini.getContext('2d');
    listEl = document.getElementById('fp-nav-list');

    // Tap the minimap to jump there.
    mini.addEventListener('click', function (e) {
      if (!state.data) return;
      var b = planBounds(), r = mini.getBoundingClientRect();
      var k = Math.min(mini.width / b.w, mini.height / b.h) * 0.92;
      var ox = (mini.width - b.w * k) / 2, oy = (mini.height - b.h * k) / 2;
      var mx = (e.clientX - r.left) * (mini.width / r.width);
      var my = (e.clientY - r.top) * (mini.height / r.height);
      flyTo((mx - ox) / k, (my - oy) / k);
    });

    document.getElementById('fp-fit').addEventListener('click', function () {
      FP.fitToView();
    });

    // Rotation is the fastest way to lose your bearings, so it is locked at
    // north-up unless deliberately unlocked.
    var lock = document.getElementById('fp-lock-rot');
    function applyLock() {
      var rot = document.getElementById('vc-rotate');
      var snap = document.getElementById('vc-snap');
      var north = document.getElementById('vc-north');
      [rot, snap, north].forEach(function (el) {
        if (!el) return;
        el.disabled = lock.checked;
        el.style.opacity = lock.checked ? 0.4 : 1;
      });
      if (lock.checked && state.view.rotation !== 0) {
        state.view.rotation = 0;
        var rv = document.getElementById('rot-val');
        if (rv) rv.textContent = '0°';
        if (rot) rot.value = 0;
        FP.draw();
      }
    }
    lock.addEventListener('change', applyLock);
    applyLock();
  }

  // ---------------------------------------------------------------- styles
  function style() {
    var css = document.createElement('style');
    css.textContent = [
      '.fp-marker-grid{display:grid !important;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;}',
      '.fp-marker{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;',
      ' border:1px solid #e2e8f0;border-radius:10px;background:#fff;cursor:pointer;min-height:88px;}',
      '.fp-marker span{font:600 10.5px system-ui,-apple-system,sans-serif;color:#334155;',
      ' text-align:center;line-height:1.2;}',
      '.fp-marker.active{border-color:#dc2626;background:#fef2f2;box-shadow:0 0 0 2px rgba(220,38,38,.18);}',
      '#fp-nav-panel canvas{width:100%;height:auto;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;',
      ' display:block;cursor:crosshair;}',
      '.fp-nav-btns{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;}',
      '.fp-nav-btns .fp-tbtn{flex:1;}',
      '.fp-nav-lock{display:flex;align-items:center;gap:6px;font:600 11px system-ui,sans-serif;color:#334155;}',
      '.fp-nav-list{margin-top:8px;max-height:190px;overflow:auto;-webkit-overflow-scrolling:touch;}',
      '.fp-nav-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;',
      ' background:transparent;padding:9px 6px;border-radius:7px;cursor:pointer;min-height:40px;',
      ' font:600 12px system-ui,sans-serif;color:#1e293b;}',
      '.fp-nav-row:hover{background:#f1f5f9;}',
      '.fp-nav-kind{width:9px;height:9px;border-radius:50%;flex:0 0 9px;background:#94a3b8;}',
      '.fp-nav-kind.symbol{background:#dc2626;}.fp-nav-kind.text{background:#475569;}',
      '.fp-nav-kind.object{background:#7c3aed;}',
      '.fp-nav-empty{font:400 11px system-ui,sans-serif;color:#64748b;padding:8px 4px;line-height:1.45;}',
      '@media (pointer:coarse){',
      ' .fp-marker{min-height:96px;}',
      ' .fp-nav-row{min-height:46px;font-size:13px;}',
      '}'
    ].join('');
    document.head.appendChild(css);
  }

  // The host repaints on every change; ride that to keep the minimap and the
  // element list honest without polling.
  var prevOverlay = window.__FP_OVERLAY;
  window.__FP_OVERLAY = function () {
    if (prevOverlay) { try { prevOverlay(); } catch (e) {} }
    try { drawMini(); } catch (e) {}
  };

  var lastCount = -1;
  setInterval(function () {
    if (!state.data) return;
    var n = (state.data.symbols || []).length + (state.data.texts || []).length +
            (state.data.objects || []).length;
    if (n !== lastCount) { lastCount = n; renderList(); }
  }, 900);

  function boot() {
    style();
    renderPalette();
    buildNavPanel();
    renderList();
    setTimeout(function () { drawMini(); }, 200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.FP_MARKERS = { renderPalette: renderPalette, flyTo: flyTo, fireSymbols: fireSymbols };
})();
