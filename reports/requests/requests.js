/* Checkout & request forms — Centerville FD Training Division
 *
 * One engine for the short forms that email sergeants and command staff:
 * Equipment Checkout, Book Checkout, Repair Request. A page loads
 * staff.js (who gets the email and the name list), this file, and calls
 *
 *     CFDForm.start(CFDForm.checkout({...}))   or   CFDForm.start({...})
 *
 * A form is a list of sections. Labels, options, `show` and `required` may be
 * functions of the current data d = { mode, f, items, ref, photos }, so a
 * section can change between checking out and returning. Every submission is
 * a PDF plus photos, emailed through /api/send-email. No signature is ever
 * filled in for anyone. Styles: ../monthly/report.css + requests.css.
 */
(function () {
    'use strict';

    const A = window.CFD_REPORT_ASSETS || {};
    const STAFF = window.CFD_STAFF || {};
    const MB = 1024 * 1024;
    const MAX_TOTAL = 28 * MB;          // Resend's 40 MB per email, after base64
    const TONES = { bad: [198, 40, 40], warn: [239, 108, 0], ok: [46, 125, 50], info: [44, 62, 80] };

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const uid = () => Math.random().toString(36).slice(2, 10);
    const fmtSize = b => b >= MB ? (b / MB).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
    const val = (x, d) => typeof x === 'function' ? x(d) : x;
    // Flags can carry a link for the screen; the PDF and email get the words only.
    const plain = html => String(html || '').replace(/<a\b[\s\S]*?<\/a>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

    function isoDay(offset = 0) {
        const t = new Date(); t.setDate(t.getDate() + offset);
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    }
    function dayLabel(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
        return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : (iso || '');
    }
    function daysBetween(a, b) {
        const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
        const x = p(a), y = p(b);
        return x == null || y == null ? null : Math.round((y - x) / 86400000);
    }

    let C = null, pad = null;
    const state = { mode: '', f: {}, items: [], photos: [], ref: '', sig: false, sent: false, saveTimer: null };
    const data = () => ({ mode: state.mode, f: state.f, items: state.items, ref: state.ref, photos: state.photos });

    const newRef = () => `${C.refPrefix}-${isoDay().replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const shown = x => x.show == null || !!x.show(data());
    const itemsSection = () => C.sections.find(s => s.type === 'items');
    const allFields = () => C.sections.flatMap(s => s.fields || []);

    // ─────────────────────────── fields ───────────────────────────
    const optionsOf = fd => (val(fd.options, data()) || []).map(o => typeof o === 'string' ? { v: o, label: o } : o);

    function fieldHtml(fd) {
        const d = data(), id = 'f-' + fd.id, label = val(fd.label, d), req = val(fd.required, d) ? ' *' : '';
        const v = state.f[fd.id] == null ? '' : state.f[fd.id], ph = val(fd.placeholder, d) || '', help = val(fd.help, d);
        const helpHtml = help ? `<div class="rq-help">${help}</div>` : '';
        switch (fd.type) {
            case 'note':
                return `<div class="rp-field full rq-note ${fd.tone || ''}" data-field="${fd.id}">${val(fd.html, d)}</div>`;
            case 'chips':
                return `<div class="rp-field full" data-field="${fd.id}"><span class="rp-label">${esc(label)}${req}</span>
                    <div class="rq-chips${fd.cards ? ' cards' : ''}" role="radiogroup" aria-label="${esc(label)}" id="${id}">${optionsOf(fd).map(o => `<label class="rq-chip" data-tone="${o.tone || ''}"><input type="radio" name="${id}" value="${esc(o.v)}" data-f="${fd.id}"${o.v === v ? ' checked' : ''}><span>${o.icon ? `<i aria-hidden="true">${o.icon}</i>` : ''}<b>${esc(o.label)}</b>${o.note ? `<small>${esc(o.note)}</small>` : ''}</span></label>`).join('')}</div>${helpHtml}</div>`;
            case 'check':
                return `<div class="rp-field full" data-field="${fd.id}"><label class="rq-check${fd.tone ? ' ' + fd.tone : ''}"><input type="checkbox" id="${id}" data-f="${fd.id}"${v ? ' checked' : ''}><span>${esc(label)}</span></label>${helpHtml}</div>`;
        }
        let input;
        if (fd.type === 'select') {
            input = `<select id="${id}" data-f="${fd.id}"><option value="">—</option>${optionsOf(fd).map(o => `<option value="${esc(o.v)}"${o.v === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
        } else if (fd.type === 'textarea') {
            input = `<textarea id="${id}" data-f="${fd.id}" placeholder="${esc(ph)}">${esc(v)}</textarea>`;
        } else {
            const list = val(fd.list, d);
            input = `<input id="${id}" type="${fd.type || 'text'}" data-f="${fd.id}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off"${list ? ` list="${id}-list"` : ''}${fd.type === 'tel' ? ' inputmode="tel"' : ''}>`
                + (list ? `<datalist id="${id}-list">${list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '');
        }
        return `<div class="rp-field${fd.full ? ' full' : ''}" data-field="${fd.id}"><label for="${id}">${esc(label)}${req}</label>${input}${helpHtml}</div>`;
    }

    // ─────────────────────────── items (equipment, books) ───────────────────────────
    function itemsHtml(sec) {
        const d = data(), I = sec.items;
        const fields = I.fields.filter(shown);
        const rows = state.items.map((row, i) => {
            const flag = I.flag ? I.flag(row, d) : null;
            const cells = fields.map(fd => {
                const id = `r${i}-${fd.id}`, v = row[fd.id] == null ? '' : row[fd.id], label = val(fd.label, d), req = val(fd.required, d) ? ' *' : '';
                const input = fd.type === 'select'
                    ? `<select id="${id}" data-row-f="${i}|${fd.id}"><option value="">—</option>${optionsOf(fd).map(o => `<option value="${esc(o.v)}"${o.v === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
                    : `<input id="${id}" type="${fd.type || 'text'}" data-row-f="${i}|${fd.id}" value="${esc(v)}" placeholder="${esc(val(fd.placeholder, d) || '')}" autocomplete="off"${fd.list ? ` list="rq-list-${fd.id}"` : ''}${fd.type === 'number' ? ' min="1" inputmode="numeric"' : ''}>`;
                return `<div class="rp-field rq-c-${fd.size || 'm'}${fd.phoneFull ? ' rq-p2' : ''}"><label for="${id}">${esc(label)}${req}</label>${input}</div>`;
            }).join('');
            return `<div class="rq-row${flag ? ' flagged' : ''}" data-row="${i}">
                <div class="rq-row-head"><span class="rq-row-n">${i + 1}</span><span class="rq-row-t">${esc(row[I.titleField] || `${I.Noun} ${i + 1}`)}</span>
                    <button type="button" class="rq-row-del" data-row-del="${i}" aria-label="Remove ${esc(I.noun)} ${i + 1}"${state.items.length <= 1 ? ' hidden' : ''}>✕ Remove</button></div>
                <div class="rq-row-grid">${cells}</div>
                ${flag ? `<div class="rq-row-flag">${flag}</div>` : ''}
            </div>`;
        }).join('');
        const lists = fields.filter(fd => fd.list).map(fd => `<datalist id="rq-list-${fd.id}">${(val(fd.list, d) || []).map(o => `<option value="${esc(o)}">`).join('')}</datalist>`).join('');
        const help = val(sec.help, d);
        return `${help ? `<p class="rp-help">${help}</p>` : ''}<div class="rq-rows">${rows}</div>${lists}
            <div class="rp-row"><button type="button" class="rp-btn" data-row-add>＋ Add ${esc(I.noun)}</button></div>`;
    }
    function blankRow(sec) { const r = {}; sec.items.fields.forEach(fd => { if (fd.default != null) r[fd.id] = val(fd.default, data()); }); return r; }

    // ─────────────────────────── photos ───────────────────────────
    function photosHtml(sec) {
        const help = val(sec.help, data());
        return `${help ? `<p class="rp-help">${help}</p>` : ''}
            <div class="rq-photos" data-photos></div>
            <div class="rq-photo-add">
                <label class="rp-btn">📷 Take photo<input type="file" accept="image/*" capture="environment" hidden data-add-photo></label>
                <label class="rp-btn">Choose photos<input type="file" accept="image/*,.heic,.heif" multiple hidden data-add-photo></label>
            </div>`;
    }
    function renderPhotos() {
        const box = $('[data-photos]'); if (!box) return;
        box.innerHTML = state.photos.map((p, i) => `<div class="rq-photo">${p.thumb ? `<img src="${p.thumb}" alt="Photo ${i + 1}">` : '<div class="busy">Preparing…</div>'}<button type="button" data-photo-del="${p.id}" aria-label="Remove photo ${i + 1}">✕</button></div>`).join('');
    }
    function loadImage(file) {
        return new Promise((res, rej) => {
            const url = URL.createObjectURL(file), img = new Image();
            img.onload = () => res({ img, url });
            img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('not an image this browser can read')); };
            img.src = url;
        });
    }
    const toBlob = (cv, q) => new Promise(r => cv.toBlob(r, 'image/jpeg', q));
    const toB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); });
    function scaled(img, max) {
        const w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, max / Math.max(w, h));
        const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        return cv;
    }
    async function addPhotos(files) {
        for (const f of Array.from(files || [])) {
            const p = { id: uid(), name: f.name };
            state.photos.push(p); renderPhotos();
            try {
                const { img, url } = await loadImage(f);
                p.blob = await toBlob(scaled(img, 2000), 0.82);
                const mid = scaled(img, 900); p.mid = mid.toDataURL('image/jpeg', 0.72); p.mw = mid.width; p.mh = mid.height;
                p.thumb = scaled(img, 360).toDataURL('image/jpeg', 0.7);
                URL.revokeObjectURL(url);
            } catch (e) {
                state.photos.splice(state.photos.indexOf(p), 1);
                toast(`${f.name}: ${e.message}`);
            }
            renderPhotos();
        }
        changed();
    }
    const photoBytes = () => state.photos.reduce((a, p) => a + (p.blob ? p.blob.size : 0), 0);

    // ─────────────────────────── send section ───────────────────────────
    function recipients() {
        const seen = new Set(), out = [];
        (C.notify || ['sergeants', 'command']).forEach(k => (STAFF[k] || []).forEach(p => { if (!seen.has(p.email)) { seen.add(p.email); out.push(p); } }));
        return out;
    }
    function signHtml(sec) {
        const d = data();
        const groups = (C.notify || ['sergeants', 'command']).map(k => `<b>${esc((STAFF.labels || {})[k] || k)}</b> (${(STAFF[k] || []).map(p => esc(p.name)).join(', ')})`).join(' and ');
        return `<div class="rq-summary" data-summary></div>
            <div class="rq-to">When you submit, this is emailed to ${groups} with a PDF copy${state.photos.length || C.sections.some(s => s.type === 'photos') ? ' and any photos' : ''}.</div>
            ${sec.ack ? `<label class="rq-check rq-ack"><input type="checkbox" data-ack${state.f._ack ? ' checked' : ''}><span data-ack-text>${esc(val(sec.ack, d))}</span></label>` : ''}
            ${sec.signature ? `<div class="rp-field full" style="margin-top:14px"><span class="rp-label">Signature *</span>
                <div class="rp-sig" id="sig-box"><canvas id="sig"></canvas><span class="hint" id="sig-hint">Sign here</span></div>
                <div class="rp-row" style="margin-top:8px"><button type="button" class="rp-btn" id="sig-clear">Clear</button><button type="button" class="rp-btn" id="sig-undo">Undo</button></div></div>` : ''}`;
    }
    function renderSummary() {
        const box = $('[data-summary]'); if (!box) return;
        const d = data(), rows = (C.summary ? C.summary(d) : []).filter(Boolean), st = C.status ? C.status(d) : null;
        box.innerHTML = (st ? `<div class="rq-status ${st.tone}">${esc(st.text)}</div>` : '')
            + (rows.length ? `<div class="rq-sumgrid">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v || '—')}</b></div>`).join('')}</div>` : '');
        const sec = C.sections.find(s => s.type === 'sign'), at = $('[data-ack-text]');
        if (at && sec && sec.ack) at.textContent = val(sec.ack, d);
    }

    // ─────────────────────────── open checkouts (this device) ───────────────────────────
    const openKey = () => `cfdOpen.${C.id}`;
    function openList() { try { return JSON.parse(localStorage.getItem(openKey()) || '[]'); } catch (e) { return []; } }
    function setOpenList(l) { try { localStorage.setItem(openKey(), JSON.stringify(l)); } catch (e) { } }
    function openHtml() {
        const list = openList();
        if (!list.length) return `<div class="rq-open-empty">Nothing is checked out from this device. If it was checked out on another phone or computer, type the checkout number below — it's on the checkout email and PDF.</div>`;
        const today = isoDay();
        return `<div class="rq-open"><div class="rp-label">Checked out from this device — tap one to return it</div>${list.map((o, i) => {
            const late = daysBetween(o.due, today);
            const due = late > 0 ? `<span class="late">${late} day${late === 1 ? '' : 's'} overdue</span>` : `due ${esc(dayLabel(o.due))}`;
            const picked = state.f.checkoutRef === o.ref;
            return `<button type="button" class="rq-open-row${picked ? ' picked' : ''}${late > 0 ? ' overdue' : ''}" data-open="${i}">
                <span class="what">${esc(o.items.map(it => (it.qty && +it.qty > 1 ? it.qty + ' × ' : '') + (it.name || '')).join(', '))}</span>
                <span class="who">${esc(o.ref)} · ${esc(o.name)} · out ${esc(dayLabel(o.date))} · ${due}</span>
                <span class="go">${picked ? '✓ Returning' : 'Return'}</span></button>`;
        }).join('')}</div>`;
    }

    // ─────────────────────────── build ───────────────────────────
    function sectionBody(sec) {
        if (sec.type === 'items') return itemsHtml(sec);
        if (sec.type === 'photos') return photosHtml(sec);
        if (sec.type === 'sign') return signHtml(sec);
        const d = data(), help = val(sec.help, d);
        const mode = sec.modes ? `<div class="rq-modes" role="radiogroup" aria-label="Check out or return">${C.modes.map(m => `<label class="rq-mode"><input type="radio" name="rq-mode" value="${m.v}"${m.v === state.mode ? ' checked' : ''}><span><i aria-hidden="true">${m.icon || ''}</i><b>${esc(m.label)}</b><small>${esc(m.note || '')}</small></span></label>`).join('')}</div>` : '';
        const open = sec.modes && C.track && state.mode === C.track.returnMode ? openHtml() : '';
        const fields = (sec.fields || []).filter(shown);
        return `${help ? `<p class="rp-help">${help}</p>` : ''}${mode}${open}
            ${fields.length ? `<div class="rp-grid"${mode ? ' style="margin-top:16px"' : ''}>${fields.map(fieldHtml).join('')}</div>` : ''}`;
    }
    function renderSection(sec) {
        const el = $('#s-' + sec.id); if (!el) return;
        const d = data();
        el.hidden = !shown(sec);
        $('h2', el).textContent = val(sec.title, d);
        $('.sub', el).textContent = val(sec.sub, d) || '';
        if (sec.type === 'sign') return;              // the signature canvas stays put
        $('.rp-card-body', el).innerHTML = sectionBody(sec);
        if (sec.type === 'photos') renderPhotos();
    }
    function renderAll() { C.sections.forEach(renderSection); renderSteps(); changed(); }

    function build() {
        document.title = `Centerville FD — ${C.title}`;
        const d = data();
        const cards = C.sections.map(sec => `<section class="rp-card" id="s-${sec.id}"${shown(sec) ? '' : ' hidden'}>
            <button type="button" class="rp-card-head" data-toggle>
                <span class="num"></span>
                <span><h2>${esc(val(sec.title, d))}</h2><div class="sub">${esc(val(sec.sub, d) || '')}</div></span>
                <span class="meta" data-meta></span><span class="chev">▼</span>
            </button>
            <div class="rp-card-body">${sectionBody(sec)}</div></section>`).join('');
        document.body.innerHTML = `
            <header class="rp-header"><div class="rp-header-inner">
                <img src="${A.PATCH_IMG || ''}" alt="CFD Training Division">
                <div><div class="rp-dept">Centerville Fire Department</div><div class="rp-title">${esc(C.title)}</div></div>
                <a class="home" href="../">← Home</a>
            </div></header>
            <nav class="rp-steps"><div class="rp-steps-inner" id="steps"></div></nav>
            <main class="rp-main">${C.intro ? `<p class="rq-intro">${C.intro}</p>` : ''}<form id="rqForm" autocomplete="off" novalidate>${cards}</form></main>
            <div class="rp-motto">Punctual · Valuable · Selfless</div>
            <div class="rp-actions"><div class="rp-actions-inner">
                <span class="rp-saved" id="saved"></span>
                <button type="button" class="rp-btn" id="btn-clear">Clear</button>
                <button type="button" class="rp-btn dl" id="btn-download">Download PDF</button>
                <button type="button" class="rp-btn primary" id="btn-submit">Submit</button>
            </div></div>
            <div class="rp-modal-back" id="modal"><div class="rp-modal" role="dialog" aria-modal="true"></div></div>
            <div class="rp-toast" id="toast" role="status"></div>`;
    }
    function renderSteps() {
        const d = data(), vis = C.sections.filter(shown);
        $('#steps').innerHTML = vis.map((sec, i) => `<a class="rp-step" href="#s-${sec.id}" data-step="s-${sec.id}"><span class="n">${i + 1}</span>${esc(val(sec.step || sec.title, d))}</a>`).join('');
        vis.forEach((sec, i) => { $('.num', $('#s-' + sec.id)).textContent = i + 1; });
    }

    // ─────────────────────────── signature ───────────────────────────
    function setupSignature() {
        const canvas = $('#sig'); if (!canvas || !window.SignaturePad) return;
        pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)', penColor: '#1e3a8a' });
        pad.addEventListener('beginStroke', () => { state.sig = true; $('#sig-hint').hidden = true; });
        pad.addEventListener('endStroke', () => changed());
        const resize = () => {
            if (!canvas.offsetWidth) return;
            const dd = pad.toData(), r = Math.max(window.devicePixelRatio || 1, 1);
            canvas.width = canvas.offsetWidth * r; canvas.height = canvas.offsetHeight * r;
            canvas.getContext('2d').scale(r, r); pad.clear();
            if (dd && dd.length) pad.fromData(dd);
        };
        window.addEventListener('resize', resize); resize();
        $('#sig-clear').onclick = () => { pad.clear(); state.sig = false; $('#sig-hint').hidden = false; changed(); };
        $('#sig-undo').onclick = () => { const dd = pad.toData(); dd.pop(); pad.fromData(dd); if (!dd.length) { state.sig = false; $('#sig-hint').hidden = false; } changed(); };
        state.resizeSig = resize;
    }

    // ─────────────────────────── validation & progress ───────────────────────────
    const blank = v => v == null || v === false || String(v).trim() === '';
    function problems() {
        const d = data(), out = [];
        C.sections.filter(shown).forEach(sec => {
            const step = 's-' + sec.id;
            (sec.fields || []).filter(shown).forEach(fd => {
                if (fd.type === 'note') return;
                const v = state.f[fd.id];
                if (val(fd.required, d) && blank(v)) out.push({ label: val(fd.label, d), target: '#f-' + fd.id, step });
                const msg = fd.check && fd.check(v, d); if (msg) out.push({ label: msg, target: '#f-' + fd.id, step });
            });
            if (sec.type === 'items') {
                const I = sec.items;
                if (!state.items.length) out.push({ label: `Add at least one ${I.noun}`, target: '#s-' + sec.id, step });
                state.items.forEach((row, i) => I.fields.filter(shown).forEach(fd => {
                    if (val(fd.required, d) && blank(row[fd.id])) out.push({ label: `${I.Noun} ${i + 1}: ${val(fd.label, d).toLowerCase()}`, target: `#r${i}-${fd.id}`, step });
                }));
            }
            if (sec.type === 'photos') {
                if (photoBytes() > MAX_TOTAL) out.push({ label: `Photos total ${fmtSize(photoBytes())} — remove some (limit ${fmtSize(MAX_TOTAL)})`, target: '#s-' + sec.id, step });
                if (state.photos.some(p => !p.blob)) out.push({ label: 'Photos are still being prepared — wait a moment', target: '#s-' + sec.id, step });
            }
            if (sec.type === 'sign') {
                if (sec.ack && !state.f._ack) out.push({ label: 'Check the box to agree', target: '[data-ack]', step });
                if (sec.signature && !state.sig) out.push({ label: 'Signature', target: '#sig-box', step });
            }
        });
        return out;
    }
    function updateProgress() {
        const probs = problems(), by = {};
        probs.forEach(p => by[p.step] = (by[p.step] || 0) + 1);
        // The last step is only done when the whole form is ready to send.
        const sendStep = 's-' + (C.sections.find(s => s.type === 'sign') || {}).id;
        const left = step => step === sendStep ? probs.length : (by[step] || 0);
        $$('[data-step]').forEach(a => a.classList.toggle('done', !left(a.dataset.step)));
        C.sections.forEach(sec => {
            const m = $(`#s-${sec.id} [data-meta]`); if (!m) return;
            const n = left('s-' + sec.id);
            m.className = 'meta' + (n ? '' : ' ok'); m.textContent = n ? `${n} to go` : ('s-' + sec.id === sendStep ? '✓ Ready' : '✓');
        });
        const btn = $('#btn-submit'); if (!btn.disabled) btn.textContent = val(C.submitLabel, data()) || 'Submit';
    }
    function goTo(target, step) {
        const sec = document.getElementById(step); if (sec) sec.classList.remove('collapsed');
        const el = $(target) || sec; if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('rp-invalid'); setTimeout(() => el.classList.remove('rp-invalid'), 2400);
        if (el.focus && /INPUT|SELECT|TEXTAREA/.test(el.tagName)) el.focus({ preventScroll: true });
    }

    // ─────────────────────────── drafts ───────────────────────────
    function save() {
        try {
            localStorage.setItem(C.storageKey, JSON.stringify({ v: 1, mode: state.mode, f: state.f, items: state.items, ref: state.ref, savedAt: Date.now() }));
            $('#saved').textContent = 'Draft saved ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        } catch (e) { }
    }
    function restore() {
        let d = null;
        try { d = JSON.parse(localStorage.getItem(C.storageKey) || 'null'); } catch (e) { }
        if (!d || d.v !== 1) return false;
        if (C.modes && C.modes.some(m => m.v === d.mode)) state.mode = d.mode;
        state.f = d.f || {};
        if (Array.isArray(d.items) && d.items.length) state.items = d.items;
        if (d.ref) state.ref = d.ref;
        return true;
    }
    function changed() {
        state.sent = false;
        renderSummary();
        updateProgress();
        clearTimeout(state.saveTimer); state.saveTimer = setTimeout(save, 350);
    }
    function defaults() {
        allFields().forEach(fd => { if (fd.default != null && blank(state.f[fd.id])) state.f[fd.id] = val(fd.default, data()); });
    }

    // ─────────────────────────── modal & toast ───────────────────────────
    function modal(kind, title, html, buttons) {
        const back = $('#modal'), box = $('.rp-modal', back);
        box.className = 'rp-modal ' + (kind || '');
        box.innerHTML = `<div class="rp-modal-body"><h3>${esc(title)}</h3>${html}</div><div class="rp-modal-foot"></div>`;
        (buttons || [{ t: 'Close' }]).forEach(b => {
            const btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'rp-btn' + (b.primary ? ' primary' : ''); btn.textContent = b.t;
            btn.onclick = () => { closeModal(); b.fn && b.fn(); };
            $('.rp-modal-foot', box).appendChild(btn);
        });
        back.classList.add('open');
    }
    const closeModal = () => $('#modal').classList.remove('open');
    function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); }
    function showProblems(list, verb) {
        modal('warn', 'A few things still need filling in', `<p>Before you can ${verb}:</p><ul>${list.slice(0, 14).map((p, i) => `<li><a href="#" data-go="${i}">${esc(p.label)}</a></li>`).join('')}${list.length > 14 ? `<li>…and ${list.length - 14} more</li>` : ''}</ul>`,
            [{ t: 'Take me to the first one', primary: true, fn: () => goTo(list[0].target, list[0].step) }, { t: 'Close' }]);
        $$('[data-go]', $('#modal')).forEach(a => a.onclick = e => { e.preventDefault(); closeModal(); const p = list[+a.dataset.go]; goTo(p.target, p.step); });
    }

    // ─────────────────────────── display values ───────────────────────────
    function display(fd, v) {
        if (v == null || v === '' || v === false) return '';
        if (fd.type === 'check') return 'Yes';
        if (fd.type === 'date') return dayLabel(v);
        if (fd.type === 'chips' || fd.type === 'select') { const o = optionsOf(fd).find(x => x.v === v); return o ? o.label : String(v); }
        return String(v);
    }
    function visibleFields(sec) {
        const d = data();
        return (sec.fields || []).filter(shown).filter(fd => fd.type !== 'note').map(fd => ({ fd, label: val(fd.pdfLabel || fd.label, d), value: display(fd, state.f[fd.id]) }));
    }

    // ─────────────────────────── PDF ───────────────────────────
    const pdfText = s => String(s == null ? '' : s).replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/→/g, '->').replace(/×/g, 'x').replace(/[–—]/g, '-').replace(/[☀-➿]️?/g, '').trim();

    function buildPDF() {
        const d = data();
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
        const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 14, PW = W - 2 * M;
        const SLATE = [44, 62, 80], RED = [183, 28, 28], INK = [34, 39, 46], DIM = [107, 112, 121], LINE = [223, 220, 212], SOFT = [243, 242, 238];
        const head = C.pdfHeader(d);
        let y = 0;
        const font = (st, sz, col) => { pdf.setFont('helvetica', st); pdf.setFontSize(sz); pdf.setTextColor(...(col || INK)); };
        const need = hh => { if (y + hh > H - 18) { pdf.addPage(); slim(); } };
        function top() {
            pdf.setFillColor(...SLATE); pdf.rect(0, 0, W, 38, 'F'); pdf.setFillColor(...RED); pdf.rect(0, 38, W, 1.8, 'F');
            try { pdf.addImage(A.PATCH_IMG, 'PNG', M, 5, 28, 28, 'patch', 'FAST'); } catch (e) { }
            font('bold', 9, [255, 255, 255]); pdf.text('CENTERVILLE FIRE DEPARTMENT', M + 34, 12);
            font('bold', 16, [255, 255, 255]); pdf.text(pdfText(head.title), M + 34, 21);
            font('normal', 11, [255, 170, 160]); pdf.text(pdf.splitTextToSize(pdfText(head.line), W - M - (M + 34))[0] || '', M + 34, 29);
            y = 46;
        }
        function slim() {
            pdf.setFillColor(...SLATE); pdf.rect(0, 0, W, 16, 'F'); pdf.setFillColor(...RED); pdf.rect(0, 16, W, 1.2, 'F');
            font('bold', 9.5, [255, 255, 255]); pdf.text(pdfText(head.title), M, 10);
            font('normal', 9.5, [255, 190, 180]); pdf.text(pdfText(head.ref || ''), W - M, 10, { align: 'right' });
            y = 24;
        }
        function heading(t) {
            need(16); font('bold', 10.5, RED); pdf.text(pdfText(t).toUpperCase(), M, y + 4);
            pdf.setDrawColor(...RED); pdf.setLineWidth(0.5); pdf.line(M, y + 6.2, M + PW, y + 6.2); y += 10;
        }
        function grid(rows) {
            // pairs share a line; long answers take the whole width
            const lines = []; let pend = null;
            rows.forEach(r => { if (r.full) { if (pend) { lines.push([pend]); pend = null; } lines.push([r]); } else if (pend) { lines.push([pend, r]); pend = null; } else pend = r; });
            if (pend) lines.push([pend]);
            lines.forEach(line => {
                const cw = line.length === 1 && line[0].full ? PW : PW / 2 - 3;
                const wrapped = line.map(r => pdf.splitTextToSize(pdfText(r.value) || '—', cw));
                const hh = Math.max(...wrapped.map(w => w.length)) * 4.3 + 7.5; need(hh);
                line.forEach((r, j) => {
                    const x = M + j * (PW / 2);
                    font('bold', 6.8, DIM); pdf.text(pdfText(r.label).toUpperCase(), x, y + 3);
                    font('normal', 9.8, INK); pdf.text(wrapped[j], x, y + 7.6);
                });
                y += hh;
            });
        }
        function table(sec) {
            const I = sec.items, cols = I.fields.filter(shown).map(fd => ({ fd, label: val(fd.label, d), w: fd.pdfW || 1 }));
            const nW = 7, tot = cols.reduce((a, c) => a + c.w, 0);
            cols.forEach(c => c.mm = (PW - nW) * c.w / tot);
            const headRow = () => {
                need(9); pdf.setFillColor(...SOFT); pdf.rect(M, y, PW, 7, 'F');
                font('bold', 6.6, DIM); let x = M + nW;
                pdf.text('#', M + 1.8, y + 4.7);
                cols.forEach(c => { pdf.text(pdf.splitTextToSize(pdfText(c.label).toUpperCase(), c.mm - 2.4)[0], x + 1.2, y + 4.7); x += c.mm; });
                y += 7;
            };
            headRow();
            state.items.forEach((row, i) => {
                const flag = I.flag ? plain(I.flag(row, d)) : '';
                font('normal', 9.2);
                const cells = cols.map(c => pdf.splitTextToSize(pdfText(display(c.fd, row[c.fd.id])) || '—', c.mm - 2.4));
                const flagLines = flag ? pdf.splitTextToSize(pdfText(flag), PW - nW - 3) : [];
                const body = Math.max(...cells.map(x => x.length)) * 4.1 + 4;
                const hh = body + (flagLines.length ? flagLines.length * 3.8 + 1.5 : 0);
                if (y + hh > H - 18) { pdf.addPage(); slim(); headRow(); }
                if (flag) { pdf.setFillColor(253, 236, 234); pdf.rect(M, y, PW, hh, 'F'); }
                font('bold', 9.2, INK); pdf.text(String(i + 1), M + 1.8, y + 5);
                let x = M + nW;
                cells.forEach((lines, j) => {
                    const hot = flag && cols[j].fd.id === I.flagField;
                    font(j === 0 || hot ? 'bold' : 'normal', 9.2, hot ? TONES.bad : INK); pdf.text(lines, x + 1.2, y + 5); x += cols[j].mm;
                });
                if (flagLines.length) { font('bold', 8, TONES.bad); pdf.text(flagLines, M + nW + 1.2, y + body + 1.5); }
                pdf.setDrawColor(...LINE); pdf.setLineWidth(0.25); pdf.line(M, y + hh, M + PW, y + hh);
                y += hh;
            });
            y += 5;
        }
        function photos() {
            const cw = (PW - 8) / 3;
            let col = 0, rowH = 0;
            state.photos.forEach((p, i) => {
                if (!p.mid) return;
                const s = Math.min(cw / p.mw, 62 / p.mh), w = p.mw * s, h = p.mh * s;
                if (col === 0) { need(66); rowH = 0; }
                const x = M + col * (cw + 4);
                try { pdf.addImage(p.mid, 'JPEG', x + (cw - w) / 2, y, w, h, undefined, 'FAST'); } catch (e) { }
                font('normal', 7.2, DIM); pdf.text(`Photo ${i + 1}`, x + cw / 2, y + h + 3.6, { align: 'center' });
                rowH = Math.max(rowH, h + 7);
                if (++col === 3) { col = 0; y += rowH; }
            });
            if (col) y += rowH;
            y += 2;
        }

        top();
        const st = C.status ? C.status(d) : null;
        if (st || head.ref) {
            if (st) {
                font('bold', 10, [255, 255, 255]);
                const w = pdf.getTextWidth(pdfText(st.text)) + 10;
                pdf.setFillColor(...(TONES[st.tone] || TONES.info)); pdf.roundedRect(M, y, w, 8, 3, 3, 'F'); pdf.text(pdfText(st.text), M + w / 2, y + 5.5, { align: 'center' });
            }
            if (head.ref) { font('bold', 10, INK); pdf.text(pdfText(head.ref), W - M, y + 5.5, { align: 'right' }); }
            y += 14;
        }
        C.sections.filter(shown).forEach(sec => {
            if (sec.type === 'items') { if (state.items.length) { heading(val(sec.pdfTitle || sec.title, d)); table(sec); } return; }
            if (sec.type === 'photos') { if (state.photos.length) { heading(val(sec.title, d)); photos(); } return; }
            if (sec.type === 'sign') {
                if (!sec.ack && !sec.signature) return;
                heading(val(sec.pdfTitle || sec.title, d));
                if (sec.ack) {
                    font('normal', 9.6, INK);
                    const t = pdf.splitTextToSize(pdfText((state.f._ack ? '[X]  ' : '[  ]  ') + val(sec.ack, d)), PW);
                    need(t.length * 4.4 + 4); pdf.text(t, M, y + 4); y += t.length * 4.4 + 4;
                }
                if (sec.signature && pad && !pad.isEmpty()) {
                    const cv = $('#sig'), sw = 80, sh = Math.min(30, sw * cv.height / cv.width);
                    need(sh + 12);
                    try { pdf.addImage(pad.toDataURL('image/png'), 'PNG', M, y, sw, sh); } catch (e) { }
                    y += sh + 1;
                    pdf.setDrawColor(...INK); pdf.setLineWidth(0.3); pdf.line(M, y, M + 90, y);
                    font('normal', 8, DIM); pdf.text(pdfText(`${head.signer || ''}  ·  signed ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`), M, y + 4);
                    y += 9;
                }
                return;
            }
            const rows = visibleFields(sec).filter(r => r.value || val(r.fd.required, d)).map(r => ({ label: r.label, value: r.value, full: r.fd.type === 'textarea' || r.fd.type === 'chips' || r.fd.type === 'check' || r.fd.full }));
            if (!rows.length) return;
            heading(val(sec.pdfTitle || sec.title, d)); grid(rows); y += 2;
        });

        const pages = pdf.internal.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
            pdf.setPage(i);
            pdf.setDrawColor(...RED); pdf.setLineWidth(0.3); pdf.line(M, H - 13, W - M, H - 13);
            font('bold', 7.5, RED); pdf.text('PUNCTUAL · VALUABLE · SELFLESS', W / 2, H - 8.5, { align: 'center' });
            font('normal', 7.5, DIM); pdf.text(pdfText(head.ref || ''), M, H - 8.5);
            pdf.text(`Page ${i} of ${pages}`, W - M, H - 8.5, { align: 'right' });
        }
        return pdf;
    }
    const fileBase = () => C.fileBase(data()).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/_$/, '');

    function download() {
        const probs = problems();
        if (probs.length) return showProblems(probs, 'download the PDF');
        const blob = buildPDF().output('blob'), url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fileBase() + '.pdf'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // ─────────────────────────── email ───────────────────────────
    function emailHtml() {
        const d = data(), st = C.status ? C.status(d) : null, head = C.pdfHeader(d);
        const color = { bad: '#c62828', warn: '#ef6c00', ok: '#2e7d32', info: '#2c3e50' };
        const h3 = t => `<h3 style="margin:18px 0 6px;color:#b71c1c;font-size:15px">${esc(t)}</h3>`;
        const row = (k, v) => `<tr><td style="padding:4px 14px 4px 0;color:#6b7079;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v || '—').replace(/\n/g, '<br>')}</b></td></tr>`;
        const parts = C.sections.filter(shown).map(sec => {
            if (sec.type === 'items') {
                const I = sec.items, cols = I.fields.filter(shown), td = 'padding:5px 8px;border-top:1px solid #e3e0d8;vertical-align:top';
                return h3(val(sec.pdfTitle || sec.title, d)) + `<table style="border-collapse:collapse;font-size:14px;width:100%"><tr>${['#', ...cols.map(fd => val(fd.label, d))].map(t => `<th style="text-align:left;padding:5px 8px;background:#f3f2ee;color:#6b7079;font-size:12px">${esc(t)}</th>`).join('')}</tr>
                    ${state.items.map((r, i) => {
                        const fl = I.flag ? plain(I.flag(r, d)) : '';
                        return `<tr style="${fl ? 'background:#fdecea' : ''}"><td style="${td}">${i + 1}</td>${cols.map(fd => `<td style="${td}${fl && fd.id === I.flagField ? ';color:#c62828;font-weight:700' : ''}">${esc(display(fd, r[fd.id]) || '—')}</td>`).join('')}</tr>`
                            + (fl ? `<tr style="background:#fdecea"><td></td><td colspan="${cols.length}" style="padding:0 8px 6px;color:#c62828;font-weight:700;font-size:13px">${esc(fl)}</td></tr>` : '');
                    }).join('')}</table>`;
            }
            if (sec.type === 'photos' || sec.type === 'sign') return '';
            const rows = visibleFields(sec).filter(r => r.value);
            return rows.length ? h3(val(sec.pdfTitle || sec.title, d)) + `<table style="border-collapse:collapse;font-size:14px">${rows.map(r => row(r.label, r.value)).join('')}</table>` : '';
        }).join('');
        return `<div style="font-family:Arial,Helvetica,sans-serif;color:#22272e;max-width:660px">
            <h2 style="margin:0 0 4px;color:#b71c1c">${esc(head.title)}</h2>
            <div style="color:#6b7079;margin-bottom:12px">${esc(head.line)}${head.ref ? ` · ${esc(head.ref)}` : ''}</div>
            ${st ? `<div style="display:inline-block;padding:6px 12px;border-radius:6px;background:${color[st.tone] || color.info};color:#fff;font-weight:800;letter-spacing:.5px">${esc(st.text)}</div>` : ''}
            ${C.emailLead ? `<p style="margin:12px 0 0;font-size:15px">${C.emailLead(d)}</p>` : ''}
            ${parts}
            <p style="color:#6b7079;font-size:13px;margin-top:18px">PDF attached${state.photos.length ? `, with ${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}` : ''}. Sent from fdtraining.org.</p></div>`;
    }

    function submit() {
        const probs = problems();
        if (probs.length) return showProblems(probs, 'submit');
        const key = `cfdFormSent|${C.id}|${state.mode}|${state.ref}`;
        let prev = null; try { prev = localStorage.getItem(key); } catch (e) { }
        if (prev) {
            return modal('warn', 'This was already sent', `<p>This ${esc(C.noun)} (${esc(state.ref)}) was sent from this device at ${esc(new Date(+prev).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}.</p><p>Only send it again if you are correcting it.</p>`,
                [{ t: 'Cancel' }, { t: 'Send again', primary: true, fn: () => send(key) }]);
        }
        send(key);
    }

    async function send(key) {
        const btn = $('#btn-submit'); btn.disabled = true; btn.textContent = 'Sending…';
        const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 180000);
        const d = data(), to = recipients().map(p => p.email);
        try {
            const pdf = buildPDF();
            const attachments = [{ filename: fileBase() + '.pdf', content: pdf.output('datauristring').split(',')[1] }];
            for (let i = 0; i < state.photos.length; i++) attachments.push({ filename: `${fileBase()}_photo_${i + 1}.jpg`, content: await toB64(state.photos[i].blob) });
            const res = await fetch('/api/send-email', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
                body: JSON.stringify({ to, from_name: 'CFD Training Division', subject: C.subject(d), html: emailHtml(), attachments })
            });
            let result = {};
            try { result = await res.json(); } catch (e) { result = { error: 'Unreadable reply (HTTP ' + res.status + ')' }; }
            if (!res.ok || !result.success) throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error || ('HTTP ' + res.status)));
            try { localStorage.setItem(key, String(Date.now())); } catch (e) { }
            if (C.track) {
                const list = openList();
                if (state.mode === C.track.outMode) {
                    list.unshift({ ref: state.ref, name: state.f.name || '', date: state.f.date || isoDay(), due: state.f.due || '', items: state.items.map(C.track.keep) });
                    setOpenList(list.filter((o, i, a) => a.findIndex(x => x.ref === o.ref) === i).slice(0, 30));
                } else if (state.f.checkoutRef) setOpenList(list.filter(o => o.ref !== String(state.f.checkoutRef).trim()));
            }
            state.sent = true;
            const done = C.done ? C.done(d) : {};
            modal('ok', done.title || 'Sent', `<p>Emailed to ${esc(recipients().map(p => p.name).join(', '))} with the PDF${state.photos.length ? ' and photos' : ''}.</p>${done.html || ''}`,
                [{ t: 'Download PDF', fn: download }, { t: 'Start a new one', primary: true, fn: () => reset(true) }]);
        } catch (err) {
            const msg = err.name === 'AbortError' ? 'It took too long — the connection may have dropped.' : (err.message || 'Unknown error');
            modal('bad', 'STOP — this did NOT send', `<p>Nothing was lost; the form is still filled in.</p><p style="font-family:monospace;font-size:.8rem;color:#8a1c1c">${esc(msg)}</p><p>Try again, or download the PDF and send it yourself.</p>`,
                [{ t: 'Download PDF', fn: download }, { t: 'Try again', primary: true, fn: () => send(key) }]);
        } finally {
            clearTimeout(timer); btn.disabled = false; updateProgress();
        }
    }

    function reset(keepPerson) {
        const person = {};
        if (keepPerson) (C.keepOnReset || []).forEach(k => { if (state.f[k]) person[k] = state.f[k]; });
        state.f = person; state.photos = []; state.ref = newRef();
        if (C.modes) state.mode = C.modes[0].v;
        state.items = itemsSection() ? [blankRow(itemsSection())] : [];
        defaults();
        if (pad) { pad.clear(); state.sig = false; $('#sig-hint').hidden = false; }
        try { localStorage.removeItem(C.storageKey); } catch (e) { }
        renderAll();
        $('#saved').textContent = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ─────────────────────────── wire up ───────────────────────────
    function wire() {
        const form = $('#rqForm');
        form.addEventListener('click', e => {
            const headBtn = e.target.closest('[data-toggle]');
            if (headBtn) return headBtn.parentElement.classList.toggle('collapsed');
            if (e.target.closest('[data-row-add]')) {
                const sec = itemsSection(); state.items.push(blankRow(sec)); renderSection(sec); changed();
                const first = $(`[data-row="${state.items.length - 1}"] input, [data-row="${state.items.length - 1}"] select`); if (first) first.focus();
                return;
            }
            const del = e.target.closest('[data-row-del]');
            if (del) { state.items.splice(+del.dataset.rowDel, 1); renderSection(itemsSection()); return changed(); }
            const ph = e.target.closest('[data-photo-del]');
            if (ph) { state.photos.splice(state.photos.findIndex(p => p.id === ph.dataset.photoDel), 1); renderPhotos(); return changed(); }
            const open = e.target.closest('[data-open]');
            if (open) {
                const o = openList()[+open.dataset.open]; if (!o) return;
                state.f.checkoutRef = o.ref; state.f.due = o.due;
                if (blank(state.f.name)) state.f.name = o.name;
                state.items = o.items.map(r => ({ ...r }));
                renderAll();
                toast(`Returning ${o.ref} — set the condition of each one`);
                const first = $('#r0-condition'); if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
        const onField = (t, choice) => {
            if (t.name === 'rq-mode') { state.mode = t.value; renderAll(); if (state.resizeSig) state.resizeSig(); return; }
            if (t.hasAttribute('data-ack')) { state.f._ack = t.checked; return; }
            if (t.dataset.f) {
                const fd = allFields().find(x => x.id === t.dataset.f);
                state.f[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
                if (choice && fd && fd.rerender) { C.sections.forEach(s => { if (s.type !== 'items') renderSection(s); }); renderSteps(); const el = $('#f-' + fd.id); if (el && el.tagName !== 'DIV') el.focus({ preventScroll: true }); }
                return;
            }
            if (t.dataset.rowF) {
                const [i, k] = t.dataset.rowF.split('|'), sec = itemsSection();
                state.items[+i][k] = t.value;
                const fd = sec.items.fields.find(x => x.id === k);
                if (choice && fd && fd.rerender) { renderSection(sec); const el = $(`#r${i}-${k}`); if (el) el.focus({ preventScroll: true }); }
                else if (k === sec.items.titleField) { const tt = $(`[data-row="${i}"] .rq-row-t`); if (tt) tt.textContent = t.value || `${sec.items.Noun} ${+i + 1}`; }
            }
        };
        // Typing updates quietly; choices (selects, chips, boxes) may re-draw a section.
        form.addEventListener('input', e => { const t = e.target; if (t.type === 'radio' || t.type === 'checkbox' || t.tagName === 'SELECT' || t.type === 'file') return; onField(t, false); changed(); });
        form.addEventListener('change', e => {
            const t = e.target;
            if (t.hasAttribute('data-add-photo')) { addPhotos(t.files); t.value = ''; return; }
            onField(t, true); changed();
        });
        $('#btn-clear').onclick = () => modal('warn', `Clear this ${C.noun || 'form'}?`, '<p>Everything entered, photos, and the signature will be removed.</p>', [{ t: 'Keep it' }, { t: 'Clear everything', primary: true, fn: () => reset(false) }]);
        $('#btn-download').onclick = download;
        $('#btn-submit').onclick = submit;
        $('#steps').addEventListener('click', e => { const a = e.target.closest('[data-step]'); if (a) { const s = document.getElementById(a.dataset.step); if (s) s.classList.remove('collapsed'); } });
        $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
        window.addEventListener('beforeunload', e => { if (state.photos.length && !state.sent) { e.preventDefault(); e.returnValue = ''; } });
    }

    // A link can fill a form in: ../repair-request/?item=Thermal%20camera&tag=TIC-2
    function prefillFromUrl() {
        const q = new URLSearchParams(location.search), ids = new Set(allFields().map(f => f.id));
        let any = false;
        q.forEach((v, k) => {
            if (k === 'mode' && C.modes && C.modes.some(m => m.v === v)) { state.mode = v; any = true; }
            else if (ids.has(k)) { state.f[k] = v; any = true; }
        });
        if (any) try { history.replaceState(null, '', location.pathname); } catch (e) { }
        return any;
    }

    function start(config) {
        C = config;
        const go = () => {
            state.mode = C.modes ? C.modes[0].v : '';
            state.ref = newRef();
            state.items = itemsSection() ? [blankRow(itemsSection())] : [];
            const linked = new URLSearchParams(location.search).toString() !== '' && prefillFromUrl();
            const restored = !linked && restore();
            defaults();
            build();
            renderSteps();
            setupSignature();
            wire();
            changed();
            if (restored) $('#saved').textContent = 'Draft restored';
            if (linked) toast('Filled in from the link — check it over');
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
    }

    // ─────────────────────────── checkout forms ───────────────────────────
    // Equipment and books share this: check out (due date, purpose) or return
    // (condition of each). Damage or loss on return flags the email and links a
    // prefilled Repair Request.
    function checkout(o) {
        const isOut = d => d.mode === 'out';
        const bad = o.badConditions;
        const flag = (row, d) => {
            if (isOut(d) || !bad.includes(row.condition)) return null;
            let html = `${esc(row.condition)} — flagged for sergeants and command staff.`;
            if (o.repairLink && row.condition !== 'Lost') {
                const q = new URLSearchParams({ item: row.name || '', tag: row.tag || '', related: d.f.checkoutRef || '', description: `${row.condition} when returned${row.note ? ': ' + row.note : ''}` });
                html += ` <a href="../repair-request/?${q}" target="_blank" rel="noopener">File a repair request →</a>`;
            }
            return html;
        };
        const named = d => d.items.filter(r => !blank(r.name));
        const itemsText = d => named(d).map(r => (r.qty && +r.qty > 1 ? `${r.qty} × ` : '') + r.name).join(', ');
        const flagged = d => !isOut(d) && d.items.some(r => bad.includes(r.condition));
        return {
            id: o.id, title: o.title, noun: o.noun, refPrefix: o.refPrefix, storageKey: `cfd.${o.id}.v1`, intro: o.intro,
            modes: [
                { v: 'out', label: 'Check out', note: o.outNote, icon: '↗' },
                { v: 'return', label: 'Return', note: o.returnNote, icon: '↩' }
            ],
            track: { outMode: 'out', returnMode: 'return', keep: r => { const k = {}; o.itemFields.forEach(fd => { if (fd.keep) k[fd.id] = r[fd.id]; }); return k; } },
            keepOnReset: ['name', 'shift', 'phone'],
            sections: [
                {
                    id: 'who', step: 'Member', title: d => isOut(d) ? 'Checking out' : 'Returning', sub: 'Who, and when', modes: true,
                    fields: [
                        { id: 'name', label: 'Name', required: true, list: () => STAFF.roster || [], placeholder: 'Last, First' },
                        { id: 'shift', label: 'Shift', type: 'select', options: () => STAFF.shifts || [] },
                        { id: 'date', label: d => isOut(d) ? 'Date out' : 'Date returned', type: 'date', required: true, default: () => isoDay() },
                        { id: 'due', label: 'Due back', type: 'date', required: true, show: isOut, default: () => isoDay(o.dueDays),
                          check: (v, d) => v && d.f.date && daysBetween(d.f.date, v) < 0 ? 'Due back can’t be before the date out' : null,
                          help: `Standard loan is ${o.dueDays} days.` },
                        { id: 'checkoutRef', label: 'Checkout number', show: d => !isOut(d), placeholder: `${o.refPrefix}-${isoDay().replace(/-/g, '')}-XXXX`,
                          help: 'Tap it in the list above, or copy it from the checkout email. Leave it blank if you don’t have it.' },
                        { id: 'phone', label: 'Phone', type: 'tel', placeholder: 'Optional' }
                    ]
                },
                {
                    id: 'use', step: 'Purpose', title: 'What it’s for', sub: o.useSub, show: isOut,
                    fields: [
                        { id: 'purpose', label: 'Purpose', type: 'chips', required: true, options: o.purposes },
                        ...(o.useFields || []),
                        { id: 'details', label: 'Details', type: 'textarea', full: true, placeholder: o.detailsPlaceholder }
                    ]
                },
                {
                    id: 'items', type: 'items', step: o.stepItems, pdfTitle: o.stepItems,
                    title: d => isOut(d) ? o.itemsOutTitle : o.itemsReturnTitle,
                    sub: d => isOut(d) ? o.itemsOutSub : 'The condition of each one as it comes back',
                    help: d => isOut(d) ? o.itemsOutHelp : 'Anything damaged, missing parts, or lost is flagged for sergeants and command staff.',
                    items: {
                        noun: o.itemNoun, Noun: o.itemNoun[0].toUpperCase() + o.itemNoun.slice(1), titleField: 'name', flag, flagField: 'condition',
                        fields: [
                            ...o.itemFields,
                            { id: 'condition', label: d => isOut(d) ? 'Condition out' : 'Condition returned', type: 'select', required: true, rerender: true, size: 'm', phoneFull: true, pdfW: 1.1,
                              options: d => isOut(d) ? o.outConditions : o.returnConditions },
                            { id: 'note', label: 'Notes', size: 'm', phoneFull: true, pdfW: 1.6, placeholder: d => isOut(d) ? 'Anything already wrong with it' : 'What’s wrong or missing' }
                        ]
                    }
                },
                { id: 'photos', type: 'photos', step: 'Photos', title: 'Photos', sub: 'Optional',
                  help: d => isOut(d) ? 'A quick photo of its condition now protects you when it comes back.' : 'Photograph any damage or missing parts.' },
                { id: 'sign', type: 'sign', step: 'Sign', title: d => isOut(d) ? 'Agree & sign' : 'Sign', sub: 'Then submit', pdfTitle: 'Acknowledgement', signature: true,
                  ack: d => isOut(d) ? o.outAck : o.returnAck }
            ],
            summary: d => isOut(d)
                ? [[o.stepItems, String(named(d).length || '')], ['Checkout number', d.ref], ['Due back', dayLabel(d.f.due)]]
                : [['Returning', String(named(d).length || '')], ['Checkout number', d.f.checkoutRef || ''], ['Flagged', String(d.items.filter(r => bad.includes(r.condition)).length)]],
            status: d => {
                if (isOut(d)) return { text: 'CHECKED OUT', tone: 'info' };
                if (flagged(d)) return { text: 'RETURNED — DAMAGE OR LOSS', tone: 'bad' };
                const late = d.f.due && d.f.date ? daysBetween(d.f.due, d.f.date) : null;
                return late > 0 ? { text: `RETURNED ${late} DAY${late === 1 ? '' : 'S'} LATE`, tone: 'warn' } : { text: 'RETURNED', tone: 'ok' };
            },
            submitLabel: d => isOut(d) ? 'Submit Checkout' : 'Submit Return',
            pdfHeader: d => ({
                title: `${o.title} — ${isOut(d) ? 'Check Out' : 'Return'}`,
                line: `${d.f.name || ''}  ·  ${isOut(d) ? `out ${dayLabel(d.f.date)}  ·  due ${dayLabel(d.f.due)}` : `returned ${dayLabel(d.f.date)}`}`,
                ref: isOut(d) ? d.ref : (d.f.checkoutRef || ''), signer: d.f.name
            }),
            fileBase: d => `${o.fileWord}_${isOut(d) ? 'Checkout' : 'Return'}_${(isOut(d) ? d.ref : d.f.checkoutRef) || d.f.date}_${d.f.name || ''}`,
            subject: d => isOut(d)
                ? `${o.title} ${d.ref}: ${itemsText(d)} — ${d.f.name} (due ${dayLabel(d.f.due)})`
                : `${flagged(d) ? '⚠ ' : ''}${o.returnedWord}${d.f.checkoutRef ? ' ' + d.f.checkoutRef : ''}: ${itemsText(d)} — ${d.f.name}${flagged(d) ? ' — damage or loss reported' : ''}`,
            emailLead: d => isOut(d)
                ? `<b>${esc(d.f.name)}</b> checked out ${esc(itemsText(d))}, due back <b>${esc(dayLabel(d.f.due))}</b>.`
                : `<b>${esc(d.f.name)}</b> returned ${esc(itemsText(d))}.${flagged(d) ? ' <b style="color:#c62828">Damage or loss was reported — see below.</b>' : ''}`,
            done: d => isOut(d)
                ? { title: 'Checked out', html: `<p>Checkout number <b>${esc(d.ref)}</b>. When you bring ${o.pronoun} back, open this form and choose <b>Return</b> — this device will list it.</p>` }
                : { title: 'Return recorded', html: flagged(d) ? `<p><b>Damage or loss was flagged.</b>${o.repairLink ? ' If it needs fixing, use the “File a repair request” link on that item.' : ''}</p>` : '' }
        };
    }

    window.CFDForm = { start, checkout, isoDay, dayLabel, daysBetween, esc, state, problems, buildPDF, emailHtml, recipients, addPhotos, submit, data, openList, get config() { return C; } };
})();
