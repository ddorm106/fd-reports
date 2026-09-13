/* ===========================================================================
 * sm-assist.js — page 10 (Site Plan): tell it where a symbol goes.
 *
 * The floor-plan assistant (fp-assist.js) edits geometry. This one does not:
 * the site plan is an aerial photograph with markers on it, so the only thing
 * worth asking for is symbol placement — "hydrant at the northeast corner",
 * "move the FDC to the Watson side", "the Knox box is by the front doors".
 *
 * Same shape as page 11's: the model returns OPERATIONS in a fixed vocabulary,
 * the worker sanitises them, and this file applies them through
 * window.PreplanSiteMap. Positions are latitude and longitude, and the model is
 * given the map's centre, its bounds and every marker already placed — it can
 * only reason about where things go by reference to what is already there.
 *
 * Undo is local. The site map has no undo stack of its own, so the markers array
 * is copied before a batch and put back if the operator taps "Undo that".
 * ======================================================================== */

(function (root) {
  'use strict';

  var busy = false;
  var undoSnapshot = null;

  function host() { return root.PreplanSiteMap || null; }

  function readPlan() {
    try { return JSON.parse(localStorage.getItem('preFirePlan') || '{}') || {}; }
    catch (e) { return {}; }
  }

  function writePlan(mutate) {
    try {
      var d = readPlan();
      mutate(d);
      localStorage.setItem('preFirePlan', JSON.stringify(d));
      return true;
    } catch (e) { return false; }
  }

  /* -------------------------------------------------- describing the plan */

  function describe() {
    var h = host();
    if (!h || !h.map()) return null;
    var map = h.map();
    var c = map.getCenter(), b = map.getBounds();
    var plan = readPlan();

    return {
      units: 'degrees',
      building: {
        name: plan.business_name || '',
        address: plan.address || ''
      },
      map: {
        centre: { lat: c.lat, lng: c.lng },
        bounds: { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
        zoom: map.getZoom()
      },
      /* Index is the address: these are what move_symbol, delete and label take. */
      markers: (h.markers() || []).map(function (m, i) {
        return { index: i, symbol: m.k, label: m.label || '', lat: m.lat, lng: m.lng };
      }),
      palette: (h.CATS || []).map(function (c2) { return { key: c2.k, label: c2.label }; }),
      generated: (plan.site_symbols || []).map(function (s) { return { key: 'gen:' + s.id, label: s.label }; })
    };
  }

  /* ------------------------------------------------------ applying the ops */

  function apply(ops) {
    var h = host();
    if (!h || !ops.length) return { added: 0, removed: 0, moved: 0, notes: [] };

    var dels = 0;
    ops.forEach(function (o) { if (o.op === 'delete') dels += (o.indexes || []).length; });
    if (dels > 2 && !confirm('This will remove ' + dels + ' markers from the site plan. Go ahead?')) {
      return null;
    }

    var list = h.markers() || [];
    undoSnapshot = JSON.parse(JSON.stringify(list));
    var added = 0, removed = 0, moved = 0, notes = [], pending = [];
    var keys = {};
    (h.CATS || []).forEach(function (c) { keys[c.k] = 1; });

    /* Deletions first and from the back, so the indexes the model was given still
       mean what it meant while the rest of the batch is applied. */
    var dropAll = [];
    ops.forEach(function (o) { if (o.op === 'delete') dropAll = dropAll.concat(o.indexes); });
    dropAll.sort(function (a, b) { return b - a; }).forEach(function (i) {
      if (i >= 0 && i < list.length) { list.splice(i, 1); removed++; }
      else notes.push('There is no marker ' + i + '.');
    });

    ops.forEach(function (o) {
      try {
        if (o.op === 'add_symbol') {
          if (o.symbol.indexOf('generate:') === 0) { pending.push(o); return; }
          if (!keys[o.symbol] && o.symbol.indexOf('gen:') !== 0) {
            notes.push('No symbol called "' + o.symbol + '" — skipped.');
            return;
          }
          list.push({ k: o.symbol, lat: o.lat, lng: o.lng, label: o.label || null });
          added++;
        } else if (o.op === 'move_symbol') {
          if (!list[o.index]) { notes.push('There is no marker ' + o.index + ' to move.'); return; }
          list[o.index].lat = o.lat;
          list[o.index].lng = o.lng;
          moved++;
        } else if (o.op === 'label') {
          if (!list[o.index]) { notes.push('There is no marker ' + o.index + ' to label.'); return; }
          list[o.index].label = o.label;
        }
      } catch (e) {
        notes.push('Could not apply one change: ' + e.message);
      }
    });

    commit(list);

    pending.forEach(function (o) {
      if (!root.FPSymGen) { notes.push('The symbol generator did not load.'); return; }
      root.FPSymGen.generate(o.symbol.slice(9)).then(function (spec) {
        var entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                      label: (spec && spec.label) || o.symbol.slice(9), spec: spec };
        writePlan(function (d) {
          var lib = (d.site_symbols || []).filter(function (s) { return s.id !== entry.id; });
          lib.push(entry);
          d.site_symbols = lib.slice(-40);
        });
        var l2 = host().markers() || [];
        l2.push({ k: 'gen:' + entry.id, lat: o.lat, lng: o.lng,
                  label: o.label || entry.label, spec: entry.spec });
        commit(l2);
        if (root.SMAdd && root.SMAdd.boot) root.SMAdd.boot();   // put its chip in the palette
        say('Drew and placed ' + entry.label + '.');
      }).catch(function (e) {
        say('Could not draw ' + o.symbol.slice(9) + ': ' + e.message, true);
      });
    });

    return { added: added, removed: removed, moved: moved, notes: notes, generating: pending.length };
  }

  function commit(list) {
    var h = host();
    h.writeMarkers(list);
    h.draw();
    h.refresh();
    h.schedule(700);
  }

  function undo() {
    if (!undoSnapshot) return;
    commit(undoSnapshot);
    undoSnapshot = null;
  }

  /* ------------------------------------------------------------- the panel */

  function el(id) { return document.getElementById(id); }

  function say(msg, bad, undoable) {
    var log = el('sa-log');
    if (!log) return;
    var row = document.createElement('div');
    row.className = 'sa-row' + (bad ? ' bad' : '');
    row.textContent = (bad ? '' : '✓ ') + msg;
    if (undoable) {
      var u = document.createElement('button');
      u.type = 'button';
      u.className = 'sa-undo';
      u.textContent = 'Undo that';
      u.addEventListener('click', function () {
        undo();
        u.remove();
        row.textContent = '↩ Undone.';
      });
      row.appendChild(u);
    }
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function ask() {
    var inp = el('sa-input');
    var text = (inp.value || '').trim();
    if (!text || busy) return;

    var plan = describe();
    if (!plan) { say('The map is not ready yet.', true); return; }

    busy = true;
    inp.value = '';
    var mine = document.createElement('div');
    mine.className = 'sa-row me';
    mine.textContent = text;
    el('sa-log').appendChild(mine);
    say('Thinking…');
    var thinking = el('sa-log').lastChild;

    fetch('/api/plan-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: '10', instruction: text, plan: plan })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j && j.error ? j.error : 'The assistant did not answer.');
        return j;
      });
    }).then(function (j) {
      thinking.remove();
      if (!j.ops.length) { say(j.say || 'Nothing to change.', false); return; }
      var res = apply(j.ops);
      if (res === null) { say('Left the site plan alone.', false); return; }
      var bits = [];
      if (res.added) bits.push('added ' + res.added);
      if (res.moved) bits.push('moved ' + res.moved);
      if (res.removed) bits.push('removed ' + res.removed);
      if (res.generating) bits.push('drawing ' + res.generating + ' new symbol' + (res.generating > 1 ? 's' : ''));
      say((j.say || 'Done.') + (bits.length ? '  (' + bits.join(', ') + ')' : ''), false, true);
      res.notes.forEach(function (n) { say(n, true); });
    }).catch(function (e) {
      if (thinking && thinking.remove) thinking.remove();
      say(e.message, true);
    }).then(function () { busy = false; });
  }

  var CSS = [
    '#sa-wrap{position:fixed;left:8px;z-index:9997;width:min(380px,calc(100vw - 16px));',
    '  bottom:calc(var(--pp-toolbar-h, calc(56px + env(safe-area-inset-bottom,0px))) + 10px);',
    '  font:13px system-ui,sans-serif}',
    '#sa-open{background:#1e3a5f;color:#fff;border:0;border-radius:20px;padding:9px 16px;font-weight:700;',
    '  box-shadow:0 2px 10px rgba(0,0,0,.3);cursor:pointer}',
    '#sa-panel{display:none;background:#fff;border:1px solid #cbd5e1;border-radius:12px;',
    '  box-shadow:0 6px 24px rgba(0,0,0,.22);overflow:hidden}',
    '#sa-panel.open{display:block}',
    '#sa-hdr{display:flex;align-items:center;gap:8px;background:#1e3a5f;color:#fff;padding:8px 10px;font-weight:700}',
    '#sa-hdr button{margin-left:auto;background:none;border:0;color:#fff;font-size:18px;cursor:pointer}',
    '#sa-log{max-height:34vh;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px}',
    '.sa-row{background:#f1f5f9;border-radius:8px;padding:6px 9px;color:#0f172a;line-height:1.35}',
    '.sa-row.me{background:#1e3a5f;color:#fff;align-self:flex-end;max-width:88%}',
    '.sa-row.bad{background:#fee2e2;color:#7f1d1d}',
    '.sa-undo{margin-left:8px;background:#1e3a5f;color:#fff;border:0;border-radius:6px;padding:3px 9px;',
    '  font-weight:700;cursor:pointer}',
    '#sa-ask{display:flex;gap:6px;padding:8px;border-top:1px solid #e2e8f0}',
    '#sa-input{flex:1;min-width:0;padding:9px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px}',
    '#sa-send{background:#1e3a5f;color:#fff;border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer}'
  ].join('');

  var HTML =
    '<button type="button" id="sa-open">✨ Assistant</button>' +
    '<div id="sa-panel">' +
      '<div id="sa-hdr">✨ Site plan assistant<button type="button" id="sa-close">×</button></div>' +
      '<div id="sa-log"><div class="sa-row">Tell me where a symbol goes — for example “hydrant at the ' +
        'northeast corner of the lot”, “move the FDC to the Watson side”, or “the Knox box is ' +
        'by the front doors”.</div></div>' +
      '<div id="sa-ask">' +
        '<input id="sa-input" type="text" placeholder="Where does it go?" autocomplete="off">' +
        '<button type="button" id="sa-send">Go</button>' +
      '</div>' +
    '</div>';

  function boot() {
    if (el('sa-wrap') || !host()) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'sa-wrap';
    wrap.innerHTML = HTML;
    document.body.appendChild(wrap);

    el('sa-open').addEventListener('click', function () {
      el('sa-panel').classList.add('open');
      el('sa-open').style.display = 'none';
      setTimeout(function () { el('sa-input').focus(); }, 40);
    });
    el('sa-close').addEventListener('click', function () {
      el('sa-panel').classList.remove('open');
      el('sa-open').style.display = '';
    });
    el('sa-send').addEventListener('click', ask);
    el('sa-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') ask(); });
  }

  root.SMAssist = { describe: describe, apply: apply, undo: undo, ask: ask, boot: boot };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 600); });
  else setTimeout(boot, 600);
})(typeof window !== 'undefined' ? window : this);
