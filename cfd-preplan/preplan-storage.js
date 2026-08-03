/* ============================================================================
 * Pre-plan storage — keeps the big blobs out of the hot save path.
 *
 * The whole plan lives in one localStorage key, `preFirePlan`. On a large
 * building that key also carries base64 floor plan images and the Fabric site
 * plan, which run to megabytes. Every save then had to re-serialise all of it,
 * so typing a building's details locked the page up.
 *
 * Those blobs now live in their own keys. `preFirePlan` keeps only the small
 * form fields, so an ordinary save is a small parse and a small write no matter
 * how many images the plan carries.
 *
 * Nothing else had to change: getItem('preFirePlan') still returns the whole
 * plan, and setItem('preFirePlan', ...) still accepts the whole plan and splits
 * it apart. Existing pages read and write exactly as they did before.
 *
 * MUST be loaded before any other script that touches the plan.
 * ==========================================================================*/
(function () {
    if (window.__preplanStorageShim) return;
    window.__preplanStorageShim = true;

    var KEY = 'preFirePlan';
    var PREFIX = 'preFirePlan.blob.';

    // Everything here is large, rarely changes, and is never edited by typing
    // in a form field.
    var BLOBS = [
        'floor_plan_image',
        'floor_plan_image_2',
        'floor_plan_image_3',
        'site_plan_data',
        'floor_plan_data'
    ];

    var _get = localStorage.getItem.bind(localStorage);
    var _set = localStorage.setItem.bind(localStorage);
    var _rm  = localStorage.removeItem.bind(localStorage);

    /** The small part only — no blobs. This is what the hot path touches. */
    function readCore() {
        try { return JSON.parse(_get(KEY) || '{}'); } catch (e) { return {}; }
    }

    function readBlob(k) {
        var raw = _get(PREFIX + k);
        if (raw === null || raw === undefined) return undefined;
        try { return JSON.parse(raw); } catch (e) { return raw; }
    }

    function writeBlob(k, val) {
        if (val === undefined || val === null) { _rm(PREFIX + k); return; }
        try {
            _set(PREFIX + k, JSON.stringify(val));
        } catch (e) {
            // Quota is the realistic failure here. Say so rather than dying
            // silently and leaving someone to find the image missing later.
            console.error('[preplan] could not store ' + k + ':', e);
            if (window.showToast) showToast('Storage full — ' + k + ' was not saved', 'error');
        }
    }

    // Merged reads are cached, because a plan with two floor plan images is
    // expensive to reassemble and pages read it far more often than they write.
    var mergedCache = null;
    function invalidate() { mergedCache = null; }

    function mergedJSON() {
        if (mergedCache !== null) return mergedCache;
        var o = readCore();
        for (var i = 0; i < BLOBS.length; i++) {
            var v = readBlob(BLOBS[i]);
            if (v !== undefined) o[BLOBS[i]] = v;
        }
        mergedCache = JSON.stringify(o);
        return mergedCache;
    }

    // ── One-time migration ──────────────────────────────────────────────────
    // Plans saved before this change have the blobs inline. Move them out once,
    // so an existing Belk plan gets the speed-up without being re-entered.
    (function migrate() {
        var core = readCore();
        var moved = 0;
        for (var i = 0; i < BLOBS.length; i++) {
            var k = BLOBS[i];
            if (core[k] !== undefined && core[k] !== null) {
                writeBlob(k, core[k]);
                delete core[k];
                moved++;
            }
        }
        if (moved) {
            _set(KEY, JSON.stringify(core));
            console.log('[preplan] moved ' + moved + ' large item(s) out of the hot save path');
        }
    })();

    // ── Compatibility shim ──────────────────────────────────────────────────
    localStorage.getItem = function (k) {
        return k === KEY ? mergedJSON() : _get(k);
    };

    localStorage.setItem = function (k, v) {
        if (k !== KEY) return _set(k, v);
        invalidate();

        // Fast path: the form-field saves that happen while typing carry no
        // blobs, so there is nothing to split and nothing to parse.
        var hasBlob = false;
        if (typeof v === 'string') {
            for (var i = 0; i < BLOBS.length; i++) {
                if (v.indexOf('"' + BLOBS[i] + '"') !== -1) { hasBlob = true; break; }
            }
        } else {
            hasBlob = true;
        }
        if (!hasBlob) return _set(KEY, v);

        var o;
        try { o = JSON.parse(v); } catch (e) { return _set(KEY, v); }
        for (var j = 0; j < BLOBS.length; j++) {
            var bk = BLOBS[j];
            if (Object.prototype.hasOwnProperty.call(o, bk)) {
                writeBlob(bk, o[bk]);
                delete o[bk];
            }
        }
        _set(KEY, JSON.stringify(o));
    };

    localStorage.removeItem = function (k) {
        if (k === KEY) {
            invalidate();
            for (var i = 0; i < BLOBS.length; i++) _rm(PREFIX + BLOBS[i]);
        }
        return _rm(k);
    };

    // Used by the auto-save fast path so typing never reassembles the blobs.
    window.__preplanReadCore = readCore;
    window.__preplanWriteCore = function (obj) {
        invalidate();
        _set(KEY, JSON.stringify(obj));
    };
})();
