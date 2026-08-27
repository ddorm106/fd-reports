/* fp2-symgen.js — describe a symbol, get a symbol.
 *
 * Type "three-bay loading dock" and the server asks Claude for a DECLARATIVE
 * SHAPE LIST, which this file draws. Nothing executable ever crosses the wire:
 * the vocabulary is rect / circle / line / poly / arc / text and nothing else,
 * validated on the server and again here. Generated JavaScript running inside a
 * page that holds pre-plan data behind a login is not a trade worth making, and
 * a shape list costs nothing in expressiveness for a floor-plan glyph.
 *
 * A generated symbol is stored WITH THE PLAN (spec on the placed element), not
 * only in a device library, so the drawing stays complete for the PDF, the Book
 * and anyone who opens it on another machine.
 */
(function (root) {
  'use strict';

  var LIB_KEY = 'fpCustomSymbols';
  var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  /* ------------------------------------------------------- safe rendering */

  function okNum(v, dflt) { return (typeof v === 'number' && isFinite(v)) ? v : dflt; }
  function okCol(v, dflt) { return (typeof v === 'string' && HEX.test(v)) ? v : dflt; }

  /* Draw a spec centred on the current origin. The caller has already
   * translated/rotated/scaled; this only emits primitives.
   *
   * Re-validates everything even though the server did: a spec can also arrive
   * from a saved plan, which may have been edited by hand or synced from
   * somewhere else. Draw code is the last place to find out a number is a
   * string. */
  function drawSpec(ctx, spec, opts) {
    if (!ctx || !spec || !Array.isArray(spec.shapes)) return false;
    opts = opts || {};
    var inkDefault = okCol(opts.ink, '#374151');
    var lwScale = okNum(opts.lwScale, 1);
    var shapes = spec.shapes;
    var drawn = 0;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (var i = 0; i < shapes.length && i < 60; i++) {
      var s = shapes[i];
      if (!s || typeof s !== 'object') continue;
      var stroke = okCol(s.stroke, null);
      var fill = okCol(s.fill, null);
      var lw = okNum(s.lw, 1.2) * lwScale;
      if (!stroke && !fill) stroke = inkDefault;

      ctx.lineWidth = Math.max(0.05, lw);
      if (s.dash) ctx.setLineDash([3 * lwScale, 2 * lwScale]); else ctx.setLineDash([]);

      if (s.t === 'rect') {
        var x = okNum(s.x, 0), y = okNum(s.y, 0);
        var w = okNum(s.w, 0), h = okNum(s.h, 0);
        var rx = okNum(s.rx, 0);
        ctx.beginPath();
        if (rx > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, rx);
        else ctx.rect(x, y, w, h);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
        drawn++;
      } else if (s.t === 'circle') {
        ctx.beginPath();
        ctx.arc(okNum(s.cx, 0), okNum(s.cy, 0), Math.abs(okNum(s.r, 1)), 0, Math.PI * 2);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
        drawn++;
      } else if (s.t === 'line') {
        ctx.beginPath();
        ctx.moveTo(okNum(s.x1, 0), okNum(s.y1, 0));
        ctx.lineTo(okNum(s.x2, 0), okNum(s.y2, 0));
        ctx.strokeStyle = stroke || inkDefault;
        ctx.stroke();
        drawn++;
      } else if (s.t === 'arc') {
        var a0 = okNum(s.a0, 0) * Math.PI / 180;
        var a1 = okNum(s.a1, 180) * Math.PI / 180;
        ctx.beginPath();
        ctx.arc(okNum(s.cx, 0), okNum(s.cy, 0), Math.abs(okNum(s.r, 1)), a0, a1);
        ctx.strokeStyle = stroke || inkDefault;
        ctx.stroke();
        drawn++;
      } else if (s.t === 'poly') {
        var pts = Array.isArray(s.points) ? s.points : [];
        if (pts.length < 2) continue;
        ctx.beginPath();
        var started = false;
        for (var j = 0; j < pts.length && j < 60; j++) {
          var p = pts[j];
          if (!Array.isArray(p) || p.length < 2) continue;
          var px = okNum(p[0], null), py = okNum(p[1], null);
          if (px === null || py === null) continue;
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        if (!started) continue;
        ctx.closePath();
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
        drawn++;
      } else if (s.t === 'text') {
        var str = typeof s.s === 'string' ? s.s.slice(0, 24) : '';
        if (!str) continue;
        var size = Math.max(1, okNum(s.size, 8));
        ctx.font = (s.bold ? 'bold ' : '') + size + 'px "Source Sans Pro", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = fill || stroke || inkDefault;
        ctx.fillText(str, okNum(s.x, 0), okNum(s.y, 0));
        drawn++;
      }
      /* Anything else is not in the vocabulary and is ignored on purpose. */
    }
    ctx.setLineDash([]);
    ctx.restore();
    return drawn > 0;
  }

  /* Turn a spec into something with the same shape as a catalog entry, so the
   * rest of the editor can treat a generated symbol exactly like a built-in. */
  function defFromSpec(spec, id) {
    return {
      id: id || spec.id,
      label: spec.label || 'Custom',
      cat: 'custom',
      w: okNum(spec.w, 32),
      h: okNum(spec.h, 32),
      custom: true,
      spec: spec,
      draw: function (ctx) { drawSpec(ctx, spec); }
    };
  }

  /* ------------------------------------------------------------- library */

  function loadLibrary() {
    try {
      var raw = localStorage.getItem(LIB_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveToLibrary(spec) {
    var lib = loadLibrary();
    var id = 'custom:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var entry = { id: id, label: spec.label || 'Custom', spec: spec, made: new Date().toISOString() };
    lib.unshift(entry);
    /* Cap it. This shares the localStorage budget with the plan itself, and a
     * runaway library is how the plan stops fitting. */
    if (lib.length > 60) lib.length = 60;
    try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch (e) {}
    return entry;
  }

  function removeFromLibrary(id) {
    var lib = loadLibrary().filter(function (e) { return e.id !== id; });
    try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch (e) {}
    return lib;
  }

  /* ------------------------------------------------------------ generate */

  function generate(description) {
    return fetch('/api/symbol-gen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description })
    }).then(function (r) {
      return r.json().catch(function () {
        throw new Error('The server did not answer in a way we could read.');
      }).then(function (d) {
        if (!r.ok || !d.ok) throw new Error(d && d.error ? d.error : ('Request failed (' + r.status + ')'));
        return d.spec;
      });
    });
  }

  /* Render a spec into a small canvas for the preview and the palette chip. */
  function thumbnail(spec, px, dpr) {
    var size = px || 48;
    var scale = dpr || 1;
    var c = document.createElement('canvas');
    c.width = size * scale; c.height = size * scale;
    c.style.width = size + 'px'; c.style.height = size + 'px';
    var ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.translate(size / 2, size / 2);
    var k = (size - 8) / Math.max(okNum(spec.w, 32), okNum(spec.h, 32));
    ctx.scale(k, k);
    try { drawSpec(ctx, spec, { lwScale: 1 / k }); } catch (e) {}
    return c;
  }

  root.FPSymGen = {
    drawSpec: drawSpec,
    defFromSpec: defFromSpec,
    loadLibrary: loadLibrary,
    saveToLibrary: saveToLibrary,
    removeFromLibrary: removeFromLibrary,
    generate: generate,
    thumbnail: thumbnail,
    LIB_KEY: LIB_KEY
  };
})(typeof window !== 'undefined' ? window : this);
