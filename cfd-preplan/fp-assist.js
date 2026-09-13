/* ===========================================================================
 * fp-assist.js — page 11 (Floor Plan): tell it what you want, it edits the plan.
 *
 * "Shade the back of house and call it Division 2." "Put a hydrant by the loading
 * dock." "Take out the three symbols in the shoe storage." The operator types it;
 * the drawing changes.
 *
 * HOW IT IS SAFE ENOUGH TO LET AN ASSISTANT EDIT A PRE-PLAN
 * ---------------------------------------------------------
 * 1. The model never touches the plan. It gets a read-only description and returns
 *    a list of OPERATIONS in a fixed vocabulary; this file applies them through the
 *    editor's own model (doc.list(), doc.addZone(), G.hostOpening()). Anything the
 *    worker's sanitiser did not recognise never arrives.
 * 2. ONE pushUndo() before the whole batch, so an edit of forty operations is one
 *    Undo — and the Undo is offered right there in the transcript.
 * 3. Deleting more than two things asks first. Adding does not: a gloved hand on
 *    scene should not have to confirm a hydrant.
 *
 * COORDINATES ARE FEET, both ways. The plan is stored in pixels at
 * scale_px_per_ft, but feet are what the operator thinks in and what the plan is
 * dimensioned in, and a model doing "20 ft north of the dock" in 12ths makes
 * arithmetic slips that land a door inside a wall. Conversion happens here.
 *
 * A DIVISION IS NOT A ROOM. Shaded divisions are written with
 * exclude_from_total:true, because Doc.floorAreaSqFt() sums zones and that figure
 * can be pushed to page 8's fire-flow calculation. A Division 2 laid over the back
 * of house would otherwise count the building's square footage twice and inflate
 * the required fire flow — a number crews act on.
 * ======================================================================== */

(function (root) {
  'use strict';

  var FP = root.FP;
  if (!FP || !FP.state) {
    console.warn('[fp-assist] window.FP not available; not initialising');
    return;
  }

  var state = FP.state;
  var busy = false;
  var focused = null;            // the zone being focused on, or null
  var printDimmed = false;       // does the dimming go into the PDF too
  var lastBatch = null;          // what the last answer did, for the Undo chip

  function doc() { return FP.doc ? FP.doc() : null; }
  function scale() { var d = doc(); return (d && d.data.scale_px_per_ft) || 12; }
  function ft2px(v) { return v * scale(); }
  function px2ft(v) { return v / scale(); }
  function r1(v) { return Math.round(v * 10) / 10; }

  /* -------------------------------------------------- describing the plan */

  /* What the model is allowed to know. Ids are included precisely so it can refer
   * to something that already exists instead of guessing at coordinates. */
  function describe() {
    var d = doc();
    if (!d) return null;
    var f = d.floor();
    var out = {
      units: 'feet',
      note: 'x runs east, y runs south (down). North is up unless north_deg says otherwise.',
      floor: { name: f.name, level: f.level, of: d.data.floors.length },
      north_deg: (d.data.sheet && d.data.sheet.north) || 0,
      walls: [], doors: [], windows: [], symbols: [], texts: [], areas: []
    };

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function see(x, y) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }

    (f.walls || []).forEach(function (w) {
      var a = { id: w.id, x1: r1(px2ft(w.x1)), y1: r1(px2ft(w.y1)), x2: r1(px2ft(w.x2)), y2: r1(px2ft(w.y2)) };
      see(a.x1, a.y1); see(a.x2, a.y2);
      out.walls.push(a);
    });
    ['doors', 'windows'].forEach(function (k) {
      (f[k] || []).forEach(function (e) {
        if (typeof e.x !== 'number') return;
        out[k].push({ id: e.id, x: r1(px2ft(e.x)), y: r1(px2ft(e.y)),
                      width_ft: r1(px2ft(e.width || 0)), type: e.type || undefined });
      });
    });
    (f.symbols || []).forEach(function (s) {
      var def = root.FP_SYMBOLS && root.FP_SYMBOLS.byId[s.symbolId];
      out.symbols.push({ id: s.id, symbol: s.symbolId,
                         what: (def && def.label) || s.label || s.symbolId,
                         label: s.label || '', x: r1(px2ft(s.x)), y: r1(px2ft(s.y)) });
    });
    (f.texts || []).forEach(function (t) {
      out.texts.push({ id: t.id, x: r1(px2ft(t.x)), y: r1(px2ft(t.y)), text: t.text });
    });
    (f.zones || []).forEach(function (z) {
      out.areas.push({ id: z.id, name: z.name || '', x: r1(px2ft(z.cx || 0)), y: r1(px2ft(z.cy || 0)),
                       area_sqft: z.area_sqft || 0 });
    });

    if (isFinite(minX)) out.extent = { minX: r1(minX), minY: r1(minY), maxX: r1(maxX), maxY: r1(maxY) };

    /* The palette, so it picks a real symbol instead of inventing a name. */
    out.symbol_palette = ((root.FP_SYMBOLS && root.FP_SYMBOLS.all) || [])
      .map(function (s) { return { id: s.id, label: s.label }; });

    return out;
  }

  /* ------------------------------------------------------ applying the ops */

  function geom() { return root.FPGeom || null; }

  function wallHost(xpx, ypx) {
    var g = geom();
    var f = doc().floor();
    if (!g || !g.hostOpening) return null;
    /* 3 ft of slack: the model is aiming at a wall it cannot see. */
    return g.hostOpening(xpx, ypx, f.walls || [], ft2px(3));
  }

  function countDeletes(ops) {
    var n = 0;
    ops.forEach(function (o) { if (o.op === 'delete') n += (o.ids || []).length; });
    return n;
  }

  function findById(id) {
    var f = doc().floor();
    var lists = ['walls', 'doors', 'windows', 'symbols', 'texts', 'zones', 'objects', 'measurements'];
    for (var i = 0; i < lists.length; i++) {
      var arr = f[lists[i]] || [];
      for (var j = 0; j < arr.length; j++) {
        if (arr[j].id === id) return { list: lists[i], arr: arr, index: j, el: arr[j] };
      }
    }
    return null;
  }

  function apply(ops) {
    var d = doc();
    if (!d || !ops.length) return { added: 0, removed: 0, notes: [] };

    var dels = countDeletes(ops);
    if (dels > 2 && !confirm('This will remove ' + dels + ' things from the plan. Go ahead?')) {
      return null;
    }

    FP.pushUndo();
    var added = 0, removed = 0, notes = [], pending = [];

    ops.forEach(function (o) {
      try {
        if (o.op === 'add_wall') {
          d.list('walls').push({ id: FP.uid('w_'), x1: ft2px(o.x1), y1: ft2px(o.y1),
                                 x2: ft2px(o.x2), y2: ft2px(o.y2) });
          added++;
        } else if (o.op === 'add_door' || o.op === 'add_window') {
          var kind = o.op === 'add_door' ? 'door' : 'window';
          var host = wallHost(ft2px(o.x), ft2px(o.y));
          if (!host) { notes.push('No wall near the ' + kind + ' at ' + r1(o.x) + ', ' + r1(o.y) + ' — skipped.'); return; }
          var rec = { id: FP.uid(kind === 'door' ? 'd_' : 'n_'), wallId: host.wallId, t: host.t,
                      width: ft2px(o.width_ft), type: kind === 'door' ? (o.type || 'single') : undefined };
          var g = geom();
          if (g && g.resolveOpening) {
            var r = g.resolveOpening(rec, d.wallsById());
            if (r) { rec.x = r.x; rec.y = r.y; rec.angle = r.angle; }
          }
          d.list(kind + 's').push(rec);
          added++;
        } else if (o.op === 'add_symbol') {
          if (o.symbol.indexOf('generate:') === 0) { pending.push(o); return; }
          var known = root.FP_SYMBOLS && root.FP_SYMBOLS.byId[o.symbol];
          if (!known) { notes.push('No symbol called "' + o.symbol + '" — skipped.'); return; }
          var srec = { id: FP.uid('s_'), symbolId: o.symbol, x: ft2px(o.x), y: ft2px(o.y),
                       angle: o.angle || 0, label: o.label || '' };
          if (known.spec) srec.spec = known.spec;
          d.list('symbols').push(srec);
          added++;
        } else if (o.op === 'add_text') {
          d.list('texts').push({ id: FP.uid('t_'), x: ft2px(o.x), y: ft2px(o.y),
                                 text: o.text, size: 14, color: '#475569', angle: 0 });
          added++;
        } else if (o.op === 'shade_area') {
          var poly = o.points.map(function (p) { return { x: ft2px(p[0]), y: ft2px(p[1]) }; });
          /* exclude_from_total: a division is a view of the building, not extra
             floor area. See the note at the top of this file. */
          d.addZone(poly, { name: o.name, color: o.color, use: 'division', exclude_from_total: true });
          added++;
        } else if (o.op === 'delete') {
          o.ids.forEach(function (id) {
            var hit = findById(id);
            if (!hit) { notes.push('Nothing on this floor with id ' + id + '.'); return; }
            hit.arr.splice(hit.index, 1);
            removed++;
          });
        } else if (o.op === 'rename') {
          var h = findById(o.id);
          if (!h) { notes.push('Nothing on this floor with id ' + o.id + '.'); return; }
          if (h.list === 'texts') h.el.text = o.name; else h.el.name = o.name;
        } else if (o.op === 'focus') {
          if (!setFocus(o.name)) notes.push('No shaded area called "' + o.name + '" to focus on.');
        } else if (o.op === 'focus_off') {
          setFocus(null);
        }
      } catch (e) {
        notes.push('Could not apply one change: ' + e.message);
      }
    });

    finish();

    /* Generated symbols need a round trip of their own; they land as they arrive. */
    pending.forEach(function (o) {
      if (!root.FPSymGen) { notes.push('The symbol generator did not load.'); return; }
      root.FPSymGen.generate(o.symbol.slice(9)).then(function (spec) {
        var entry = root.FPSymGen.saveToLibrary(spec);
        var def = root.FPSymGen.defFromSpec(entry.spec, entry.id);
        if (root.FP_SYMBOLS) { root.FP_SYMBOLS.byId[def.id] = def; root.FP_SYMBOLS.all.push(def); }
        doc().list('symbols').push({ id: FP.uid('s_'), symbolId: def.id, spec: entry.spec,
                                     x: ft2px(o.x), y: ft2px(o.y), angle: 0,
                                     label: o.label || '' });
        finish();
        say('Drew and placed ' + (spec.label || o.symbol.slice(9)) + '.');
      }).catch(function (e) {
        say('Could not draw ' + o.symbol.slice(9) + ': ' + e.message, true);
      });
    });

    return { added: added, removed: removed, notes: notes, generating: pending.length };
  }

  function finish() {
    if (FP.hideEmpty) FP.hideEmpty();
    if (FP.updateCounts) FP.updateCounts();
    if (FP.saveToStorage) FP.saveToStorage();
    FP.draw();
  }

  /* --------------------------------------------------------- focus on one */

  function zoneByName(name) {
    var want = String(name || '').trim().toLowerCase();
    var f = doc().floor();
    var hit = null;
    (f.zones || []).forEach(function (z) {
      var n = String(z.name || '').trim().toLowerCase();
      if (!hit && n && (n === want || n.indexOf(want) >= 0 || want.indexOf(n) >= 0)) hit = z;
    });
    return hit;
  }

  /* Focus is held as an id and a name, never as a reference to the zone object.
   * doc.undo() replaces the whole data graph (JSON.parse of a snapshot), so a
   * reference would go stale on every undo even when the zone is still there. */
  function focusZone() {
    if (!focused) return null;
    var d = doc();
    if (!d) return null;
    var zones = d.floor().zones || [];
    var byId = null, byName = null;
    zones.forEach(function (z) {
      if (z.id === focused.id) byId = z;
      if (!byName && z.name && z.name === focused.name) byName = z;
    });
    return byId || byName;
  }

  function setFocus(name) {
    if (!name) { focused = null; chip(); FP.draw(); return true; }
    var z = zoneByName(name);
    if (!z) { focused = null; chip(); return false; }
    focused = { id: z.id, name: z.name || name, color: z.color };
    chip();
    FP.draw();
    return true;
  }

  /* Dim everything outside the focused area: one fill over the whole canvas with
   * the division punched out of it (even-odd), so the rest of the building stays
   * legible but reads as background. */
  var suppressDim = false;
  function paintFocus() {
    if (!focused || suppressDim) return;
    var c = FP.ctx;
    if (!c) return;
    /* An Undo can take the zone away, or the operator can switch floors. Dimming
     * around a shape that is no longer there would grey the plan with nothing to
     * explain it, so focus follows the zone out. */
    var z = focusZone();
    if (!z) { focused = null; chip(); return; }
    var poly = z.poly || [];
    if (poly.length < 3) return;
    c.save();
    c.setTransform(state.dpr || 1, 0, 0, state.dpr || 1, 0, 0);
    var w = FP.canvas.width / (state.dpr || 1), h = FP.canvas.height / (state.dpr || 1);
    c.beginPath();
    c.rect(0, 0, w, h);
    var first = FP.dataToScreen(poly[0].x, poly[0].y);
    c.moveTo(first.sx, first.sy);
    for (var i = 1; i < poly.length; i++) {
      var p = FP.dataToScreen(poly[i].x, poly[i].y);
      c.lineTo(p.sx, p.sy);
    }
    c.closePath();
    c.fillStyle = 'rgba(248,250,252,0.74)';
    c.fill('evenodd');
    /* Outline the division so its edge is unmistakable. */
    c.beginPath();
    c.moveTo(first.sx, first.sy);
    for (var j = 1; j < poly.length; j++) {
      var q = FP.dataToScreen(poly[j].x, poly[j].y);
      c.lineTo(q.sx, q.sy);
    }
    c.closePath();
    c.strokeStyle = z.color || focused.color || '#f59e0b';
    c.lineWidth = 3;
    c.stroke();
    c.restore();
  }

  var prevOverlay = root.__FP_OVERLAY;
  root.__FP_OVERLAY = function () {
    if (prevOverlay) { try { prevOverlay(); } catch (e) { console.warn('[fp-assist] prior overlay', e); } }
    paintFocus();
  };

  /* The PDF and the Book are made from canvas.toDataURL(). Focus is a way of
   * LOOKING at the plan, not a property of it, so by default the printed sheet
   * shows the whole building — unless the operator ticks "print it dimmed too". */
  function guardPrint() {
    var cv = FP.canvas;
    if (!cv || cv.__assistGuarded) return;
    var orig = cv.toDataURL;
    cv.toDataURL = function () {
      if (!focused || printDimmed) return orig.apply(cv, arguments);
      suppressDim = true;
      try { FP.draw(); return orig.apply(cv, arguments); }
      finally { suppressDim = false; FP.draw(); }
    };
    cv.__assistGuarded = true;
  }

  /* ------------------------------------------------------------- the panel */

  function el(id) { return document.getElementById(id); }

  function say(msg, bad, undoable) {
    var log = el('fa-log');
    if (!log) return;
    var row = document.createElement('div');
    row.className = 'fa-row' + (bad ? ' bad' : '');
    row.textContent = (bad ? '' : '✓ ') + msg;
    if (undoable) {
      var u = document.createElement('button');
      u.type = 'button';
      u.className = 'fa-undo';
      u.textContent = 'Undo that';
      u.addEventListener('click', function () {
        var b = el('btn-undo');
        if (b) b.click();
        u.remove();
        row.textContent = '↩ Undone.';
      });
      row.appendChild(u);
    }
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function chip() {
    var c = el('fa-focus');
    if (!c) return;
    if (!focused) { c.style.display = 'none'; return; }
    c.style.display = 'flex';
    el('fa-focus-name').textContent = 'Focus: ' + (focused.name || 'area');
    el('fa-focus-print').checked = printDimmed;
  }

  function ask() {
    var inp = el('fa-input');
    var text = (inp.value || '').trim();
    if (!text || busy) return;

    var plan = describe();
    if (!plan) { say('The plan is not loaded yet.', true); return; }

    busy = true;
    inp.value = '';
    var mine = document.createElement('div');
    mine.className = 'fa-row me';
    mine.textContent = text;
    el('fa-log').appendChild(mine);
    say('Thinking…');
    var thinking = el('fa-log').lastChild;

    fetch('/api/plan-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: '11', instruction: text, plan: plan })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j && j.error ? j.error : 'The assistant did not answer.');
        return j;
      });
    }).then(function (j) {
      thinking.remove();
      if (!j.ops.length) { say(j.say || 'Nothing to change.', false); return; }
      var res = apply(j.ops);
      if (res === null) { say('Left the plan alone.', false); return; }
      var bits = [];
      if (res.added) bits.push('added ' + res.added);
      if (res.removed) bits.push('removed ' + res.removed);
      if (res.generating) bits.push('drawing ' + res.generating + ' new symbol' + (res.generating > 1 ? 's' : ''));
      say((j.say || 'Done.') + (bits.length ? '  (' + bits.join(', ') + ')' : ''), false, true);
      res.notes.forEach(function (n) { say(n, true); });
      lastBatch = res;
    }).catch(function (e) {
      if (thinking && thinking.remove) thinking.remove();
      say(e.message, true);
    }).then(function () { busy = false; });
  }

  var CSS = [
    '#fa-wrap{position:fixed;left:8px;z-index:9997;width:min(380px,calc(100vw - 16px));',
    '  bottom:calc(var(--pp-toolbar-h, calc(56px + env(safe-area-inset-bottom,0px))) + 10px);',
    '  font:13px system-ui,sans-serif}',
    '#fa-open{background:#1e3a5f;color:#fff;border:0;border-radius:20px;padding:9px 16px;font-weight:700;',
    '  box-shadow:0 2px 10px rgba(0,0,0,.3);cursor:pointer}',
    '#fa-panel{display:none;background:#fff;border:1px solid #cbd5e1;border-radius:12px;',
    '  box-shadow:0 6px 24px rgba(0,0,0,.22);overflow:hidden}',
    '#fa-panel.open{display:block}',
    '#fa-hdr{display:flex;align-items:center;gap:8px;background:#1e3a5f;color:#fff;padding:8px 10px;font-weight:700}',
    '#fa-hdr button{margin-left:auto;background:none;border:0;color:#fff;font-size:18px;cursor:pointer}',
    '#fa-log{max-height:34vh;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px}',
    '.fa-row{background:#f1f5f9;border-radius:8px;padding:6px 9px;color:#0f172a;line-height:1.35}',
    '.fa-row.me{background:#1e3a5f;color:#fff;align-self:flex-end;max-width:88%}',
    '.fa-row.bad{background:#fee2e2;color:#7f1d1d}',
    '.fa-undo{margin-left:8px;background:#1e3a5f;color:#fff;border:0;border-radius:6px;padding:3px 9px;',
    '  font-weight:700;cursor:pointer}',
    '#fa-ask{display:flex;gap:6px;padding:8px;border-top:1px solid #e2e8f0}',
    '#fa-input{flex:1;min-width:0;padding:9px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px}',
    '#fa-send{background:#1e3a5f;color:#fff;border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer}',
    '#fa-focus{display:none;align-items:center;gap:8px;padding:7px 10px;background:#fef3c7;',
    '  border-top:1px solid #fde68a;color:#78350f;font-weight:600}',
    '#fa-focus button{margin-left:auto;background:#78350f;color:#fff;border:0;border-radius:6px;',
    '  padding:3px 9px;font-weight:700;cursor:pointer}',
    '#fa-focus label{font-weight:500;display:flex;align-items:center;gap:4px}'
  ].join('');

  var HTML =
    '<button type="button" id="fa-open">✨ Assistant</button>' +
    '<div id="fa-panel">' +
      '<div id="fa-hdr">✨ Plan assistant<button type="button" id="fa-close">×</button></div>' +
      '<div id="fa-log"><div class="fa-row">Tell me what to change — for example “shade the back of ' +
        'house and call it Division 2”, “put a hydrant at the Watson entrance”, or “focus on ' +
        'Division 2”.</div></div>' +
      '<div id="fa-focus"><span id="fa-focus-name"></span>' +
        '<label><input type="checkbox" id="fa-focus-print"> print it too</label>' +
        '<button type="button" id="fa-focus-off">Clear</button></div>' +
      '<div id="fa-ask">' +
        '<input id="fa-input" type="text" placeholder="What do you want changed?" autocomplete="off">' +
        '<button type="button" id="fa-send">Go</button>' +
      '</div>' +
    '</div>';

  function boot() {
    if (el('fa-wrap')) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'fa-wrap';
    wrap.innerHTML = HTML;
    document.body.appendChild(wrap);

    el('fa-open').addEventListener('click', function () {
      el('fa-panel').classList.add('open');
      el('fa-open').style.display = 'none';
      setTimeout(function () { el('fa-input').focus(); }, 40);
    });
    el('fa-close').addEventListener('click', function () {
      el('fa-panel').classList.remove('open');
      el('fa-open').style.display = '';
    });
    el('fa-send').addEventListener('click', ask);
    el('fa-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') ask(); });
    el('fa-focus-off').addEventListener('click', function () { setFocus(null); });
    el('fa-focus-print').addEventListener('change', function () {
      printDimmed = this.checked;
    });

    guardPrint();
  }

  root.FPAssist = {
    describe: describe, apply: apply, focus: setFocus,
    get focused() { return focused; },
    ask: ask, boot: boot
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 500); });
  else setTimeout(boot, 500);
})(typeof window !== 'undefined' ? window : this);
