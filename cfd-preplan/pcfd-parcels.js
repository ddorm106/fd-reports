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
 * WHAT STANDS ON IT (2026-09-21): like Centerville's street map, a parcel's popup
 * lists the occupancies on it -- tier swatch, name, occupancy, station, sq ft,
 * occupant load, NFA fire flow, address and a link to the pre-plan in the Peach
 * Book -- from occupancies-peach.js (data-occupancies overrides), built by
 * ~/cfd-map-build/build_peach_occupancies.py from Peach's occupant sheet merged
 * with the inspection app. It is an extra: parcels work if it fails to load.
 *
 * TAPS (rebuilt 2026-09-21 after "sometimes the parcels won't let me click"):
 * nothing the plugin draws takes pointer events. Its canvas lies UNDER the host
 * page's own layers, and any of them -- a second canvas, a filled polygon such
 * as the radar's NWS alerts -- would otherwise catch the tap first. Instead the
 * plugin listens to the MAP's click and works out what is under the finger
 * itself: a main within TAP_PX, else a known-size marker, else the lot. If the
 * page's own feature answered the same tap with a popup (a hydrant, an alert),
 * the plugin stays out of the way. Nothing is ever swallowed, so a page that
 * uses map clicks (the radar's arrival estimate) keeps working.
 * The buttons move themselves down out from under any page panel that covers
 * them (the radar's header sits on the top-left corner). data-position picks
 * the corner (default topleft).
 *
 * WATER (added 2026-09-21): a second button, "Water", from water-peach.js
 * (data-water overrides). Lines only where real pipe geometry exists -- FVUC's
 * 2019 map and Warner Robins' lines in Peach -- solid blue pipes with a white
 * edge, thicker = bigger, the recorded size printed on the line at zoom 17+.
 * Never dashed (2026-09-21, David: "the dotted line is confusing" -- most mains
 * have no size, so nearly everything was dashed and read as a boundary).
 * Where public records state a main size but no route (Byron's bids,
 * industrial-site listings, the 2018 FVSU project) it is a marker, never a
 * drawn pipe. Every popup names its source and says it is not for digging.
 * Knox / lock-box data is deliberately NOT here: it stays on the Centerville side.
 * Line record: [inches|0, src, material, minLng, minLat, maxLng, maxLat, [lng,lat,...], year?]
 * Coverage runs ~3 mi past the Peach line: Macon Water Authority (sized, with install
 * decade), Warner Robins, Centerville and Houston County (location only). Perry,
 * Crawford and Macon County publish no mains.
 * NEIGHBOURS' HYDRANTS (2026-09-21): the same button also shows the other departments'
 * hydrants in that zone (Centerville FD's own records, Macon Water Authority, ...) from
 * neighbor-hydrants-peach.js (data-hydrants overrides), as Centerville-style dots --
 * NFPA 291 class colour from the flow test, else the painted bonnet, grey if neither.
 * Reference only: they are not in PCFD's hydrant book, and the popup says whose they are.
 * WATER TOWERS & PUMP HOUSES (2026-09-21): water-facilities.js (data-facilities overrides) --
 * OpenStreetMap towers, FAA obstacle-file tanks (height) and Macon Water Authority tanks/pumps
 * (name, capacity), merged by build_water_facilities.py. Shown from FAC_ZOOM so towers work as
 * landmarks; DOM icons that take no pointer events -- taps are still decided by onTap.
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
  var TAP_PX = 10;              // how near a main a finger has to land, in screen pixels
  var POSITION = (me && me.getAttribute('data-position')) || 'topleft';
  var KEY = 'pcfd_parcels_on';
  var pending = null;

  var OCC = (me && me.getAttribute('data-occupancies')) || (base + 'occupancies-peach.js?v=2');
  /* Street View aim point per parcel (the main building), from build_parcel_aim.py. */
  var AIM = (me && me.getAttribute('data-aim')) || (base + 'parcel-aim-peach.js?v=1');
  var apending = null;
  function loadAim() {
    if (window.PCFD_AIM) return Promise.resolve(window.PCFD_AIM);
    if (apending) return apending;
    apending = new Promise(function (res) {
      var s = document.createElement('script');
      s.src = AIM;
      s.onload = function () { res(window.PCFD_AIM || null); };
      s.onerror = function () { apending = null; res(null); };
      document.head.appendChild(s);
    });
    return apending;
  }
  var TIER_COLOR = { 1: '#c62828', 2: '#e07b00', 3: '#5b7c99' };   // same as Centerville
  /* The same plugin also runs the Centerville map site (2026-09-23): these three say whose map it is.
     Defaults are Peach's, so every Peach page is unchanged. */
  var DEPT = (me && me.getAttribute('data-dept')) || 'PCFD';
  var COUNTY = (me && me.getAttribute('data-county')) || 'Peach County, GA';
  var opending = null;

  /* Resolves null on failure rather than rejecting: the occupancy list is an extra,
     and a parcel popup without it is still a working parcel popup. */
  function loadOcc() {
    if (window.PCFD_OCC) return Promise.resolve(window.PCFD_OCC);
    if (opending) return opending;
    opending = new Promise(function (res) {
      var s = document.createElement('script');
      s.src = OCC;
      s.onload = function () { res(window.PCFD_OCC || null); };
      s.onerror = function () { opending = null; res(null); };
      document.head.appendChild(s);
    });
    return opending;
  }

  var WATER = (me && me.getAttribute('data-water')) || (base + 'water-peach.js?v=8');
  var NHYD = (me && me.getAttribute('data-hydrants')) || (base + 'neighbor-hydrants-peach.js?v=6');
  var WFAC = (me && me.getAttribute('data-facilities')) || (base + 'water-facilities.js?v=1');
  var WFAC_ZOOM = 12;
  var fpending = null;
  function loadWfac() {
    if (window.PCFD_WFAC) return Promise.resolve(window.PCFD_WFAC);
    if (fpending) return fpending;
    fpending = new Promise(function (res) {
      var s = document.createElement('script');
      s.src = WFAC;
      s.onload = function () { res(window.PCFD_WFAC || null); };
      s.onerror = function () { fpending = null; res(null); };
      document.head.appendChild(s);
    });
    return fpending;
  }
  var TOWER_SVG = '<svg width="22" height="28" viewBox="0 0 22 28" style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.5))">' +
    '<path d="M6 13 L4 27 M16 13 L18 27 M11 14 L11 27 M5 20 L17 20" stroke="#0c4a6e" stroke-width="1.6" fill="none"/>' +
    '<ellipse cx="11" cy="8" rx="9.5" ry="6.5" fill="#0369a1" stroke="#fff" stroke-width="1.6"/></svg>';
  var PUMP_HTML = '<div style="width:18px;height:18px;border-radius:4px;background:#0f766e;border:2px solid #fff;' +
    'box-shadow:0 1px 4px rgba(0,0,0,.45);color:#fff;font:800 11px/18px -apple-system,Segoe UI,Roboto,sans-serif;text-align:center">P</div>';
  function facPopup(f) {
    return '<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;min-width:180px">' +
      '<div style="font-weight:700">' + (f[2] === 'pump' ? 'Pump station' : 'Water tower / tank') + (f[3] ? ' &mdash; ' + esc(f[3]) : '') + '</div>' +
      (f[4] ? '<div style="font-size:12px">' + esc(f[4]) + '</div>' : '') +
      '<div style="font-size:11px;color:#64748b;margin-top:3px">Source: ' + esc(f[5]) + '</div>' +
      '<div style="font-size:10.5px;color:#b45309;margin-top:4px">From public records &mdash; confirm with the utility.</div></div>';
  }
  var npending = null;
  /* An extra like the occupancy list: resolves null on failure, never breaks Water. */
  function loadNhyd() {
    if (window.PCFD_NHYD) return Promise.resolve(window.PCFD_NHYD);
    if (npending) return npending;
    npending = new Promise(function (res) {
      var s = document.createElement('script');
      s.src = NHYD;
      s.onload = function () { res(window.PCFD_NHYD || null); };
      s.onerror = function () { npending = null; res(null); };
      document.head.appendChild(s);
    });
    return npending;
  }
  /* NFPA 291 class, the Centerville map's colours: flow test first, else the bonnet. */
  var HYD_CLS = { AA: ['#3498db', 'Class AA (blue) 1,500+ gpm'], A: ['#27ae60', 'Class A (green) 1,000-1,499 gpm'],
                  B: ['#e67e22', 'Class B (orange) 500-999 gpm'], C: ['#e74c3c', 'Class C (red) under 500 gpm'] };
  function hydClass(flow, paint) {
    if (flow > 0) return flow >= 1500 ? 'AA' : flow >= 1000 ? 'A' : flow >= 500 ? 'B' : 'C';
    var p = String(paint || '').toLowerCase();
    return (p === 'blue' || p === 'light blue') ? 'AA' : p === 'green' ? 'A' : p === 'orange' ? 'B' : p === 'red' ? 'C' : '';
  }
  function nhydPopup(h, N) {
    var c = hydClass(h[4], h[5]), who = (N.srcs || [])[h[2]] || '';
    var x = '<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;min-width:180px">' +
      svSlot(h[0], h[1]) +
      '<div style="font-weight:700">Hydrant' + (h[3] ? ' #' + esc(h[3]) : '') + '</div>' +
      (h[6] ? '<div style="font-size:12px">' + esc(h[6]) + '</div>' : '') +
      '<div style="font-size:12px;margin-top:2px">' + (c ? esc(HYD_CLS[c][1]) : 'Flow not on file') +
      (h[4] > 0 ? ' &middot; tested ' + Number(h[4]).toLocaleString() + ' gpm' : '') + '</div>' +
      (h[8] ? '<div style="font-size:12px">On a ' + esc(h[8]) + '&quot; main</div>' : '') +
      (h[7] ? '<div style="font-size:12px;font-weight:700;color:#c62828">OUT OF SERVICE</div>' : '') +
      (h[9] ? '<div style="font-size:11px;color:#64748b">' + esc(h[9]) + '</div>' : '') +
      '<div style="font-size:11px;color:#64748b;margin-top:3px">' + esc(who) + ' &mdash; not a ' + esc(DEPT) + ' hydrant</div></div>';
    return x;
  }
  var WATER_ZOOM = 15;          // same as parcels: at 14, downtown Fort Valley alone is ~5,800 mains (0.5 s per pan)
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

  /* Every main is a solid blue pipe with a white edge -- the edge is what keeps
     it from reading as a boundary line. Thicker = bigger. A main with no size on
     file draws as a standard pipe; where the size IS on file it is printed on the
     line once you are close enough to read it (LABEL_ZOOM). Same look as the
     Centerville street map. */
  var LABEL_ZOOM = 17;
  function waterStyle(r) {
    var sz = r[0];
    if (!sz) return { color: '#2563eb', weight: 2.8 };
    if (sz >= 16) return { color: '#172554', weight: 6 };
    if (sz >= 12) return { color: '#1e3a8a', weight: 5 };
    if (sz >= 8)  return { color: '#1d4ed8', weight: 3.8 };
    if (sz >= 6)  return { color: '#2563eb', weight: 2.8 };
    return { color: '#3b82f6', weight: 1.8 };
  }

  /* Half-way along a main, and how long it is -- where its size label sits. */
  function waterMid(f) {
    var c = Math.cos(f[1] * Math.PI / 180), seg = [], tot = 0, k;
    for (k = 2; k < f.length; k += 2) {
      var dx = (f[k] - f[k - 2]) * c, dy = f[k + 1] - f[k - 1], d = Math.sqrt(dx * dx + dy * dy) * 111320;
      seg.push(d); tot += d;
    }
    var half = tot / 2, acc = 0;
    for (k = 0; k < seg.length; k++) {
      if (acc + seg[k] >= half) {
        var t = seg[k] ? (half - acc) / seg[k] : 0, i = k * 2;
        return { len: tot, lat: f[i + 1] + (f[i + 3] - f[i + 1]) * t, lng: f[i] + (f[i + 2] - f[i]) * t };
      }
      acc += seg[k];
    }
    return { len: tot, lat: f[1], lng: f[0] };
  }

  function waterLabels(W) {
    var out = [];
    for (var i = 0; i < W.lines.length; i++) {
      var r = W.lines[i];
      if (!r[0]) continue;
      var m = waterMid(r[7]);
      if (m.len < 30) continue;          // stubs and hydrant leads would bury the street in labels
      out.push({ lat: m.lat, lng: m.lng, sz: r[0] });
    }
    out.sort(function (a, b) { return b.sz - a.sz; });   // the trunk wins a crowded corner
    return out;
  }

  var LABEL_CSS = 'position:absolute;transform:translate(-50%,-50%);display:inline-block;background:#1e3a8a;' +
    'color:#fff;font:700 10px/1.25 -apple-system,Segoe UI,Roboto,sans-serif;padding:0 4px;border-radius:3px;' +
    'border:1px solid #fff;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.35)';
  var PIPE_CSS = 'display:inline-block;width:24px;vertical-align:middle;margin-right:5px;border-radius:3px;' +
    'box-shadow:0 0 0 1.5px #fff,0 0 0 2.5px #cbd5e1';

  var WARN = '<div style="font-size:10.5px;color:#b45309;margin-top:4px">Approximate &mdash; not for excavation. Call 811.</div>';

  /* Grey = inferred from the hydrants on the street (build_probable_mains.py), never a utility record. */
  function isProbable(W, r) { return String((W.srcs || [])[r[1]] || '').indexOf('Probable main') === 0; }
  function isLead(W, r) { return String((W.srcs || [])[r[1]] || '').indexOf('hydrant lead') >= 0; }
  function waterPopup(r, W) {
    if (isLead(W, r)) {
      return '<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;min-width:200px;max-width:250px">' +
        '<div style="font-weight:700">Hydrant lead (traced)</div>' +
        '<div style="font-size:12px">Every hydrant hangs off a main by a short lead (branch). This one is drawn straight from the hydrant to the nearest main on the map, so it shows which main feeds it.</div>' +
        '<div style="font-size:10.5px;color:#b45309;margin-top:4px">Not a utility record &mdash; not for excavation. Call 811.</div></div>';
    }
    if (isProbable(W, r)) {
      return '<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;min-width:200px;max-width:250px">' +
        '<div style="font-weight:700">' + (r[0] ? r[0] + '&quot; water main (traced)' : 'Water main (traced) &mdash; size not known yet') + '</div>' +
        '<div style="font-size:12px">Traced from the hydrants: every hydrant sits on a main, so the main is drawn along the streets that join them (hydrant to hydrant where a street is too new to be on the map). Checked against areas where the real mains are published (Warner Robins, Macon, Fort Valley, Centerville), about 9 in 10 traced lines sit on a real main.</div>' +
        '<div style="font-size:10.5px;color:#b45309;margin-top:4px">Not a utility record &mdash; not for excavation. Call 811.</div></div>';
    }
    var mat = (W.mats && W.mats[r[2]]) || '';
    var h = '<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;min-width:180px">';
    h += r[0] ? '<div style="font-weight:700">' + r[0] + '&quot; water main</div>'
              : '<div style="font-weight:700">Water main &mdash; size not recorded</div>';
    if (mat || r[8]) h += '<div style="font-size:12px">' + esc(mat) +
      (r[8] ? (mat ? ' &middot; ' : '') + 'installed about ' + r[8] : '') + '</div>';
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

  /* PROPERTY PHOTO (2026-09-22): Street View first (see STREET VIEW FIRST), and an aerial of the lot with its line drawn on.
     Esri World Imagery's export cuts one image to any box without a key; asking
     for it in Web Mercator (3857) lets the outline be projected onto the same
     pixels. Padded so the neighbours show, never tighter than ~70 m across. */
  var PHOTO_W = 480, PHOTO_H = 300;
  var ESRI_EXPORT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export';
  function merc(lng, lat) {
    var R = 6378137, y = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
    return [R * lng * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + y / 2))];
  }
  function photoBox(minLng, minLat, maxLng, maxLat, w, h) {
    var a = merc(minLng, minLat), b = merc(maxLng, maxLat);
    var cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    var bw = Math.max((b[0] - a[0]) * 1.35, 70), bh = Math.max((b[1] - a[1]) * 1.35, 70 * h / w);
    if (bw / bh < w / h) bw = bh * w / h; else bh = bw * h / w;
    return [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2];
  }
  function photoUrl(box, w, h) {
    return ESRI_EXPORT + '?bbox=' + box.map(function (v) { return v.toFixed(1); }).join(',') +
      '&bboxSR=3857&imageSR=3857&size=' + w + ',' + h + '&format=jpg&f=image';
  }
  var SV_BASE = (me && me.getAttribute('data-sv')) || 'https://pcfdmembers.org/sv/';   // fd-streetview Worker
  /* STREET VIEW FIRST (2026-09-22, David: "default the image to the street view"):
     the photo opens on Google Street View aimed at the lot, with a Street | Aerial
     switch; the aerial is the fallback wherever Google has no street photo. The
     camera is the pano Google finds for the county ADDRESS (so it stands on the
     street the building faces), else the pano nearest the middle of the lot; one
     more than ~120 m past the lot is a bad geocode and is ignored.
     Google is reached through the fd-streetview Worker (~/fd-streetview): it holds
     the key as a secret, answers only our sites and caches every photo, so the
     key never ships in page code. */
  var svCache = {};
  function distM(la1, lo1, la2, lo2) {
    var k = Math.PI / 180, x = (lo2 - lo1) * k * Math.cos((la1 + la2) / 2 * k), y = (la2 - la1) * k;
    return 6371000 * Math.sqrt(x * x + y * y);
  }
  function bearing(la1, lo1, la2, lo2) {
    var k = Math.PI / 180, dl = (lo2 - lo1) * k;
    var y = Math.sin(dl) * Math.cos(la2 * k);
    var x = Math.cos(la1 * k) * Math.sin(la2 * k) - Math.sin(la1 * k) * Math.cos(la2 * k) * Math.cos(dl);
    return (Math.atan2(y, x) / k + 360) % 360;
  }
  function svMeta(loc, radius) {
    return fetch(SV_BASE + 'meta?loc=' + encodeURIComponent(loc) + '&r=' + radius)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.status === 'OK' && j.location ? j : null; })
      .catch(function () { return null; });
  }
  function findPano(bb, q, aim) {
    var ck = bb.join(',');
    if (svCache[ck]) return svCache[ck];
    /* look at the main building when one is known (build_parcel_aim.py), else the lot */
    var cLat = aim ? aim[1] : (bb[1] + bb[3]) / 2, cLng = aim ? aim[0] : (bb[0] + bb[2]) / 2;
    var half = distM(bb[1], bb[0], bb[3], bb[2]) / 2;
    function near(j) { return j && distM(j.location.lat, j.location.lng, cLat, cLng) <= half + 120 ? j : null; }
    function byCentre() {
      return svMeta(cLat.toFixed(6) + ',' + cLng.toFixed(6), Math.round(Math.min(300, Math.max(50, half + 30)))).then(near);
    }
    svCache[ck] = (q ? svMeta(q, 50).then(near).then(function (j) { return j || byCentre(); }) : byCentre())
      .then(function (j) {
        if (!j) return null;
        var d = Math.max(8, distM(j.location.lat, j.location.lng, cLat, cLng));
        var fit = aim && aim[2] ? aim[2] * 1.7 : Math.max(half, 15) * 0.8;   // building ~60% of the width
        var fov = Math.round(Math.min(100, Math.max(40, 2 * Math.atan(fit / d) * 180 / Math.PI)));
        return { pano: j.pano_id, date: j.date || '', heading: Math.round(bearing(j.location.lat, j.location.lng, cLat, cLng)), fov: fov };
      });
    return svCache[ck];
  }
  function svDate(s) {
    var m = /^(\d{4})-(\d{2})/.exec(s || '');
    return m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + m[1] : '';
  }
  /* Both views stacked in one box; hydratePhoto() decides which shows.
     bb = [minLng, minLat, maxLng, maxLat]; d = the lot line as an SVG path in
     the aerial's pixels; q = the address Street View looks up. */
  function photoFrame(bb, box, d, q, mapsQ, aim) {
    var cLat = (bb[1] + bb[3]) / 2, cLng = (bb[0] + bb[2]) / 2;
    var big = photoUrl(photoBox(bb[0], bb[1], bb[2], bb[3], 1600, 1000), 1600, 1000);
    var lay = 'display:none;position:absolute;inset:0';
    var btn = 'border:0;padding:3px 9px;font:700 11px -apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer;';
    return '<div class="pcfd-photo" data-bb="' + bb.join(',') + '" data-q="' + esc(q) + '" data-aim="' + (aim ? aim.join(',') : '') + '" ' +
      'style="position:relative;margin:0 0 7px;border-radius:6px;overflow:hidden;background:#cbd5e1;' +
      'aspect-ratio:' + PHOTO_W + '/' + PHOTO_H + '">' +
      '<a class="ph-aer" href="' + esc(big) + '" target="_blank" rel="noopener" title="Open a larger photo" style="' + lay + '">' +
      '<img src="' + esc(photoUrl(box, PHOTO_W, PHOTO_H)) + '" alt="Aerial photo of the parcel" ' +
      'style="display:block;width:100%;height:100%;object-fit:cover">' +
      '<svg viewBox="0 0 ' + PHOTO_W + ' ' + PHOTO_H + '" style="position:absolute;inset:0;width:100%;height:100%">' +
      '<path d="' + d + '" fill="rgba(250,204,21,.10)" fill-rule="evenodd" stroke="#facc15" stroke-width="3" ' +
      'stroke-linejoin="round"/></svg>' +
      '<span style="position:absolute;right:4px;bottom:3px;font-size:9px;color:#fff;text-shadow:0 0 2px #000">' +
      'Imagery &copy; Esri</span></a>' +
      '<a class="ph-sv" target="_blank" rel="noopener" title="Open Street View here" style="' + lay + '">' +
      '<img alt="Street View of the property" style="display:block;width:100%;height:100%;object-fit:cover">' +
      '<span class="ph-date" style="position:absolute;right:5px;top:5px;font-size:10px;font-weight:600;color:#fff;' +
      'background:rgba(15,23,42,.6);padding:1px 6px;border-radius:9px"></span></a>' +
      '<div class="ph-msg" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font-size:11px;color:#475569">Loading photo&hellip;</div>' +
      '<div class="ph-tg" style="position:absolute;left:5px;top:5px;display:none;border-radius:7px;overflow:hidden;' +
      'box-shadow:0 1px 3px rgba(0,0,0,.4)">' +
      '<button type="button" data-v="sv" style="' + btn + '">Street</button>' +
      '<button type="button" data-v="aer" style="' + btn + 'border-left:1px solid #cbd5e1">Aerial</button></div>' +
      '</div>' +
      '<div style="font-size:12px;margin:-2px 0 6px">' +
      '<a class="ph-svlink" target="_blank" rel="noopener" href="https://www.google.com/maps/@?api=1&amp;map_action=pano&amp;viewpoint=' +
      cLat.toFixed(6) + ',' + cLng.toFixed(6) + '">Street View &rarr;</a> &nbsp; ' +
      '<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&amp;query=' +
      encodeURIComponent(mapsQ) + '">Google Maps &rarr;</a></div>';
  }
  function hydratePhoto(root) {
    var el = root && root.querySelector && root.querySelector('.pcfd-photo');
    if (!el || el.__pcfdPhoto) return;
    el.__pcfdPhoto = true;
    var bb = el.getAttribute('data-bb').split(',').map(Number), q = el.getAttribute('data-q');
  var aim = (el.getAttribute('data-aim') || '').split(',').filter(Boolean).map(Number);
    var aer = el.querySelector('.ph-aer'), sv = el.querySelector('.ph-sv'), msg = el.querySelector('.ph-msg');
    var tg = el.querySelector('.ph-tg'), btns = tg.querySelectorAll('button');
    function show(v) {
      msg.style.display = 'none';
      aer.style.display = v === 'aer' ? 'block' : 'none';
      sv.style.display = v === 'sv' ? 'block' : 'none';
      for (var i = 0; i < btns.length; i++) {
        var on = btns[i].getAttribute('data-v') === v;
        btns[i].style.background = on ? '#1e3a8a' : '#fff';
        btns[i].style.color = on ? '#fff' : '#1e293b';
      }
    }
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        show(this.getAttribute('data-v'));
      });
    }
    var settled = false;
    function aerialOnly() { if (settled) return; settled = true; show('aer'); }
    var t = setTimeout(aerialOnly, 8000);
    findPano(bb, q, aim.length === 3 ? aim : null).then(function (p) {
      if (!p) { clearTimeout(t); aerialOnly(); return; }
      var img = sv.querySelector('img');
      img.onload = function () {
        if (settled) return;
        settled = true; clearTimeout(t);
        tg.style.display = 'flex';
        show('sv');
      };
      img.onerror = function () { clearTimeout(t); aerialOnly(); };
      var link = 'https://www.google.com/maps/@?api=1&map_action=pano&pano=' + encodeURIComponent(p.pano) +
        '&heading=' + p.heading + '&pitch=0&fov=' + p.fov;
      sv.href = link;
      var sl = el.parentNode && el.parentNode.querySelector('.ph-svlink');
      if (sl) sl.href = link;
      var dt = svDate(p.date), tag = sv.querySelector('.ph-date');
      if (dt) tag.textContent = 'Street View ' + dt; else tag.style.display = 'none';
      img.src = SV_BASE + 'img?pano=' + encodeURIComponent(p.pano) + '&heading=' + p.heading +
        '&pitch=3&fov=' + p.fov;
    });
  }

  /* HYDRANT STREET VIEW (2026-09-22, David: "street view of the hydrants when clicked
     on them"). A hydrant popup carries an empty slot, svSlot(lat, lng); svHydrate()
     fills it with the Street View picture from the pano ~16 m up the street from the hydrant,
     aimed back at it, zoomed to ~14 m across the hydrant (book coordinates can be a few metres off), tilted down to it. No pano
     within ~60 m -> the slot stays hidden. Any page can use it: the plugin fills any
     `.pcfd-sv` slot in a popup that opens on a map it is attached to. */
  function svSlot(lat, lng) {
    var b = 'border:0;width:26px;height:24px;font:700 14px/24px -apple-system,Segoe UI,Roboto,sans-serif;' +
      'background:rgba(255,255,255,.92);color:#1e293b;cursor:pointer;padding:0;';
    return '<div class="pcfd-sv" data-lat="' + (+lat).toFixed(6) + '" data-lng="' + (+lng).toFixed(6) + '" ' +
      'style="display:none;margin:0 0 6px;position:relative;border-radius:6px;overflow:hidden;background:#cbd5e1;' +
      'aspect-ratio:' + PHOTO_W + '/' + PHOTO_H + ';min-width:230px">' +
      '<a target="_blank" rel="noopener" title="Open Street View here" style="display:block;width:100%;height:100%">' +
      '<img alt="Street View of the hydrant" style="display:block;width:100%;height:100%;object-fit:cover"></a>' +
      '<span class="sv-tag" style="position:absolute;right:5px;top:5px;font-size:10px;font-weight:600;color:#fff;' +
      'background:rgba(15,23,42,.6);padding:1px 6px;border-radius:9px;pointer-events:none"></span>' +
      '<div class="sv-ctl" style="position:absolute;left:5px;bottom:5px;display:flex;gap:1px;border-radius:6px;' +
      'overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.4)">' +
      '<button type="button" data-a="out" title="Zoom out" style="' + b + '">&minus;</button>' +
      '<button type="button" data-a="in" title="Zoom in" style="' + b + '">+</button>' +
      '<button type="button" data-a="left" title="Turn left" style="' + b + '">&#9664;</button>' +
      '<button type="button" data-a="right" title="Turn right" style="' + b + '">&#9654;</button></div></div>';
  }
  var svPtCache = {};
  function findPanoAt(lat, lng) {
    var ck = lat.toFixed(6) + ',' + lng.toFixed(6);
    if (!svPtCache[ck]) {
      /* Hydrant coordinates sit on or beside the street, so the nearest pano is usually
         right on top of the hydrant and "aim at it" looks at pavement. Stand back
         instead: ask for panos ~16 m away in eight directions (panos only exist on
         streets, so hits are up/down the street or on a cross street) and look back
         at the hydrant from the one nearest 16 m. Looking along the street keeps the
         hydrant in frame even when the book puts it a few metres off. Metadata calls
         are free and cached. */
      var k = Math.PI / 180, R0 = 111320;
      var probes = [0, 45, 90, 135, 180, 225, 270, 315].map(function (b) {
        var la = lat + 16 * Math.cos(b * k) / R0, lo = lng + 16 * Math.sin(b * k) / (R0 * Math.cos(lat * k));
        return svMeta(la.toFixed(6) + ',' + lo.toFixed(6), 8);
      });
      svPtCache[ck] = Promise.all(probes).then(function (js) {
        var best = null;
        js.forEach(function (j) {
          if (!j) return;
          var d = distM(j.location.lat, j.location.lng, lat, lng);
          if (d < 9 || d > 35) return;
          if (!best || Math.abs(d - 16) < Math.abs(best.d - 16)) best = { j: j, d: d };
        });
        return best;
      }).then(function (b) {
        if (!b) return null;
        var j = b.j, d = b.d;
        return {
          pano: j.pano_id, date: j.date || '', dist: d,
          heading: Math.round(bearing(j.location.lat, j.location.lng, lat, lng)),   // zoom: SV_ACROSS
          pitch: Math.round(Math.max(-20, -Math.atan(2 / d) * 180 / Math.PI))                  // camera ~2.5 m up, hydrant ~0.5 m
        };
      });
    }
    return svPtCache[ck];
  }
  /* Zoom steps, as metres across the frame at the hydrant. Opens at 12 m: tighter
     than that and a hydrant whose book point is a few metres off falls out of frame
     (tested on three: at 8 m one was cut, at 6 m two were), so the crew zooms in and
     turns the camera with the buttons instead. Each press is one more picture. */
  var SV_ACROSS = [24, 12, 7, 4];
  function svHydrate(root, resized) {
    var slots = root && root.querySelectorAll ? root.querySelectorAll('.pcfd-sv') : [];
    Array.prototype.forEach.call(slots, function (el) {
      if (el.__pcfdSv) return;
      el.__pcfdSv = true;
      var lat = +el.getAttribute('data-lat'), lng = +el.getAttribute('data-lng');
      findPanoAt(lat, lng).then(function (p) {
        if (!p) return;
        var img = el.querySelector('img'), a = el.querySelector('a');
        var zi = 1, heading = p.heading, first = true;
        function fov() {
          return Math.round(Math.min(90, Math.max(20, 2 * Math.atan(SV_ACROSS[zi] / 2 / p.dist) * 180 / Math.PI)));
        }
        function load() {
          var h = Math.round((heading + 360) % 360), f = fov();
          a.href = 'https://www.google.com/maps/@?api=1&map_action=pano&pano=' +
            encodeURIComponent(p.pano) + '&heading=' + h + '&pitch=' + p.pitch + '&fov=' + f;
          img.style.opacity = first ? '1' : '.6';
          img.src = SV_BASE + 'img?pano=' + encodeURIComponent(p.pano) + '&heading=' + h +
            '&pitch=' + p.pitch + '&fov=' + f;
        }
        img.onload = function () {
          img.style.opacity = '1';
          if (first) { first = false; el.style.display = 'block'; if (resized) resized(); }
        };
        Array.prototype.forEach.call(el.querySelectorAll('.sv-ctl button'), function (btn) {
          btn.addEventListener('click', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            var act = btn.getAttribute('data-a');
            if (act === 'in' && zi < SV_ACROSS.length - 1) zi++;
            else if (act === 'out' && zi > 0) zi--;
            else if (act === 'left' || act === 'right') heading += (act === 'left' ? -1 : 1) * Math.max(4, fov() / 4);
            else return;
            load();
          });
        });
        var dt = svDate(p.date);
        el.querySelector('.sv-tag').textContent = (dt ? 'Street View ' + dt + ' · ' : '') + Math.round(p.dist * 3.28084) + ' ft away';
        load();
      });
    });
  }
  window.PCFD_SV = { slot: svSlot, hydrate: svHydrate };   // for pages' own hydrant popups

  function photoHtml(rec) {
    var bb = [rec[2], rec[3], rec[4], rec[5]];
    var box = photoBox(bb[0], bb[1], bb[2], bb[3], PHOTO_W, PHOTO_H);
    var sx = PHOTO_W / (box[2] - box[0]), sy = PHOTO_H / (box[3] - box[1]), d = '';
    rec[6].forEach(function (rings) {
      rings.forEach(function (f) {
        for (var i = 0; i + 1 < f.length; i += 2) {
          var m = merc(f[i], f[i + 1]);
          d += (i ? 'L' : 'M') + ((m[0] - box[0]) * sx).toFixed(1) + ' ' + ((box[3] - m[1]) * sy).toFixed(1);
        }
        d += 'Z';
      });
    });
    var ad = rec[7] || [], q = ad.length ? ad[0] + ', ' + COUNTY : '';
    var aim = window.PCFD_AIM && window.PCFD_AIM.by[rec[0]];
    return photoFrame(bb, box, d, q, q || ((bb[1] + bb[3]) / 2).toFixed(6) + ',' + ((bb[0] + bb[2]) / 2).toFixed(6), aim);
  }

  /* The county's address for the PARCEL. On a strip centre that is one number
     for the whole lot, not each tenant's suite -- hence the label. */
  function popupHtml(rec) {
    var ad = rec[7] || [];
    var h = '<div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;width:250px">';
    h += photoHtml(rec);
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

    /* What stands on it, the way the Centerville map lists it. */
    var O = window.PCFD_OCC, occ = (O && O.by && O.by[rec[0]]) || [];
    if (O && !occ.length) {
      h += '<div style="font-size:11.5px;color:#94a3b8;margin-top:6px">No mapped occupancy on this parcel.</div>';
    } else if (occ.length) {
      h += '<div style="margin-top:8px;font-size:10.5px;font-weight:700;letter-spacing:.4px;color:#64748b">' +
           'ON THIS PARCEL (' + occ.length + ')</div>';
      occ.forEach(function (o) {
        h += '<div style="margin-top:6px;font-size:12.5px"><span style="display:inline-block;width:10px;height:10px;' +
             'border-radius:3px;border:1.5px solid #fff;box-shadow:0 0 0 1px #94a3b8;vertical-align:-1px;background:' +
             (TIER_COLOR[o[3]] || '#5b7c99') + '"></span> <b>' + esc(o[0]) + '</b>' +
             (o[10] ? ' <span style="color:#94a3b8;font-size:11px">#' + esc(o[10]) + '</span>' : '');
        /* Same facts the Centerville map shows for a target hazard. */
        var cls = [o[4], o[6]].filter(Boolean).map(esc).join(' &middot; ');
        if (cls) h += '<div style="font-size:11.5px;margin-left:16px">' + cls + '</div>';
        var facts = [];
        if (o[7]) facts.push(Number(o[7]).toLocaleString() + ' sq ft');
        if (o[8]) facts.push('load ' + Number(o[8]).toLocaleString());
        if (o[9]) facts.push('fire flow ' + Number(o[9]).toLocaleString() + ' gpm');
        if (facts.length) h += '<div style="font-size:11.5px;margin-left:16px;color:#334155">' + facts.join(' &middot; ') + '</div>';
        if (o[1]) h += '<div style="color:#64748b;font-size:11px;margin-left:16px">' + esc(o[1]) + '</div>';
        h += '<div style="margin-left:16px;font-size:12.5px">' + (o[2]
          ? '<a target="_blank" rel="noopener" href="' + esc(O.book + encodeURIComponent(o[2])) + '">Pre-plan &rarr;</a>'
          : '<span style="color:#b45309;font-weight:600">no pre-plan yet</span>') + '</div></div>';
      });
    }
    return h + '</div>';
  }

  function attach(map) {
    if (map.__pcfdParcels || map.options.pcfdParcels === false) return;
    map.__pcfdParcels = true;

    /* Own pane below the overlay pane (400): parcels sit under every marker,
       radar tile and track the page already draws. */
    map.createPane('pcfdParcels');
    map.getPane('pcfdParcels').style.zIndex = 350;
    /* Draw-only: ONE canvas for parcels and water that never takes a pointer event
       (a Leaflet canvas otherwise swallows every tap over the whole map). Taps are
       answered by onTap() below from the map's own click. */
    map.getPane('pcfdParcels').style.pointerEvents = 'none';
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
        group.addLayer(L.polygon(latlngs(r), {
          pane: 'pcfdParcels', renderer: renderer, interactive: false,
          color: '#7c3aed', weight: 1, opacity: 0.6,
          fillColor: '#7c3aed', fillOpacity: 0.04
        }));
      }
      waterToFront();
    }

    /* Parcels are rebuilt on every move and land on top of the shared canvas; put
       the mains and the known-size markers back over them (drawing order only --
       taps are decided by onTap). */
    function waterToFront() {
      if (!won || !mains || !map.hasLayer(wgroup)) return;
      mains.forEach(function (l) { l.bringToFront(); });
      if (nhyd) nhyd.forEach(function (l) { l.bringToFront(); });
      fgroup.eachLayer(function (l) { if (l.bringToFront) l.bringToFront(); });
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
      Promise.all([load(), loadOcc(), loadAim()]).then(draw).catch(function () { label('&#9638; Parcels <small>unavailable</small>'); });
    }

    /* ------------------------------------------------------------ water */
    /* On the parcels' canvas (350, under the page's own overlays at 400). */
    /* Size labels ride on the mains but stay under the page's markers (400). */
    map.createPane('pcfdWaterLbl');
    map.getPane('pcfdWaterLbl').style.zIndex = 390;
    var wrenderer = renderer;
    var wgroup = L.layerGroup();        // mains: built once, kept, only toggled by zoom
    var fgroup = L.layerGroup();        // the few known-size markers
    var lgroup = L.layerGroup();        // size labels on screen, rebuilt each move at LABEL_ZOOM+
    var hgroup = L.layerGroup();        // neighbours' hydrants, built once
    var cgroup = L.layerGroup();        // water towers + pump houses (from WFAC_ZOOM)
    var facs = null;
    var nhyd = null;
    var won = false, wbtn = null, legend = null, mains = null, labels = null;

    function wlabel(t) { if (wbtn) wbtn.innerHTML = t; }

    /* The FVUC map is CAD-converted into thousands of tiny segments; drawing them
       one layer each, rebuilt every pan, cost half a second per move in Fort Valley.
       But every segment with the same size, source, material and install decade
       gets the SAME popup, so each such group becomes ONE multi-line layer built
       once: ~14,000 objects become a few dozen, and Leaflet's canvas clips to the
       screen by itself. Nothing a firefighter can see or tap is lost. */
    function buildMains(W) {
      var groups = {}, order = [];
      for (var i = 0; i < W.lines.length; i++) {
        var r = W.lines[i], key = r[0] + '|' + r[1] + '|' + r[2] + '|' + (r[8] || '');
        if (!groups[key]) { groups[key] = { r: r, parts: [] }; order.push(key); }
        var f = r[7], ll = [];
        for (var k = 0; k < f.length; k += 2) ll.push([f[k + 1], f[k]]);
        groups[key].parts.push(ll);
      }
      /* Small first, big last: a 16" trunk is drawn over the 6" main it crosses.
         Every white edge goes down before any blue, so crossings read as one network. */
      order.sort(function (a, b) { return groups[a].r[0] - groups[b].r[0]; });
      var edges = [], pipes = [];
      order.forEach(function (key) {
        /* Traced from hydrants: slate-blue, sized like the rest where a hydrant record gives the size. */
        var g = groups[key], st = isLead(W, g.r) ? { color: '#6b84a8', weight: 1.8 } : isProbable(W, g.r) ? (function (s) { return { color: '#6b84a8', weight: s ? waterStyle(g.r).weight : 2.8 }; })(g.r[0]) : waterStyle(g.r);
        edges.push(L.polyline(g.parts, {
          pane: 'pcfdParcels', renderer: wrenderer, interactive: false,
          color: '#ffffff', weight: st.weight + 3, opacity: 0.92, lineCap: 'round', lineJoin: 'round'
        }));
        pipes.push(L.polyline(g.parts, {
          pane: 'pcfdParcels', renderer: wrenderer, interactive: false,
          color: st.color, weight: st.weight, opacity: 1, lineCap: 'round', lineJoin: 'round'
        }));
      });
      return edges.concat(pipes);
    }

    function drawLabels() {
      lgroup.clearLayers();
      if (!labels || map.getZoom() < LABEL_ZOOM) return;
      var b = map.getBounds().pad(0.1), taken = {}, n = 0;
      for (var i = 0; i < labels.length && n < 300; i++) {
        var w = labels[i];
        if (!b.contains([w.lat, w.lng])) continue;
        var p = map.latLngToLayerPoint([w.lat, w.lng]);
        var cell = Math.floor(p.x / 125) + ',' + Math.floor(p.y / 64);
        if (taken[cell]) continue;
        taken[cell] = 1; n++;
        lgroup.addLayer(L.marker([w.lat, w.lng], {
          pane: 'pcfdWaterLbl', interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'pcfd-wlab', iconSize: null,
                            html: '<span style="' + LABEL_CSS + '">' + w.sz + '&quot;</span>' })
        }));
      }
    }

    function wdraw() {
      if (!won || !window.PCFD_WATER) return;
      var W = window.PCFD_WATER, z = map.getZoom();
      if (!facs && window.PCFD_WFAC) {
        facs = window.PCFD_WFAC.f.map(function (f) {
          var tower = f[2] !== 'pump';
          return L.marker([f[0], f[1]], { interactive: false, keyboard: false, zIndexOffset: -500,
            icon: L.divIcon({ className: '', html: tower ? TOWER_SVG : PUMP_HTML,
                              iconSize: tower ? [22, 28] : [22, 22], iconAnchor: tower ? [11, 27] : [11, 11] }) });
        });
      }
      if (facs) {
        if (z >= WFAC_ZOOM) { if (!cgroup.getLayers().length) facs.forEach(function (m) { cgroup.addLayer(m); }); if (!map.hasLayer(cgroup)) cgroup.addTo(map); }
        else if (map.hasLayer(cgroup)) map.removeLayer(cgroup);
      }
      fgroup.clearLayers();
      if (z >= FACT_ZOOM) {
        (W.facts || []).forEach(function (f) {
          fgroup.addLayer(L.circleMarker([f.lat, f.lng], {
            pane: 'pcfdParcels', renderer: wrenderer, radius: 7, interactive: false,
            color: '#fff', weight: 2, fillColor: '#0369a1', fillOpacity: 1
          }));
        });
      }
      if (z < WATER_ZOOM) {
        if (map.hasLayer(wgroup)) map.removeLayer(wgroup);
        wlabel('&#128167; Water <small>zoom in for mains</small>');
        return;
      }
      if (!mains) {
        mains = buildMains(W); mains.forEach(function (l) { wgroup.addLayer(l); });
        labels = waterLabels(W); wgroup.addLayer(lgroup);
      }
      if (!nhyd && window.PCFD_NHYD) {
        /* The Centerville dot: class colour in a white ring; out of service black with a red ring. */
        nhyd = window.PCFD_NHYD.h.map(function (h) {
          var c = hydClass(h[4], h[5]);
          return L.circleMarker([h[0], h[1]], {
            pane: 'pcfdParcels', renderer: wrenderer, interactive: false, radius: 6,
            color: h[7] ? '#e74c3c' : '#fff', weight: h[7] ? 2.5 : 2, opacity: 1,
            fillColor: h[7] ? '#111' : (c ? HYD_CLS[c][0] : '#7f8c8d'), fillOpacity: 1
          });
        });
        nhyd.forEach(function (m) { hgroup.addLayer(m); });
        wgroup.addLayer(hgroup);
      }
      if (!map.hasLayer(wgroup)) wgroup.addTo(map);
      drawLabels();
      wlabel('&#128167; Water');
    }

    function wsetOn(v) {
      won = !!v;
      try { localStorage.setItem(WKEY, won ? '1' : '0'); } catch (e) {}
      if (wbtn) {
        wbtn.setAttribute('aria-pressed', won ? 'true' : 'false');
        wbtn.style.background = won ? '#e0f2fe' : '#fff';
      }
      if (legend) legend.style.display = won ? 'block' : 'none';
      setTimeout(clearOfPage, 0);                // the legend changes the box's height
      if (!won) {
        if (map.hasLayer(cgroup)) map.removeLayer(cgroup);
        if (map.hasLayer(wgroup)) map.removeLayer(wgroup);
        fgroup.clearLayers(); if (map.hasLayer(fgroup)) map.removeLayer(fgroup);
        wlabel('&#128167; Water'); return;
      }
      if (!map.hasLayer(fgroup)) fgroup.addTo(map);
      wlabel('&#128167; Water <small>loading</small>');
      Promise.all([loadWater(), loadNhyd(), loadWfac()]).then(wdraw).catch(function () { wlabel('&#128167; Water <small>unavailable</small>'); });
    }

    var ctlBox = null;
    var Ctl = L.Control.extend({
      options: { position: POSITION },
      onAdd: function () {
        var box = ctlBox = L.DomUtil.create('div', 'leaflet-bar');
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
        legend.style.cssText = 'display:none;padding:5px 8px;font:11px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#334155;background:#fff;border-top:1px solid #ccc;max-width:190px;white-space:normal;max-height:38vh;overflow-y:auto';
        legend.innerHTML =
          '<div><span style="' + PIPE_CSS + ';height:6px;background:#1e3a8a"></span>12&quot; and bigger</div>' +
          '<div><span style="' + PIPE_CSS + ';height:4px;background:#1d4ed8"></span>8&ndash;10&quot;</div>' +
          '<div><span style="' + PIPE_CSS + ';height:3px;background:#2563eb"></span>6&quot;, or size not on file</div>' +
          '<div><span style="' + PIPE_CSS + ';height:2px;background:#3b82f6"></span>smaller than 6&quot;</div>' +
          '<div><span style="' + PIPE_CSS + ';height:3px;background:#6b84a8"></span>traced from hydrants (~9 in 10 match real mains)</div>' +
          '<div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#0369a1;vertical-align:middle;margin:0 12px 0 7px"></span>known size, route not public</div>' +
          '<div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#27ae60;border:2px solid #fff;box-shadow:0 0 0 1px #94a3b8;vertical-align:middle;margin:0 10px 0 5px"></span>neighbours&rsquo; hydrants (by flow class)</div>' +
          '<div><span style="display:inline-block;vertical-align:middle;margin:0 6px 0 2px">' + TOWER_SVG.replace('width="22" height="28"', 'width="16" height="20"') + '</span>water tower / tank &nbsp;<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#0f766e;vertical-align:middle"></span> pump station</div>' +
          '<div style="margin-top:3px">Every solid blue line is a water main. Sizes print on the line up close ' +
          '<span style="' + LABEL_CSS.replace('position:absolute;transform:translate(-50%,-50%);', '') + '">8&quot;</span> where the utility recorded them.</div>' +
          '<div style="color:#b45309;margin-top:2px">Approximate. Not for excavation.</div>';
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.on(btn, 'click', function (ev) { L.DomEvent.preventDefault(ev); setOn(!on); });
        L.DomEvent.on(wbtn, 'click', function (ev) { L.DomEvent.preventDefault(ev); wsetOn(!won); });
        return box;
      }
    });
    new Ctl().addTo(map);

    /* ------------------------------------------------------------ taps */
    function ringHas(f, x, y) {                  // f = [lng,lat,...]
      var ins = false, n = f.length / 2;
      for (var i = 0, j = n - 1; i < n; j = i++) {
        var xi = f[2 * i], yi = f[2 * i + 1], xj = f[2 * j], yj = f[2 * j + 1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
      }
      return ins;
    }
    function parcelAt(ll) {
      var P = window.CV_PARCELS && window.CV_PARCELS.p, x = ll.lng, y = ll.lat;
      if (!P) return null;
      for (var i = 0; i < P.length; i++) {
        var r = P[i];
        if (x < r[2] || x > r[4] || y < r[3] || y > r[5]) continue;
        for (var k = 0; k < r[6].length; k++) {
          var poly = r[6][k];
          if (!poly.length || !ringHas(poly[0], x, y)) continue;
          var hole = false;
          for (var h = 1; h < poly.length && !hole; h++) hole = ringHas(poly[h], x, y);
          if (!hole) return r;
        }
      }
      return null;
    }
    function segPx(p, a, b) {
      var dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      var t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      return Math.sqrt(Math.pow(p.x - a.x - t * dx, 2) + Math.pow(p.y - a.y - t * dy, 2));
    }
    function mainAt(cp) {
      var W = window.PCFD_WATER;
      if (!W) return null;
      var a = map.containerPointToLatLng([cp.x - TAP_PX, cp.y - TAP_PX]);
      var b = map.containerPointToLatLng([cp.x + TAP_PX, cp.y + TAP_PX]);
      var w = Math.min(a.lng, b.lng), e = Math.max(a.lng, b.lng), s = Math.min(a.lat, b.lat), n = Math.max(a.lat, b.lat);
      var best = null, bd = TAP_PX;
      for (var i = 0; i < W.lines.length; i++) {
        var r = W.lines[i];
        if (r[3] > e || r[5] < w || r[4] > n || r[6] < s) continue;
        var f = r[7], p0 = map.latLngToContainerPoint([f[1], f[0]]);
        for (var k = 2; k < f.length; k += 2) {
          var p1 = map.latLngToContainerPoint([f[k + 1], f[k]]), d = segPx(cp, p0, p1);
          if (d < bd || (best && d === bd && r[0] > best[0])) { bd = d; best = r; }
          p0 = p1;
        }
      }
      return best;
    }
    function nhydAt(cp) {
      var N = window.PCFD_NHYD, best = null, bd = TAP_PX + 1;
      if (!N) return null;
      for (var i = 0; i < N.h.length; i++) {
        var p = map.latLngToContainerPoint([N.h[i][0], N.h[i][1]]);
        var d = Math.max(Math.abs(p.x - cp.x), Math.abs(p.y - cp.y));
        if (d < bd) { bd = d; best = N.h[i]; }
      }
      return best;
    }
    function facAt(cp) {
      var F = (window.PCFD_WFAC && window.PCFD_WFAC.f) || [];
      for (var i = 0; i < F.length; i++) {
        var p = map.latLngToContainerPoint([F[i][0], F[i][1]]);
        var dy = F[i][2] === 'pump' ? p.y - cp.y : (p.y - 13) - cp.y;     // a tower's icon stands above its point
        if (Math.abs(p.x - cp.x) <= 13 && Math.abs(dy) <= 14) return F[i];
      }
      return null;
    }
    function factAt(cp) {
      var F = (window.PCFD_WATER && window.PCFD_WATER.facts) || [];
      for (var i = 0; i < F.length; i++) {
        var p = map.latLngToContainerPoint([F[i].lat, F[i].lng]);
        if (Math.abs(p.x - cp.x) <= TAP_PX && Math.abs(p.y - cp.y) <= TAP_PX) return F[i];
      }
      return null;
    }
    /* The page's own features win: if a hydrant, alert or marker opened its popup on
       this same tap, leave it alone. Our popups carry options.pcfd to tell them apart. */
    var foreignPopupAt = 0;
    map.on('popupopen', function (e) {
      if (!(e.popup && e.popup.options && e.popup.options.pcfd)) foreignPopupAt = Date.now();
    });
    function onTap(ev) {
      if (!on && !won) return;
      var cp = ev.containerPoint, ll = ev.latlng;
      setTimeout(function () {                   // after the page's own handlers for this tap
        if (Date.now() - foreignPopupAt < 400) return;
        var z = map.getZoom(), html = null;
        if (won && window.PCFD_WFAC && z >= WFAC_ZOOM) { var fc = facAt(cp); if (fc) html = facPopup(fc); }
        if (!html && won && window.PCFD_WATER) {
          var nh = z >= WATER_ZOOM ? nhydAt(cp) : null;
          var f = !nh && z >= FACT_ZOOM ? factAt(cp) : null;
          if (nh) html = nhydPopup(nh, window.PCFD_NHYD);
          else if (f) html = factPopup(f);
          else if (z >= WATER_ZOOM) { var r = mainAt(cp); if (r) html = waterPopup(r, window.PCFD_WATER); }
        }
        if (!html && on && z >= MIN_ZOOM) { var p = parcelAt(ll); if (p) html = popupHtml(p); }
        /* maxHeight: a strip centre can list five tenants; scroll rather than cover the map. */
        if (html) hydratePhoto(L.popup({ maxWidth: 280, maxHeight: 380, pcfd: true }).setLatLng(ll).setContent(html).openOn(map).getElement());
      }, 0);
    }
    map.on('click', onTap);
    /* Street View for any hydrant popup on this map -- ours or the page's own -- that
       carries a .pcfd-sv slot; the popup re-lays itself out once the picture is in. */
    map.on('popupopen', function (e) {
      var pp = e.popup;
      /* re-measure only: update() would re-run a function-content popup and throw the
         picture away (the radar's and inspections' hydrant popups are built on open) */
      svHydrate(pp.getElement(), function () {
        if (!pp.isOpen || !pp.isOpen()) return;
        if (pp._updateLayout) { pp._updateLayout(); pp._updatePosition(); if (pp._adjustPan) pp._adjustPan(); }
      });
    });

    /* ------------------------------------------------------------ keep the buttons visible */
    /* A page panel sitting on our corner (the radar's header) would hide the buttons.
       Push the box down below whatever covers it; re-checked because pages open and
       close their panels. Gives up rather than push the box off the map. */
    function clearOfPage() {
      if (!ctlBox || !ctlBox.parentNode) return;
      var ctr = map.getContainer(), cr = ctr.getBoundingClientRect();
      ctlBox.style.marginTop = '';
      var shift = 0;
      for (var n = 0; n < 8; n++) {
        var r = ctlBox.getBoundingClientRect();
        if (!r.width) return;
        /* Only the two buttons must be clear; the legend under them may overlap a page
           panel near the bottom (it scrolls). Checking the whole box made a tall legend
           collide with the radar's reflectivity key and give up. */
        var rb = (wbtn || ctlBox).getBoundingClientRect();
        var pts = [[r.left + 6, r.top + 6], [r.right - 6, r.top + 6], [rb.left + 6, rb.bottom - 6], [rb.right - 6, rb.bottom - 6]];
        var cover = null;
        for (var i = 0; i < pts.length && !cover; i++) {
          var el = document.elementFromPoint(pts[i][0], pts[i][1]);
          if (!el || ctlBox.contains(el)) continue;
          if (ctr.contains(el) && !(el.closest && el.closest('.leaflet-control'))) continue;   // the map itself
          cover = el;
        }
        if (!cover) return;
        var need = cover.getBoundingClientRect().bottom - r.top + 8;
        if (need <= 0) return;
        shift += need;
        if (rb.bottom + need > cr.bottom - 4) { ctlBox.style.marginTop = ''; return; }
        ctlBox.style.marginTop = shift + 'px';
      }
    }
    map.whenReady(function () { setTimeout(clearOfPage, 300); });
    window.addEventListener('resize', clearOfPage);
    setInterval(clearOfPage, 1500);

    map.on('moveend zoomend', function () { if (on) draw(); if (won) wdraw(); });

    var was = false, wwas = false;
    try { was = localStorage.getItem(KEY) === '1'; wwas = localStorage.getItem(WKEY) === '1'; } catch (e) {}
    if (was) map.whenReady(function () { setOn(true); });
    if (wwas) map.whenReady(function () { wsetOn(true); });
  }

  L.Map.addInitHook(function () { attach(this); });

  window.PCFDParcels = { load: load, loadWater: loadWater, loadOcc: loadOcc, loadNhyd: loadNhyd, loadWfac: loadWfac, attach: attach,
                         data: DATA, water: WATER, occupancies: OCC, version: 'book-sync-2026-09-22' };
})();
