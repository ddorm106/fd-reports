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
function autoSave(form) {
    form.addEventListener('input', function(){ saveFormData(form) });
    form.addEventListener('change', function(){ saveFormData(form) });
}
function navigate(url, form) { if(form) saveFormData(form); window.location.href = url; }
