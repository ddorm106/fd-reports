/* ===========================================================================
 * preplan-sitemap.js — the site plan
 *
 * Page 10 used to be an upload box and a Fabric canvas over whatever aerial
 * screenshot somebody happened to grab. It worked, but nothing on it had
 * coordinates: a marker was pixels on a screengrab, so it could not be checked
 * against a hydrant record, could not move with a corrected address, and could
 * not be handed to anything else.
 *
 * This replaces it. A live satellite map, tap to drop a categorised marker,
 * and the hydrant database drawn on top. Every marker carries a real lat/lng.
 *
 * The 400-hydrant table already has flow GPM, available fire flow at 20 psi,
 * NFPA colour class and out-of-service flags, so the overlay is not decorative
 * — it answers "what will that one actually give me" without leaving the page.
 *
 * WHAT PRINTS. Whatever is on screen is what lands in the PDF and the Book.
 * The map is composed to a flat JPEG (tiles, hydrants, markers, north arrow,
 * scale bar, legend) and stored as site_map_image, re-rendered a beat after
 * every pan, zoom or marker change. That is why the tiles come through
 * /api/maptile/ on our own origin: a canvas that has drawn a cross-origin tile
 * is tainted, and toDataURL() throws.
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
  var SAT_URL    = '/api/maptile/sat/{z}/{x}/{y}';
  var STREET_URL = '/api/maptile/street/{z}/{x}/{y}';
  var MAX_NATIVE = 19;

  var map, satLayer, streetLayer, markerLayer, hydrantLayer, hereLayer;
  var picked = null, usingSat = true, showHyd = true, hydrants = null;
  var renderTimer = null, rendering = false, renderAgain = false;

  // ------------------------------------------------------------ plan access
  function readPlan() {
    try { return JSON.parse(localStorage.getItem('preFirePlan') || '{}') || {}; }
    catch (e) { return {}; }
  }
  function writePlan(mutate) {
    try {
      var d = readPlan();
      mutate(d);
      localStorage.setItem('preFirePlan', JSON.stringify(d));
      return true;
    } catch (e) { return false; }
  }
  function markers() { return readPlan().site_markers || []; }
  function writeMarkers(list) {
    writePlan(function (d) {
      if (list && list.length) d.site_markers = list; else delete d.site_markers;
    });
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

  // ------------------------------------------------------------ projection
  // Plain Web Mercator in world pixels. Leaflet has this internally but the
  // composer must work with an explicit zoom that is not the display zoom.
  function project(lat, lng, z) {
    var s = 256 * Math.pow(2, z);
    var sn = Math.sin(lat * Math.PI / 180);
    sn = Math.max(-0.9999, Math.min(0.9999, sn));
    return {
      x: (lng + 180) / 360 * s,
      y: (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * s
    };
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
          var list = markers(); list.splice(i, 1); writeMarkers(list);
          drawMarkers(); refreshCount(); scheduleRender();
        }
      });
      markerLayer.addLayer(mk);
    });
  }

  function hydColour(h) {
    if (String(h.out_of_service) === '1') return '#7f1d1d';
    return h.color === 'Blue' ? '#2563eb' : h.color === 'Green' ? '#16a34a'
         : h.color === 'Orange' ? '#ea580c' : h.color === 'Red' ? '#dc2626' : '#64748b';
  }

  // Only what is actually near the building; 400 pins over a whole county is
  // noise, not information.
  function nearbyHydrants() {
    if (!hydrants) return [];
    var here = planLatLng();
    return hydrants.filter(function (h) {
      if (!h.latitude || !h.longitude) return false;
      if (!here) return true;
      var dx = (h.longitude - here[1]) * 288200, dy = (h.latitude - here[0]) * 364000; // rough ft
      return Math.sqrt(dx * dx + dy * dy) <= 2000;
    });
  }

  function drawHydrants() {
    if (!hydrantLayer || !hydrants) return;
    hydrantLayer.clearLayers();
    nearbyHydrants().forEach(function (h) {
      var oos = String(h.out_of_service) === '1';
      var mk = L.circleMarker([h.latitude, h.longitude], {
        radius: 7, color: '#fff', weight: 2, fillColor: hydColour(h), fillOpacity: 1
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
  function status(msg, warn) {
    var el = document.getElementById('smStat');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = warn ? '#b3252b' : '#166534';
  }

  // ============================================================== composer
  // Turn the current view into a flat JPEG for the PDF and the Book.
  function loadTile(url) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = url;                    // same origin: canvas stays untainted
    });
  }

  // Work out what the picture has to cover. Whatever is on screen, PLUS every
  // marker and the building, with room for the pin labels. A marker the crew
  // placed but left just off the edge of the view would otherwise never reach
  // the PDF, which is exactly the thing this is for.
  function extentFor(z, bw, bh, dz, c) {
    var f = Math.pow(2, z - dz);
    var w = bw * f, h = bh * f;
    var ctr = project(c.lat, c.lng, z);
    var minX = ctr.x - w / 2, maxX = ctr.x + w / 2;
    var minY = ctr.y - h / 2, maxY = ctr.y + h / 2;
    var pts = [];
    markers().forEach(function (m) {
      if (isFinite(m.lat) && isFinite(m.lng)) pts.push(project(m.lat, m.lng, z));
    });
    var here = planLatLng();
    if (here) pts.push(project(here[0], here[1], z));
    var pad = 48;                      // pin radius plus its label
    pts.forEach(function (pt) {
      minX = Math.min(minX, pt.x - pad); maxX = Math.max(maxX, pt.x + pad);
      minY = Math.min(minY, pt.y - pad); maxY = Math.max(maxY, pt.y + pad + 26);
    });
    var W = maxX - minX, H = maxY - minY;
    // A letterbox strip prints as a sliver on a portrait page.
    if (W / H > 1.75) { var nh = W / 1.75; minY -= (nh - H) / 2; H = nh; }
    return { tl: { x: minX, y: minY }, w: Math.round(W), h: Math.round(H) };
  }

  function composeImage() {
    if (!map || typeof L === 'undefined') return Promise.resolve(null);
    var box = document.getElementById('smMap');
    if (!box) return Promise.resolve(null);
    var bw = box.clientWidth || 900, bh = box.clientHeight || 560;
    var dz = map.getZoom();
    var c = map.getCenter();

    // Back the zoom off until the whole extent is a sane number of tiles.
    var z = Math.min(MAX_NATIVE, Math.round(dz)), ext = extentFor(z, bw, bh, dz, c);
    while (z > 14 && (ext.w > 2800 || ext.h > 2800 ||
                      Math.ceil(ext.w / 256 + 1) * Math.ceil(ext.h / 256 + 1) > 200)) {
      z--; ext = extentFor(z, bw, bh, dz, c);
    }
    var outW = ext.w, outH = ext.h, tl = ext.tl;
    if (outW < 40 || outH < 40) return Promise.resolve(null);

    var k = Math.min(1, 1600 / outW, 1400 / outH);
    var finW = Math.max(1, Math.round(outW * k)), finH = Math.max(1, Math.round(outH * k));

    var n = Math.pow(2, z);
    var x0 = Math.floor(tl.x / 256), x1 = Math.floor((tl.x + outW - 1) / 256);
    var y0 = Math.floor(tl.y / 256), y1 = Math.floor((tl.y + outH - 1) / 256);
    var base = (usingSat ? SAT_URL : STREET_URL);
    var jobs = [];
    for (var tx = x0; tx <= x1; tx++) {
      for (var ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= n) continue;
        var wx = ((tx % n) + n) % n;
        jobs.push({
          url: base.replace('{z}', z).replace('{x}', wx).replace('{y}', ty),
          dx: tx * 256 - tl.x, dy: ty * 256 - tl.y
        });
      }
    }
    if (!jobs.length) return Promise.resolve(null);

    var tileCv = document.createElement('canvas');
    tileCv.width = outW; tileCv.height = outH;
    var tctx = tileCv.getContext('2d');
    tctx.fillStyle = '#1a1a1e'; tctx.fillRect(0, 0, outW, outH);

    return Promise.all(jobs.map(function (j) {
      return loadTile(j.url).then(function (im) { if (im) tctx.drawImage(im, j.dx, j.dy, 256, 256); });
    })).then(function () {
      var cv = document.createElement('canvas');
      cv.width = finW; cv.height = finH;
      var g = cv.getContext('2d');
      g.drawImage(tileCv, 0, 0, finW, finH);
      function P(lat, lng) {
        var pt = project(lat, lng, z);
        return { x: (pt.x - tl.x) * k, y: (pt.y - tl.y) * k };
      }
      var S = Math.max(0.72, Math.min(1.5, finW / 1100));

      nearbyHydrants().forEach(function (h) {
        var pt = P(h.latitude, h.longitude);
        if (pt.x < -20 || pt.y < -20 || pt.x > finW + 20 || pt.y > finH + 20) return;
        var r = 7 * S;
        g.beginPath(); g.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        g.fillStyle = hydColour(h); g.fill();
        g.lineWidth = 2 * S; g.strokeStyle = '#fff'; g.stroke();
        if (h.aff_20psi) {
          var t = h.aff_20psi + '';
          g.font = '700 ' + Math.round(10 * S) + 'px system-ui, sans-serif';
          var w = g.measureText(t).width + 6 * S;
          g.fillStyle = 'rgba(0,0,0,.72)';
          g.fillRect(pt.x - w / 2, pt.y + r + 2 * S, w, 13 * S);
          g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(t, pt.x, pt.y + r + 8.5 * S);
        }
      });

      var here = planLatLng();
      if (here) {
        var hp = P(here[0], here[1]);
        g.beginPath(); g.arc(hp.x, hp.y, 10 * S, 0, Math.PI * 2);
        g.fillStyle = '#1e3a5f'; g.fill();
        g.lineWidth = 3 * S; g.strokeStyle = '#fff'; g.stroke();
      }

      var used = {};
      markers().forEach(function (m) {
        var cc = cat(m.k); used[cc.k] = cc;
        var pt = P(m.lat, m.lng);
        var r = 15 * S;
        g.beginPath(); g.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        g.fillStyle = cc.c; g.fill();
        g.lineWidth = 2.5 * S; g.strokeStyle = '#fff'; g.stroke();
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = '700 ' + Math.round((cc.t.length > 1 ? 12 : 16) * S) + 'px system-ui, sans-serif';
        g.fillText(cc.t, pt.x, pt.y + 0.5 * S);
        var lab = (m.label || cc.label);
        g.font = '700 ' + Math.round(11 * S) + 'px system-ui, sans-serif';
        var lw = g.measureText(lab).width + 8 * S;
        g.fillStyle = 'rgba(0,0,0,.78)';
        g.fillRect(pt.x - lw / 2, pt.y + r + 3 * S, lw, 15 * S);
        g.fillStyle = '#fff';
        g.fillText(lab, pt.x, pt.y + r + 10.5 * S);
      });

      // scale bar — a map in a report without one is a picture
      var mpp = 156543.03392 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, z) / k;
      var fpp = mpp * 3.28084;
      var want = [25, 50, 100, 200, 300, 500, 800, 1000, 2000];
      var ft = want[0], px = 0;
      for (var wi = 0; wi < want.length; wi++) {
        var q = want[wi] / fpp;
        if (q >= 70 * S && q <= finW * 0.42) { ft = want[wi]; px = q; break; }
        if (q < 70 * S) { ft = want[wi]; px = q; }
      }
      if (px > 4) {
        var bx = 12 * S, by = finH - 16 * S;
        g.fillStyle = 'rgba(0,0,0,.62)';
        g.fillRect(bx - 6 * S, by - 20 * S, px + 12 * S, 30 * S);
        g.strokeStyle = '#fff'; g.lineWidth = 3 * S;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + px, by); g.stroke();
        g.beginPath(); g.moveTo(bx, by - 5 * S); g.lineTo(bx, by + 5 * S);
        g.moveTo(bx + px, by - 5 * S); g.lineTo(bx + px, by + 5 * S); g.stroke();
        g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        g.font = '700 ' + Math.round(11 * S) + 'px system-ui, sans-serif';
        g.fillText(ft + ' ft', bx, by - 7 * S);
      }

      var nx = finW - 26 * S, ny = 26 * S;
      g.fillStyle = 'rgba(0,0,0,.62)';
      g.beginPath(); g.arc(nx, ny, 19 * S, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(nx, ny - 13 * S); g.lineTo(nx + 6 * S, ny + 4 * S);
      g.lineTo(nx, ny + 1 * S); g.lineTo(nx - 6 * S, ny + 4 * S);
      g.closePath(); g.fill();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 ' + Math.round(10 * S) + 'px system-ui, sans-serif';
      g.fillText('N', nx, ny + 11 * S);

      var keys = Object.keys(used);
      if (keys.length) {
        var lh = 17 * S, pad2 = 8 * S;
        g.font = '600 ' + Math.round(11 * S) + 'px system-ui, sans-serif';
        var wmax = 0;
        keys.forEach(function (kk) { wmax = Math.max(wmax, g.measureText(used[kk].label).width); });
        var boxW2 = wmax + 34 * S, boxH2 = keys.length * lh + pad2 * 2;
        var lx = 12 * S, ly = 12 * S;
        g.fillStyle = 'rgba(0,0,0,.66)';
        g.fillRect(lx, ly, boxW2, boxH2);
        keys.forEach(function (kk, i) {
          var cc = used[kk], yy = ly + pad2 + i * lh + lh / 2;
          g.beginPath(); g.arc(lx + pad2 + 7 * S, yy, 7 * S, 0, Math.PI * 2);
          g.fillStyle = cc.c; g.fill();
          g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.font = '700 ' + Math.round((cc.t.length > 1 ? 7 : 9) * S) + 'px system-ui, sans-serif';
          g.fillText(cc.t, lx + pad2 + 7 * S, yy + 0.5 * S);
          g.textAlign = 'left';
          g.font = '600 ' + Math.round(11 * S) + 'px system-ui, sans-serif';
          g.fillText(cc.label, lx + pad2 + 19 * S, yy);
        });
      }

      try { return cv.toDataURL('image/jpeg', 0.82); }
      catch (e) { console.warn('site map compose blocked', e); return null; }
    });
  }

  function renderNow() {
    if (rendering) { renderAgain = true; return Promise.resolve(); }
    rendering = true;
    status('Updating the report image…');
    return composeImage().then(function (url) {
      rendering = false;
      if (!url) { status('Could not build the report image from this view.', true); return; }
      var c = map.getCenter();
      var ok = writePlan(function (d) {
        d.site_map_image = url;
        d.site_map_view = { lat: c.lat, lng: c.lng, zoom: map.getZoom(), sat: usingSat };
        d.site_map_saved_at = new Date().toISOString();
      });
      var n = markers().length;
      status(ok ? ('This view is what prints ✓' + (n ? '  \u2014  all ' + n + ' marker' + (n === 1 ? '' : 's') + ' are in it' : ''))
                : 'Out of browser storage — the map image was not saved.', !ok);
      if (renderAgain) { renderAgain = false; scheduleRender(400); }
    }).catch(function (e) {
      rendering = false;
      status('Could not build the report image.', true);
      console.error('site map render', e);
    });
  }

  function scheduleRender(ms) {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () { renderTimer = null; renderNow(); }, ms || 1400);
  }
  function flush() {
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    // Best effort on the way out; a pending compose is async and may not land.
    if (!rendering) renderNow();
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
      '<h3 class="section-title">10. Site Plan</h3>' +
      '<div class="info-tip">Tap a symbol, then tap the map where it is. Every marker carries a real ' +
      'position, so it can be checked against the hydrant records. <b>Whatever you leave on screen is ' +
      'what prints in the PDF and the Book</b> — pan and zoom until the framing is right.</div>' +
      '<div id="smTools">' +
        '<button type="button" class="btn-secondary" id="smLayer">\u{1F6F0} Satellite</button>' +
        '<button type="button" class="btn-secondary" id="smHyd">\u{1F6B0} Hydrants on</button>' +
        '<button type="button" class="btn-secondary" id="smHere">Centre on the building</button>' +
        '<button type="button" class="btn-secondary" id="smFit">Fit everything</button>' +
        '<span id="smCount"></span>' +
      '</div>' +
      '<div id="smPal">' + palette() + '</div>' +
      '<div id="smHint">Pick a symbol above, then tap the map.</div>' +
      '<div id="smMap"></div>' +
      '<div id="smStat"></div>';
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
      scheduleRender();
    });
    document.getElementById('smHyd').addEventListener('click', function () {
      showHyd = !showHyd;
      if (showHyd) hydrantLayer.addTo(map); else map.removeLayer(hydrantLayer);
      this.textContent = showHyd ? '\u{1F6B0} Hydrants on' : '\u{1F6B0} Hydrants off';
      scheduleRender();
    });
    document.getElementById('smFit').addEventListener('click', function () {
      var pts = markers().filter(function (m) { return isFinite(m.lat) && isFinite(m.lng); })
                         .map(function (m) { return [m.lat, m.lng]; });
      var here = planLatLng(); if (here) pts.push(here);
      if (!pts.length) { alert('Nothing placed yet.'); return; }
      if (pts.length === 1) { map.setView(pts[0], 19); return; }
      map.fitBounds(L.latLngBounds(pts), { padding: [45, 45], maxZoom: 20 });
    });
    document.getElementById('smHere').addEventListener('click', function () {
      var p = planLatLng();
      if (p) map.setView(p, 19);
      else alert('No coordinates on this plan yet. Fill in latitude and longitude on the Location page.');
    });
  }

  function initMap() {
    var saved = readPlan().site_map_view;
    var here = planLatLng() || [32.6285, -83.6899];   // Centerville
    var start = (saved && isFinite(saved.lat) && isFinite(saved.lng)) ? [saved.lat, saved.lng] : here;
    var startZ = (saved && isFinite(saved.zoom)) ? saved.zoom : (planLatLng() ? 19 : 14);
    if (saved && saved.sat === false) usingSat = false;

    map = L.map('smMap', { zoomControl: true }).setView(start, startZ);

    satLayer    = L.tileLayer(SAT_URL,    { maxZoom: 21, maxNativeZoom: MAX_NATIVE, attribution: 'Esri World Imagery' });
    streetLayer = L.tileLayer(STREET_URL, { maxZoom: 21, maxNativeZoom: MAX_NATIVE, attribution: '© OpenStreetMap' });
    (usingSat ? satLayer : streetLayer).addTo(map);

    markerLayer  = L.layerGroup().addTo(map);
    hydrantLayer = L.layerGroup().addTo(map);

    if (planLatLng()) {
      hereLayer = L.circleMarker(here, { radius: 9, color: '#fff', weight: 3, fillColor: '#1e3a5f', fillOpacity: 1 })
        .bindTooltip('This building').addTo(map);
    }

    map.on('click', function (e) {
      if (!picked) {
        document.getElementById('smHint').textContent = 'Pick a symbol first, then tap the map.';
        return;
      }
      var label = prompt('Label for this ' + cat(picked).label + ' (optional)', '');
      if (label === null) return;
      var list = markers();
      list.push({ k: picked, lat: e.latlng.lat, lng: e.latlng.lng, label: (label || '').trim() || null });
      writeMarkers(list); drawMarkers(); refreshCount(); scheduleRender();
    });
    map.on('moveend zoomend', function () { scheduleRender(); });

    drawMarkers(); refreshCount();

    fetch('/api/hydrants/all').then(function (r) { return r.json(); })
      .then(function (j) {
        hydrants = Array.isArray(j) ? j : (j.hydrants || j.results || j.data || []);
        drawHydrants();
        scheduleRender(900);
      }).catch(function () { scheduleRender(900); });
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
      '#smStat{font:600 12px system-ui,sans-serif;color:#166534;margin-top:8px;min-height:16px}',
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
    var host = document.getElementById('siteMapHost');
    if (!host) return;                                  // page 10 only
    style();
    build(host);
    loadCss(LEAFLET_CSS);
    loadScript(LEAFLET_JS).then(function () { initMap(); wire(); })
      .catch(function (e) {
        var m = document.getElementById('smMap');
        if (m) m.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b">' +
          'Map could not load. Check the connection and reload this page.</div>';
        console.error(e);
      });
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PreplanSiteMap = {
    CATS: CATS, cat: cat, markers: markers,
    render: renderNow, flush: flush, compose: composeImage
  };
})();
