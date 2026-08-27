/* fp2-shell.js — the full-screen chrome around the floor plan editor.
 *
 * The editor itself (fp2-app.js) is untouched by this file. All this does is
 * arrange it: which buttons are on the rail, what hides behind the ⋯ menu,
 * where the menus open, and keeping the top bar's labels in step.
 *
 * Why it exists at all: page 11 used to be a small canvas under two toolbars
 * carrying about thirty buttons, inside a twelve-page form. The feedback was
 * "there is too much going on and im confused", and the fix is not smaller
 * buttons — it is showing nine tools and putting the other twenty behind one
 * predictable door.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;

  var moreMenu, floorMenu, scrim, drawer, railSymbol;
  var openMenu = null;

  /* ------------------------------------------------------------- menus */

  function placeMenu(menu, anchor, align) {
    var r = anchor.getBoundingClientRect();
    menu.classList.remove('hidden');
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = (align === 'right') ? (r.right - mw) : r.left;
    /* Never let a menu run off the edge — on an iPad in portrait the ⋯ button
     * is close enough to the corner that a naive left/top does exactly that. */
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function showMenu(menu, anchor, align) {
    closeMenus();
    placeMenu(menu, anchor, align);
    scrim.classList.remove('hidden');
    openMenu = menu;
  }

  function closeMenus() {
    if (moreMenu) moreMenu.classList.add('hidden');
    if (floorMenu) floorMenu.classList.add('hidden');
    if (scrim) scrim.classList.add('hidden');
    openMenu = null;
  }

  /* ------------------------------------------------------ symbol drawer */

  function openDrawer() {
    drawer.classList.add('open');
    var s = $('sym-search');
    /* Focusing the search on a touch device throws the keyboard up over the
     * palette you just opened, so only do it with a real pointer. */
    if (s && window.matchMedia('(pointer:fine)').matches) setTimeout(function () { s.focus(); }, 180);
  }
  function closeDrawer() { drawer.classList.remove('open'); }

  /* ---------------------------------------------------------- top bar */

  /* Called by fp2-app whenever the floors or the plan change. */
  function sync() {
    try {
      var FP = window.FP;
      if (!FP || !FP.doc) return;
      var doc = FP.doc();
      if (!doc) return;

      var plan = {};
      try { plan = JSON.parse(localStorage.getItem('preFirePlan') || '{}'); } catch (e) {}
      var name = plan.business_name || plan.address || 'Floor Plan';
      var nm = $('fpx-planname');
      if (nm) { nm.textContent = name; nm.title = name; }

      var f = doc.floor();
      var fl = $('fpx-floorname');
      if (fl) {
        var n = doc.data.floors.length;
        fl.textContent = f.name + (n > 1 ? '  ·  ' + n + ' floors' : '');
      }

      /* The rail's Symbol button must never be stuck disabled: the drawer is
       * the only way to choose a symbol, so disabling it before one is chosen
       * would lock the feature behind itself. */
      if (railSymbol) railSymbol.disabled = false;
    } catch (e) { /* the shell must never take the editor down with it */ }
  }

  /* ---------------------------------------------------------------- boot */

  function init() {
    moreMenu = $('more-menu');
    floorMenu = $('floor-menu');
    scrim = $('fpx-scrim');
    drawer = $('palette-drawer');
    railSymbol = $('rail-symbol');
    if (!moreMenu || !scrim) return;

    $('fpx-more').addEventListener('click', function (e) {
      e.stopPropagation();
      if (openMenu === moreMenu) { closeMenus(); return; }
      showMenu(moreMenu, this, 'right');
    });

    $('fpx-floorbtn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (openMenu === floorMenu) { closeMenus(); return; }
      showMenu(floorMenu, this, 'left');
    });

    scrim.addEventListener('click', closeMenus);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeMenus(); closeDrawer(); }
    });

    /* Anything picked from a menu closes it. Without this the menu sits over
     * the drawing you just changed and hides the result. */
    [moreMenu, floorMenu].forEach(function (m) {
      m.addEventListener('click', function (e) {
        /* Closed synchronously. Deferring it left the menu open for a tick,
         * which is long enough to race the next open and leave a menu showing
         * with no scrim behind it. The item's own handler is earlier on the
         * bubble path, so it has already run by the time this fires. */
        if (e.target.closest('.fpx-menu-item') || e.target.closest('.fp-ftab')) closeMenus();
      });
    });

    /* The Symbol tool and its drawer are the same action. */
    if (railSymbol) {
      railSymbol.addEventListener('click', function () { openDrawer(); });
    }
    $('palette-close').addEventListener('click', closeDrawer);
    /* Picking a symbol closes the drawer on a narrow screen, where it covers
     * the whole drawing; on a wide one it stays open so several can be placed. */
    $('sym-body').addEventListener('click', function () {
      if (window.innerWidth <= 760) setTimeout(closeDrawer, 120);
    });

    /* Toggles that only exist in the shell. */
    $('mm-steps').addEventListener('click', function () {
      body.classList.toggle('show-steps');
      this.classList.toggle('active', body.classList.contains('show-steps'));
      window.dispatchEvent(new Event('resize'));
    });
    $('mm-sheets').addEventListener('click', function () {
      body.classList.toggle('show-sheets');
      this.classList.toggle('active', body.classList.contains('show-sheets'));
    });
    $('mm-minimap').addEventListener('click', function () {
      $('fpx').classList.toggle('show-minimap');
      this.classList.toggle('active', $('fpx').classList.contains('show-minimap'));
    });

    /* Flow navigation. Both save first — a drawing that only lives in memory
     * is a drawing somebody is going to lose. */
    $('fpx-back').addEventListener('click', function () {
      if (window.ppSaveBeforeLeaving) ppSaveBeforeLeaving();
      location.href = 'page10-site-plan.html';
    });
    $('fpx-next').addEventListener('click', function () {
      if (window.ppSaveBeforeLeaving) ppSaveBeforeLeaving();
      location.href = 'page12-submit.html';
    });

    /* The canvas is sized from its wrapper, so a viewport change has to reach
     * it — orientation changes on an iPad otherwise leave it the old shape. */
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 220);
    });

    sync();
  }

  window.FPShell = { sync: sync, closeMenus: closeMenus, openDrawer: openDrawer, closeDrawer: closeDrawer };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
