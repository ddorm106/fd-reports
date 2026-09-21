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

    var Ctl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var box = L.DomUtil.create('div', 'leaflet-bar');
        btn = L.DomUtil.create('a', '', box);
        btn.href = '#';
        btn.setAttribute('role', 'button');
        btn.title = 'Show county parcels with their addresses and tax IDs';
        btn.style.cssText = 'width:auto;padding:0 8px;font:600 12px/30px -apple-system,Segoe UI,Roboto,sans-serif;white-space:nowrap;color:#4c1d95;background:#fff';
        btn.innerHTML = '&#9638; Parcels';
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.on(btn, 'click', function (ev) { L.DomEvent.preventDefault(ev); setOn(!on); });
        return box;
      }
    });
    new Ctl().addTo(map);

    map.on('moveend zoomend', function () { if (on) draw(); });

    var was = false;
    try { was = localStorage.getItem(KEY) === '1'; } catch (e) {}
    if (was) map.whenReady(function () { setOn(true); });
  }

  L.Map.addInitHook(function () { attach(this); });

  window.PCFDParcels = { load: load, attach: attach, data: DATA };
})();
