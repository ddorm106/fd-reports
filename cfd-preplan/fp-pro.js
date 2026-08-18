/* ===========================================================================
 * fp-pro.js — page 11 floor plan, field-practical additions
 *
 * page11-floor-plan.html runs its editor inside an IIFE, so this file reaches
 * it through exactly two published seams: window.FP (the internals it exports)
 * and window.__FP_OVERLAY (invoked at the tail of every draw()). Nothing here
 * replaces host behaviour.
 *
 * The host already has Select / Pan / Wall (one drag) / Room (drag a
 * rectangle) / Pen / Text / Measure / Place / Delete, and an editable Length
 * field on a selected wall. What it did not have, and what made a real
 * building impractical to draw:
 *
 *   1. Chained walls. Tap corner to corner instead of one drag per wall.
 *      A 40-corner perimeter was 40 separate drags with no shared corners.
 *   2. Dimensions while you draw. The host can fix a wall's length after the
 *      fact by selecting it; you could not state a length up front, and you
 *      could not see one at all during a drag.
 *   3. Corners that actually meet. Endpoint snapping on the chain tool, plus
 *      a Weld pass for cleaning up a traced or imported outline. An outline
 *      only reads as enclosed — and only computes an area — if corners
 *      coincide.
 *   4. Sheet furniture. North arrow, graphic scale bar, title block.
 *
 * Angle lock exists but defaults OFF, deliberately: several buildings in this
 * book have genuinely angled walls, and snapping moves real corners.
 *
 * The data model is untouched — walls stay plain {x1,y1,x2,y2} in
 * floor_plan_data, which the Worker's handleFromCapture and page 12's
 * renderV4Floorplan both depend on.
 * ======================================================================== */

(function () {
  'use strict';

  var FP = window.FP;
  if (!FP || !FP.state || !FP.wrap) {
    console.warn('[fp-pro] window.FP not published by the host page; not initialising');
    return;
  }

  var state         = FP.state,
      wrap          = FP.wrap,
      screenToData  = FP.screenToData,
      dataToScreen  = FP.dataToScreen,
      pushUndo      = FP.pushUndo,
      saveToStorage = FP.saveToStorage,
      emptyData     = FP.emptyData,
      updateCounts  = FP.updateCounts,
      hideEmpty     = FP.hideEmpty,
      showToast     = FP.showToast,
      degToRad      = FP.degToRad;

  // ---------------------------------------------------------------- config
  var PRO = {
    chainActive: false,
    chain: null,          // { pts: [{x,y}], preview: {x,y} }
    angleSnap: false,     // OFF on purpose — see header
    angleStep: 45,
    endpointSnap: true,
    lastSnap: null,
    sheet: true,
    northDeg: 0,
    weldFeet: 0.5         // matches DivisionScan Manual Draw's join tolerance
  };
  window.FP_PRO = PRO;

  var SNAP_PX = 16;

  // ------------------------------------------------------------- utilities
  function sf() { return (state.data && state.data.scale_px_per_ft) || 12; }
  function ftToPx(ft) { return ft * sf(); }
  function pxToFt(px) { return px / sf(); }

  function ensureData() {
    if (!state.data) state.data = emptyData();
    if (typeof hideEmpty === 'function') hideEmpty();
    return state.data;
  }

  /** "47", "47.5", "47 6", "47'6", "47' 6\"", "47-6"  ->  feet. */
  function parseFeet(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;
    s = s.replace(/["”]/g, '').replace(/[’]/g, "'");
    var m = s.match(/^(-?\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)?$/)
         || s.match(/^(-?\d+(?:\.\d+)?)\s*[-\s]\s*(\d+(?:\.\d+)?)$/);
    if (m) {
      var ft = parseFloat(m[1]);
      var inch = m[2] ? parseFloat(m[2]) : 0;
      if (!isFinite(ft) || !isFinite(inch)) return null;
      return ft + (ft < 0 ? -inch : inch) / 12;
    }
    var plain = parseFloat(s.replace(/'/g, ''));
    return isFinite(plain) ? plain : null;
  }

  /** "40 x 25", "40x25", "40' 6 x 25" -> [w,h] in feet, or null. */
  function parseSize(raw) {
    if (raw == null) return null;
    var parts = String(raw).split(/\s*[x×]\s*/i);
    if (parts.length !== 2) return null;
    var w = parseFeet(parts[0]), h = parseFeet(parts[1]);
    return (w && h && w > 0 && h > 0) ? [w, h] : null;
  }

  function fmtFeet(ft) {
    if (!isFinite(ft)) return '—';
    var whole = Math.floor(Math.abs(ft));
    var inch = Math.round((Math.abs(ft) - whole) * 12);
    if (inch === 12) { whole += 1; inch = 0; }
    var sign = ft < 0 ? '-' : '';
    return inch ? sign + whole + "' " + inch + '"' : sign + whole + "'";
  }

  /** Degrees clockwise from page-up, offset by the sheet's north. */
  function bearingOf(ax, ay, bx, by) {
    var d = Math.atan2(bx - ax, -(by - ay)) * 180 / Math.PI + PRO.northDeg;
    return ((d % 360) + 360) % 360;
  }

  // ---------------------------------------------------------------- snapping
  function snapToEndpoint(pt) {
    if (!PRO.endpointSnap || !state.data) return null;
    var tol = SNAP_PX / Math.max(state.view.zoom, 0.0001);
    var best = null, bestD = tol;
    var walls = state.data.walls || [];
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      var ends = [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }];
      for (var k = 0; k < 2; k++) {
        var d = Math.hypot(ends[k].x - pt.x, ends[k].y - pt.y);
        if (d < bestD) { bestD = d; best = { x: ends[k].x, y: ends[k].y, kind: 'endpoint' }; }
      }
    }
    // The chain's own start, so a perimeter can close onto itself.
    if (PRO.chain && PRO.chain.pts.length > 2) {
      var s0 = PRO.chain.pts[0];
      if (Math.hypot(s0.x - pt.x, s0.y - pt.y) < bestD) {
        best = { x: s0.x, y: s0.y, kind: 'close' };
      }
    }
    return best;
  }

  function snapAngle(anchor, pt) {
    if (!PRO.angleSnap || !anchor) return null;
    var dx = pt.x - anchor.x, dy = pt.y - anchor.y;
    var len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    var step = PRO.angleStep * Math.PI / 180;
    var a = Math.round(Math.atan2(dy, dx) / step) * step;
    return { x: anchor.x + Math.cos(a) * len, y: anchor.y + Math.sin(a) * len, kind: 'angle' };
  }

  function resolvePoint(dpt, anchor) {
    var ep = snapToEndpoint(dpt);
    if (ep) { PRO.lastSnap = ep; return ep; }
    var ang = snapAngle(anchor, dpt);
    if (ang) { PRO.lastSnap = ang; return ang; }
    PRO.lastSnap = null;
    return { x: dpt.x, y: dpt.y, kind: null };
  }

  /**
   * Weld wall endpoints within `feet` of each other onto a shared point.
   * Traced and imported outlines nearly always have hairline gaps at the
   * corners, and a gap means the outline is not closed: it will not read as a
   * room and its area comes out wrong.
   *
   * The tolerance stays small and user-visible. Welding MOVES real corners, so
   * a generous value would pull genuinely separate walls together — the same
   * reasoning that keeps DivisionScan's Manual Draw join tolerance at 0.5 ft
   * and keeps right-angle snapping off entirely.
   */
  function weldCorners(feet) {
    if (!state.data || !state.data.walls || !state.data.walls.length) {
      showToast('Nothing to weld', 'err');
      return 0;
    }
    var tol = ftToPx(feet);
    var walls = state.data.walls;
    var pts = [];
    for (var i = 0; i < walls.length; i++) {
      pts.push({ w: i, e: 1, x: walls[i].x1, y: walls[i].y1 });
      pts.push({ w: i, e: 2, x: walls[i].x2, y: walls[i].y2 });
    }
    var clusters = [], moved = 0;
    for (var p = 0; p < pts.length; p++) {
      var placed = false;
      for (var c = 0; c < clusters.length; c++) {
        if (Math.hypot(clusters[c].x - pts[p].x, clusters[c].y - pts[p].y) <= tol) {
          clusters[c].members.push(pts[p]);
          // Running centroid, so a welded corner lands between its
          // contributors rather than on whichever endpoint happened to be first.
          var n = clusters[c].members.length;
          clusters[c].x += (pts[p].x - clusters[c].x) / n;
          clusters[c].y += (pts[p].y - clusters[c].y) / n;
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ x: pts[p].x, y: pts[p].y, members: [pts[p]] });
    }
    pushUndo();
    for (var q = 0; q < clusters.length; q++) {
      var cl = clusters[q];
      if (cl.members.length < 2) continue;
      for (var m = 0; m < cl.members.length; m++) {
        var mem = cl.members[m], wall = walls[mem.w];
        var ox = mem.e === 1 ? wall.x1 : wall.x2;
        var oy = mem.e === 1 ? wall.y1 : wall.y2;
        if (Math.hypot(ox - cl.x, oy - cl.y) > 1e-6) moved++;
        if (mem.e === 1) { wall.x1 = cl.x; wall.y1 = cl.y; }
        else { wall.x2 = cl.x; wall.y2 = cl.y; }
      }
    }
    saveToStorage();
    FP.draw();
    showToast(moved ? moved + ' corner point(s) welded' : 'Corners already meet', 'ok');
    return moved;
  }
  window.fpWeldCorners = weldCorners;

  // ------------------------------------------------------------ wall commits
  function addWall(a, b) {
    var d = ensureData();
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) return false;
    d.walls.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    return true;
  }

  function commitChain(closeIt) {
    var c = PRO.chain;
    if (!c || c.pts.length < 2) { PRO.chain = null; redraw(); syncHUD(); return; }
    pushUndo();
    var n = 0;
    for (var i = 0; i < c.pts.length - 1; i++) if (addWall(c.pts[i], c.pts[i + 1])) n++;
    if (closeIt && c.pts.length > 2 && addWall(c.pts[c.pts.length - 1], c.pts[0])) n++;
    PRO.chain = null;
    if (typeof updateCounts === 'function') updateCounts();
    saveToStorage();
    if (typeof hideEmpty === 'function') hideEmpty();
    redraw();
    showToast(n + ' wall' + (n === 1 ? '' : 's') + ' added', 'ok');
    syncHUD();
  }

  function redraw() { FP.draw(); }

  // ------------------------------------------------------------ pointer layer
  // Capture phase on `wrap`: the host's listeners are bubble phase on the same
  // element and the pointer target is the canvas inside it, so this runs first
  // and stopPropagation keeps the host handlers out of the way while the chain
  // tool owns the pointer.
  function localPoint(e) {
    var r = wrap.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  wrap.addEventListener('pointerdown', function (e) {
    if (!PRO.chainActive || e.isPrimary === false) return;
    e.stopPropagation();
    e.preventDefault();
    try { wrap.setPointerCapture(e.pointerId); } catch (_) {}

    var p = localPoint(e);
    var dpt = screenToData(p.sx, p.sy);
    ensureData();

    var anchor = PRO.chain && PRO.chain.pts.length ? PRO.chain.pts[PRO.chain.pts.length - 1] : null;
    var snapped = resolvePoint(dpt, anchor);
    if (!PRO.chain) {
      PRO.chain = { pts: [{ x: snapped.x, y: snapped.y }], preview: null };
    } else if (snapped.kind === 'close') {
      commitChain(true);
      return;
    } else {
      PRO.chain.pts.push({ x: snapped.x, y: snapped.y });
    }
    PRO.chain.preview = { x: snapped.x, y: snapped.y };
    redraw();
    syncHUD();
  }, true);

  wrap.addEventListener('pointermove', function (e) {
    if (!PRO.chainActive || e.isPrimary === false) return;
    var p = localPoint(e);
    var dpt = screenToData(p.sx, p.sy);
    if (PRO.chain) {
      e.stopPropagation();
      var anchor = PRO.chain.pts[PRO.chain.pts.length - 1];
      var snapped = resolvePoint(dpt, anchor);
      PRO.chain.preview = { x: snapped.x, y: snapped.y };
      redraw();
      syncHUD();
    } else {
      var ep = snapToEndpoint(dpt);
      if (ep !== PRO.lastSnap) { PRO.lastSnap = ep; redraw(); }
    }
  }, true);

  wrap.addEventListener('dblclick', function (e) {
    if (PRO.chainActive && PRO.chain) {
      e.stopPropagation(); e.preventDefault();
      commitChain(false);
    }
  }, true);

  // ---------------------------------------------------------------- keyboard
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Escape') {
      if (PRO.chain) { PRO.chain = null; redraw(); syncHUD(); }
      else if (PRO.chainActive) exitChain();
    } else if (e.key === 'Enter' && PRO.chain) {
      commitChain(false);
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && PRO.chain) {
      e.preventDefault();
      PRO.chain.pts.pop();
      if (!PRO.chain.pts.length) PRO.chain = null;
      redraw(); syncHUD();
    }
  });

  // ------------------------------------------------------------ preview paint
  window.__FP_OVERLAY = function () {
    paintOverlay();
    // Host drags redraw on every pointermove, so this keeps the readout live
    // for the host's own Wall / Room / Measure tools too.
    syncHUD();
  };

  function paintOverlay() {
    var c = FP.ctx;
    if (!c) return;
    if (state.data) {
      c.save();
      c.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

      if (PRO.chain && PRO.chain.pts.length) {
        var pts = PRO.chain.pts.slice();
        if (PRO.chain.preview) pts.push(PRO.chain.preview);
        c.strokeStyle = '#f97316';
        c.lineWidth = 2;
        c.setLineDash([6, 4]);
        c.beginPath();
        for (var i = 0; i < pts.length; i++) {
          var s = dataToScreen(pts[i].x, pts[i].y);
          if (i === 0) c.moveTo(s.sx, s.sy); else c.lineTo(s.sx, s.sy);
        }
        c.stroke();
        c.setLineDash([]);

        for (var j = 0; j < PRO.chain.pts.length; j++) {
          var sp = dataToScreen(PRO.chain.pts[j].x, PRO.chain.pts[j].y);
          c.fillStyle = j === 0 ? '#16a34a' : '#f97316';
          c.beginPath(); c.arc(sp.sx, sp.sy, j === 0 ? 6 : 4, 0, Math.PI * 2); c.fill();
          c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke();
        }
        if (PRO.chain.preview) {
          labelSegment(c, PRO.chain.pts[PRO.chain.pts.length - 1], PRO.chain.preview, false);
        }
        for (var k = 0; k < PRO.chain.pts.length - 1; k++) {
          labelSegment(c, PRO.chain.pts[k], PRO.chain.pts[k + 1], true);
        }
      }

      // Live dimension for the host's own in-progress wall / room.
      var d = state.drawing;
      if (d && d.kind === 'wall') {
        labelSegment(c, { x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }, false);
      } else if (d && d.kind === 'room') {
        var wft = pxToFt(Math.abs(d.x2 - d.x1)), hft = pxToFt(Math.abs(d.y2 - d.y1));
        if (wft > 0.5 && hft > 0.5) {
          var ca = dataToScreen(d.x1, d.y1), cb = dataToScreen(d.x2, d.y2);
          badge(c, (ca.sx + cb.sx) / 2, (ca.sy + cb.sy) / 2 + 22,
                Math.round(wft * hft).toLocaleString() + ' sq ft', true);
        }
      }

      if (PRO.lastSnap && PRO.chainActive) {
        var ss = dataToScreen(PRO.lastSnap.x, PRO.lastSnap.y);
        c.strokeStyle = PRO.lastSnap.kind === 'close' ? '#16a34a' : '#0ea5e9';
        c.lineWidth = 2;
        c.beginPath(); c.arc(ss.sx, ss.sy, 9, 0, Math.PI * 2); c.stroke();
      }
      c.restore();
    }
    if (PRO.sheet) paintSheet();
  }

  function labelSegment(c, a, b, quiet) {
    var ft = pxToFt(Math.hypot(b.x - a.x, b.y - a.y));
    if (ft < 0.4) return;
    var sa = dataToScreen(a.x, a.y), sb = dataToScreen(b.x, b.y);
    var txt = fmtFeet(ft);
    if (!quiet) txt += '   ' + Math.round(bearingOf(a.x, a.y, b.x, b.y)) + '°';
    badge(c, (sa.sx + sb.sx) / 2, (sa.sy + sb.sy) / 2, txt, quiet);
  }

  function badge(c, x, y, text, quiet) {
    c.save();
    c.font = (quiet ? '600 11px ' : 'bold 12px ') + 'system-ui, -apple-system, sans-serif';
    var w = c.measureText(text).width + 12;
    var h = quiet ? 17 : 20;
    c.fillStyle = quiet ? 'rgba(17,24,39,0.72)' : '#111827';
    if (c.roundRect) { c.beginPath(); c.roundRect(x - w / 2, y - h / 2, w, h, 4); c.fill(); }
    else c.fillRect(x - w / 2, y - h / 2, w, h);
    c.fillStyle = '#fff';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, x, y);
    c.restore();
  }

  // ------------------------------------------------------- sheet furniture
  function paintSheet() {
    var c = FP.ctx;
    var W = state.view.width, H = state.view.height;
    if (!c || !W || !H) return;
    c.save();
    c.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    // North arrow, top right — rotates with the view so it stays truthful.
    var nx = W - 40, ny = 42;
    c.save();
    c.translate(nx, ny);
    c.rotate(-degToRad(state.view.rotation) + degToRad(PRO.northDeg));
    c.fillStyle = '#111827';
    c.beginPath();
    c.moveTo(0, -18); c.lineTo(7, 10); c.lineTo(0, 5); c.lineTo(-7, 10);
    c.closePath(); c.fill();
    c.restore();
    c.fillStyle = '#111827';
    c.font = 'bold 11px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText('N', nx, ny + 14);

    // Graphic scale bar, bottom left. Graphic rather than "1 in = 20 ft" so it
    // stays true after the sheet is photocopied or scaled to fit.
    var pxPerFt = sf() * state.view.zoom;
    if (pxPerFt > 0.02) {
      var rawFt = 140 / pxPerFt;
      var nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
      var ft = nice[nice.length - 1];
      for (var i = 0; i < nice.length; i++) if (nice[i] >= rawFt) { ft = nice[i]; break; }
      var barPx = ft * pxPerFt;
      var bx = 18, by = H - 30;
      c.fillStyle = 'rgba(255,255,255,0.88)';
      if (c.roundRect) { c.beginPath(); c.roundRect(bx - 8, by - 22, barPx + 64, 36, 5); c.fill(); }
      else c.fillRect(bx - 8, by - 22, barPx + 64, 36);
      var halves = 4, seg = barPx / halves;
      for (var s = 0; s < halves; s++) {
        c.fillStyle = (s % 2 === 0) ? '#111827' : '#ffffff';
        c.fillRect(bx + s * seg, by - 6, seg, 6);
      }
      c.strokeStyle = '#111827'; c.lineWidth = 1;
      c.strokeRect(bx, by - 6, barPx, 6);
      c.fillStyle = '#111827';
      c.font = '600 10px system-ui, sans-serif';
      c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText('0', bx - 2, by + 2);
      c.fillText(ft + ' ft', bx + barPx - 6, by + 2);
      c.textBaseline = 'bottom';
      c.fillText('SCALE', bx, by - 9);
    }

    // Title block, bottom right.
    var plan = readPlan();
    var lines = [plan.business_name || 'Untitled', plan.address || ''].filter(Boolean);
    var meta = [plan.pfp_number ? 'PFP ' + plan.pfp_number : '',
                plan.iso_tour_date ? 'Tour ' + plan.iso_tour_date : ''].filter(Boolean).join('   •   ');
    if (meta) lines.push(meta);
    if (lines.length) {
      var maxW = 0;
      for (var L = 0; L < lines.length; L++) {
        c.font = (L === 0 ? 'bold 12px ' : '600 10px ') + 'system-ui, sans-serif';
        maxW = Math.max(maxW, c.measureText(lines[L]).width);
      }
      var boxW = maxW + 20, boxH = 16 + lines.length * 14;
      var tx = W - boxW - 14, ty = H - boxH - 14;
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.strokeStyle = '#111827'; c.lineWidth = 1;
      if (c.roundRect) { c.beginPath(); c.roundRect(tx, ty, boxW, boxH, 5); c.fill(); c.stroke(); }
      else { c.fillRect(tx, ty, boxW, boxH); c.strokeRect(tx, ty, boxW, boxH); }
      c.textAlign = 'left'; c.textBaseline = 'top';
      for (var m = 0; m < lines.length; m++) {
        c.font = (m === 0 ? 'bold 12px ' : '600 10px ') + 'system-ui, sans-serif';
        c.fillStyle = m === 0 ? '#111827' : '#4b5563';
        c.fillText(lines[m], tx + 10, ty + 9 + m * 14);
      }
    }
    c.restore();
  }

  function readPlan() {
    try { return JSON.parse(localStorage.getItem('preFirePlan') || '{}') || {}; }
    catch (_) { return {}; }
  }

  // ------------------------------------------------------------------- HUD
  var hud, hudText, dimInput, dimLabel;

  function hudShouldOpen() {
    if (PRO.chainActive) return true;
    var t = state.tool;
    return t === 'wall' || t === 'room' || t === 'measure';
  }

  function buildUI() {
    var wallBtn = document.querySelector('[data-tool="wall"]');
    if (wallBtn && wallBtn.parentNode) {
      var chain = document.createElement('button');
      chain.className = 'fp-tbtn';
      chain.id = 'tool-chain';
      chain.dataset.proTool = 'chain';
      chain.textContent = '⌔ Chain';
      chain.title = 'Chain walls corner to corner. Tap each corner; type a length to be exact; tap the green start dot to close the loop.';
      chain.addEventListener('click', function () { enterChain(); });
      wallBtn.parentNode.insertBefore(chain, wallBtn.nextSibling);
    }

    hud = document.createElement('div');
    hud.id = 'fp-pro-hud';
    hud.innerHTML =
      '<div class="pro-row pro-live"><span id="pro-live-text">—</span></div>' +
      '<div class="pro-row">' +
        '<label id="pro-dim-label" for="pro-dim">Length</label>' +
        '<input id="pro-dim" type="text" inputmode="decimal" placeholder="47 6" autocomplete="off">' +
        '<button id="pro-dim-go" class="pro-btn pro-primary">Set</button>' +
      '</div>' +
      '<div class="pro-row pro-toggles">' +
        '<label class="pro-chk"><input type="checkbox" id="pro-snap-end" checked> Snap corners</label>' +
        '<label class="pro-chk"><input type="checkbox" id="pro-snap-ang"> Angle lock ' +
          '<select id="pro-ang-step"><option>15</option><option>30</option><option selected>45</option><option>90</option></select>' +
        '</label>' +
        '<button id="pro-weld" class="pro-btn" title="Close hairline gaps so corners meet and the outline reads as enclosed">Weld corners</button>' +
      '</div>' +
      '<div class="pro-row pro-actions">' +
        '<button id="pro-close" class="pro-btn">Close loop</button>' +
        '<button id="pro-finish" class="pro-btn">Finish</button>' +
        '<button id="pro-undo-pt" class="pro-btn">Undo point</button>' +
        '<button id="pro-cancel" class="pro-btn pro-danger">Cancel</button>' +
      '</div>';
    document.body.appendChild(hud);

    hudText  = hud.querySelector('#pro-live-text');
    dimInput = hud.querySelector('#pro-dim');
    dimLabel = hud.querySelector('#pro-dim-label');

    hud.querySelector('#pro-dim-go').addEventListener('click', applyTypedDim);
    dimInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applyTypedDim(); }
    });
    hud.querySelector('#pro-close').addEventListener('click', function () { commitChain(true); });
    hud.querySelector('#pro-finish').addEventListener('click', function () { commitChain(false); });
    hud.querySelector('#pro-undo-pt').addEventListener('click', function () {
      if (!PRO.chain) return;
      PRO.chain.pts.pop();
      if (!PRO.chain.pts.length) PRO.chain = null;
      redraw(); syncHUD();
    });
    hud.querySelector('#pro-cancel').addEventListener('click', function () {
      PRO.chain = null; redraw(); syncHUD();
    });
    hud.querySelector('#pro-snap-end').addEventListener('change', function (e) {
      PRO.endpointSnap = e.target.checked;
    });
    hud.querySelector('#pro-snap-ang').addEventListener('change', function (e) {
      PRO.angleSnap = e.target.checked;
      if (e.target.checked) showToast('Angle lock on — turn it off for angled walls', 'ok');
    });
    hud.querySelector('#pro-ang-step').addEventListener('change', function (e) {
      PRO.angleStep = parseFloat(e.target.value) || 45;
    });
    hud.querySelector('#pro-weld').addEventListener('click', function () {
      var v = prompt('Weld wall corners that are within how many feet?\n\n' +
                     'Keep this small. Welding moves real corners, so a large\n' +
                     'value pulls genuinely separate walls together.', String(PRO.weldFeet));
      if (v == null) return;
      var ft = parseFeet(v);
      if (ft == null || ft <= 0) { showToast('Enter a distance in feet', 'err'); return; }
      if (ft > 3) { showToast('Refusing over 3 ft — that would move real corners', 'err'); return; }
      PRO.weldFeet = ft;
      weldCorners(ft);
    });

    var lp = document.getElementById('layers');
    if (lp) {
      var row = document.createElement('label');
      row.className = 'fp-layer-row';
      row.innerHTML = '<input type="checkbox" id="pro-sheet" checked>' +
        '<span class="swatch" style="background:#111827;"></span>Scale &amp; north';
      lp.appendChild(row);
      row.querySelector('#pro-sheet').addEventListener('change', function (e) {
        PRO.sheet = e.target.checked; redraw();
      });
    }

    injectStyles();
    syncHUD();
  }

  function enterChain() {
    PRO.chainActive = true;
    document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
    var cb = document.getElementById('tool-chain');
    if (cb) cb.classList.add('active');
    // A value none of the host's pointer branches match, so even if an event
    // slipped past the capture listener the host would do nothing with it.
    state.tool = 'pro-chain';
    state.drawing = null;
    state.drag = null;
    syncHUD();
    redraw();
  }

  function exitChain() {
    PRO.chainActive = false;
    PRO.chain = null;
    var cb = document.getElementById('tool-chain');
    if (cb) cb.classList.remove('active');
    syncHUD();
    redraw();
  }

  /** Any host tool button drops us out of chain mode (bubble phase, after the host's handler). */
  function bindHostToolExit() {
    document.querySelectorAll('[data-tool]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (PRO.chainActive) exitChain(); else syncHUD();
      });
    });
  }

  /**
   * Commit an exact dimension. Applies to the chain tool, and also drives the
   * host's own Wall and Room drags by rewriting state.drawing in place.
   */
  function applyTypedDim() {
    var raw = dimInput.value;
    var d = state.drawing;

    if (!PRO.chainActive && d && d.kind === 'room') {
      var wh = parseSize(raw), w, h;
      if (wh) { w = wh[0]; h = wh[1]; }
      else {
        w = parseFeet(raw);
        if (w == null || w <= 0) { showToast('Enter 40 x 25, or a width in feet', 'err'); return; }
        var curW = Math.abs(d.x2 - d.x1) || 1, curH = Math.abs(d.y2 - d.y1) || 1;
        h = pxToFt(curH / curW * ftToPx(w));
      }
      d.x2 = d.x1 + Math.sign(d.x2 - d.x1 || 1) * ftToPx(w);
      d.y2 = d.y1 + Math.sign(d.y2 - d.y1 || 1) * ftToPx(h);
      dimInput.value = '';
      redraw(); syncHUD();
      showToast(fmtFeet(w) + ' x ' + fmtFeet(h) + ' — release to place', 'ok');
      return;
    }

    var ft = parseFeet(raw);
    if (ft == null || ft <= 0) { showToast('Enter a length like 47 or 47 6', 'err'); return; }

    if (!PRO.chainActive && d && (d.kind === 'wall' || d.kind === 'measure')) {
      var dx = d.x2 - d.x1, dy = d.y2 - d.y1, mag = Math.hypot(dx, dy);
      if (mag < 1e-6) { dx = 1; dy = 0; mag = 1; }
      d.x2 = d.x1 + dx / mag * ftToPx(ft);
      d.y2 = d.y1 + dy / mag * ftToPx(ft);
      dimInput.value = '';
      redraw(); syncHUD();
      showToast(fmtFeet(ft) + ' — release to place', 'ok');
      return;
    }

    if (!PRO.chain || !PRO.chain.pts.length) {
      showToast('Start a wall first, then set its length', 'err');
      return;
    }
    var a = PRO.chain.pts[PRO.chain.pts.length - 1];
    var b = PRO.chain.preview;
    var vx = 1, vy = 0, m = 1;
    if (b) {
      vx = b.x - a.x; vy = b.y - a.y; m = Math.hypot(vx, vy);
      if (m < 1e-6) { vx = 1; vy = 0; m = 1; }
    }
    var px = ftToPx(ft);
    var np = { x: a.x + vx / m * px, y: a.y + vy / m * px };
    PRO.chain.pts.push(np);
    PRO.chain.preview = { x: np.x, y: np.y };
    dimInput.value = '';
    redraw(); syncHUD();
    showToast(fmtFeet(ft) + ' wall set', 'ok');
  }

  function syncHUD() {
    if (!hud) return;
    var open = hudShouldOpen();
    hud.classList.toggle('open', open);
    if (!open) return;

    var d = state.drawing;
    var txt = '', mode = 'length';

    if (PRO.chainActive) {
      if (!PRO.chain) txt = 'Tap the first corner';
      else {
        var run = 0;
        for (var i = 0; i < PRO.chain.pts.length - 1; i++) {
          run += pxToFt(Math.hypot(PRO.chain.pts[i + 1].x - PRO.chain.pts[i].x,
                                   PRO.chain.pts[i + 1].y - PRO.chain.pts[i].y));
        }
        var a = PRO.chain.pts[PRO.chain.pts.length - 1], b = PRO.chain.preview;
        var seg = b ? pxToFt(Math.hypot(b.x - a.x, b.y - a.y)) : 0;
        txt = 'Corner ' + PRO.chain.pts.length +
              '   •   this wall ' + fmtFeet(seg) +
              '   •   run ' + fmtFeet(run);
      }
    } else if (d && d.kind === 'room') {
      mode = 'size';
      var wft = pxToFt(Math.abs(d.x2 - d.x1)), hft = pxToFt(Math.abs(d.y2 - d.y1));
      txt = fmtFeet(wft) + ' x ' + fmtFeet(hft) + '   •   ' +
            Math.round(wft * hft).toLocaleString() + ' sq ft';
    } else if (d && (d.kind === 'wall' || d.kind === 'measure')) {
      txt = fmtFeet(pxToFt(Math.hypot(d.x2 - d.x1, d.y2 - d.y1))) +
            '   •   ' + Math.round(bearingOf(d.x1, d.y1, d.x2, d.y2)) + '°';
    } else {
      txt = state.tool === 'room' ? 'Drag out a room' : 'Drag a wall, or type a length';
    }

    hudText.textContent = txt;
    dimLabel.textContent = mode === 'size' ? 'Size' : 'Length';
    dimInput.placeholder = mode === 'size' ? '40 x 25' : "47 6";

    var chainOnly = PRO.chainActive ? '' : 'none';
    hud.querySelector('#pro-close').style.display = chainOnly;
    hud.querySelector('#pro-undo-pt').style.display = chainOnly;
    hud.querySelector('#pro-finish').style.display = chainOnly;
    hud.querySelector('#pro-cancel').style.display = chainOnly;
  }

  // ---------------------------------------------------------------- styles
  function injectStyles() {
    var css = document.createElement('style');
    css.textContent = [
      '#fp-pro-hud{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:60;',
      ' display:none;flex-direction:column;gap:8px;background:rgba(17,24,39,.95);color:#fff;',
      ' padding:12px 14px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.35);',
      ' font:600 13px system-ui,-apple-system,sans-serif;max-width:min(94vw,700px);',
      ' -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}',
      '#fp-pro-hud.open{display:flex;}',
      '#fp-pro-hud .pro-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '#fp-pro-hud .pro-live{font-size:14px;color:#fbbf24;min-height:18px;}',
      '#fp-pro-hud label{font-size:12px;color:#cbd5e1;}',
      '#fp-pro-hud input[type=text]{width:120px;padding:10px;border-radius:9px;border:1px solid #475569;',
      ' background:#0f172a;color:#fff;font:600 15px system-ui,sans-serif;}',
      '#fp-pro-hud select{padding:6px;border-radius:7px;border:1px solid #475569;background:#0f172a;color:#fff;}',
      '#fp-pro-hud .pro-btn{padding:10px 14px;border-radius:9px;border:1px solid #475569;background:#1e293b;',
      ' color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer;min-height:40px;}',
      '#fp-pro-hud .pro-btn:active{background:#334155;}',
      '#fp-pro-hud .pro-primary{background:#f97316;border-color:#f97316;}',
      '#fp-pro-hud .pro-danger{background:#7f1d1d;border-color:#991b1b;}',
      '#fp-pro-hud .pro-chk{display:inline-flex;align-items:center;gap:6px;}',
      '#fp-pro-hud .pro-chk input{width:18px;height:18px;}',
      '@media (pointer:coarse){',
      ' .fp-tbtn{min-height:44px;min-width:44px;font-size:14px;padding:10px 12px;}',
      ' .fp-layer-row{min-height:38px;}',
      ' #fp-pro-hud{bottom:8px;padding:10px;}',
      '}',
      '.fp-tbtn[data-pro-tool].active{background:#f97316;color:#fff;border-color:#f97316;}'
    ].join('');
    document.head.appendChild(css);
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    buildUI();
    bindHostToolExit();
    setTimeout(redraw, 60);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.FP_PRO_API = {
    parseFeet: parseFeet,
    parseSize: parseSize,
    fmtFeet: fmtFeet,
    weldCorners: weldCorners,
    enterChain: enterChain
  };
})();
