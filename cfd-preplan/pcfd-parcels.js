/* pcfd-parcels.js — county parcels, with their addresses, on any Leaflet map.
 *
 * Load it AFTER Leaflet and BEFORE the page creates its map. It hooks
 * L.Map.addInitHook, so every map the page makes gets a "Parcels" button and
 * no page has to hand over its map variable. That matters: the radar page
 * keeps its map inside a closure where nothing outside can reach it.
 *
 * Off by default. The first tick loads the data file sitting next to this one
 * (parcels-peach.js unless the script tag names another with data-parcels).
 * It is the SAME file the Peach pre-plan reads for its Tax ID lookup, so a map
 * and a plan can never disagree about which parcel a building is on.
 *
 * Record: [pin, acres, minLng, minLat, maxLng, maxLat, polygons, addresses?]
 * polygons -> rings -> [lng,lat,...]; ring 0 is the outline, the rest holes.
 *
 * Clicks are NOT swallowed: a parcel opens its popup and the click still
 * reaches the map, so a page that uses map clicks (the radar's arrival
 * estimate) keeps working with parcels switched on.
 *
 * WATER (added 2026-09-21): a second button, "Water", from water-peach.js
 * (data-water overrides). Lines only where real pipe geometry exists -- FVUC's
 * 2019 map and Warner Robins' lines in Peach -- styled by size, unknown sizes
 * dashed. Where public records state a main size but no route (Byron's bids,
 * industrial-site listings, the 2018 FVSU project) it is a marker, never a
 * drawn pipe. Every popup names its source and says it is not for digging.
 * Knox / lock-box data is deliberately NOT here: it stays on the Centerville side.
 * Line record: [inches|0, src, material, minLng, minLat, maxLng, maxLat, [lng,lat,...]]
 */
(function () {
  'use strict';
  var L = window.L;
  if (!L || !L.Map || L.Map.__pcfdParcelsHook) return;
  L.Map.__pcfdParcelsHook = true;

  var me = document.currentScript;
  var src = me && me.src ? me.src : '';
  var base = src ? src.slice(0, src.lastIndexOf('/') + 1) : '';
  var DATA = (me && me.getAttribute('data-parcels')) || (base + 'parcels-peach.js?v=1');
  var MIN_ZOOM = 15;
  var KEY = 'pcfd_parcels_on';
  var pending = null;

  var WATER = (me && me.getAttribute('data-water')) || (base + 'water-peach.js?v=1');
  var WATER_ZOOM = 14;          // mains read at a street's-worth of detail
  var FACT_ZOOM = 11;           // the few known-size markers show from further out
  var WKEY = 'pcfd_water_on';
  var wpending = null;

  function loadWater() {
    if (window.PCFD_WATER) return Promise.resolve(window.PCFD_WATER);
    if (wpending) return wpending;
    wpending = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = WATER;
      s.onload = function () { window.PCFD_WATER ? res(window.PCFD_WATER) : rej(new Error('no data')); };
      s.onerror = function () { wpending = null; rej(new Error('water data unavailable')); };
      document.head.appendChild(s);
    });
    return wpending;
  }

  /* Bigger main, heavier line. Unknown size is dashed so nobody reads it as small. */
  function waterStyle(r) {
    var sz = r[0], wr = r[1] === 1;
    if (!sz) return { color: wr ? '#0e7490' : '#0284c7', weight: 1.6, opacity: 0.85, dashArray: '5,4' };
    if (sz >= 16) return { color: '#1e3a8a', weight: 4.5, opacity: 0.95 };
    if (sz >= 12) return { color: '#1d4ed8', weight: 3.5, opacity: 0.95 };
    if (sz >= 8)  return { color: '#2563eb', weight: 2.6, opacity: 0.9 };
    if (sz >= 6)  return { color: '#3b82f6', weight: 2.0, opacity: 0.9 };
    return { color: '#60a5fa', weight: 1.3, opacity: 0.85 };
  }

  var WARN = '<div style="font-size:10.5px;color:#b45309;margin-top:4px">Approximate &mdash; not for excavation. Call 811.</div>';

  function waterPopup(r, W) {
    var mat = (W.mats && W.mats[r[2]]) || '';
    var h = '<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;min-width:180px">';
    h += r[0] ? '<div style="font-weight:700">' + r[0] + '&quot; water main</div>'
              : '<div style="font-weight:700">Water main &mdash; size not recorded</div>';
    if (mat) h += '<div style="font-size:12px">' + esc(mat) + '</div>';
    h += '<div style="font-size:11px;color:#64748b;margin-top:3px">' + esc((W.srcs || [])[r[1]] || '') + '</div>';
    return h + WARN + '</div>';
  }

  function factPopup(f) {
    return '<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;max-width:250px">' +
      '<div style="font-weight:700">' + esc(f.t) + '</div>' +
      '<div style="font-size:12px;margin-top:2px">' + esc(f.x) + '</div>' +
      '<div style="font-size:11px;color:#64748b;margin-top:3px">Source: ' + esc(f.s) + '</div>' + WARN + '</div>';
  }

  function load() {
    if (window.CV_PARCELS) return Promise.resolve(window.CV_PARCELS);
    if (pending) return pending;
    pending = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = DATA;
      s.onload = function () { window.CV_PARCELS ? res(window.CV_PARCELS) : rej(new Error('no data')); };
      s.onerror = function () { pending = null; rej(new Error('parcel data unavailable')); };
      document.head.appendChild(s);
    });
    return pending;
  }

  function latlngs(rec) {
    return rec[6].map(function (rings) {
      return rings.map(function (f) {
        var out = [];
        for (var i = 0; i < f.length; i += 2) out.push([f[i + 1], f[i]]);
        return out;
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* The county's address for the PARCEL. On a strip centre that is one number
     for the whole lot, not each tenant's suite -- hence the label. */
  function popupHtml(rec) {
    var ad = rec[7] || [];
    var h = '<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;min-width:170px">';
    h += ad.length
      ? '<div style="font-weight:700">' + esc(ad[0]) + '</div>'
      : '<div style="font-weight:700;color:#64748b">No county address on file</div>';
    if (ad.length > 1) {
      h += '<div style="font-size:12px">' + ad.slice(1, 6).map(esc).join('<br>') +
           (ad.length > 6 ? '<br>+ ' + (ad.length - 6) + ' more' : '') + '</div>';
    }
    h += '<div style="font-size:12px;color:#475569;margin-top:3px">Tax ID <b>' + esc(rec[0]) +
         '</b>' + (rec[1] != null ? ' &middot; ' + rec[1] + ' ac' : '') + '</div>';
    if (ad.length) h += '<div style="font-size:10.5px;color:#94a3b8;margin-top:2px">County address</div>';
    return h + '</div>';
  }

  function attach(map) {
    if (map.__pcfdParcels || map.options.pcfdParcels === false) return;
    map.__pcfdParcels = true;

    /* Own pane below the overlay pane (400): parcels sit under every marker,
       radar tile and track the page already draws. */
    map.createPane('pcfdParcels');
    map.getPane('pcfdParcels').style.zIndex = 350;
    var renderer = L.canvas({ pane: 'pcfdParcels', padding: 0.3 });
    var group = L.layerGroup();
    var on = false, btn = null;

    function label(t) { if (btn) btn.innerHTML = t; }

    function draw() {
      group.clearLayers();
      if (!on || !window.CV_PARCELS) return;
      if (map.getZoom() < MIN_ZOOM) { label('&#9638; Parcels <small>zoom in</small>'); return; }
      label('&#9638; Parcels');
      /* Only what is on screen: 14,000 lots is too many to hand Leaflet at
         once and nobody can look at them all anyway. */
      var b = map.getBounds(), w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
      var P = window.CV_PARCELS.p;
      for (var i = 0; i < P.length; i++) {
        var r = P[i];
        if (r[2] > e || r[4] < w || r[3] > n || r[5] < s) continue;
        var poly = L.polygon(latlngs(r), {
          pane: 'pcfdParcels', renderer: renderer,
          color: '#7c3aed', weight: 1, opacity: 0.6,
          fillColor: '#7c3aed', fillOpacity: 0.04
        });
        /* Not bindPopup: its handler calls DomEvent.stop(), which would eat the
           click before the page's own map-click handler ever sees it. */
        poly.on('click', (function (rec) {
          return function (ev) {
            L.popup({ maxWidth: 260 }).setLatLng(ev.latlng).setContent(popupHtml(rec)).openOn(map);
          };
        })(r));
        group.addLayer(poly);
      }
    }

    function setOn(v) {
      on = !!v;
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
      if (btn) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.style.background = on ? '#ede9fe' : '#fff';
      }
      if (!on) { group.clearLayers(); if (map.hasLayer(group)) map.removeLayer(group); label('&#9638; Parcels'); return; }
      if (!map.hasLayer(group)) group.addTo(map);
      label('&#9638; Parcels <small>loading</small>');
      load().then(draw).catch(function () { label('&#9638; Parcels <small>unavailable</small>'); });
    }

    /* ------------------------------------------------------------ water */
    /* Just above the parcels (350), still under the page's own overlays (400).
       tolerance: a 2-px main is hard to hit with a finger on an iPad. */
    map.createPane('pcfdWater');
    map.getPane('pcfdWater').style.zIndex = 355;
    var wrenderer = L.canvas({ pane: 'pcfdWater', padding: 0.3, tolerance: 6 });
    var wgroup = L.layerGroup();
    var won = false, wbtn = null, legend = null;

    function wlabel(t) { if (wbtn) wbtn.innerHTML = t; }

    function wdraw() {
      wgroup.clearLayers();
      if (!won || !window.PCFD_WATER) return;
      var W = window.PCFD_WATER, z = map.getZoom();
      var b = map.getBounds(), w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
      if (z >= FACT_ZOOM) {
        (W.facts || []).forEach(function (f) {
          if (f.lng < w || f.lng > e || f.lat < s || f.lat > n) return;
          var m = L.circleMarker([f.lat, f.lng], {
            pane: 'pcfdWater', renderer: wrenderer, radius: 7,
            color: '#fff', weight: 2, fillColor: '#0369a1', fillOpacity: 1
          });
          m.on('click', function (ev) {
            L.popup({ maxWidth: 270 }).setLatLng(ev.latlng).setContent(factPopup(f)).openOn(map);
          });
          wgroup.addLayer(m);
        });
      }
      if (z < WATER_ZOOM) { wlabel('&#128167; Water <small>zoom in for mains</small>'); return; }
      wlabel('&#128167; Water');
      var R = W.lines;
      for (var i = 0; i < R.length; i++) {
        var r = R[i];
        if (r[3] > e || r[5] < w || r[4] > n || r[6] < s) continue;
        var f = r[7], ll = [];
        for (var k = 0; k < f.length; k += 2) ll.push([f[k + 1], f[k]]);
        var st = waterStyle(r);
        st.pane = 'pcfdWater'; st.renderer = wrenderer;
        var line = L.polyline(ll, st);
        line.on('click', (function (rec) {        // opened by hand: the map click still gets through
          return function (ev) {
            L.popup({ maxWidth: 260 }).setLatLng(ev.latlng).setContent(waterPopup(rec, W)).openOn(map);
          };
        })(r));
        wgroup.addLayer(line);
      }
    }

    function wsetOn(v) {
      won = !!v;
      try { localStorage.setItem(WKEY, won ? '1' : '0'); } catch (e) {}
      if (wbtn) {
        wbtn.setAttribute('aria-pressed', won ? 'true' : 'false');
        wbtn.style.background = won ? '#e0f2fe' : '#fff';
      }
      if (legend) legend.style.display = won ? 'block' : 'none';
      if (!won) { wgroup.clearLayers(); if (map.hasLayer(wgroup)) map.removeLayer(wgroup); wlabel('&#128167; Water'); return; }
      if (!map.hasLayer(wgroup)) wgroup.addTo(map);
      wlabel('&#128167; Water <small>loading</small>');
      loadWater().then(wdraw).catch(function () { wlabel('&#128167; Water <small>unavailable</small>'); });
    }

    var Ctl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var box = L.DomUtil.create('div', 'leaflet-bar');
        var css = 'display:block;width:auto;padding:0 8px;font:600 12px/30px -apple-system,Segoe UI,Roboto,sans-serif;white-space:nowrap;background:#fff';
        btn = L.DomUtil.create('a', '', box);
        btn.href = '#';
        btn.setAttribute('role', 'button');
        btn.title = 'Show county parcels with their addresses and tax IDs';
        btn.style.cssText = css + ';color:#4c1d95';
        btn.innerHTML = '&#9638; Parcels';
        wbtn = L.DomUtil.create('a', '', box);
        wbtn.href = '#';
        wbtn.setAttribute('role', 'button');
        wbtn.title = 'Show known water mains (approximate, from public records)';
        wbtn.style.cssText = css + ';color:#075985';
        wbtn.innerHTML = '&#128167; Water';
        legend = L.DomUtil.create('div', '', box);
        legend.style.cssText = 'display:none;padding:5px 8px;font:11px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#334155;background:#fff;border-top:1px solid #ccc;max-width:190px;white-space:normal';
        legend.innerHTML =
          '<div><span style="display:inline-block;width:22px;border-top:4px solid #1d4ed8;vertical-align:middle"></span> 12&quot;+</div>' +
          '<div><span style="display:inline-block;width:22px;border-top:3px solid #2563eb;vertical-align:middle"></span> 8&ndash;10&quot;</div>' +
          '<div><span style="display:inline-block;width:22px;border-top:2px solid #3b82f6;vertical-align:middle"></span> 6&quot; &middot; <span style="color:#60a5fa">thin</span> under 6&quot;</div>' +
          '<div><span style="display:inline-block;width:22px;border-top:2px dashed #0284c7;vertical-align:middle"></span> size not recorded</div>' +
          '<div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#0369a1;vertical-align:middle"></span> known main size, no route</div>' +
          '<div style="color:#b45309;margin-top:2px">Approximate. Not for excavation.</div>';
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.on(btn, 'click', function (ev) { L.DomEvent.preventDefault(ev); setOn(!on); });
        L.DomEvent.on(wbtn, 'click', function (ev) { L.DomEvent.preventDefault(ev); wsetOn(!won); });
        return box;
      }
    });
    new Ctl().addTo(map);

    map.on('moveend zoomend', function () { if (on) draw(); if (won) wdraw(); });

    var was = false, wwas = false;
    try { was = localStorage.getItem(KEY) === '1'; wwas = localStorage.getItem(WKEY) === '1'; } catch (e) {}
    if (was) map.whenReady(function () { setOn(true); });
    if (wwas) map.whenReady(function () { wsetOn(true); });
  }

  L.Map.addInitHook(function () { attach(this); });

  window.PCFDParcels = { load: load, loadWater: loadWater, attach: attach, data: DATA, water: WATER };
})();
