/* sm-shell.js — the full-screen chrome around the site map (page 10).
 *
 * Same treatment page 11 got, and for the same reason: the map was a 560px box
 * two thirds of the way down a form page, under a title, an info paragraph, a
 * four-button toolbar and an eighteen-button palette. Now the map is the page.
 *
 * preplan-sitemap.js is NOT modified. It still builds its own markup into
 * #siteMapHost; this file waits for that, then MOVES the pieces into the shell
 * and re-points the shell's buttons at the originals. Moving a node keeps its
 * listeners, so the map component never knows the difference — and if this file
 * fails to find something it leaves it where it was rather than breaking it.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;
  var openMenu = null;
  var moved = false;

  /* ------------------------------------------------------------- menus */

  function closeMenus() {
    var m = $('more-menu'); if (m) m.classList.add('hidden');
    var s = $('fpx-scrim'); if (s) s.classList.add('hidden');
    openMenu = null;
  }

  function showMenu(menu, anchor) {
    closeMenus();
    menu.classList.remove('hidden');
    var r = anchor.getBoundingClientRect();
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    $('fpx-scrim').classList.remove('hidden');
    openMenu = menu;
  }

  function openDrawer() { $('palette-drawer').classList.add('open'); }
  function closeDrawer() { $('palette-drawer').classList.remove('open'); }

  /* Leaflet resizes itself on the window resize event (trackResize defaults to
   * true), which is the only handle we have on the map instance from out here. */
  function nudgeMap() {
    window.dispatchEvent(new Event('resize'));
  }

  /* --------------------------------------------------- move the pieces in */

  function relocate() {
    var box = $('smBox');
    if (!box || moved) return !!moved;
    var map = $('smMap'), pal = $('smPal'), hint = $('smHint'),
        stat = $('smStat'), tools = $('smTools');
    if (!map || !pal) return false;

    /* The component's own heading and info paragraph are what the shell
     * replaces, so they go rather than being shown twice. */
    var h = box.querySelector('.section-title'); if (h) h.style.display = 'none';
    var tip = box.querySelector('.info-tip'); if (tip) tip.style.display = 'none';
    if (tools) tools.style.display = 'none';        // its buttons are driven from the shell

    $('sm-mapslot').appendChild(map);
    $('sm-palslot').appendChild(pal);
    if (hint) {
      $('sm-hintslot').appendChild(hint);
      /* The component's opening line says "Pick a symbol above" — true when the
       * palette sat above the map, wrong now that it is behind the Place
       * button. The component rewrites this itself once something is picked. */
      if (/above/i.test(hint.textContent)) {
        hint.textContent = 'Tap Place to pick a symbol, then tap the map where it is.';
      }
    }
    if (stat) $('sm-stat').appendChild(stat);

    moved = true;
    nudgeMap();
    return true;
  }

  /* Drive the component's own buttons rather than reimplementing them — they
   * carry the real behaviour and the labels the component keeps up to date. */
  function proxy(shellId, originalId, opts) {
    var b = $(shellId);
    if (!b) return;
    b.addEventListener('click', function () {
      var o = $(originalId);
      if (o) o.click();
      if (opts && opts.mirrorLabel && o) b.textContent = o.textContent.trim();
      if (opts && opts.closeMenu) closeMenus();
      nudgeMap();
    });
  }

  /* The component's toggle buttons rename themselves ("Hydrants on" /
   * "Hydrants off"). Mirror that so the shell button never lies about state. */
  function mirrorLabels() {
    [['sm-satellite', 'smLayer', '🛰 '], ['sm-hydrants', 'smHyd', '🚰 ']].forEach(function (p) {
      var b = $(p[0]), o = $(p[1]);
      if (!b || !o) return;
      var txt = o.textContent.replace(/^[^\w]*\s*/, '').trim();
      if (txt) b.textContent = p[2] + txt;
    });
  }


  /* The pre-plan form toolbar is injected by the Worker, is position:fixed at
   * z-index 9999, and owns the bottom ~56px of every pre-plan page. Measure it
   * and hand the number to CSS so the shell can stop above it rather than be
   * covered by it. Re-measured on resize because it reflows. */
  function reserveToolbarSpace() {
    var t = document.querySelector('.pp-toolbar');
    var h = t ? Math.round(t.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--pp-toolbar-h', h + 'px');
    return h;
  }

  /* --------------------------------------------------------------- boot */

  function init() {
    $('fpx-more').addEventListener('click', function (e) {
      e.stopPropagation();
      if (openMenu) { closeMenus(); return; }
      showMenu($('more-menu'), this);
    });
    $('fpx-scrim').addEventListener('click', closeMenus);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeMenus(); closeDrawer(); }
    });

    $('sm-place').addEventListener('click', openDrawer);
    $('palette-close').addEventListener('click', closeDrawer);

    proxy('sm-satellite', 'smLayer');
    proxy('sm-hydrants', 'smHyd');
    proxy('sm-centre', 'smHere');
    proxy('sm-fit', 'smFit');
    proxy('mm-centre', 'smHere', { closeMenu: true });
    proxy('mm-fit', 'smFit', { closeMenu: true });

    $('mm-steps').addEventListener('click', function () {
      body.classList.toggle('show-steps');
      this.classList.toggle('active', body.classList.contains('show-steps'));
      closeMenus();
      nudgeMap();
    });
    $('mm-legacy').addEventListener('click', function () {
      if (!body.classList.contains('has-legacy')) {
        this.textContent = 'No old aerial on this plan';
        return;
      }
      body.classList.toggle('show-legacy');
      $('legacySite').classList.toggle('hidden', !body.classList.contains('show-legacy'));
      closeMenus();
    });

    $('fpx-back').addEventListener('click', function () {
      if (window.smLeave) smLeave('page9-hazardous-materials.html');
      else location.href = 'page9-hazardous-materials.html';
    });
    $('fpx-next').addEventListener('click', function () {
      if (window.smLeave) smLeave('page11-floor-plan.html');
      else location.href = 'page11-floor-plan.html';
    });

    /* Name the plan in the top bar, the way page 11 does. */
    try {
      var plan = JSON.parse(localStorage.getItem('preFirePlan') || '{}');
      var name = plan.business_name || plan.address || 'Site Plan';
      var nm = $('fpx-planname');
      if (nm) { nm.textContent = name; nm.title = name; }
    } catch (e) {}

    /* The map builds asynchronously — Leaflet is fetched from a CDN first — so
     * poll briefly rather than assuming it is there. Gives up quietly, leaving
     * the component's own layout in place, instead of half-moving it. */
    var tries = 0;
    var t = setInterval(function () {
      if (relocate() || ++tries > 60) {
        clearInterval(t);
        mirrorLabels();
        /* Picking a marker closes the drawer so you can see where to tap. */
        var pal = $('smPal');
        if (pal) pal.addEventListener('click', function (e) {
          if (e.target.closest('.sm-cat')) closeDrawer();
        });
      }
    }, 120);

    var tbTries = 0;
    var tbTimer = setInterval(function () {
      if (reserveToolbarSpace() > 0 || ++tbTries > 40) clearInterval(tbTimer);
    }, 120);
    window.addEventListener('resize', reserveToolbarSpace);

    window.addEventListener('orientationchange', function () {
      setTimeout(nudgeMap, 220);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
