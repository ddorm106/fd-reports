function showToast(msg, type) {
    type = type || 'info';
    var c = document.getElementById('toast-container');
    if (!c) { c = document.createElement('div'); c.id='toast-container'; c.className='toast-container'; document.body.appendChild(c); }
    var t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){ t.remove() },300) },3000);
}
function getSavedData() { try { return JSON.parse(localStorage.getItem('preFirePlan')||'{}'); } catch(e) { return {}; } }
function saveAllData(data) { localStorage.setItem('preFirePlan', JSON.stringify(data)); }
function loadFormData(form) {
    var data = getSavedData();
    Array.from(form.elements).forEach(function(el) {
        if (!el.name) return;
        var val = data[el.name];
        if (val === undefined || val === null) return;
        if (el.type === 'radio') { if (el.value === val) el.checked = true; }
        else if (el.type === 'checkbox') {
            if (Array.isArray(val)) el.checked = val.indexOf(el.value) > -1;
            else el.checked = !!val;
        }
        else el.value = val;
    });
}
function saveFormData(form) {
    var data = getSavedData();
    Array.from(form.elements).forEach(function(el) {
        if (!el.name) return;
        if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
        else if (el.type === 'checkbox') {
            if (!data[el.name] || !Array.isArray(data[el.name])) data[el.name] = [];
            if (el.checked && data[el.name].indexOf(el.value) === -1) data[el.name].push(el.value);
            else if (!el.checked) data[el.name] = data[el.name].filter(function(v){return v!==el.value});
        }
        else data[el.name] = el.value;
    });
    saveAllData(data);
}
// ─── Auto-save ──────────────────────────────────────────────────────────────
// The whole plan lives in one localStorage key. On a big building that key
// holds the floor plan vectors plus base64 floor plan and site plan images —
// several megabytes. Saving on every keystroke meant parsing all of it,
// re-serialising all of it, and doing a synchronous localStorage write, per
// character. On a large plan that locks the page up while typing.
//
// Writes are now coalesced. Nothing is saved less reliably: a pending write is
// flushed on change, on navigation, when the tab is hidden, and before unload.
var __saveTimer = null;
var __pendingForm = null;
var SAVE_DEBOUNCE_MS = 600;

function flushPendingSave() {
    if (__saveTimer) { clearTimeout(__saveTimer); __saveTimer = null; }
    if (!__pendingForm) return;
    var form = __pendingForm;
    __pendingForm = null;
    saveFormData(form);
}

function queueSave(form) {
    __pendingForm = form;
    if (__saveTimer) clearTimeout(__saveTimer);
    __saveTimer = setTimeout(flushPendingSave, SAVE_DEBOUNCE_MS);
}

function autoSave(form) {
    form.addEventListener('input', function(){ queueSave(form) });
    // `change` fires once per pick, and marks the end of typing in a field, so
    // it is cheap enough to write straight away.
    form.addEventListener('change', function(){ __pendingForm = form; flushPendingSave(); });
}

// Anything that can end the page's life has to take the pending write with it.
window.addEventListener('beforeunload', flushPendingSave);
window.addEventListener('pagehide', flushPendingSave);
document.addEventListener('visibilitychange', function(){
    if (document.hidden) flushPendingSave();
});

function navigate(url, form) {
    if (form) __pendingForm = form;
    flushPendingSave();
    window.location.href = url;
}
