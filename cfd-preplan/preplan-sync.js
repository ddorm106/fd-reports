/* ============================================
   PRE-FIRE PLAN — Cloud Sync Module v2
   Transparent localStorage hook + cloud sync
   No changes needed to individual page scripts
   ============================================ */
(function() {
    'use strict';

    const SYNC_API = 'https://prefire-api.centfire6.workers.dev';
    const STORAGE_KEY = 'preFirePlan';
    const META_KEY = 'preFirePlanMeta';
    let syncTimeout = null;
    let isSyncing = false;
    let initialized = false;

    function getMeta() {
        try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); }
        catch { return {}; }
    }

    function setMeta(id, shareCode) {
        localStorage.setItem(META_KEY, JSON.stringify({ id, share_code: shareCode }));
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('plan', shareCode);
            window.history.replaceState({}, '', url.toString());
        } catch(e) {}
    }

    function getShareCodeFromUrl() {
        try {
            return new URLSearchParams(window.location.search).get('plan') || null;
        } catch { return null; }
    }

    // ─── Cloud Sync ──────────────────────────────────

    async function syncToCloud() {
        if (isSyncing) return;
        isSyncing = true;
        updateSyncStatus('saving');
        try {
            const data = localStorage.getItem(STORAGE_KEY) || '{}';
            const parsed = JSON.parse(data);
            const meta = getMeta();
            const payload = { data: parsed, business_name: parsed.business_name || '' };
            if (meta.id) payload.id = meta.id;
            const code = meta.share_code || getShareCodeFromUrl();
            if (code) payload.share_code = code;
            const res = await fetch(SYNC_API + '/api/plans/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                const result = await res.json();
                if (result.id && result.share_code) setMeta(result.id, result.share_code);
                updateSyncStatus('synced');
            } else { updateSyncStatus('error'); }
        } catch (e) {
            console.warn('Sync failed:', e.message);
            updateSyncStatus('offline');
        } finally { isSyncing = false; }
    }

    async function loadFromCloud() {
        try {
            const urlCode = getShareCodeFromUrl();
            const meta = getMeta();
            const code = urlCode || meta.share_code;
            const id = meta.id;
            if (!code && !id) return false;
            let url = SYNC_API + '/api/plans/load';
            url += code ? '?code=' + encodeURIComponent(code) : '?id=' + encodeURIComponent(id);
            const res = await fetch(url);
            if (!res.ok) return false;
            const result = await res.json();
            if (!result.data) return false;
            const cloudData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
            const localRaw = localStorage.getItem(STORAGE_KEY);
            const localData = localRaw ? JSON.parse(localRaw) : {};
            const merged = { ...localData, ...cloudData };
            // Use original setItem to avoid triggering sync loop
            origSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(merged));
            setMeta(result.id, result.share_code);
            updateSyncStatus('synced');
            return true;
        } catch (e) {
            console.warn('Cloud load failed:', e.message);
            updateSyncStatus('offline');
            return false;
        }
    }

    // ─── Hook localStorage.setItem ───────────────────
    const origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(key, value) {
        origSetItem(key, value);
        if (key === STORAGE_KEY && initialized) {
            clearTimeout(syncTimeout);
            updateSyncStatus('pending');
            syncTimeout = setTimeout(() => syncToCloud(), 2500);
        }
    };

    // ─── Patch Navigation (preserve plan code in URLs) ──

    document.addEventListener('click', function(e) {
        const link = e.target.closest('a[href]');
        if (!link) return;
        const href = link.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto') || href.startsWith('javascript')) return;
        const meta = getMeta();
        if (meta.share_code && !href.includes('plan=')) {
            e.preventDefault();
            window.location.href = href + (href.includes('?') ? '&' : '?') + 'plan=' + meta.share_code;
        }
    });

    // Patch window.location.href to preserve plan code
    // We intercept by overriding the property on window.location is not possible,
    // so instead we patch common navigation patterns in existing code
    const origAssign = window.location.assign ? window.location.assign.bind(window.location) : null;

    // After page loads, wrap any navigate() function the page defines
    function patchPageNavigate() {
        if (typeof window.navigate === 'function' && !window.navigate.__patched) {
            const orig = window.navigate;
            window.navigate = function(url) {
                const meta = getMeta();
                if (meta.share_code && url && !url.includes('plan=') && !url.startsWith('http')) {
                    url = url + (url.includes('?') ? '&' : '?') + 'plan=' + meta.share_code;
                }
                return orig(url);
            };
            window.navigate.__patched = true;
        }
    }

    // Also intercept location.href changes made in setTimeout callbacks
    // by observing beforeunload and patching common patterns
    // The most reliable approach: override location.href via a MutationObserver on script execution
    // Actually - simplest reliable method: patch the pages' navigate() and use beforeunload for sync

    // ─── Sync Bar UI ─────────────────────────────────

    function createSyncUI() {
        const bar = document.createElement('div');
        bar.id = 'sync-bar';
        bar.innerHTML = '<div id="sync-indicator" class="sync-ind sync-pending">' +
            '<span id="sync-icon">\u25CC</span> <span id="sync-text">Connecting...</span></div>' +
            '<button type="button" id="share-btn">\uD83D\uDCF1 Share / Other Device</button>';
        document.body.prepend(bar);

        const s = document.createElement('style');
        s.textContent = [
            '#sync-bar{position:sticky;top:0;z-index:999;display:flex;justify-content:space-between;align-items:center;padding:5px 16px;background:#1E293B;color:white;font-family:inherit;font-size:.78rem;flex-wrap:wrap;gap:6px}',
            '.sync-ind{display:flex;align-items:center;gap:5px;padding:2px 10px;border-radius:20px;font-weight:600;font-size:.72rem}',
            '.sync-synced{background:#065F46;color:#D1FAE5}.sync-pending{background:#92400E;color:#FEF3C7}',
            '.sync-error{background:#991B1B;color:#FEE2E2}.sync-offline{background:#475569;color:#E2E8F0}',
            '.sync-saving{background:#1E40AF;color:#DBEAFE}',
            '#share-btn{background:#C8102E;color:white;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:.72rem;font-weight:600;white-space:nowrap}',
            '#share-btn:hover{background:#9B0D24}',
            '.share-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center}',
            '.share-modal{background:#1E293B;color:white;padding:24px;border-radius:12px;text-align:center;max-width:90vw;width:400px;box-shadow:0 20px 40px rgba(0,0,0,.3)}',
            '.share-modal .code{font-size:1.8rem;font-weight:700;color:#FBBF24;letter-spacing:3px;margin:12px 0;user-select:all}',
            '.share-modal .url-box{font-size:.72rem;color:#94A3B8;word-break:break-all;padding:8px;background:#0F172A;border-radius:6px;margin:8px 0;user-select:all}',
            '.share-modal button{margin:4px;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:.85rem}',
            '@media(max-width:600px){#sync-bar{padding:3px 8px;font-size:.68rem}#share-btn{padding:3px 8px;font-size:.68rem}.share-modal{padding:16px}}'
        ].join('');
        document.head.appendChild(s);

        document.getElementById('share-btn').addEventListener('click', showShareDialog);
    }

    async function showShareDialog() {
        await syncToCloud();
        const meta = getMeta();
        if (!meta.share_code) { alert('Enter some data first, then share.'); return; }

        const base = window.location.href.split('?')[0].replace(/page\d+.*$/, '').replace(/index\.html$/, '');
        const shareUrl = base + 'page1-location.html?plan=' + meta.share_code;

        const overlay = document.createElement('div');
        overlay.className = 'share-overlay';
        overlay.innerHTML = '<div class="share-modal">' +
            '<div style="font-size:1.4rem;margin-bottom:8px">\uD83D\uDCF1 Continue on Another Device</div>' +
            '<p style="color:#94A3B8;font-size:.85rem">Open this link on your phone, iPad, or another computer to continue where you left off:</p>' +
            '<div class="url-box">' + shareUrl + '</div>' +
            '<div style="color:#CBD5E1;font-size:.8rem;margin:4px 0">\u2014 or type this code \u2014</div>' +
            '<div class="code">' + meta.share_code + '</div>' +
            '<div><button style="background:#C8102E;color:white" id="copy-share-btn">\uD83D\uDCCB Copy Link</button>' +
            '<button style="background:#475569;color:white" id="close-share-btn">Close</button></div></div>';

        document.body.appendChild(overlay);
        document.getElementById('copy-share-btn').addEventListener('click', function() {
            navigator.clipboard.writeText(shareUrl).then(() => {
                this.textContent = '\u2713 Copied!';
                setTimeout(() => { this.textContent = '\uD83D\uDCCB Copy Link'; }, 2000);
            }).catch(() => {
                const ta = document.createElement('textarea'); ta.value = shareUrl;
                document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
                this.textContent = '\u2713 Copied!';
            });
        });
        document.getElementById('close-share-btn').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        if (navigator.share) {
            try { await navigator.share({ title: 'Pre-Fire Plan', text: 'Continue pre-fire plan. Code: ' + meta.share_code, url: shareUrl }); } catch(e) {}
        }
    }

    function updateSyncStatus(status) {
        const icon = document.getElementById('sync-icon');
        const text = document.getElementById('sync-text');
        const ind = document.getElementById('sync-indicator');
        if (!icon) return;
        ind.className = 'sync-ind';
        var m = { synced: ['\u25CF','Synced to cloud','sync-synced'], saving: ['\u21BB','Syncing...','sync-saving'],
            pending: ['\u25CC','Unsaved changes','sync-pending'], error: ['\u2715','Sync error','sync-error'],
            offline: ['\u25CC','Offline \u2014 saved locally','sync-offline'] };
        var v = m[status] || m.pending;
        icon.textContent = v[0]; text.textContent = v[1]; ind.classList.add(v[2]);
    }

    // ─── Reload form data after cloud load ───────────

    function reloadFormData() {
        var saved;
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return; }
        document.querySelectorAll('form').forEach(function(form) {
            Object.keys(saved).forEach(function(key) {
                if (key === 'occupancy_types' && Array.isArray(saved[key])) {
                    document.querySelectorAll('input[name="occupancy_types"]').forEach(function(cb) {
                        cb.checked = saved[key].includes(cb.value);
                    });
                    return;
                }
                var el = form.elements[key];
                if (!el) return;
                if (el.length !== undefined && el[0]) {
                    for (var i = 0; i < el.length; i++) {
                        if (el[i].type === 'radio' && saved[key] === el[i].value) el[i].checked = true;
                        if (el[i].type === 'checkbox' && saved[key] === el[i].value) el[i].checked = true;
                    }
                } else if (el.type === 'checkbox') {
                    el.checked = saved[key] === el.value;
                } else if (el.type !== 'file') {
                    el.value = saved[key] || '';
                }
            });
        });
        // Trigger change events for dynamic UI updates (like NFPA diamond)
        document.querySelectorAll('.diamond-input input').forEach(function(inp) {
            inp.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    // ─── Init ────────────────────────────────────────

    async function init() {
        createSyncUI();
        var loaded = await loadFromCloud();
        if (loaded) {
            // Re-populate forms with cloud data
            reloadFormData();
        }
        initialized = true;
        patchPageNavigate();

        // Sync on page exit
        window.addEventListener('beforeunload', function() {
            var data = localStorage.getItem(STORAGE_KEY);
            if (data && data !== '{}') {
                var meta = getMeta();
                try {
                    navigator.sendBeacon(SYNC_API + '/api/plans/save', JSON.stringify({
                        id: meta.id, share_code: meta.share_code,
                        data: JSON.parse(data), business_name: (JSON.parse(data)).business_name || ''
                    }));
                } catch(e) {}
            }
        });

        // Periodic sync
        setInterval(function() {
            var data = localStorage.getItem(STORAGE_KEY);
            if (data && data !== '{}') syncToCloud();
        }, 30000);

        window.addEventListener('online', function() { syncToCloud(); });
        window.addEventListener('offline', function() { updateSyncStatus('offline'); });
    }

    // ─── Global navigation patcher ─────────────────
    // Wraps window.location.href assignments to add plan code
    // This runs BEFORE page scripts execute (since sync is in <head>)
    
    var _origLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    
    // We can't override location directly, so instead we provide a helper
    // and patch the navigate() pattern used by all pages
    window._pfpNav = function(url) {
        var meta;
        try { meta = JSON.parse(localStorage.getItem('preFirePlanMeta') || '{}'); } catch(e) { meta = {}; }
        if (meta.share_code && url && !url.includes('plan=') && !url.startsWith('http') && !url.startsWith('mailto')) {
            url = url + (url.includes('?') ? '&' : '?') + 'plan=' + meta.share_code;
        }
        window.location.href = url;
    };

    // After all scripts load, find and patch any navigate() functions
    window.addEventListener('load', function() {
        patchPageNavigate();
        
        // Also re-run reload in case page scripts populated forms during load
        // and our cloud data arrived later
        setTimeout(function() {
            var meta = getMeta();
            if (meta.share_code) reloadFormData();
        }, 500);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 150); });
    } else {
        setTimeout(init, 150);
    }
})();
