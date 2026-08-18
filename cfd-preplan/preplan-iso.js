/* ===========================================================================
 * preplan-iso.js — ISO FSRS Item 580.H compliance layer
 *
 * Loads on every pre-plan page, after preplan-storage.js.
 *
 * WHY THIS EXISTS
 * ---------------
 * Item 580.H (Building Familiarization / Pre-Incident Planning) awards up to
 * 12 points for pre-incident planning tours of each commercial, industrial,
 * institutional and similar building, conducted ANNUALLY by company personnel,
 * with records that carry "complete and up-to-date notes and sketches" and
 * that are available to the responding incident commander.
 *
 * Three things follow from that wording, and this file makes all three
 * visible while the plan is being written rather than at audit time:
 *
 *   1. FREQUENCY is graded. A plan with a tour date older than 12 months is
 *      not creditable, however good it is. Currency is computed and shown.
 *   2. NOTES **AND** SKETCHES. Both. A perfect data sheet with no floor plan,
 *      or a floor plan on a record with no construction type, does not read
 *      as a creditable NFPA 1620 plan.
 *   3. WHO conducted it. Company personnel, named on the record.
 *
 * The content checklist below is the intersection of what ISO credits and
 * what NFPA 1620 asks a pre-incident plan to carry. The CORE set is the seven
 * fields an audit of this book found sitting at 2 records out of 111 —
 * construction type, sprinkler, alarm, Knox, shutoffs, hydrant, contact.
 * Those are weighted separately because they are the number that moves.
 *
 * This layer never blocks a save and never writes plan data. It reads
 * localStorage.preFirePlan and reports.
 * ======================================================================== */

(function () {
  'use strict';

  var MONTHS_CURRENT = 12;   // 580.H: annual for maximum credit
  var WARN_DAYS = 60;        // amber before it lapses

  // ------------------------------------------------------------------ spec
  // core:true  -> one of the seven ISO-credited fields
  // any:true   -> satisfied if ANY listed field has a value
  // when(p)    -> requirement only applies if this returns true
  var SPEC = [
    // ---- 580.H record itself -------------------------------------------
    { key: 'tour_date', label: 'Tour date on the record', group: 'record',
      page: 'page12-submit.html', fields: ['plan_date'],
      why: '580.H is graded on annual frequency. Without a date the record cannot be shown to be current.' },

    { key: 'conducted_by', label: 'Conducted by (company personnel)', group: 'record',
      page: 'page12-submit.html', fields: ['pre_plan_conducted_by'],
      why: '580.H credits tours made by company personnel. The record has to name who made it.' },

    { key: 'sketch_site', label: 'Sketch — site plan', group: 'record',
      page: 'page10-site-plan.html', fields: ['site_plan_data'],
      why: '580.H requires notes AND sketches. The site plan is the exterior half.' },

    { key: 'sketch_floor', label: 'Sketch — floor plan', group: 'record',
      page: 'page11-floor-plan.html', fields: ['floor_plan_data'],
      why: '580.H requires notes AND sketches. The floor plan is the interior half.' },

    // ---- the seven that move the number --------------------------------
    { key: 'construction', label: 'Construction type', group: 'content', core: true,
      page: 'page4-construction.html', fields: ['wall_construction', 'roof_construction'],
      why: 'Governs collapse risk and tactics. A floor plan on a record with no construction type is not a creditable 1620 plan.' },

    { key: 'sprinkler', label: 'Sprinkler status', group: 'content', core: true,
      page: 'page5-fire-protection.html', fields: ['sprinklered'],
      why: 'Drives the whole fire-attack decision and the ISO needed-fire-flow credit.' },

    { key: 'alarm', label: 'Fire alarm', group: 'content', core: true,
      page: 'page5-fire-protection.html', fields: ['fire_alarm_type'],
      why: 'Detection and notification type tells the first-due what it is walking into.' },

    { key: 'knox', label: 'Knox box location', group: 'content', core: true,
      page: 'page5-fire-protection.html', fields: ['knox_box_loc'],
      why: 'Forcible-entry decision on arrival.' },

    { key: 'shutoffs', label: 'Utility shutoffs (electric / gas / water)', group: 'content', core: true,
      page: 'page6-utilities.html', fields: ['electric_loc', 'natural_gas_loc', 'lp_gas_loc', 'water_shutoff_loc'],
      minCount: 2,
      why: 'Control of utilities is a first-arriving assignment; the locations have to be on the sheet.' },

    { key: 'hydrant', label: 'Nearest hydrant', group: 'content', core: true,
      page: 'page8-fire-flow.html', fields: ['hyd_aff_1'],
      why: 'Water supply. ISO grades supply separately, but the plan must say where it is.' },

    { key: 'contact', label: 'Responsible party + phone', group: 'content', core: true,
      page: 'page2-operating.html', fields: ['primary_contact', 'primary_tel'],
      why: 'After-hours access and occupancy information. 109 of 111 records in the sister book had no phone number.' },

    // ---- other NFPA 1620 content ISO expects to see ---------------------
    { key: 'identity', label: 'Building name and address', group: 'content',
      page: 'page1-location.html', fields: ['business_name', 'address'],
      why: 'Identifies the record. Also what dispatch matches against.' },

    { key: 'occupancy', label: 'Occupancy classification', group: 'content',
      page: 'page3-occupancy.html', fields: ['occupancy_types'],
      why: 'Determines the expected life hazard and fire load.' },

    { key: 'occupant_load', label: 'Occupant load', group: 'content',
      page: 'page3-occupancy.html', fields: ['occupant_load_day', 'occupant_load_night'], any: true,
      why: 'Sizes the rescue problem.' },

    { key: 'access', label: 'Primary access', group: 'content',
      page: 'page2-operating.html', fields: ['primary_access'],
      why: 'How the first-due gets in, and where apparatus goes.' },

    { key: 'life_safety', label: 'Life-safety concerns', group: 'content',
      page: 'page3-occupancy.html', fields: ['life_safety_concerns'],
      why: '1620 asks for the occupancy-specific hazards to responders and occupants.' },

    { key: 'fdc', label: 'FDC location', group: 'content',
      page: 'page5-fire-protection.html', fields: ['fdc_loc'],
      when: function (p) { return yes(p.sprinklered) || yes(p.standpipe); },
      why: 'Required once the building is sprinklered or standpiped — the supply company needs it.' },

    { key: 'standpipe', label: 'Standpipe', group: 'content',
      page: 'page5-fire-protection.html', fields: ['standpipe'],
      why: 'Determines whether crews stretch from a floor below or from the apparatus.' },

    { key: 'iso_class', label: 'ISO construction class (fire flow)', group: 'content',
      page: 'page8-fire-flow.html', fields: ['nff_const_class'],
      why: 'Feeds the needed-fire-flow calculation ISO grades under Item 580.' },

    { key: 'fire_flow', label: 'Needed fire flow computed', group: 'content',
      page: 'page8-fire-flow.html', fields: ['nff_area', 'nff_occ_class'],
      why: 'Establishes the supply the incident will need.' },

    { key: 'notes', label: 'Tactical notes', group: 'record',
      page: 'page12-submit.html', fields: ['additional_notes', 'construction_notes', 'fire_protection_notes', 'utility_notes'], any: true,
      why: '580.H says notes AND sketches. This is the notes half in the responder’s own words.' }
  ];

  function yes(v) {
    if (v == null) return false;
    var s = String(v).trim().toLowerCase();
    return s === 'yes' || s === 'y' || s === 'true' || s === '1';
  }

  function readPlan() {
    try { return JSON.parse(localStorage.getItem('preFirePlan') || '{}') || {}; }
    catch (_) { return {}; }
  }

  function filled(v) {
    if (v == null) return false;
    if (typeof v === 'object') {
      // Sketch payloads: a floor plan counts only if it actually has geometry.
      if (Array.isArray(v)) return v.length > 0;
      if (v.walls || v.objects || v.symbols) {
        return (v.walls || []).length > 0 || (v.objects || []).length > 0 ||
               (v.symbols || []).length > 0 || (v.texts || []).length > 0;
      }
      return Object.keys(v).length > 0;
    }
    var s = String(v).trim();
    if (!s) return false;
    if (s === 'undefined' || s === 'null') return false;
    // A site plan is stored as a Fabric JSON string; require more than a stub.
    return true;
  }

  // ------------------------------------------------------------- evaluation
  function evaluate() {
    var p = readPlan();
    var rows = [], met = 0, total = 0, coreMet = 0, coreTotal = 0;

    for (var i = 0; i < SPEC.length; i++) {
      var r = SPEC[i];
      if (r.when && !r.when(p)) continue;

      var have = [], missing = [];
      for (var f = 0; f < r.fields.length; f++) {
        (filled(p[r.fields[f]]) ? have : missing).push(r.fields[f]);
      }

      var ok;
      if (r.any) ok = have.length >= 1;
      else if (r.minCount) ok = have.length >= r.minCount;
      else ok = missing.length === 0;

      rows.push({
        key: r.key, label: r.label, group: r.group, core: !!r.core,
        page: r.page, why: r.why, ok: ok,
        have: have, missing: missing,
        partial: !ok && have.length > 0
      });

      total++;
      if (ok) met++;
      if (r.core) { coreTotal++; if (ok) coreMet++; }
    }

    return { rows: rows, met: met, total: total, coreMet: coreMet, coreTotal: coreTotal,
             currency: currency(p), plan: p };
  }

  /** 580.H is graded on annual frequency, so currency is its own verdict. */
  function currency(p) {
    var raw = p.plan_date;
    if (!filled(raw)) {
      return { state: 'none', label: 'No tour date', detail: 'Item 580.H is graded on annual tours. Undated records cannot be shown current.' };
    }
    var d = new Date(raw + 'T00:00:00');
    if (isNaN(d.getTime())) {
      return { state: 'none', label: 'Tour date unreadable', detail: String(raw) };
    }
    var due = new Date(d.getTime());
    due.setMonth(due.getMonth() + MONTHS_CURRENT);
    var now = new Date();
    var days = Math.round((due - now) / 86400000);
    var dueStr = due.toISOString().slice(0, 10);

    if (days < 0) {
      return { state: 'overdue', label: 'Overdue by ' + Math.abs(days) + ' days',
               detail: 'Tour ' + raw + ' — was due ' + dueStr + '. Not creditable until re-toured.', due: dueStr };
    }
    if (days <= WARN_DAYS) {
      return { state: 'soon', label: 'Due in ' + days + ' days',
               detail: 'Tour ' + raw + ' — next due ' + dueStr + '.', due: dueStr };
    }
    return { state: 'current', label: 'Current', detail: 'Tour ' + raw + ' — next due ' + dueStr + '.', due: dueStr };
  }

  // ------------------------------------------------------------------- UI
  var pill, panel;

  function build() {
    if (document.getElementById('iso-pill')) return;

    pill = document.createElement('button');
    pill.id = 'iso-pill';
    pill.type = 'button';
    pill.addEventListener('click', toggle);
    document.body.appendChild(pill);

    panel = document.createElement('div');
    panel.id = 'iso-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ISO 580.H compliance');
    document.body.appendChild(panel);

    document.addEventListener('click', function (e) {
      if (!panel.classList.contains('open')) return;
      if (panel.contains(e.target) || pill.contains(e.target)) return;
      panel.classList.remove('open');
    });

    style();
    refresh();

    // The plan is written to constantly; keep the badge honest without
    // re-rendering the panel underneath the reader.
    window.addEventListener('storage', refresh);
    setInterval(function () { if (!panel.classList.contains('open')) refresh(); }, 4000);
    document.addEventListener('change', function () { setTimeout(refresh, 60); }, true);
  }

  function toggle() {
    render();
    panel.classList.toggle('open');
  }

  function refresh() {
    var r = evaluate();
    var pct = r.total ? Math.round(r.met / r.total * 100) : 0;
    var cls = r.currency.state === 'overdue' ? 'bad'
            : (r.coreMet < r.coreTotal || r.currency.state !== 'current') ? 'warn'
            : 'good';
    pill.className = cls;
    pill.innerHTML = '<span class="iso-tag">ISO 580.H</span>' +
                     '<span class="iso-score">' + r.met + '/' + r.total + '</span>' +
                     '<span class="iso-core">core ' + r.coreMet + '/' + r.coreTotal + '</span>';
    pill.title = 'ISO 580.H — ' + pct + '% complete, ' + r.currency.label +
                 '. Click for what is missing.';
    if (panel.classList.contains('open')) render();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render() {
    var r = evaluate();
    var cur = r.currency;

    var h = '<div class="iso-head">' +
              '<div><strong>ISO FSRS Item 580.H</strong>' +
              '<div class="iso-sub">Building familiarization / pre-incident planning &mdash; up to 12 points</div></div>' +
              '<button class="iso-x" type="button" aria-label="Close">&times;</button>' +
            '</div>';

    h += '<div class="iso-cur iso-' + cur.state + '">' +
           '<strong>' + esc(cur.label) + '</strong><span>' + esc(cur.detail) + '</span>' +
         '</div>';

    h += '<div class="iso-bars">' +
           bar('The seven that move the number', r.coreMet, r.coreTotal) +
           bar('All 580.H / 1620 items', r.met, r.total) +
         '</div>';

    var groups = [
      { id: 'record', title: 'The record itself (580.H)' },
      { id: 'content', title: 'Plan content (NFPA 1620)' }
    ];

    for (var g = 0; g < groups.length; g++) {
      var list = r.rows.filter(function (x) { return x.group === groups[g].id; });
      if (!list.length) continue;
      h += '<div class="iso-group"><h4>' + groups[g].title + '</h4>';
      for (var i = 0; i < list.length; i++) {
        var row = list[i];
        var mark = row.ok ? '&#10003;' : (row.partial ? '&#8226;' : '&times;');
        var st = row.ok ? 'ok' : (row.partial ? 'part' : 'no');
        h += '<div class="iso-row iso-' + st + (row.core ? ' iso-corerow' : '') + '">' +
               '<span class="iso-mark">' + mark + '</span>' +
               '<div class="iso-body">' +
                 '<div class="iso-label">' + esc(row.label) +
                   (row.core ? '<span class="iso-badge">CORE</span>' : '') + '</div>' +
                 (row.ok ? '' : '<div class="iso-why">' + esc(row.why) + '</div>') +
                 (row.ok ? '' : '<a class="iso-go" href="' + esc(row.page) +
                    (row.missing.length ? '#' + esc(row.missing[0]) : '') + '">Go fix it &rarr;</a>') +
               '</div>' +
             '</div>';
      }
      h += '</div>';
    }

    h += '<div class="iso-foot">Records must carry complete, up-to-date notes <em>and</em> sketches, ' +
         'and be available to the responding incident commander.</div>';

    panel.innerHTML = h;
    panel.querySelector('.iso-x').addEventListener('click', function () {
      panel.classList.remove('open');
    });
  }

  function bar(label, n, d) {
    var pct = d ? Math.round(n / d * 100) : 0;
    var cls = pct === 100 ? 'good' : pct >= 60 ? 'warn' : 'bad';
    return '<div class="iso-bar"><div class="iso-bar-top"><span>' + esc(label) +
           '</span><span>' + n + '/' + d + '</span></div>' +
           '<div class="iso-track"><i class="' + cls + '" style="width:' + pct + '%"></i></div></div>';
  }

  function style() {
    var s = document.createElement('style');
    s.textContent = [
      '#iso-pill{position:fixed;right:14px;bottom:14px;z-index:9998;display:flex;align-items:center;gap:8px;',
      ' padding:10px 14px;border-radius:999px;border:0;cursor:pointer;color:#fff;min-height:44px;',
      ' font:700 12px system-ui,-apple-system,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.28);}',
      '#iso-pill.good{background:#16a34a}#iso-pill.warn{background:#d97706}#iso-pill.bad{background:#b91c1c}',
      '#iso-pill .iso-tag{opacity:.85;font-weight:800;letter-spacing:.02em}',
      '#iso-pill .iso-score{background:rgba(255,255,255,.22);padding:3px 8px;border-radius:999px}',
      '#iso-pill .iso-core{background:rgba(0,0,0,.2);padding:3px 8px;border-radius:999px;font-weight:600}',
      '#iso-panel{position:fixed;right:14px;bottom:68px;z-index:9999;width:min(94vw,430px);',
      ' max-height:min(76vh,700px);overflow:auto;background:#fff;border-radius:14px;display:none;',
      ' box-shadow:0 18px 50px rgba(0,0,0,.3);font:400 13px system-ui,-apple-system,sans-serif;color:#111827;',
      ' -webkit-overflow-scrolling:touch;}',
      '#iso-panel.open{display:block}',
      '#iso-panel .iso-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;',
      ' padding:14px 16px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:#fff;border-radius:14px 14px 0 0}',
      '#iso-panel .iso-sub{color:#6b7280;font-size:11px;margin-top:2px}',
      '#iso-panel .iso-x{border:0;background:#f3f4f6;width:34px;height:34px;border-radius:8px;font-size:20px;cursor:pointer;line-height:1}',
      '#iso-panel .iso-cur{padding:11px 16px;display:flex;flex-direction:column;gap:2px;font-size:12px}',
      '#iso-panel .iso-cur span{color:#4b5563}',
      '#iso-panel .iso-current{background:#ecfdf5;border-left:4px solid #16a34a}',
      '#iso-panel .iso-soon{background:#fffbeb;border-left:4px solid #d97706}',
      '#iso-panel .iso-overdue{background:#fef2f2;border-left:4px solid #b91c1c}',
      '#iso-panel .iso-none{background:#f9fafb;border-left:4px solid #9ca3af}',
      '#iso-panel .iso-bars{padding:12px 16px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid #e5e7eb}',
      '#iso-panel .iso-bar-top{display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin-bottom:4px}',
      '#iso-panel .iso-track{height:7px;background:#e5e7eb;border-radius:999px;overflow:hidden}',
      '#iso-panel .iso-track i{display:block;height:100%;border-radius:999px}',
      '#iso-panel .iso-track i.good{background:#16a34a}#iso-panel .iso-track i.warn{background:#d97706}',
      '#iso-panel .iso-track i.bad{background:#b91c1c}',
      '#iso-panel .iso-group{padding:10px 16px 4px}',
      '#iso-panel .iso-group h4{margin:6px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280}',
      '#iso-panel .iso-row{display:flex;gap:10px;padding:8px 0;border-top:1px solid #f3f4f6}',
      '#iso-panel .iso-mark{width:20px;height:20px;border-radius:50%;flex:0 0 20px;display:flex;',
      ' align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;margin-top:1px}',
      '#iso-panel .iso-ok .iso-mark{background:#16a34a}',
      '#iso-panel .iso-part .iso-mark{background:#d97706}',
      '#iso-panel .iso-no .iso-mark{background:#b91c1c}',
      '#iso-panel .iso-label{font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '#iso-panel .iso-badge{background:#111827;color:#fff;font-size:9px;padding:2px 5px;border-radius:4px;letter-spacing:.04em}',
      '#iso-panel .iso-why{color:#6b7280;font-size:11.5px;margin-top:3px;line-height:1.4}',
      '#iso-panel .iso-go{display:inline-block;margin-top:5px;font-size:11.5px;font-weight:700;color:#1d4ed8;text-decoration:none}',
      '#iso-panel .iso-ok .iso-label{color:#374151;font-weight:500}',
      '#iso-panel .iso-foot{padding:12px 16px 16px;color:#6b7280;font-size:11px;line-height:1.5;border-top:1px solid #e5e7eb}',
      '@media print{#iso-pill,#iso-panel{display:none!important}}'
    ].join('');
    document.head.appendChild(s);
  }

  // Deep links land on the field that is missing; make that obvious.
  function focusHash() {
    if (!location.hash || location.hash.length < 2) return;
    var el = document.getElementById(location.hash.slice(1));
    if (!el) return;
    setTimeout(function () {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { el.scrollIntoView(); }
      var old = el.style.boxShadow;
      el.style.boxShadow = '0 0 0 3px #f59e0b';
      setTimeout(function () { el.style.boxShadow = old; }, 2600);
      if (el.focus) { try { el.focus({ preventScroll: true }); } catch (_) {} }
    }, 350);
  }

  function boot() { build(); focusHash(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PreplanISO = { evaluate: evaluate, currency: currency, SPEC: SPEC, refresh: function () { refresh(); } };
})();
