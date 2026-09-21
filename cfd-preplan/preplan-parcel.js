/* preplan-parcel.js — Houston County parcels in the pre-fire plan.
 *
 * Two jobs, both driven off the plan's own latitude/longitude:
 *   page 1  — fill Tax ID from the parcel the building stands on
 *   page 10 — draw that parcel's boundary on the site map
 *
 * The parcel PIN *is* the tax id: every tax-assessor card in the Centerville
 * archive is filed as "<address> (<PIN>)(<year>).pdf", and all six PINs
 * spot-checked against the county data resolved. So rather than ask anyone to
 * copy a number off a qPublic printout, we look up which polygon contains the
 * building and read the PIN straight off it.
 *
 * The data (3,410 Centerville polygons, ~135 KB gzipped) is a SEPARATE file
 * loaded on demand — never on pages that do not need it, and never before the
 * plan actually has coordinates.
 *
 * The set is the parcels Houston County codes 0C, which is NOT the same as
 * "inside the city limits". The prefix is the county's tax coding and it lags
 * annexation: 1101 Dunbar Road (Lighthouse Baptist) and 219 Jewellie Road
 * (Parkland Cabana) are in the city, but Dunbar Road still carries the county
 * PIN 000450 022000, so neither is in here. A lookup there returns nothing and
 * the field is left alone -- the message says why, so nobody concludes the
 * building is out of the city.
 */
(function () {
  'use strict';

  var DATA = 'parcels-centerville.js';
  var pending = null;

  function load() {
    if (window.CV_PARCELS) return Promise.resolve(window.CV_PARCELS);
    if (pending) return pending;
    pending = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = DATA;
      s.onload = function () { res(window.CV_PARCELS); };
      s.onerror = function () { rej(new Error('parcel data unavailable')); };
      document.head.appendChild(s);
    });
    return pending;
  }

  /* rec = [pin, acres, minLng, minLat, maxLng, maxLat, polygons]
     polygons -> rings -> [lng,lat,lng,lat,...]. Ring 0 is the outline and any
     further rings are holes, which is how GeoJSON and Leaflet both say it.

     Flat coordinate pairs rather than objects: 24,000 vertices, and [[x,y],[x,y]]
     triples the file for no gain.

     The nesting is not theoretical. 0C0200 009000 is the 47-acre Watson Blvd
     shopping centre with four out-parcels cut out of it; reading only the outer
     ring put Ole Times Country Buffet -- which has its own 1.03-acre parcel,
     0C0200 018000, sitting in one of those holes -- on the mall's tax id. */
  function inRing(f, lng, lat) {
    var inside = false, n = f.length;
    for (var i = 0, j = n - 2; i < n; j = i, i += 2) {
      var xi = f[i], yi = f[i + 1], xj = f[j], yj = f[j + 1];
      if (((yi > lat) !== (yj > lat)) &&
          (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function hit(rec, lng, lat) {
    if (lng < rec[2] || lng > rec[4] || lat < rec[3] || lat > rec[5]) return false;
    var polys = rec[6];
    for (var p = 0; p < polys.length; p++) {
      var rings = polys[p];
      if (!inRing(rings[0], lng, lat)) continue;
      var inHole = false;
      for (var k = 1; k < rings.length; k++) {
        if (inRing(rings[k], lng, lat)) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  }

  function findAt(lat, lng) {
    var P = window.CV_PARCELS;
    if (!P || !isFinite(lat) || !isFinite(lng)) return null;
    for (var i = 0; i < P.p.length; i++) if (hit(P.p[i], lng, lat)) return P.p[i];
    return null;
  }

  function byPin(pin) {
    var P = window.CV_PARCELS;
    if (!P || !pin) return null;
    var want = String(pin).replace(/\s+/g, '').toUpperCase();
    for (var i = 0; i < P.p.length; i++) {
      if (String(P.p[i][0]).replace(/\s+/g, '').toUpperCase() === want) return P.p[i];
    }
    return null;
  }

  /* Leaflet wants [lat,lng]; the data is stored [lng,lat] like GeoJSON.
     The polygon -> ring -> point nesting is handed straight to L.polygon, which
     reads it as parts and holes, so a cut-out parcel draws as a ring. */
  function latlngs(rec) {
    return rec[6].map(function (rings) {
      return rings.map(function (f) {
        var out = [];
        for (var i = 0; i < f.length; i += 2) out.push([f[i + 1], f[i]]);
        return out;
      });
    });
  }

  function planCoords() {
    var plan = {};
    try { plan = JSON.parse(localStorage.getItem('preFirePlan') || '{}'); } catch (e) {}
    var lat = parseFloat(plan.latitude), lng = parseFloat(plan.longitude);
    return (isFinite(lat) && isFinite(lng)) ? { lat: lat, lng: lng } : null;
  }

  /* ------------------------------------------------------------- page 1 */
  function wireTaxId() {
    var input = document.getElementById('tax_id');
    if (!input || input.dataset.parcelWired) return;
    input.dataset.parcelWired = '1';

    var note = document.createElement('div');
    note.className = 'hint';
    note.style.cssText = 'font-size:12px;margin-top:4px;color:#475569';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Find from map position';
    btn.style.cssText = 'font-size:12px;padding:3px 8px;margin-top:4px;cursor:pointer';
    input.parentNode.appendChild(btn);
    input.parentNode.appendChild(note);

    function say(t, bad) { note.textContent = t; note.style.color = bad ? '#b91c1c' : '#475569'; }

    function lookup(quiet) {
      var c = planCoords();
      if (!c) { if (!quiet) say('Set the latitude and longitude on this page first.', true); return; }
      if (!quiet) say('Looking up the parcel…');
      load().then(function () {
        var rec = findAt(c.lat, c.lng);
        if (!rec) {
          /* Not "outside the city limits": annexed property can still carry a
             county PIN, and those parcels are not in this set. */
          if (!quiet) say('No parcel on file for this spot. Only city-coded (0C) parcels are ' +
                          'loaded, so recently annexed property can be missing. Type the tax ID in.', true);
          return;
        }
        /* Never overwrite a value somebody typed; only fill a blank one. */
        if (!input.value.trim()) {
          input.value = rec[0];
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        say('Parcel ' + rec[0] + ' · ' + rec[1] + ' acres' +
            (input.value.trim() === rec[0] ? '' : ' (field left as typed)'));
      }).catch(function () { if (!quiet) say('Parcel data could not be loaded.', true); });
    }

    btn.addEventListener('click', function () { lookup(false); });
    /* Quietly fill a blank Tax ID when the plan already has coordinates. */
    if (!input.value.trim() && planCoords()) setTimeout(function () { lookup(true); }, 600);
  }

  /* ------------------------------------------------------------ page 10 */
  var layer = null;

  function drawOnMap() {
    var SM = window.PreplanSiteMap;
    if (!SM || typeof SM.map !== 'function' || !window.L) return false;
    var map = SM.map();
    if (!map) return false;

    var c = planCoords();
    if (!c) return true;                       // map is up, just nothing to draw

    load().then(function () {
      var plan = {};
      try { plan = JSON.parse(localStorage.getItem('preFirePlan') || '{}'); } catch (e) {}
      var rec = (plan.tax_id && byPin(plan.tax_id)) || findAt(c.lat, c.lng);
      if (!rec) return;
      if (layer) { try { map.removeLayer(layer); } catch (e) {} }
      layer = window.L.polygon(latlngs(rec), {
        color: '#7c3aed', weight: 2, opacity: 0.95,
        fillColor: '#7c3aed', fillOpacity: 0.07, dashArray: '6,4',
        interactive: false
      }).addTo(map);
      layer.bindTooltip('Parcel ' + rec[0] + ' · ' + rec[1] + ' ac',
        { permanent: false, sticky: true });
    }).catch(function () {});
    return true;
  }

  function waitForMap() {
    var tries = 0;
    var t = setInterval(function () {
      if (drawOnMap() || ++tries > 40) clearInterval(t);
    }, 400);
  }

  function boot() {
    if (document.getElementById('tax_id')) wireTaxId();
    if (document.getElementById('siteMapHost') || document.getElementById('smMap') ||
        /page10/.test(location.pathname)) waitForMap();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PreplanParcel = {
    load: load, findAt: findAt, byPin: byPin, latlngs: latlngs,
    redraw: drawOnMap,
    hide: function () {
      var SM = window.PreplanSiteMap;
      if (layer && SM && SM.map()) { try { SM.map().removeLayer(layer); } catch (e) {} layer = null; }
    }
  };
})();
