/* ===========================================================================
 * fp-photo.js — page 11 (Floor Plan) add-on: photographs pinned to the plan.
 *
 * WHY
 * ---
 * The camera panel already holds every picture taken for a plan, but a picture
 * in a list does not tell you WHERE it was taken. In a 25,000 sq ft building
 * "electrical room" is four different rooms. A pin does tell you: tap the spot
 * on the plan, take the picture, and from then on the plan says what that
 * corner of the building actually looks like.
 *
 * HOW IT REACHES THE EDITOR
 * -------------------------
 * Through window.FP and window.__FP_OVERLAY only — the same contract fp-pro.js
 * and fp-markers.js use, and the one fp2-render.js names in the comment above
 * its overlay call. Nothing in the editor is rewritten.
 *
 *   - The Photo button calls FP.setTool('photo'). 'photo' is a tool the host
 *     does not know, so its pointer handler falls through and does nothing,
 *     which is exactly what is wanted: the host stays out of the way while this
 *     file handles the tap. Picking any other tool disarms it for free, because
 *     setTool already toggles .active across every [data-tool] button.
 *   - Pins are painted in the overlay hook. snapshot() calls draw() and then
 *     reads the canvas, so the pins reach the PDF and the Book too, not just
 *     the screen.
 *   - A tap on an existing pin is caught on window in the CAPTURE phase, so it
 *     beats the host's own canvas handler and a pin can be opened without the
 *     select tool grabbing whatever is underneath it.
 *
 * WHAT IS STORED
 * --------------
 * floor.photos = [{ id, x, y, photoId, label }] — plan coordinates and the
 * photo's id, never the image. The image goes where every other pre-plan
 * photograph goes (POST /api/preplan/photos, tagged page 11) so one library
 * holds them all; the plan itself rides in localStorage and the cloud draft,
 * where base64 would bloat both.
 * ======================================================================== */

(function (root) {
  'use strict';

  var FP = root.FP;
  if (!FP || !FP.state) {
    console.warn('[fp-photo] window.FP not available; not initialising');
    return;
  }

  var PAGE = '11';
  var MAX_B64 = 8e5;            // the worker rejects anything larger
  var HIT_PX = 18;              // how close a tap has to land, in screen pixels
  var state = FP.state;
  var M = root.FPModel;

  var input = null;             // the file picker, made once
  var moving = null;            // a pin waiting to be put somewhere else
  var swallowClick = false;     // a pin tap must not also place a new pin

  /* ------------------------------------------------------------- the data */

  function doc() { return FP.doc ? FP.doc() : null; }

  /* doc.list() makes the array on demand, so pins need no schema change. */
  function pins() {
    var d = doc();
    return d ? d.list('photos') : [];
  }

  function planId() {
    if (!M) return '';
    var p = M.readPlan();
    if (!p.plan_uid) {
      p.plan_uid = 'plan-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      M.writePlan({ plan_uid: p.plan_uid });
    }
    return p.plan_uid;
  }

  function say(msg, kind) {
    if (FP.showToast) FP.showToast(msg, kind || 'ok');
  }

  function hint(msg) {
    var el = document.getElementById('hint-bar');
    if (el) el.innerHTML = msg;
  }

  function commit(label) {
    if (FP.saveToStorage) FP.saveToStorage();
    if (FP.updateCounts) FP.updateCounts();
    FP.draw();
    if (label) say(label);
  }

  /* --------------------------------------------------------- the picture */

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
        plan_id: planId(), page: PAGE, category: 'Interior', caption: caption || '',
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

  /* ------------------------------------------------------------ the pins */

  function addPin(x, y, photoId, label) {
    var d = doc();
    if (!d) return null;
    var rec = { id: 'ph_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                x: x, y: y, photoId: photoId, label: label || '' };
    FP.pushUndo();
    pins().push(rec);
    if (FP.hideEmpty) FP.hideEmpty();
    commit('Photo pinned');
    return rec;
  }

  function removePin(i) {
    var list = pins();
    if (i < 0 || i >= list.length) return;
    FP.pushUndo();
    var gone = list.splice(i, 1)[0];
    if (gone && gone.photoId) {
      fetch('/api/preplan/photos/' + encodeURIComponent(gone.photoId), { method: 'DELETE' }).catch(function () {});
    }
    commit('Photo removed');
  }

  function pinAt(sx, sy) {
    var list = pins();
    /* Last drawn is topmost, so search backwards. */
    for (var i = list.length - 1; i >= 0; i--) {
      var s = FP.dataToScreen(list[i].x, list[i].y);
      if (Math.hypot(s.sx - sx, s.sy - sy) <= HIT_PX) return { pin: list[i], index: i };
    }
    return null;
  }

  /* ----------------------------------------------------------- the picker */

  function ensureInput() {
    if (input) return input;
    input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');   // the back camera on a tablet
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      var at = input._at;
      input.value = ''; input._at = null;            // so the same shot can be retaken
      if (!file || !at) return;
      hint('Saving the photo…');
      compress(file).then(function (shot) {
        var caption = prompt('Caption for this photo (optional)', '') || '';
        return upload(shot, caption.trim()).then(function (id) {
          addPin(at.x, at.y, id, caption.trim());
          hint('Tap the plan to pin another photo.');
        });
      }).catch(function (e) {
        hint('Photo not saved: ' + e.message);
        say('Photo not saved: ' + e.message, 'err');
      });
    });
    document.body.appendChild(input);
    return input;
  }

  function takePhotoAt(pt) {
    var el = ensureInput();
    el._at = pt;
    el.click();
  }

  /* ----------------------------------------------------------- the viewer */

  function openPhoto(hit) {
    var m = hit.pin;
    var box = document.createElement('div');
    box.id = 'fp-photo-view';
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:100050;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px';
    var img = document.createElement('img');
    img.src = '/api/preplan/photos/' + encodeURIComponent(m.photoId) + '/image';
    img.style.cssText = 'max-width:94vw;max-height:72vh;border-radius:8px;background:#111';
    var cap = document.createElement('div');
    cap.textContent = m.label || 'Photo';
    cap.style.cssText = 'color:#fff;font:600 15px system-ui,sans-serif;text-align:center;padding:0 16px';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;padding:0 12px';
    row.innerHTML =
      '<button type="button" data-a="close" style="padding:11px 20px;border:0;border-radius:8px;font-weight:700">Close</button>' +
      '<button type="button" data-a="move" style="padding:11px 20px;border:0;border-radius:8px;background:#1e3a5f;color:#fff;font-weight:700">Move pin</button>' +
      '<button type="button" data-a="del" style="padding:11px 20px;border:0;border-radius:8px;background:#b3252b;color:#fff;font-weight:700">Remove</button>';
    box.appendChild(img); box.appendChild(cap); box.appendChild(row);
    document.body.appendChild(box);

    var shut = function () { box.remove(); };
    box.addEventListener('click', function (e) { if (e.target === box) shut(); });
    row.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (!a) return;
      if (a === 'close') { shut(); return; }
      if (a === 'move') {
        shut();
        moving = m;
        FP.setTool('photo');
        hint('Tap the plan where this photo belongs.');
        say('Tap the new spot');
        return;
      }
      if (a === 'del') {
        if (!confirm('Remove this photo from the plan?')) return;
        removePin(hit.index);
        shut();
      }
    });
  }

  /* --------------------------------------------------------- the painting */

  var prevOverlay = root.__FP_OVERLAY;
  root.__FP_OVERLAY = function () {
    if (prevOverlay) { try { prevOverlay(); } catch (e) { console.warn('[fp-photo] prior overlay', e); } }
    paint();
  };

  function paint() {
    var c = FP.ctx;
    if (!c || !state.data) return;
    var list = pins();
    if (!list.length) return;
    c.save();
    c.setTransform(state.dpr || 1, 0, 0, state.dpr || 1, 0, 0);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    list.forEach(function (m) {
      var s = FP.dataToScreen(m.x, m.y);
      /* Fixed screen size: a pin is a map marker, not part of the building, so
       * it has to stay legible at every zoom. */
      c.beginPath(); c.arc(s.sx, s.sy, 13, 0, Math.PI * 2);
      c.fillStyle = (moving && moving === m) ? '#f97316' : '#0ea5e9';
      c.fill();
      c.lineWidth = 2.5; c.strokeStyle = '#fff'; c.stroke();
      c.fillStyle = '#fff';
      c.font = '700 13px system-ui, sans-serif';
      c.fillText('📷', s.sx, s.sy + 1);
      if (m.label) {
        var t = String(m.label).slice(0, 28);
        c.font = '600 11px system-ui, sans-serif';
        var w = c.measureText(t).width + 8;
        c.fillStyle = 'rgba(255,255,255,.92)';
        c.fillRect(s.sx - w / 2, s.sy + 15, w, 15);
        c.strokeStyle = '#0ea5e9'; c.lineWidth = 1;
        c.strokeRect(s.sx - w / 2, s.sy + 15, w, 15);
        c.fillStyle = '#0f172a';
        c.fillText(t, s.sx, s.sy + 23);
      }
    });
    c.restore();
  }

  /* ------------------------------------------------------------- the taps */

  function canvasPoint(e) {
    var r = FP.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  function onCapture(e) {
    if (!FP.canvas || e.target !== FP.canvas) return;
    var t = state.tool;
    /* Only steal the tap where stealing it is what the user meant. In a drawing
     * tool a pin is scenery, or tracing a wall past one would open a picture. */
    if (t !== 'select' && t !== 'photo') return;
    if (t === 'photo' && moving) return;        // a move is placing, not opening
    var p = canvasPoint(e);
    var hit = pinAt(p.sx, p.sy);
    if (!hit) return;
    e.stopPropagation();
    e.preventDefault();
    swallowClick = true;
    openPhoto(hit);
  }

  function onClick(e) {
    if (!FP.canvas || e.target !== FP.canvas) return;
    if (swallowClick) { swallowClick = false; return; }
    if (state.tool !== 'photo') return;
    var p = canvasPoint(e);
    var pt = FP.screenToData(p.sx, p.sy);
    if (moving) {
      FP.pushUndo();
      moving.x = pt.x; moving.y = pt.y;
      moving = null;
      commit('Photo moved');
      hint('Tap the plan to pin another photo.');
      return;
    }
    takePhotoAt(pt);
  }

  /* ----------------------------------------------------------- the button */

  function arm() {
    FP.setTool('photo');
    moving = null;
    hint('Tap the plan where the picture was taken, then take it.');
    if (!pins().length) say('Tap the spot, then take the picture');
  }

  function boot() {
    var rail = document.querySelector('[data-tool="measure"]');
    if (rail && rail.parentNode && !document.getElementById('fpx-photo')) {
      var b = document.createElement('button');
      b.className = rail.className.replace(/\bactive\b/, '').trim();
      b.id = 'fpx-photo';
      b.setAttribute('data-tool', 'photo');    // so setTool lights it, and clears it
      b.innerHTML = '<i>📷</i><b>Photo</b>';
      b.addEventListener('click', arm);
      rail.parentNode.insertBefore(b, rail.nextSibling);
    }
    /* Leaving the tool by any other route cancels a half-finished move. */
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-tool]') : null;
      if (el && el.getAttribute('data-tool') !== 'photo') moving = null;
    }, true);
    root.addEventListener('pointerdown', onCapture, true);
    root.addEventListener('click', onClick, true);
  }

  root.FPPhoto = {
    add: addPin, remove: removePin, pins: pins, at: pinAt,
    open: openPhoto, arm: arm, paint: paint, planId: planId
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 400); });
  else setTimeout(boot, 400);
})(typeof window !== 'undefined' ? window : this);
