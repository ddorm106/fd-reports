/* ===========================================================================
 * preplan-layout.js — the behaviour half of the shared layout
 *
 * Two jobs, both about making a long form legible rather than changing it:
 *   1. A completion bar per page, so you can see whether a page is done
 *      without reading every field on it.
 *   2. Marking filled fields, so the ones still empty are findable by eye.
 *      preplan-layout.css keeps a coloured left edge on empty fields and drops
 *      it once they are answered.
 *
 * Reads the DOM only. No field ids, no calculators, no auto-save touched.
 * ======================================================================== */

(function () {
  'use strict';

  /* Hold .nav-buttons clear of whatever else is fixed to the bottom.
   *
   * Centerville's Worker injects .pp-toolbar across the foot of every pre-plan
   * page; Peach has no such bar. Rather than hardcode a height per site (and
   * --pp-toolbar-h is referenced in places but never actually defined), measure
   * what is there and publish it as --pp-navbar-bottom. --pp-navbar-pad then
   * reserves room so the last field is not hidden under a bar that no longer
   * takes part in the layout.
   */
  function sizeNavBar() {
    try {
      var tb = document.querySelector('.pp-toolbar');
      var h = 0;
      if (tb) {
        var r = tb.getBoundingClientRect();
        /* Only count it when it is actually pinned at the foot. */
        if (r.height > 0 && r.bottom >= window.innerHeight - 2) h = Math.round(r.height);
      }
      var nav = document.querySelector('.nav-buttons');
      var navH = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
      var root = document.documentElement;
      root.style.setProperty('--pp-navbar-bottom', h + 'px');
      root.style.setProperty('--pp-navbar-pad', (h + navH + 24) + 'px');
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sizeNavBar);
  } else {
    sizeNavBar();
  }
  window.addEventListener('resize', sizeNavBar);
  window.addEventListener('orientationchange', sizeNavBar);
  /* preplan-flow.js rebuilds the bar after us, which changes its height. */
  setTimeout(sizeNavBar, 400);
  setTimeout(sizeNavBar, 1200);
})();

(function () {
  'use strict';

  function fields() {
    return Array.prototype.slice.call(document.querySelectorAll('.form-field'));
  }

  /** Is anything actually answered inside this field wrapper? */
  function answered(box) {
    var els = box.querySelectorAll('input, select, textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type === 'radio' || el.type === 'checkbox') {
        if (el.checked) return true;
      } else if (el.type === 'hidden') {
        // Card-style pickers write their answer into a hidden input.
        if ((el.value || '').trim() !== '') return true;
      } else if ((el.value || '').trim() !== '') {
        return true;
      }
    }
    // Some choice groups keep state on the button, not an input.
    if (box.querySelector('.apparatus-btn.active, .apparatus-btn.selected')) return true;
    return false;
  }

  function visible(box) {
    // A conditional section that has not been triggered should not count
    // against the page, or every page reads as permanently unfinished.
    return !!(box.offsetParent || box.getClientRects().length);
  }

  var bar;

  function build() {
    var host = document.querySelector('.page-wrapper') || document.querySelector('.container');
    if (!host || document.getElementById('pp-page-progress')) return;
    if (!document.querySelector('.form-field')) return;   // not a form page

    bar = document.createElement('div');
    bar.id = 'pp-page-progress';
    bar.innerHTML = '<span class="lbl">This page</span>' +
                    '<span class="bar"><i style="width:0%"></i></span>' +
                    '<span class="n">0 / 0</span>';
    var title = host.querySelector('.section-title');
    if (title && title.nextSibling) title.parentNode.insertBefore(bar, title.nextSibling);
    else host.insertBefore(bar, host.firstChild);
  }

  function refresh() {
    var boxes = fields().filter(visible);
    var done = 0;
    boxes.forEach(function (b) {
      var ok = answered(b);
      b.classList.toggle('pp-filled', ok);
      if (ok) done++;
    });
    if (!bar) return;
    var pct = boxes.length ? Math.round(done / boxes.length * 100) : 0;
    bar.querySelector('i').style.width = pct + '%';
    bar.querySelector('.n').textContent = done + ' / ' + boxes.length;
    bar.querySelector('.lbl').textContent = pct === 100 ? 'This page is complete' : 'This page';
  }

  function boot() {
    build();
    refresh();
    // Cheap enough to just re-read on any interaction; the form is small and
    // this avoids having to know which control wrote which value.
    document.addEventListener('input', function () { setTimeout(refresh, 0); }, true);
    document.addEventListener('change', function () { setTimeout(refresh, 0); }, true);
    document.addEventListener('click', function () { setTimeout(refresh, 60); }, true);
    setInterval(refresh, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PreplanLayout = { refresh: refresh };
})();
