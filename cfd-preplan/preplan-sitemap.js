/* ===========================================================================
 * preplan-sitemap.js — the site plan as a real map, not a screenshot
 *
 * Page 10 has been a Fabric canvas over an uploaded aerial screenshot. That
 * works, but nothing on it has coordinates: a marker is pixels on somebody's
 * screengrab, so it cannot be checked against a hydrant record, cannot move
 * with a corrected address, and cannot be handed to anything else.
 *
 * This is the HCFD idea, and it is a good one. A live satellite map, tap to
 * drop a categorised marker, and the hydrant database drawn on top. Every
 * marker carries a real lat/lng.
 *
 * The 400-hydrant table already has flow GPM, available fire flow at 20 psi,
 * NFPA colour class and out-of-service flags, so the overlay is not decorative
 * - it answers "what will that one give me" without leaving the page.
 *
 * The uploaded-screenshot path is untouched and still saves to
 * site_plan_image. This is an addition, not a replacement: an aerial with the
 * building outlined by hand is still the right answer for some sites.
 * ======================================================================== */

(function () {
  'use strict';

  var CATS = [
    { k: 'fdc',       label: 'FDC',              t: '⊕', c: '#c92d34' },
    { k: 'knox',      label: 'Knox Box',         t: 'K',      c: '#d8aa4d' },
    { k: 'sprinkler', label: 'Sprinkler riser',  t: 'S',      c: '#2196f3' },
    { k: 'standpipe', label: 'Standpipe',        t: '⇧', c: '#55a8df' },
    { k: 'alarm',     label: 'Alarm panel',      t: '▣', c: '#ab47bc' },
    { k: 'electric',  label: 'Electric shutoff', t: 'E',      c: '#e2a33a' },
    { k: 'gas',       label: 'Gas shutoff',      t: 'G',      c: '#fb8c00' },
    { k: 'water',     label: 'Water shutoff',    t: 'W',      c: '#2196f3' },
    // Letter badges, not drum emoji. Three drums are indistinguishable at
    // marker size and emoji render differently on every device.
    { k: 'diesel',    label: 'Diesel tank',      t: 'D',      c: '#795548' },
    { k: 'gasoline',  label: 'Gasoline tank',    t: 'GA',     c: '#e64a19' },
    { k: 'propane',   label: 'Propane tank',     t: 'P',      c: '#7e57c2' },
    { k: 'hazmat',    label: 'Hazmat',           t: '☢', c: '#b3252b' },
    { k: 'entry',     label: 'Primary entry',    t: '➜', c: '#4caf50' },
    { k: 'roof',      label: 'Roof access',      t: 'R',      c: '#90a4ae' },
    { k: 'exposure',  label: 'Exposure',         t: 'X',      c: '#ff9800' },
    { k: 'assembly',  label: 'Assembly point',   t: '●', c: '#4caf50' },
    { k: 'obstruct',  label: 'Overhead obstruction', t: '⚠', c: '#ffd54f' },
    { k: 'other',     label: 'Other hazard',     t: '!',      c: '#b3252b' }
  ];
  function cat(k) { for (var i = 0; i < CATS.length; i++) if (CATS[i].k === k) return CATS[i]; return CATS[CATS.length - 1]; }

  var LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  var LEAFLET_JS  = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';

  var map, satLayer, streetLayer, markerLayer, hydrantLayer;
  var picked = null, usingSat = true, showHyd = true, hydrants = null;

  // ------------------------------------------------------------ plan access
  function readPlan() {
    try { return JSON.parse(localStorage.getItem('preFirePlan') || '{}') || {}; }
    catch (e) { return {}; }
  }
  function markers() { return readPlan().site_markers || []; }
  function writeMarkers(list) {
    try {
      var d = readPlan();
      if (list && list.length) d.site_markers = list; else delete d.site_markers;
      localStorage.setItem('preFirePlan', JSON.stringify(d));
    } catch (e) {}
  }
  function planLatLng() {
    var d = readPlan();
    var la = parseFloat(d.latitude), ln = parseFloat(d.longitude);
    if (isFinite(la) && isFinite(ln) && la !== 0 && ln !== 0) return [la, ln];
    return null;
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadCss(href) {
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
  }

  // ------------------------------------------------------------------ draw
  function pinIcon(c) {
    return L.divIcon({
      className: '',
      html: '<div class="sm-pin" style="background:' + c.c + '">' + c.t + '</div>' +
            '<div class="sm-pin-l">' + String(c.label).replace(/[<>&]/g, '') + '</div>',
      iconSize: [34, 34], iconAnchor: [17, 17]
    });
  }

  function drawMarkers() {
    if (!markerLayer) return;
    markerLayer.clearLayers();
    markers().forEach(function (m, i) {
      var c = cat(m.k);
      var mk = L.marker([m.lat, m.lng], { icon: pinIcon({ t: c.t, c: c.c, label: m.label || c.label }) });
      mk.on('click', function () {
        if (confirm('Remove this ' + (m.label || c.label) + ' marker?')) {
          var list = markers(); list.splice(i, 1); writeMarkers(list); drawMarkers(); refreshCount();
        }
      });
      markerLayer.addLayer(mk);
    });
  }

  function drawHydrants() {
    if (!hydrantLayer || !hydrants) return;
    hydrantLayer.clearLayers();
    var here = planLatLng();
    hydrants.forEach(function (h) {
      if (!h.latitude || !h.longitude) return;
      // Only what is actually near the building; 400 pins over a whole county
      // is noise, not information.
      if (here) {
        var dx = (h.longitude - here[1]) * 288200, dy = (h.latitude - here[0]) * 364000; // rough ft
        if (Math.sqrt(dx * dx + dy * dy) > 2000) return;
      }
      var oos = String(h.out_of_service) === '1';
      var col = oos ? '#7f1d1d'
              : (h.color === 'Blue' ? '#2563eb' : h.color === 'Green' ? '#16a34a'
              : h.color === 'Orange' ? '#ea580c' : h.color === 'Red' ? '#dc2626' : '#64748b');
      var mk = L.circleMarker([h.latitude, h.longitude], {
        radius: 7, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1
      });
      mk.bindPopup(
        '<b>Hydrant ' + (h.hydrant_id || h.id) + '</b><br>' +
        (h.location ? String(h.location).replace(/[<>]/g, '') + '<br>' : '') +
        (h.flow_gpm ? h.flow_gpm + ' gpm flow<br>' : '') +
        (h.aff_20psi ? '<b>' + h.aff_20psi + ' gpm available @20 psi</b><br>' : '') +
        (h.color ? 'NFPA class ' + h.color + '<br>' : '') +
        (oos ? '<b style="color:#b91c1c">OUT OF SERVICE</b>' : ''));
      hydrantLayer.addLayer(mk);
    });
  }

  function refreshCount() {
    var el = document.getElementById('smCount');
    if (el) {
      var n = markers().length;
      el.textContent = n ? n + ' marker' + (n === 1 ? '' : 's') + ' placed' : 'No markers yet';
    }
  }

  // -------------------------------------------------------------------- UI
  function palette() {
    return CATS.map(function (c) {
      return '<button type="button" class="sm-cat" data-k="' + c.k + '">' +
             '<span class="d" style="background:' + c.c + '">' + c.t + '</span>' + c.label + '</button>';
    }).join('');
  }

  function build(host) {
    var box = document.createElement('div');
    box.className = 'preplan-section';
    box.id = 'smBox';
    box.innerHTML =
      '<h3 class="section-title">Site map &mdash; tap to place what crews need to find</h3>' +
      '<div class="info-tip">Every marker here carries a real position, so it can be checked against the hydrant records and reused. ' +
      'The uploaded aerial below still works and is unaffected.</div>' +
      '<div id="smTools">' +
        '<button type="button" class="btn-secondary" id="smLayer">\u{1F6F0} Satellite</button>' +
        '<button type="button" class="btn-secondary" id="smHyd">\u{1F6B0} Hydrants on</button>' +
        '<button type="button" class="btn-secondary" id="smHere">Centre on the building</button>' +
        '<span id="smCount"></span>' +
      '</div>' +
      '<div id="smPal">' + palette() + '</div>' +
      '<div id="smHint">Pick a symbol above, then tap the map.</div>' +
      '<div id="smMap"></div>';
    host.insertBefore(box, host.firstChild);
  }

  function wire() {
    document.getElementById('smPal').addEventListener('click', function (e) {
      var b = e.target.closest('.sm-cat'); if (!b) return;
      picked = b.dataset.k;
      Array.prototype.forEach.call(document.querySelectorAll('.sm-cat'), function (x) {
        x.classList.toggle('sel', x === b);
      });
      document.getElementById('smHint').textContent =
        'Tap the map where the ' + cat(picked).label.toLowerCase() + ' is. Tap a placed marker to remove it.';
    });
    document.getElementById('smLayer').addEventListener('click', function () {
      usingSat = !usingSat;
      if (usingSat) { map.removeLayer(streetLayer); satLayer.addTo(map); }
      else { map.removeLayer(satLayer); streetLayer.addTo(map); }
      this.textContent = usingSat ? '\u{1F6F0} Satellite' : '\u{1F5FA} Street';
    });
    document.getElementById('smHyd').addEventListener('click', function () {
      showHyd = !showHyd;
      if (showHyd) hydrantLayer.addTo(map); else map.removeLayer(hydrantLayer);
      this.textContent = showHyd ? '\u{1F6B0} Hydrants on' : '\u{1F6B0} Hydrants off';
    });
    document.getElementById('smHere').addEventListener('click', function () {
      var p = planLatLng();
      if (p) map.setView(p, 19);
      else alert('No coordinates on this plan yet. Fill in latitude and longitude on the Location page.');
    });
  }

  function initMap() {
    var here = planLatLng() || [32.6285, -83.6899];   // Centerville
    map = L.map('smMap', { zoomControl: true }).setView(here, planLatLng() ? 19 : 14);

    satLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 21, maxNativeZoom: 19, attribution: 'Esri' });
    streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 21, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
    satLayer.addTo(map);

    markerLayer = L.layerGroup().addTo(map);
    hydrantLayer = L.layerGroup().addTo(map);

    if (planLatLng()) {
      L.circleMarker(here, { radius: 9, color: '#fff', weight: 3, fillColor: '#1e3a5f', fillOpacity: 1 })
        .bindTooltip('This building', { permanent: false }).addTo(map);
    }

    map.on('click', function (e) {
      if (!picked) {
        document.getElementById('smHint').textContent = 'Pick a symbol first, then tap the map.';
        return;
      }
      var label = prompt('Label for this ' + cat(picked).label + ' (optional)', '') ;
      var list = markers();
      list.push({ k: picked, lat: e.latlng.lat, lng: e.latlng.lng,
                  label: (label || '').trim() || null });
      writeMarkers(list); drawMarkers(); refreshCount();
    });

    drawMarkers(); refreshCount();

    fetch('/api/hydrants/all').then(function (r) { return r.json(); })
      .then(function (j) {
        hydrants = Array.isArray(j) ? j : (j.hydrants || j.results || j.data || []);
        drawHydrants();
      }).catch(function () {});
  }

  function style() {
    var css = document.createElement('style');
    css.textContent = [
      '#smMap{height:min(62vh,560px);border-radius:12px;border:1px solid #dbe3ec;margin-top:10px}',
      '#smTools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}',
      '#smTools .btn-secondary{padding:9px 14px !important;min-height:44px !important;font-size:14px !important}',
      '#smCount{font:600 12.5px system-ui,sans-serif;color:#64748b;margin-left:auto}',
      '#smPal{display:flex;flex-wrap:wrap;gap:6px}',
      '.sm-cat{display:flex;align-items:center;gap:7px;padding:8px 11px;border-radius:9px;',
      ' border:2px solid #dbe3ec;background:#fff;color:#0f172a;font:600 12.5px system-ui,sans-serif;',
      ' cursor:pointer;min-height:44px}',
      '.sm-cat.sel{border-color:#1e3a5f;background:#eef4fb}',
      '.sm-cat .d{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;',
      ' justify-content:center;font-size:11px;font-weight:700;color:#fff}',
      '#smHint{font:600 12px system-ui,sans-serif;color:#64748b;margin-top:8px}',
      '.sm-pin{width:30px;height:30px;border-radius:50%;border:2.5px solid #fff;display:flex;',
      ' align-items:center;justify-content:center;font:700 15px system-ui,sans-serif;color:#fff;',
      ' box-shadow:0 1px 4px rgba(0,0,0,.5)}',
      '.sm-pin-l{margin-top:2px;font:700 10px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.7);',
      ' padding:1px 5px;border-radius:4px;white-space:nowrap;transform:translateX(-25%)}',
      '@media print{#smBox{display:none}}'
    ].join('');
    document.head.appendChild(css);
  }

  function boot() {
    var host = document.querySelector('.page-wrapper') || document.querySelector('.container');
    if (!host || !document.getElementById('uploadSection')) return;   // page 10 only
    style();
    build(host);
    loadCss(LEAFLET_CSS);
    loadScript(LEAFLET_JS).then(function () { initMap(); wire(); })
      .catch(function (e) {
        document.getElementById('smMap').innerHTML =
          '<div style="padding:24px;text-align:center;color:#64748b">Map could not load. ' +
          'The aerial upload below still works.</div>';
        console.error(e);
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PreplanSiteMap = { CATS: CATS, markers: markers };
})();
