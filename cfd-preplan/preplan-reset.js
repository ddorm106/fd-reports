/* ===========================================================================
 * preplan-reset.js — a reset that actually resets
 *
 * "Reset All Data" used to be one line on the index page:
 *
 *     localStorage.removeItem('preFirePlan'); location.reload();
 *
 * That does not clear the plan, for five separate reasons. Each one on its own
 * is enough to bring the whole thing back:
 *
 *  1. ppPersist() in the Worker's injected toolbar treats "the plan had keys
 *     and now has none" as corruption and writes the old plan back. It also
 *     restores key-by-key. That guard is right for auto-save — a half-loaded
 *     page must never eat a pre-plan — but it cannot tell a deliberate wipe
 *     from a bug, so it undoes the reset.
 *  2. preFirePlan__prev is a rollback snapshot the same toolbar keeps. It
 *     survived, and the corruption-repair path restores from it.
 *  3. preFirePlanCloud holds the plan's cloud code. The server draft was never
 *     touched, so the plan came back the moment anything opened ?plan=<code>.
 *  4. cfdPreplanPhotos (IndexedDB) held every photo taken on the device.
 *  5. A ?plan= code in the URL survives location.reload(), and preplan-cloud's
 *     init() then pulls the whole plan straight back down.
 *
 * So a real reset has to clear local storage, the rollback snapshot, the cloud
 * code, the server draft, the photo vault and the URL — and it has to hand the
 * user their data first, because a button whose own dialog says "this cannot
 * be undone" should not be the only copy standing between them and a lost
 * afternoon's work.
 * ======================================================================== */

(function () {
  'use strict';

  var KEY = 'preFirePlan';

  function readPlan() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function fieldCount(p) {
    var n = 0;
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) n++;
    return n;
  }

  function planLabel(p) {
    return (p.business_name || p.address || 'pre-plan')
      .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'pre-plan';
  }

  /** Hand the whole plan back as a JSON file before anything is destroyed. */
  function downloadBackup(p) {
    try {
      var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      var blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = planLabel(p) + '-backup-' + stamp + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return true;
    } catch (e) { return false; }
  }

  /** Every localStorage key this app writes, including the split-out blobs. */
  function planKeys() {
    var out = [KEY, KEY + '__prev', KEY + '.blobindex', 'preFirePlanCloud', 'ppCloudCode'];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(KEY + '.blob.') === 0 && out.indexOf(k) < 0) out.push(k);
      }
    } catch (e) {}
    return out;
  }

  function clearPhotoVault() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.deleteDatabase('cfdPreplanPhotos');
        req.onsuccess = req.onerror = req.onblocked = function () { resolve(); };
        setTimeout(resolve, 2500);   // never hang the reset on a locked handle
      } catch (e) { resolve(); }
    });
  }

  /**
   * Park a copy on the server under a FRESH code and return it.
   *
   * The JSON download alone is not a safety net: a programmatic download can be
   * blocked outright, and when it is, the user finds out only after their plan
   * is gone. A server copy is verifiable before anything is destroyed, and the
   * code can be read back off the screen.
   */
  function parkBackup(p) {
    return fetch('/api/save-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: p })      // no code => the server mints one
    })
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.success && j.code) ? j.code : null; })
      .catch(function () { return null; });
  }

  /** Blank the server draft so ?plan=<code> cannot resurrect the plan. */
  function clearServerDraft(code) {
    if (!code) return Promise.resolve();
    return fetch('/api/save-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, data: {} })
    }).then(function () {}).catch(function () {});
  }

  function resetPlan() {
    var p = readPlan();
    var n = fieldCount(p);
    var code = '';
    try { code = (JSON.parse(localStorage.getItem('preFirePlanCloud') || '{}') || {}).code || ''; } catch (e) {}

    var msg = n
      ? 'Clear ALL pre-plan data?\n\n' +
        'This plan has ' + n + ' fields filled in' +
        (p.business_name ? ' for ' + p.business_name : '') + '.\n' +
        (code ? 'It will also be cleared from the cloud (code ' + code + ').\n' : '') +
        '\nA JSON backup will download first.\n\nThis cannot be undone.'
      : 'Clear ALL pre-plan data?\n\nThere is nothing filled in yet.';

    if (!confirm(msg)) return;

    // Back up BEFORE destroying anything, and prove it landed. If it did not,
    // the user gets to decide whether to go ahead blind rather than finding out
    // afterwards.
    if (n) {
      downloadBackup(p);                       // best effort; may be blocked
      parkBackup(p).then(function (code) {
        if (!code) {
          if (!confirm('The cloud backup FAILED and the file download may have been ' +
                       'blocked by the browser.\n\nClear the plan anyway? There may be ' +
                       'no copy left.')) return;
        } else {
          alert('Backed up as plan code ' + code + '\n\nWrite this down. To bring the ' +
                'plan back, open:\n' + location.origin + location.pathname + '?plan=' + code);
        }
        doWipe(code);
      });
      return;
    }
    doWipe(null);
  }

  function doWipe(backupCode) {
    var code = '';
    try { code = (JSON.parse(localStorage.getItem('preFirePlanCloud') || '{}') || {}).code || ''; } catch (e) {}

    // Mark the wipe as deliberate, and leave the mark set ACROSS the reload.
    // ppPersist() cannot tell a reset from corruption, so the next load
    // re-checks that the plan really is gone before dropping the flag.
    try { sessionStorage.setItem('__preplanResetting', '1'); } catch (e) {}
    try { if (backupCode) sessionStorage.setItem('__preplanBackupCode', backupCode); } catch (e) {}
    try { window.__preplanResetting = true; } catch (e) {}

    // Clear local storage FIRST and synchronously. If the tab is closed part
    // way through the network work below, the wipe has still happened, and any
    // auto-save that fires in the meantime now reads an empty "before" and so
    // has nothing to restore from.
    wipeLocal();

    Promise.all([clearServerDraft(code), clearPhotoVault()]).then(function () {
      wipeLocal();   // anything written during the async window goes too
      // A ?plan= code survives reload() and preplan-cloud's init() would pull
      // the whole plan back down, so land on a clean URL instead.
      location.replace(location.origin + location.pathname);
    });
  }

  function wipeLocal() {
    // removeItem on the plan key is shimmed by preplan-storage.js and takes the
    // blobs with it; the rest are cleared by name so nothing survives to
    // restore from.
    planKeys().forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  /**
   * Self-heal. If the previous page load started a reset, confirm the plan is
   * actually gone. Something restoring it means a path exists that this file
   * does not know about — clear it again and say so, rather than leaving the
   * user staring at data they asked to delete.
   */
  function verifyReset() {
    var flag;
    try { flag = sessionStorage.getItem('__preplanResetting'); } catch (e) { return; }
    if (!flag) return;

    var n = fieldCount(readPlan());
    if (n > 0) {
      wipeLocal();
      if (window.showToast) showToast('Reset had to run twice — ' + n + ' fields came back', 'info');
      else console.warn('[preplan-reset] plan was restored after a reset (' + n + ' fields); cleared again');
      // Leave the flag set for one more load so a persistent restorer is seen.
      return;
    }
    try { sessionStorage.removeItem('__preplanResetting'); } catch (e) {}

    var bc;
    try { bc = sessionStorage.getItem('__preplanBackupCode'); } catch (e) {}
    if (bc) {
      try { sessionStorage.removeItem('__preplanBackupCode'); } catch (e) {}
      showBackupBanner(bc);
    }
  }

  /** Persistent, dismissible note of where the cleared plan went. */
  function showBackupBanner(code) {
    var d = document.createElement('div');
    d.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);top:12px;z-index:10000;max-width:92vw;' +
      'background:#1e3a5f;color:#fff;padding:12px 16px;border-radius:12px;' +
      'font:600 13px system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);' +
      'display:flex;gap:12px;align-items:center;';
    d.innerHTML = '<span>Plan cleared. The old one is saved as code <b>' + code +
                  '</b> &mdash; open <code>?plan=' + code + '</code> to bring it back.</span>';
    var b = document.createElement('button');
    b.textContent = 'OK';
    b.style.cssText = 'border:0;background:#fff;color:#1e3a5f;font-weight:700;padding:8px 14px;' +
                      'border-radius:8px;cursor:pointer;min-height:36px;';
    b.onclick = function () { d.remove(); };
    d.appendChild(b);
    document.body.appendChild(d);
  }

  window.ppResetPlan = resetPlan;

  // Wire any button that asks for it, so the markup stays declarative.
  function wire() {
    var els = document.querySelectorAll('[data-preplan-reset]');
    for (var i = 0; i < els.length; i++) {
      els[i].addEventListener('click', function (e) { e.preventDefault(); resetPlan(); });
    }
  }
  function boot() { wire(); verifyReset(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
