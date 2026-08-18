/* ===========================================================================
 * preplan-flow.js — one place that owns the order of the form
 *
 * The sequence used to live in three places at once: a `pages` array on the
 * index, a hardcoded Previous/Next pair in every page's markup, and a step
 * number typed into each page's <h3>. Changing the order meant editing all
 * three and hoping. This owns it.
 *
 * ORDER
 * -----
 * Sequenced the way a size-up runs, not the way the old paper form was laid
 * out. You get the building and how to reach it first, then what it is made of
 * and who is inside, then what is already there to fight it with, then the
 * hazards, then the sketches. Contacts and sign-off go last because nobody
 * reads a phone number on approach.
 *
 * The old order buried construction behind occupancy, put special rescue
 * between utilities and fire flow, and left water supply near the end.
 *
 * FIELD IDS ARE UNTOUCHED. Only the sequence and the chrome change, so every
 * saved plan, the DivisionScan import, the Worker's forward allowlist and the
 * ISO layer all keep working against the same keys.
 * ======================================================================== */

(function () {
  'use strict';

  var FLOW = [
    { file: 'page1-location.html',            title: 'Location',            desc: 'Address, GPS, directions',        fields: ['business_name', 'address', 'pfp_number'] },
    { file: 'page2-operating.html',           title: 'Access',              desc: 'Getting in, hours, obstructions', fields: ['primary_access', 'operating_hours', 'exterior_access_locs'] },
    { file: 'page4-construction.html',        title: 'Building',            desc: 'Construction, roof, dimensions',  fields: ['wall_construction', 'roof_construction', 'total_sq_ft'] },
    { file: 'page3-occupancy.html',           title: 'Occupancy & Life',    desc: 'Use, occupant load, hazards',     fields: ['occupancy_types', 'occupant_load_day', 'life_safety_concerns'] },
    { file: 'page5-fire-protection.html',     title: 'Fire Protection',     desc: 'Sprinkler, standpipe, FDC, Knox', fields: ['sprinklered', 'fire_alarm_type', 'knox_box_loc'] },
    { file: 'page6-utilities.html',           title: 'Utilities',           desc: 'Gas, electric, water shutoffs',   fields: ['electric_loc', 'natural_gas_loc', 'water_shutoff_loc'] },
    { file: 'page8-fire-flow.html',           title: 'Water Supply',        desc: 'Hydrants, needed fire flow',      fields: ['hyd_aff_1', 'nff_area', 'nff_const_class'] },
    { file: 'page9-hazardous-materials.html', title: 'Hazmat',              desc: 'Chemicals, NFPA 704',             fields: ['chemCount', 'tier_ii', 'msds_onsite'] },
    { file: 'page7-special-rescue.html',      title: 'Special Rescue',      desc: 'Confined space, high angle',      fields: ['confined_space', 'high_angle'] },
    { file: 'page10-site-plan.html',          title: 'Site Plan',           desc: 'Exterior sketch',                 fields: ['site_plan_data'] },
    { file: 'page11-floor-plan.html',         title: 'Floor Plan',          desc: 'Interior sketch',                 fields: ['floor_plan_data'] },
    { file: 'page12-submit.html',             title: 'Contacts & Review',   desc: 'Responsible party, tour, submit', fields: ['primary_contact', 'plan_date', 'pre_plan_conducted_by'] }
  ];
  FLOW.forEach(function (s, i) { s.step = i + 1; });
  window.PREPLAN_FLOW = FLOW;

  function plan() {
    try { return JSON.parse(localStorage.getItem('preFirePlan') || '{}') || {}; }
    catch (e) { return {}; }
  }

  function filled(v) {
    if (v == null) return false;
    if (typeof v === 'object') {
      if (Array.isArray(v)) return v.length > 0;
      if (v.walls || v.objects || v.symbols) {
        return (v.walls || []).length > 0 || (v.objects || []).length > 0 ||
               (v.symbols || []).length > 0 || (v.texts || []).length > 0;
      }
      return Object.keys(v).length > 0;
    }
    return String(v).trim() !== '';
  }

  function isStarted(step, data) {
    for (var i = 0; i < step.fields.length; i++) if (filled(data[step.fields[i]])) return true;
    return false;
  }

  function here() {
    var f = location.pathname.split('/').pop() || '';
    for (var i = 0; i < FLOW.length; i++) if (FLOW[i].file === f) return i;
    return -1;
  }

  function go(url) {
    // navigate() flushes the pending auto-save before leaving. Never bypass it.
    var form = document.getElementById('theForm') || document.querySelector('form');
    if (typeof window.navigate === 'function') window.navigate(url, form);
    else location.href = url;
  }

  // ---------------------------------------------------------------- step bar
  // A persistent strip of every step, so you always know where you are and can
  // jump straight to the one you actually came to fill in. Getting lost in a
  // twelve-page form is mostly not being able to see the shape of it.
  function buildStepBar(idx) {
    var data = plan();
    var bar = document.createElement('nav');
    bar.id = 'pp-stepbar';
    bar.setAttribute('aria-label', 'Pre-plan sections');

    var inner = document.createElement('div');
    inner.className = 'pp-stepbar-inner';

    FLOW.forEach(function (s, i) {
      var a = document.createElement('a');
      a.href = s.file;
      a.className = 'pp-step' +
        (i === idx ? ' current' : '') +
        (isStarted(s, data) ? ' started' : '');
      a.innerHTML = '<span class="pp-step-n">' + s.step + '</span>' +
                    '<span class="pp-step-t">' + s.title + '</span>';
      a.title = s.step + '. ' + s.title + ' — ' + s.desc;
      a.addEventListener('click', function (e) { e.preventDefault(); go(s.file); });
      inner.appendChild(a);
    });

    bar.appendChild(inner);
    document.body.insertBefore(bar, document.body.firstChild);

    // Keep the step you are on in view without dragging the whole page.
    var cur = bar.querySelector('.pp-step.current');
    if (cur && cur.scrollIntoView) {
      try { cur.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {}
    }
  }

  // ------------------------------------------------------------ page chrome
  function retitle(idx) {
    var s = FLOW[idx];
    var h = document.querySelector('.section-title');
    if (h) h.textContent = s.step + '. ' + s.title;
    // The old numbers are baked into <title> too, and a wrong one in the tab
    // is exactly the sort of thing that makes a form feel out of order.
    if (document.title.indexOf('Pre-Fire Plan') === 0) {
      document.title = 'Pre-Fire Plan: ' + s.title;
    }
  }

  function rewireNav(idx) {
    var wrap = document.querySelector('.nav-buttons');
    if (!wrap) return;
    var prev = FLOW[idx - 1], next = FLOW[idx + 1];

    wrap.innerHTML = '';
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn-secondary';
    back.textContent = prev ? '← ' + prev.title : '← Overview';
    back.addEventListener('click', function () { go(prev ? prev.file : 'preplan-index.html'); });
    wrap.appendChild(back);

    var fwd = document.createElement('button');
    fwd.type = 'button';
    fwd.className = 'btn-primary';
    fwd.textContent = next ? next.title + ' →' : 'Overview →';
    fwd.addEventListener('click', function () { go(next ? next.file : 'preplan-index.html'); });
    wrap.appendChild(fwd);
  }

  // ------------------------------------------------------------------ index
  function renderIndex() {
    var nav = document.getElementById('page-nav');
    if (!nav) return false;
    var data = plan();
    nav.innerHTML = FLOW.map(function (s) {
      var done = isStarted(s, data);
      return '<a href="' + s.file + '" class="page-link' + (done ? ' completed' : '') + '">' +
               '<div class="page-number">' + s.step + '</div>' +
               '<div class="page-info"><h4>' + s.title + '</h4><p>' + s.desc + '</p></div>' +
               '<div class="page-status"></div></a>';
    }).join('');
    return true;
  }

  // ------------------------------------------------------------------ style
  function style() {
    var css = document.createElement('style');
    css.textContent = [
      '#pp-stepbar{position:sticky;top:0;z-index:900;background:#1e3a5f;',
      ' box-shadow:0 2px 8px rgba(0,0,0,.18);}',
      '.pp-stepbar-inner{display:flex;gap:6px;overflow-x:auto;padding:8px 10px;',
      ' -webkit-overflow-scrolling:touch;scrollbar-width:none;}',
      '.pp-stepbar-inner::-webkit-scrollbar{display:none;}',
      '.pp-step{flex:0 0 auto;display:flex;align-items:center;gap:7px;text-decoration:none;',
      ' padding:9px 13px;border-radius:999px;background:rgba(255,255,255,.10);color:#cfe0f5;',
      ' font:600 13px system-ui,-apple-system,sans-serif;min-height:44px;white-space:nowrap;}',
      '.pp-step-n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;',
      ' border-radius:50%;background:rgba(255,255,255,.18);font-size:11px;font-weight:800;}',
      '.pp-step.started{color:#fff;}',
      '.pp-step.started .pp-step-n{background:#16a34a;color:#fff;}',
      '.pp-step.current{background:#fff;color:#1e3a5f;}',
      '.pp-step.current .pp-step-n{background:#1e3a5f;color:#fff;}',
      // iPad ergonomics. The form was built for a mouse: 30px inputs, tiny
      // radios, buttons you have to aim at.
      'input,select,textarea{font-size:16px !important;}',   // also stops iOS zooming on focus
      '@media (pointer:coarse){',
      ' input[type=text],input[type=tel],input[type=date],input[type=number],input[type=email],select{',
      '   min-height:46px !important;padding:10px 12px !important;}',
      ' textarea{min-height:88px !important;padding:10px 12px !important;}',
      ' input[type=checkbox],input[type=radio]{width:22px !important;height:22px !important;}',
      ' label{line-height:1.45;}',
      ' .btn-primary,.btn-secondary,.action-btn{min-height:48px !important;padding:12px 22px !important;',
      '   font-size:16px !important;}',
      ' .nav-buttons{position:sticky;bottom:0;background:rgba(255,255,255,.96);padding:10px;',
      '   margin:0 -10px -10px;border-top:1px solid #e2e8f0;z-index:800;',
      '   -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}',
      ' .nav-buttons button{flex:1;}',
      '}',
      '@media print{#pp-stepbar{display:none !important;}}'
    ].join('');
    document.head.appendChild(css);
  }

  function boot() {
    style();
    if (renderIndex()) return;      // overview page needs no step chrome
    var idx = here();
    if (idx < 0) return;
    buildStepBar(idx);
    retitle(idx);
    rewireNav(idx);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
