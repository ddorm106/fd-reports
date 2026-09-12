/* sm-photo-sym.js — page 10 (Site Plan) add-on: photo pins and AI symbols.
 *
 * Why a separate file: preplan-sitemap.js works, and page 11 already proved the
 * pattern — an add-on reaches the host through a few named seams rather than by
 * being merged into it (fp-pro.js / window.FP). The seams here are:
 *   PreplanSiteMap.map() / .writeMarkers() / .draw() / .refresh() / .pick()
 * and, inside the host, four one-line checks for window.SMAdd.
 *
 * Photo pins: a pin that carries photoId. The photo itself goes to the same
 * place the 📷 panel sends everything — POST /api/preplan/photos, tagged
 * page "10" — so one library holds them all and the per-page list already
 * works. The plan only stores the id, never the image: site_markers rides in
 * localStorage and the cloud draft, and base64 there would bloat both.
 *
 * AI symbols: the same generator page 11 uses (FPSymGen -> /api/symbol-gen).
 * The returned spec is stored ON the marker as well as in the plan's library,
 * so a symbol drawn here still renders on another device that has never seen it.
 */
(function (root) {
  'use strict';

  var PAGE = '10';
  var MAX_B64 = 8e5;          // the worker rejects anything larger
  var pendingLatLng = null;
  var input = null;

  function host() { return root.PreplanSiteMap || null; }

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

  /* Same rule as the photo panel's own getPlanId, so both file photos against
     one plan. Minting it here when it is missing matches what the panel does. */
  function planId() {
    var d = readPlan();
    if (!d.plan_uid) {
      d.plan_uid = 'plan-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      writePlan(function (p) { p.plan_uid = d.plan_uid; });
    }
    return d.plan_uid;
  }

  function toast(msg) {
    var el = document.getElementById('smHint');
    if (el) el.textContent = msg;
  }

  /* ------------------------------------------------------------ photo pins */

  function compress(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var max = 1200;
        var k = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var q = [0.7, 0.5, 0.3], out = null;
        for (var i = 0; i < q.length; i++) {
          out = c.toDataURL('image/jpeg', q[i]);
          if (out.length - 23 <= MAX_B64) break;
        }
        if (out.length - 23 > MAX_B64) { reject(new Error('That picture is too large even at low quality.')); return; }
        resolve({ b64: out.split(',')[1], w: c.width, h: c.height });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not an image this browser can read.')); };
      img.src = url;
    });
  }

  function upload(shot, caption) {
    return fetch('/api/preplan/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: planId(), page: PAGE, category: 'Exterior', caption: caption || '',
        data_base64: shot.b64, file_type: 'image/jpeg',
        file_size: Math.round(shot.b64.length * 0.75), width: shot.w, height: shot.h
      })
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || !d.id) throw new Error(d && d.error ? d.error : 'Upload failed (' + r.status + ')');
        return d.id;
      });
    });
  }

  function ensureInput() {
    if (input) return input;
    input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');   // the back camera on a tablet
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';                              // so the same picture can be retaken
      var at = pendingLatLng; pendingLatLng = null;
      if (!file || !at) return;
      toast('Saving the photo…');
      compress(file).then(function (shot) {
        var caption = prompt('Caption for this photo (optional)', '') || '';
        return upload(shot, caption.trim()).then(function (id) {
          var h = host();
          var list = h.markers();
          list.push({ k: 'photo', lat: at.lat, lng: at.lng, label: caption.trim() || null, photoId: id });
          h.writeMarkers(list); h.draw(); h.refresh(); h.schedule(700);
          toast('Photo pinned. Tap the pin to view it.');
        });
      }).catch(function (e) {
        toast('Photo not saved: ' + e.message);
        alert('Photo not saved: ' + e.message);
      });
    });
    document.body.appendChild(input);
    return input;
  }

  function placePhoto(latlng) {
    pendingLatLng = latlng;
    ensureInput().click();
  }

  function openPhoto(m, index) {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:10050;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px';
    var img = document.createElement('img');
    img.src = '/api/preplan/photos/' + encodeURIComponent(m.photoId) + '/image';
    img.style.cssText = 'max-width:94vw;max-height:76vh;border-radius:8px;background:#111';
    var cap = document.createElement('div');
    cap.textContent = m.label || 'Photo';
    cap.style.cssText = 'color:#fff;font:600 15px system-ui,sans-serif';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px';
    row.innerHTML =
      '<button type="button" id="smPhClose" style="padding:10px 18px;border:0;border-radius:8px;font-weight:700">Close</button>' +
      '<button type="button" id="smPhDel" style="padding:10px 18px;border:0;border-radius:8px;background:#b3252b;color:#fff;font-weight:700">Remove pin and photo</button>';
    box.appendChild(img); box.appendChild(cap); box.appendChild(row);
    document.body.appendChild(box);
    var shut = function () { box.remove(); };
    box.addEventListener('click', function (e) { if (e.target === box) shut(); });
    row.querySelector('#smPhClose').addEventListener('click', shut);
    row.querySelector('#smPhDel').addEventListener('click', function () {
      if (!confirm('Remove this photo from the plan?')) return;
      fetch('/api/preplan/photos/' + encodeURIComponent(m.photoId), { method: 'DELETE' }).catch(function () {});
      var h = host(); var list = h.markers(); list.splice(index, 1);
      h.writeMarkers(list); h.draw(); h.refresh(); h.schedule(700);
      shut();
    });
  }

  /* --------------------------------------------------------- AI symbols */

  function library() { return readPlan().site_symbols || []; }

  function remember(entry) {
    writePlan(function (d) {
      var lib = d.site_symbols || [];
      lib = lib.filter(function (s) { return s.id !== entry.id; });
      lib.push(entry);
      d.site_symbols = lib.slice(-40);        // a plan does not need more than this
    });
  }

  function specImage(spec, px) {
    if (!root.FPSymGen) return null;
    try { return root.FPSymGen.thumbnail(spec, px || 34, 2).toDataURL('image/png'); }
    catch (e) { return null; }
  }

  function chipFor(entry) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sm-cat';
    b.dataset.k = 'gen:' + entry.id;
    b.title = entry.label;
    var src = specImage(entry.spec, 26);
    b.innerHTML = (src ? '<img src="' + src + '" alt="" style="width:22px;height:22px;vertical-align:-4px">' : '✨') +
      ' ' + String(entry.label).replace(/[<>&]/g, '').slice(0, 18);
    return b;
  }

  function addChips() {
    var pal = document.getElementById('smPal');
    if (!pal) return;
    library().forEach(function (entry) {
      if (pal.querySelector('[data-k="gen:' + entry.id + '"]')) return;
      pal.appendChild(chipFor(entry));
    });
  }

  function generate() {
    if (!root.FPSymGen) { alert('The symbol generator did not load on this page.'); return; }
    var what = prompt('Describe the symbol you want — for example "loading dock door" or "propane cage".', '');
    if (!what) return;
    toast('Drawing “' + what + '”…');
    root.FPSymGen.generate(what).then(function (spec) {
      var entry = { id: Date.now().toString(36), label: (spec && spec.label) || what, spec: spec };
      remember(entry);
      addChips();
      host().pick('gen:' + entry.id);
      var chip = document.querySelector('[data-k="gen:' + entry.id + '"]');
      Array.prototype.forEach.call(document.querySelectorAll('.sm-cat'), function (x) { x.classList.toggle('sel', x === chip); });
      toast('Tap the map where the ' + entry.label.toLowerCase() + ' is.');
    }).catch(function (e) {
      toast('Could not draw that: ' + e.message);
      alert('Could not draw that symbol: ' + e.message);
    });
  }

  function placeSymbol(k, latlng) {
    var entry = library().filter(function (s) { return 'gen:' + s.id === k; })[0];
    if (!entry) { toast('That symbol is no longer in this plan.'); return; }
    var label = prompt('Label for this ' + entry.label + ' (optional)', '');
    if (label === null) return;
    var h = host(); var list = h.markers();
    list.push({ k: k, lat: latlng.lat, lng: latlng.lng, label: (label || '').trim() || entry.label, spec: entry.spec });
    h.writeMarkers(list); h.draw(); h.refresh(); h.schedule(700);
  }

  /* Icon for a marker carrying a spec — used by the host's drawMarkers. */
  function iconFor(m) {
    var src = specImage(m.spec, 34);
    if (!src || typeof L === 'undefined') return null;
    return L.divIcon({
      className: '',
      html: '<div style="width:34px;height:34px;border-radius:50%;background:#fff;border:2px solid #1e3a5f;' +
            'display:flex;align-items:center;justify-content:center"><img src="' + src + '" style="width:26px;height:26px"></div>' +
            '<div class="sm-pin-l">' + String(m.label || '').replace(/[<>&]/g, '') + '</div>',
      iconSize: [34, 34], iconAnchor: [17, 17]
    });
  }

  /* Draw a spec marker into the flattened JPEG — what actually prints. */
  function drawSpecOn(g, m, pt, S) {
    var src = specImage(m.spec, 34);
    g.beginPath(); g.arc(pt.x, pt.y, 15 * S, 0, Math.PI * 2);
    g.fillStyle = '#fff'; g.fill();
    g.lineWidth = 2.5 * S; g.strokeStyle = '#1e3a5f'; g.stroke();
    if (!src) return false;
    var im = new Image();
    im.src = src;                       // data URL: already decoded, draws synchronously
    try { g.drawImage(im, pt.x - 11 * S, pt.y - 11 * S, 22 * S, 22 * S); } catch (e) {}
    return true;
  }

  function boot() {
    var tools = document.getElementById('smTools');
    if (tools && !document.getElementById('smGen')) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-secondary';
      b.id = 'smGen';
      b.textContent = '✨ AI symbol';
      b.addEventListener('click', generate);
      tools.appendChild(b);
    }
    addChips();
  }

  root.SMAdd = {
    placePhoto: placePhoto, openPhoto: openPhoto,
    placeSymbol: placeSymbol, iconFor: iconFor, drawSpecOn: drawSpecOn,
    generate: generate, boot: boot
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 300); });
  else setTimeout(boot, 300);
})(typeof window !== 'undefined' ? window : this);
