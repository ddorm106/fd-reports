/* fp2-draft.js — the drafted look for the symbol catalog.
 *
 * The 124 built-ins were drawn as little illustrations: heavy fills, per-symbol
 * line weights, a lot of colour. Next to the doors and windows the editor now
 * draws — thin, uniform, architectural — they look like they came from a
 * different program, because they did.
 *
 * Rather than redraw 124 symbols by hand (124 chances to introduce a mistake in
 * artwork that already matches the iOS app), this restyles them at draw time.
 * A proxy sits in front of the canvas context while a symbol draws:
 *
 *   - every fill becomes a pale wash of the colour it asked for, plus an
 *     outline, which is what turns a solid blob into a drafted object
 *   - line width is uniform, whatever the symbol asked for
 *   - line work is a single ink grey for furniture, fittings and plant
 *
 * COLOUR IS KEPT for fire protection, utilities and hazmat. Draining the red
 * out of an FDC or the amber out of a gas shutoff to make a plan prettier would
 * be a bad trade on a document somebody reads at 3am, so those categories keep
 * their coding and only gain the uniform weight.
 *
 * Nothing here is destructive: the original draw functions are untouched and
 * the plain look is one toggle away.
 */
(function (root) {
  'use strict';

  /* Categories whose colour carries meaning on the fireground. */
  var KEEP_COLOUR = { fire: 1, hazmat: 1, utilities: 1, compass: 1 };

  var INK = '#3d4753';        // line work for everything else
  var WASH_ALPHA = 0.13;      // how much of the original fill survives

  function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    var h = hex.trim();
    if (h.charAt(0) !== '#') return null;
    if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    if (h.length !== 7) return null;
    var n = parseInt(h.slice(1), 16);
    if (isNaN(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /* A wash keeps a hint of the original so a wooden desk and a steel cabinet
   * still read differently, without either one becoming a solid block. */
  function wash(colour) {
    var rgb = hexToRgb(colour);
    if (!rgb) return 'rgba(148,163,184,' + WASH_ALPHA + ')';
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + WASH_ALPHA + ')';
  }

  /* Very light colours (white highlights, paper) would vanish as a wash and
   * leave a hollow shape, so they are left alone. */
  function isPale(colour) {
    var rgb = hexToRgb(colour);
    if (!rgb) return false;
    return (rgb.r + rgb.g + rgb.b) / 3 > 232;
  }

  /* Wrap a 2D context for the duration of one symbol's draw call.
   *
   * opts: { keepColour, ink, lw }
   * `lw` is in the symbol's own units — the caller passes the value already
   * divided by any zoom so the weight is uniform on screen. */
  function wrap(ctx, opts) {
    opts = opts || {};
    var keep = !!opts.keepColour;
    var ink = opts.ink || INK;
    var lw = typeof opts.lw === 'number' ? opts.lw : 1;
    var wantFill = '#94a3b8';
    var wantStroke = ink;

    function outlineAfterFill() {
      ctx.strokeStyle = keep ? wantStroke : ink;
      ctx.lineWidth = lw;
      try { ctx.stroke(); } catch (e) {}
    }

    return new Proxy(ctx, {
      get: function (t, k) {
        var v = t[k];
        if (typeof v !== 'function') return v;

        if (k === 'fill') {
          return function () {
            t.fillStyle = isPale(wantFill) ? wantFill : wash(wantFill);
            v.apply(t, arguments);
            outlineAfterFill();
          };
        }
        if (k === 'stroke') {
          return function () {
            t.strokeStyle = keep ? wantStroke : ink;
            t.lineWidth = lw;
            v.apply(t, arguments);
          };
        }
        if (k === 'fillRect') {
          return function (x, y, w, h) {
            t.fillStyle = isPale(wantFill) ? wantFill : wash(wantFill);
            v.call(t, x, y, w, h);
            t.strokeStyle = keep ? wantStroke : ink;
            t.lineWidth = lw;
            t.strokeRect(x, y, w, h);
          };
        }
        if (k === 'strokeRect') {
          return function (x, y, w, h) {
            t.strokeStyle = keep ? wantStroke : ink;
            t.lineWidth = lw;
            v.call(t, x, y, w, h);
          };
        }
        if (k === 'fillText') {
          return function () {
            /* Lettering stays readable: ink, never a wash. */
            t.fillStyle = keep ? wantFill : ink;
            v.apply(t, arguments);
          };
        }
        return v.bind(t);
      },

      set: function (t, k, val) {
        if (k === 'fillStyle') { wantFill = val; t.fillStyle = val; return true; }
        if (k === 'strokeStyle') { wantStroke = val; t.strokeStyle = val; return true; }
        if (k === 'lineWidth') { t.lineWidth = lw; return true; }   // uniform, always
        t[k] = val;
        return true;
      }
    });
  }

  /* Draw a catalog symbol in the drafted style. Falls back to a plain draw if
   * anything about the proxy path goes wrong — a symbol that renders in the
   * old style is a cosmetic problem; one that throws is a blank plan. */
  function drawDef(ctx, def, lw) {
    if (!def || typeof def.draw !== 'function') return false;
    var keep = !!KEEP_COLOUR[def.cat];
    try {
      var p = wrap(ctx, { keepColour: keep, lw: typeof lw === 'number' ? lw : 1 });
      def.draw(p, def.w, def.h);
      return true;
    } catch (e) {
      try { def.draw(ctx, def.w, def.h); } catch (e2) {}
      return false;
    }
  }

  /* Line weight in SYMBOL units. The renderer sets this per frame from the
   * zoom so the weight is uniform on screen; palette chips and the PDF leave
   * the default, which is tuned for a symbol drawn at its own size. */
  var currentLW = 1.1;
  function setLW(v) { currentLW = (typeof v === 'number' && isFinite(v) && v > 0) ? v : 1.1; }

  /* Patch the catalog in place so EVERY consumer gets the drafted look without
   * knowing about it — the canvas, the palette, fp-markers.js's own chip grid,
   * and page 12's PDF. The original stays on _draw, so the switch is
   * reversible and nothing is destroyed.
   *
   * Generated symbols are skipped: they are drawn from a shape list that is
   * already thin line-work, and washing them out would undo the drawing the
   * operator just approved. */
  function applyTo(catalog) {
    if (!catalog || !catalog.all) return 0;
    var n = 0;
    catalog.all.forEach(function (def) {
      if (!def || def.custom || def._draw || typeof def.draw !== 'function') return;
      var original = def.draw;
      def._draw = original;
      def.draw = function (ctx, w, h) {
        var keep = !!KEEP_COLOUR[def.cat];
        try {
          original.call(this, wrap(ctx, { keepColour: keep, lw: currentLW }), w, h);
        } catch (e) {
          try { original.call(this, ctx, w, h); } catch (e2) {}
        }
      };
      n++;
    });
    return n;
  }

  function revert(catalog) {
    if (!catalog || !catalog.all) return 0;
    var n = 0;
    catalog.all.forEach(function (def) {
      if (def && def._draw) { def.draw = def._draw; delete def._draw; n++; }
    });
    return n;
  }

  root.FPDraft = {
    wrap: wrap,
    drawDef: drawDef,
    applyTo: applyTo,
    revert: revert,
    setLW: setLW,
    KEEP_COLOUR: KEEP_COLOUR,
    INK: INK
  };
})(typeof window !== 'undefined' ? window : this);
