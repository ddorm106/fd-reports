/* preplan-seed.js — start a pre-plan from the business we already know about.
 *
 * 123 Centerville businesses have no pre-plan yet. For every one of them we
 * already hold a name, address, coordinates, occupancy, square footage, a
 * needed-fire-flow figure, the parcel PIN (= tax id) and the three nearest
 * hydrants. Making somebody retype that into a blank form is the single
 * biggest reason plans do not get written.
 *
 * So: pick the business, the form opens already filled in, and you correct it
 * on scene rather than build it from nothing.
 *
 * Seeded fields are marked in additional_notes so nobody mistakes desk data
 * for something that was verified on site.
 */
(function () {
  'use strict';

  var SEEDS = 'preplan-seeds.json';
  var data = null, pending = null;

  function load() {
    if (data) return Promise.resolve(data);
    if (pending) return pending;
    pending = fetch(SEEDS, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('seeds ' + r.status); return r.json(); })
      .then(function (j) { data = j; return j; });
    return pending;
  }

  function planIsEmpty() {
    var p = {};
    try { p = JSON.parse(localStorage.getItem('preFirePlan') || '{}'); } catch (e) {}
    var real = Object.keys(p).filter(function (k) {
      return k !== 'plan_uid' && p[k] !== '' && p[k] != null;
    });
    return real.length === 0;
  }

  /* Build a preFirePlan from a seed. Only fields we can actually stand behind:
     everything here came off the hazard inventory, the county parcel layer or
     the hydrant list, and every one of them is repeated in the notes. */
  function toPlan(s) {
    var p = { plan_uid: 'plan-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) };
    p.business_name = s.name || '';
    p.address = (s.address || '') + (/Centerville/i.test(s.address || '') ? '' : ', Centerville, GA 31028');
    p.fire_district = 'CFD';
    if (s.lat) p.latitude = String(s.lat);
    if (s.lng) p.longitude = String(s.lng);
    if (s.tax_id) p.tax_id = s.tax_id;
    if (s.occupancy_types) p.occupancy_types = s.occupancy_types;
    if (s.occupant_load) { p.occupant_load_day = String(s.occupant_load); }
    if (s.sq_ft) { p.total_sq_ft = String(s.sq_ft); p.nff_area = String(s.sq_ft); }
    if (s.nff) p.nff_result = String(s.nff);

    (s.hydrants || []).slice(0, 3).forEach(function (h, i) {
      var n = i + 1;
      p['hyd_num_' + n] = h.id; p['hyd_loc_' + n] = h.loc;
      p['hyd_dist_' + n] = String(h.ft);
      p['hyd_flow_' + n] = h.flow || ''; p['hyd_static_' + n] = h.static || '';
      p['hyd_res_' + n] = h.resid || '';
    });
    if ((s.hydrants || []).length) p.hydCount = String(Math.min(3, s.hydrants.length));

    var seeded = [];
    if (s.tax_id) seeded.push('Tax ID ' + s.tax_id + ' (Houston County parcel' +
      (s.parcel_acres ? ', ' + s.parcel_acres + ' ac' : '') + ')');
    if (s.sq_ft) seeded.push(s.sq_ft + ' sq ft');
    if (s.occ_code) seeded.push('occupancy ' + s.occ_code);
    if (s.occupant_load) seeded.push('occupant load ' + s.occupant_load);
    if (s.nff) seeded.push('needed fire flow ' + s.nff + ' GPM');
    if ((s.hydrants || []).length) seeded.push('3 nearest hydrants');

    p.additional_notes =
      'SEEDED FROM DESK DATA on ' + new Date().toISOString().slice(0, 10) + ' - NOT YET VERIFIED ON SITE. ' +
      'Pre-filled: ' + seeded.join('; ') + '. ' +
      'Sources: CFD hazard inventory, Houston County parcel layer, CFD + county hydrant list. ' +
      (s.notes ? 'Inventory note: ' + s.notes + '. ' : '') +
      'Walk the building and correct anything that does not match.';
    return p;
  }

  function start(s) {
    /* Clearing the cloud code matters: keep it and this plan's first save
       overwrites the previous plan's draft under the same code. */
    Object.keys(localStorage)
      .filter(function (k) { return k.indexOf('preFirePlan') === 0; })
      .forEach(function (k) { localStorage.removeItem(k); });
    localStorage.setItem('preFirePlan', JSON.stringify(toPlan(s)));
    location.href = 'page1-location.html';
  }

  function render(host, list, q) {
    var needle = (q || '').trim().toLowerCase();
    var rows = list.filter(function (s) {
      if (!needle) return true;
      return (s.name + ' ' + s.address + ' ' + (s.tax_id || '')).toLowerCase().indexOf(needle) >= 0;
    });
    host.innerHTML = '';
    if (!rows.length) { host.innerHTML = '<div style="padding:14px;color:#64748b">No match.</div>'; return; }
    rows.slice(0, 300).forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 12px;border:0;' +
        'border-bottom:1px solid #e2e8f0;background:#fff;cursor:pointer;font-size:14px';
      b.innerHTML = '<strong>' + esc(s.name) + '</strong>' +
        '<div style="font-size:12px;color:#475569;margin-top:2px">' + esc(s.address) +
        (s.sq_ft ? ' · ' + s.sq_ft + ' sq ft' : '') +
        (s.occ_code ? ' · ' + esc(s.occ_code) : '') + '</div>';
      b.addEventListener('mouseenter', function () { b.style.background = '#f1f5f9'; });
      b.addEventListener('mouseleave', function () { b.style.background = '#fff'; });
      b.addEventListener('click', function () {
        if (!planIsEmpty() &&
            !confirm('This replaces the pre-plan currently open on this device.\n\n' +
                     'Make sure it is saved to the cloud first. Continue?')) return;
        start(s);
      });
      host.appendChild(b);
    });
    if (rows.length > 300) {
      var more = document.createElement('div');
      more.style.cssText = 'padding:8px 12px;color:#64748b;font-size:12px';
      more.textContent = rows.length - 300 + ' more — keep typing to narrow it down.';
      host.appendChild(more);
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function openPicker() {
    var back = document.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;' +
      'display:flex;align-items:center;justify-content:center;padding:16px';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;max-width:640px;width:100%;' +
      'max-height:82vh;display:flex;flex-direction:column;overflow:hidden';
    box.innerHTML =
      '<div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;' +
      'align-items:center;gap:10px">' +
      '<strong style="flex:1">Start from our business list</strong>' +
      '<button type="button" id="psClose" style="border:0;background:#e2e8f0;border-radius:6px;' +
      'padding:6px 10px;cursor:pointer">Close</button></div>' +
      '<div style="padding:10px 16px;border-bottom:1px solid #e2e8f0">' +
      '<input id="psQ" placeholder="Search name, address or tax ID…" ' +
      'style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px">' +
      '<div id="psCount" style="font-size:12px;color:#64748b;margin-top:6px"></div></div>' +
      '<div id="psList" style="overflow:auto;flex:1"></div>';
    back.appendChild(box);
    document.body.appendChild(back);

    function close() { back.remove(); }
    box.querySelector('#psClose').addEventListener('click', close);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });

    var list = box.querySelector('#psList'), q = box.querySelector('#psQ'),
        cnt = box.querySelector('#psCount');
    list.innerHTML = '<div style="padding:14px;color:#64748b">Loading…</div>';
    load().then(function (j) {
      cnt.textContent = j.count + ' businesses with no pre-plan yet · seeded from desk data, verify on site';
      render(list, j.seeds, '');
      q.addEventListener('input', function () { render(list, j.seeds, q.value); });
      q.focus();
    }).catch(function () {
      list.innerHTML = '<div style="padding:14px;color:#b91c1c">Business list could not be loaded.</div>';
    });
  }

  function boot() {
    var row = document.querySelector('[data-preplan-reset]');
    if (!row || !row.parentNode) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-secondary';
    b.textContent = '🏢 Start from business list';
    b.addEventListener('click', openPicker);
    row.parentNode.insertBefore(b, row);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PreplanSeed = { load: load, open: openPicker, toPlan: toPlan };
})();
