/* ============================================================================
 * Pre-plan cloud sync — the plan follows you between devices.
 *
 * Everything the form holds, including the floor plan and the site plan, is
 * pushed to the server as you work and pulled back when you open the plan
 * somewhere else. The browser's localStorage becomes a cache rather than the
 * only copy, which is what a ~5 MB quota and a lost tab had made it.
 *
 * This syncs a DRAFT. It does not publish to the Pre-Plan Book — publishing
 * stays a deliberate act on page 12.
 *
 * Load order: after preplan-storage.js, so reads here get the whole plan with
 * its blobs merged back in.
 * ==========================================================================*/
(function () {
    if (window.__preplanCloud) return;
    window.__preplanCloud = true;

    var KEY = 'preFirePlan';
    var META = 'preFirePlanCloud';
    var SAVE_URL = '/api/save-draft';
    var LOAD_URL = '/api/load-draft';
    var PUSH_DELAY = 4000;   // quiet period before a push
    var MIN_GAP = 2500;      // never push more often than this

    var timer = null, inFlight = false, lastPush = 0, booted = false;

    function meta() {
        try { return JSON.parse(localStorage.getItem(META) || '{}'); } catch (e) { return {}; }
    }
    function setMeta(m) {
        try { localStorage.setItem(META, JSON.stringify(m)); } catch (e) {}
    }
    function codeFromUrl() {
        try { return new URLSearchParams(location.search).get('plan'); } catch (e) { return null; }
    }
    /// ?restore=CODE — pull a copy WITHOUT adopting the code.
    ///
    /// ?plan=CODE is for sharing one live plan between devices, so both ends
    /// should push to the same code. Restoring a backup is the opposite: the
    /// backup must stay exactly as it was. Using ?plan= for it is what
    /// destroyed a backup on 2026-08-18 — the browser adopted the backup's
    /// code as its sync target, and when the plan was later cleared the sync
    /// pushed the empty state straight over it. A backup that the thing it is
    /// backing up can overwrite is not a backup.
    function restoreCodeFromUrl() {
        try { return new URLSearchParams(location.search).get('restore'); } catch (e) { return null; }
    }
    function currentCode() { return meta().code || codeFromUrl() || null; }

    function plan() {
        try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
    }
    function isEmpty(p) {
        for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) return false;
        return true;
    }

    // ── Status chip ─────────────────────────────────────────────────────────
    var chip = null;
    function status(text, tone) {
        if (!chip) {
            chip = document.createElement('div');
            chip.id = 'ppCloudChip';
            chip.style.cssText =
                'position:fixed;right:10px;bottom:10px;z-index:9999;font:600 11px/1.2 system-ui,Arial;' +
                'padding:6px 10px;border-radius:20px;background:#1e3a5f;color:#fff;opacity:.92;' +
                'box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer';
            chip.title = 'Tap to copy this plan’s link';
            chip.onclick = shareLink;
            document.body.appendChild(chip);
        }
        chip.textContent = text;
        chip.style.background = tone === 'err' ? '#c0392b'
                              : tone === 'ok'  ? '#1e7e34'
                              : '#1e3a5f';
    }

    function shareLink() {
        var c = currentCode();
        if (!c) { if (window.showToast) showToast('Nothing synced yet', 'info'); return; }
        var link = location.origin + location.pathname + '?plan=' + c;
        if (navigator.clipboard) navigator.clipboard.writeText(link);
        if (window.showToast) showToast('Plan code ' + c + ' — link copied', 'success');
    }

    // ── Push ────────────────────────────────────────────────────────────────
    function push(immediate) {
        if (timer) { clearTimeout(timer); timer = null; }
        var wait = immediate ? 0 : Math.max(PUSH_DELAY, MIN_GAP - (Date.now() - lastPush));
        timer = setTimeout(doPush, wait);
    }

    function doPush() {
        timer = null;
        if (inFlight || !booted) return;
        var p = plan();
        if (isEmpty(p)) return;

        inFlight = true;
        lastPush = Date.now();
        status('Saving…');

        var body = { data: p };
        var c = currentCode();
        if (c) body.code = c;

        fetch(SAVE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json(); })
          .then(function (j) {
              inFlight = false;
              if (j && j.success && j.code) {
                  var m = meta();
                  if (m.code !== j.code) {
                      m.code = j.code;
                      setMeta(m);
                      try {
                          var u = new URL(location.href);
                          u.searchParams.set('plan', j.code);
                          history.replaceState({}, '', u.toString());
                      } catch (e) {}
                  }
                  m.savedAt = Date.now();
                  setMeta(m);
                  status('Saved ✓ ' + j.code, 'ok');
              } else {
                  status('Not saved', 'err');
              }
          })
          .catch(function () {
              inFlight = false;
              // Offline is normal in a parking lot. The local copy is intact
              // and the next change will try again.
              status('Offline — saved on device', 'err');
          });
    }

    // ── Pull ────────────────────────────────────────────────────────────────
    function pull(code, opts) {
        var adopt = !opts || opts.adoptCode !== false;
        return fetch(LOAD_URL + '?code=' + encodeURIComponent(code))
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j || !j.success || !j.data) return false;
                localStorage.setItem(KEY, JSON.stringify(j.data));
                if (adopt) { var m = meta(); m.code = code; m.savedAt = Date.now(); setMeta(m); }
                return true;
            })
            .catch(function () { return false; });
    }

    // ── Boot ────────────────────────────────────────────────────────────────
    function init() {
        // Restore first, and deliberately do not keep the code.
        var restoreCode = restoreCodeFromUrl();
        if (restoreCode) {
            status('Restoring…');
            pull(restoreCode, { adoptCode: false }).then(function (ok) {
                booted = true;
                if (ok) {
                    status('Restored from ' + restoreCode, 'ok');
                    // A fresh working code is minted on the next push, so the
                    // backup is never written to again.
                    try { localStorage.removeItem(META); } catch (e) {}
                    location.replace(location.origin + location.pathname);
                } else {
                    status('Could not restore ' + restoreCode, 'err');
                }
            });
            return;
        }

        var urlCode = codeFromUrl();
        var local = plan();

        // Arriving with a plan code and nothing local: this is another device
        // opening the plan, so take the server's copy.
        if (urlCode && isEmpty(local)) {
            status('Loading…');
            pull(urlCode).then(function (ok) {
                booted = true;
                if (ok) {
                    status('Loaded ✓ ' + urlCode, 'ok');
                    // Pages read localStorage as they start, so the simplest
                    // correct thing is to start again now that it is filled.
                    location.reload();
                } else {
                    status('Could not load ' + urlCode, 'err');
                }
            });
            return;
        }

        booted = true;
        var c = currentCode();
        if (c) status('Synced ✓ ' + c, 'ok'); else status('Not synced yet');

        // Anything already in the plan gets a first push, so a plan created
        // before this existed still lands on the server.
        if (!isEmpty(local)) push(true);
    }

    // Every write to the plan schedules a push. The storage module notifies
    // us rather than us wrapping localStorage a second time — layering two
    // wrappers on Storage was fragile and one of them silently stopped
    // working, which is how large values appeared to vanish.
    window.__preplanWriteListeners = window.__preplanWriteListeners || [];
    window.__preplanWriteListeners.push(function () { if (booted) push(false); });

    // Leaving the page must not lose the last few seconds of work.
    function flush() {
        if (!timer || inFlight || !booted) return;
        clearTimeout(timer); timer = null;
        try {
            var p = plan();
            if (isEmpty(p)) return;
            var body = { data: p };
            var c = currentCode();
            if (c) body.code = c;
            navigator.sendBeacon(SAVE_URL, new Blob([JSON.stringify(body)],
                                 { type: 'application/json' }));
        } catch (e) {}
    }
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) flush();
    });

    // Keep the plan code on internal links so moving between pages keeps it.
    document.addEventListener('click', function (e) {
        var a = e.target && e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        var href = a.getAttribute('href');
        if (!href || href.charAt(0) === '#' || /^(https?:|mailto:|javascript:)/.test(href)) return;
        var c = currentCode();
        if (c && href.indexOf('plan=') === -1) {
            a.setAttribute('href', href + (href.indexOf('?') === -1 ? '?' : '&') + 'plan=' + c);
        }
    }, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
