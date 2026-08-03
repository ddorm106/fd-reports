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
    var INDEX = 'preFirePlan.blobindex';

    // Anything this big gets its own key. Sizing the rule rather than naming
    // the fields means a blob added later — another floor's image, a second
    // site plan render — is handled without anyone remembering to list it.
    // The first version of this listed field names and promptly missed
    // site_plan_image, which put megabytes straight back into the hot key.
    var BLOB_MIN = 4096;

    var _get = localStorage.getItem.bind(localStorage);
    var _set = localStorage.setItem.bind(localStorage);
    var _rm  = localStorage.removeItem.bind(localStorage);

    /** The small part only — no blobs. This is what the hot path touches. */
    function readCore() {
        try { return JSON.parse(_get(KEY) || '{}'); } catch (e) { return {}; }
    }

    /** Names of the values currently living in their own keys. */
    function blobIndex() {
        try { return JSON.parse(_get(INDEX) || '[]'); } catch (e) { return []; }
    }
    function setBlobIndex(list) { _set(INDEX, JSON.stringify(list)); }

    function readBlob(k) {
        var raw = _get(PREFIX + k);
        if (raw === null || raw === undefined) return undefined;
        try { return JSON.parse(raw); } catch (e) { return raw; }
    }

    /**
     * Stores one value in its own key. Returns true only when the value is
     * verifiably in storage.
     *
     * This must never report success it cannot back up. An earlier version
     * swallowed the quota error and the caller went on to delete the value
     * from the plan — which turned "could not move this image" into "this
     * image is gone". Nothing is removed from the plan unless this says true.
     */
    function writeBlob(k, val) {
        if (val === undefined || val === null) { _rm(PREFIX + k); return false; }
        var s;
        try { s = JSON.stringify(val); } catch (e) { return false; }
        try {
            _set(PREFIX + k, s);
        } catch (e) {
            console.error('[preplan] could not store ' + k + ' (' +
                          Math.round(s.length / 1024) + ' KB):', e && e.name);
            if (window.showToast) {
                showToast('Storage full — ' + k + ' kept in place, not moved', 'error');
            }
            return false;
        }
        // Confirm it actually landed. Some browsers fail a write quietly when
        // storage is under pressure.
        var back = _get(PREFIX + k);
        if (back === null || back.length !== s.length) {
            console.error('[preplan] ' + k + ' did not persist; leaving it in the plan');
            _rm(PREFIX + k);
            return false;
        }
        return true;
    }

    // Merged reads are cached, because a plan with two floor plan images is
    // expensive to reassemble and pages read it far more often than they write.
    var mergedCache = null;
    function invalidate() { mergedCache = null; }

    function mergedJSON() {
        if (mergedCache !== null) return mergedCache;
        var o = readCore();
        var idx = blobIndex();
        for (var i = 0; i < idx.length; i++) {
            var v = readBlob(idx[i]);
            if (v !== undefined) o[idx[i]] = v;
        }
        mergedCache = JSON.stringify(o);
        return mergedCache;
    }

    /**
     * Splits a whole-plan object: anything large moves to its own key, and any
     * blob no longer present is dropped. Callers that hand us the full plan
     * (an image upload, a canvas save) rely on both halves of that — removing
     * a floor plan image has to actually stick.
     */
    function writeWholePlan(o) {
        var previous = blobIndex();
        var nowBlobs = [];

        // Measure once — JSON.stringify on a megabyte value is not free.
        var sized = [];
        for (var k in o) {
            if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
            var v = o[k];
            if (v === null || v === undefined) continue;
            var approx = (typeof v === 'string') ? v.length : JSON.stringify(v).length;
            if (approx >= BLOB_MIN) sized.push({ k: k, n: approx });
        }
        // Biggest first: each one that moves frees space for the next, which
        // matters because the plan is still holding the old copy meanwhile.
        sized.sort(function (a, b) { return b.n - a.n; });

        for (var i = 0; i < sized.length; i++) {
            var key = sized[i].k;
            var val = o[key];
            if (!writeBlob(key, val)) continue;   // failed — leave it in the plan

            nowBlobs.push(key);
            delete o[key];
            // Shrink the main key straight away so the duplicate copy stops
            // occupying quota before the next blob is written.
            try {
                _set(KEY, JSON.stringify(o));
            } catch (e) {
                // Could not shrink; put it back so the plan stays whole and
                // give the blob key back rather than leaving an orphan.
                o[key] = val;
                nowBlobs.pop();
                _rm(PREFIX + key);
            }
        }

        // A key that simply is not in this write means "unchanged", NOT
        // "delete". Pages here write a partial plan all the time — built from
        // a stale read, or from a subset — and treating those omissions as
        // deletions destroyed the floor plan and the site plan repeatedly.
        // Removing a value now requires saying so explicitly, by writing it
        // as null.
        for (var j = 0; j < previous.length; j++) {
            var pk = previous[j];
            if (nowBlobs.indexOf(pk) !== -1) continue;

            if (Object.prototype.hasOwnProperty.call(o, pk)) {
                // The caller supplied a value for this key, so the old blob is
                // stale whatever the new value is. Drop it: either the key was
                // cleared, or the new value is small enough to sit inline —
                // and a leftover blob would shadow it on the next read, which
                // would quietly resurrect an old drawing over a new one.
                _rm(PREFIX + pk);
                var v2 = o[pk];
                if (v2 === null || v2 === undefined || v2 === '') delete o[pk];
            } else {
                // Not mentioned in this write. That means unchanged, not
                // deleted — partial writes must not destroy a floor plan.
                nowBlobs.push(pk);
            }
        }

        setBlobIndex(nowBlobs);
        _set(KEY, JSON.stringify(o));
    }

    // ── One-time migration ──────────────────────────────────────────────────
    // Plans saved before this change have the blobs inline. Move them out once,
    // so an existing Belk plan gets the speed-up without being re-entered.
    (function migrate() {
        var core = readCore();
        var big = 0;
        for (var k in core) {
            if (!Object.prototype.hasOwnProperty.call(core, k)) continue;
            var v = core[k];
            if (v === null || v === undefined) continue;
            var approx = (typeof v === 'string') ? v.length : JSON.stringify(v).length;
            if (approx >= BLOB_MIN) big++;
        }
        if (big) {
            writeWholePlan(core);
            console.log('[preplan] moved ' + big + ' large item(s) out of the hot save path');
        }
    })();

    // ── Compatibility shim ──────────────────────────────────────────────────
    localStorage.getItem = function (k) {
        return k === KEY ? mergedJSON() : _get(k);
    };

    // Every write that comes through here carries the whole plan — that is what
    // getItem handed the caller. So it is always split and reconciled. The
    // typing path does not come through here; it uses __preplanWriteCore.
    localStorage.setItem = function (k, v) {
        if (k !== KEY) return _set(k, v);
        invalidate();
        var o;
        try { o = JSON.parse(v); } catch (e) { return _set(KEY, v); }
        writeWholePlan(o);
    };

    localStorage.removeItem = function (k) {
        if (k === KEY) {
            invalidate();
            var idx = blobIndex();
            for (var i = 0; i < idx.length; i++) _rm(PREFIX + idx[i]);
            _rm(INDEX);
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
