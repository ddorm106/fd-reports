/* PPE Gear Inspection — Centerville FD
 *
 * The digital copy of the department's "Personal Protective Equipment
 * Inspection Form" (three pages: pants, jackets, accessories). Every field on
 * the paper form, plus: tap the garment drawings to mark where damage is,
 * photos per item, NFPA 1851's ten-year retirement check, and gear that is
 * out of service is TAGGED — a numbered red tag prints on the PDF and the
 * email goes to command staff as well as Training.
 *
 * Page: gear-inspection/index.html (window.GEAR_CONFIG). Drawings:
 * views.js. Styles: ../monthly/report.css + gear.css.
 */
(function () {
    'use strict';

    const C = window.GEAR_CONFIG;
    const VIEWS = window.CFD_GEAR_VIEWS || {};
    const A = window.CFD_REPORT_ASSETS || {};
    const MB = 1024 * 1024;
    const MAX_TOTAL = 28 * MB;          // Resend's 40 MB per email, after base64
    const VIEW_NAMES = [['front', 'Front'], ['back', 'Back'], ['front-inside', 'Front (inside out)'], ['back-inside', 'Back (inside out)']];
    const viewsOf = layer => layer.viewList || VIEW_NAMES;
    // What a mark on a drawing means. The icon is placed where the damage is.
    const DAMAGE = [
        { id: 'hole', label: 'Hole', rgb: [183, 28, 28] },
        { id: 'tear', label: 'Tear', rgb: [198, 40, 40] },
        { id: 'burn', label: 'Burn', rgb: [230, 81, 0] },
        { id: 'abrasion', label: 'Abrasion / wear', rgb: [109, 76, 65] },
        { id: 'contamination', label: 'Contamination', rgb: [106, 27, 154] },
        { id: 'other', label: 'Other', rgb: [69, 90, 100] }
    ];
    const dmg = id => DAMAGE.find(d => d.id === id) || DAMAGE[DAMAGE.length - 1];
    const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
    // Small SVG icons, the same shapes the PDF draws.
    function damageIcon(id, size = 22) {
        const c = hex(dmg(id).rgb);
        const body = {
            hole: `<circle cx="12" cy="12" r="9" fill="${c}"/><circle cx="12" cy="12" r="4.2" fill="#fff"/>`,
            tear: `<circle cx="12" cy="12" r="11" fill="#fff" stroke="${c}" stroke-width="1.5"/><path d="M4 15 L8 8 L11 15 L14 8 L17 15 L20 9" fill="none" stroke="${c}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`,
            burn: `<path d="M12 2 C14 7 19 9 19 15 C19 19.5 15.8 22 12 22 C8.2 22 5 19.5 5 15 C5 11.5 7.5 10 8.5 7 C10 9 10.5 10.5 10.5 12 C12 10 12.5 6 12 2 Z" fill="${c}"/><path d="M12 13 C13.5 15 15 16 15 18 C15 19.8 13.7 21 12 21 C10.3 21 9 19.8 9 18 C9 16.5 10.5 15.5 12 13 Z" fill="#ffb74d"/>`,
            abrasion: `<circle cx="12" cy="12" r="10" fill="#fff" stroke="${c}" stroke-width="2"/><path d="M6 14 L14 6 M7 18 L18 7 M11 19 L19 11" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
            contamination: `<path d="M12 2 C15 7 19 11 19 15.5 C19 19.4 15.9 22 12 22 C8.1 22 5 19.4 5 15.5 C5 11 9 7 12 2 Z" fill="${c}"/><circle cx="9.5" cy="15.5" r="1.8" fill="#fff" opacity=".7"/>`,
            other: `<circle cx="12" cy="12" r="10" fill="${c}"/><path d="M12 6.5 L12 13.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.6" fill="#fff"/>`
        }[dmg(id).id];
        return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
    }
    // Needs repair and Retire take the item out of service: tagged, and command staff are told.
    const CONDITIONS = [
        { v: 'Serviceable', note: 'OK to wear' },
        { v: 'Needs cleaning', note: 'advanced clean' },
        { v: 'Needs repair', note: 'out of service', oos: true },
        { v: 'Retire', note: 'out of service', oos: true }
    ];
    const isOOS = v => !!(CONDITIONS.find(c => c.v === v) || {}).oos;

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const uid = () => Math.random().toString(36).slice(2, 10);
    const fmtSize = b => b >= MB ? (b / MB).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

    // item state: { notIssued, fields{mfr,serial,mfgDate,size,issued,comments,reason}, condition, pins[], photos[] }
    const state = { items: {}, general: [], sigSource: null, sent: false, saveTimer: null };
    C.items.forEach(it => state.items[it.id] = { notIssued: false, condition: '', fields: {}, pins: [], photos: [] });
    let pad = null;
    const drag = { on: null, justMoved: false };

    // ─────────────────────────── dates ───────────────────────────
    function todayIso() {
        const t = new Date();
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    }
    function dayLabel(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
        return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : (iso || '');
    }
    function monthLabel(v) {
        const m = /^(\d{4})-(\d{1,2})/.exec(v || '');
        return m ? new Date(+m[1], +m[2] - 1, 15).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : (v || '');
    }
    // NFPA 1851: structural ensemble elements are retired ten years from their date of manufacture.
    function yearsSince(mfg, onIso) {
        const m = /^(\d{4})-(\d{1,2})/.exec(mfg || ''), d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(onIso || todayIso());
        if (!m || !d) return null;
        return ((+d[1] - +m[1]) * 12 + (+d[2] - +m[2])) / 12;
    }

    function tagNumber(itemIndex) {
        const d = ($('#g-date') || {}).value || todayIso();
        const who = (($('#g-member') || {}).value || 'XX').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'XX';
        return `PPE-${d.replace(/-/g, '')}-${who}-${String(itemIndex + 1).padStart(2, '0')}`;
    }

    // ─────────────────────────── build ───────────────────────────
    function card(id, num, title, sub, body, extraClass, headExtra) {
        return `<section class="rp-card ${extraClass || ''}" id="${id}">
            <button type="button" class="rp-card-head" data-toggle>
                <span class="num">${num}</span>
                <span><h2>${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</span>
                ${headExtra || '<span class="meta" data-meta></span>'}
                <span class="chev">▼</span>
            </button>
            <div class="rp-card-body">${body}</div>
        </section>`;
    }

    function photoBlock(scope) {
        return `<div class="rp-label" style="margin-top:14px">Photos</div>
            <div class="gi-photos" data-photos="${scope}"></div>
            <div class="gi-photo-add">
                <label class="rp-btn">📷 Take photo<input type="file" accept="image/*" capture="environment" hidden data-add-photo="${scope}"></label>
                <label class="rp-btn">Choose photos<input type="file" accept="image/*,.heic,.heif" multiple hidden data-add-photo="${scope}"></label>
            </div>`;
    }

    function itemCard(it, i, n) {
        const sizeLabel = it.sizeLabel || 'Size';
        const cond = CONDITIONS.map(c => `<label><input type="radio" name="cond-${it.id}" value="${esc(c.v)}"><span>${esc(c.v)}<small>${esc(c.note)}</small></span></label>`).join('');
        const map = (it.layers || []).map(l => {
            const vl = viewsOf(l);
            return `
            <div class="gi-map-title">${esc(l.title)}</div>
            <div class="gi-views n${vl.length}">${vl.map(([vk, vn]) => {
                const v = VIEWS[`${l.views}--${vk}`];
                return `<figure class="gi-fig"><div class="gi-view" data-view="${l.id}|${vk}" data-item="${it.id}" role="button" aria-label="${esc(l.title + ' ' + vn)}: tap to mark damage">
                    ${v ? `<img src="${v.src}" alt="" draggable="false">` : ''}</div><figcaption>${esc(vn)}</figcaption></figure>`;
            }).join('')}</div>`;
        }).join('');
        const tools = `<div class="gi-tools" role="radiogroup" aria-label="Type of damage to place">
            <span class="rp-label">Mark damage</span>
            ${DAMAGE.map((d, di) => `<label class="gi-tool"><input type="radio" name="dmg-${it.id}" value="${d.id}"${di === 0 ? ' checked' : ''}><span>${damageIcon(d.id, 20)}${esc(d.label)}</span></label>`).join('')}
        </div>`;
        const body = `
            <div class="gi-ni-row">
                <label class="gi-ni"><input type="checkbox" data-not-issued="${it.id}"> Not issued / not inspected</label>
            </div>
            <div class="rp-grid">
                <div class="rp-field"><label>Manufacturer / Model</label><input data-f="mfr" data-item="${it.id}" autocomplete="off"></div>
                <div class="rp-field"><label>Serial / Lot Number</label><input data-f="serial" data-item="${it.id}" autocomplete="off"></div>
                <div class="rp-field"><label>Date of Mfgr</label><input type="month" data-f="mfgDate" data-item="${it.id}" placeholder="YYYY-MM"></div>
                <div class="rp-field"><label>${esc(sizeLabel)}</label><input data-f="size" data-item="${it.id}" autocomplete="off"></div>
                <div class="rp-field"><label>Date Issued</label><input type="date" data-f="issued" data-item="${it.id}"></div>
            </div>
            <div class="rp-label" style="margin-top:14px">Condition *</div>
            <div class="gi-cond" role="radiogroup">${cond}</div>
            <div data-age="${it.id}"></div>
            <div class="gi-redtag" data-redtag="${it.id}" hidden>
                <div class="t">⚠ Out of service — tagged</div>
                <div class="n" data-tagno="${it.id}"></div>
                <textarea data-f="reason" data-item="${it.id}" placeholder="What is wrong with it? (required) — e.g. torn outer shell at left knee, liner delaminated"></textarea>
            </div>
            ${map ? `<div class="gi-map">${tools}${map}<div class="gi-map-help">Pick the kind of damage, then tap the drawing where it is. Drag a mark to move it. Each mark takes a note and photos.</div><div class="gi-pins" data-pins="${it.id}"></div></div>` : ''}
            <div class="rp-field full" style="margin-top:14px"><label>Comments</label><textarea data-f="comments" data-item="${it.id}"></textarea></div>
            ${photoBlock(it.id)}`;
        return card('s-' + it.id, n, it.title, it.group || null, body, 'gi-item', '<span class="tag" data-tag>Not inspected</span>');
    }

    function build() {
        document.title = 'Centerville FD — PPE Gear Inspection';
        let n = 1;
        const who = `<div class="rp-grid">
                <div class="rp-field full"><span class="rp-label">Gear set *</span><div class="gi-set rp-chips">
                    <label class="rp-chip"><input type="radio" name="set" value="Primary"><span>Primary</span></label>
                    <label class="rp-chip"><input type="radio" name="set" value="Backup"><span>Backup</span></label></div></div>
                <div class="rp-field"><label for="g-member">Name *</label><input id="g-member" list="g-roster" autocomplete="off" placeholder="Member whose gear this is"></div>
                <div class="rp-field"><label for="g-date">Inspection date *</label><input id="g-date" type="date"></div>
                <div class="rp-field"><label for="g-inspector">Inspected by *</label><input id="g-inspector" list="g-roster" autocomplete="off"></div>
                <div class="rp-field"><label for="g-shift">Shift</label><select id="g-shift"><option value="">—</option>${C.shifts.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
            </div>
            <datalist id="g-roster">${C.roster.map(r => `<option value="${esc(r)}">`).join('')}</datalist>`;
        const cards = [card('s-who', n++, 'Member & Inspection', 'Whose gear, which set, and who inspected it', who)];
        const groups = [];
        C.items.forEach((it, i) => {
            if (it.page && !groups.includes(it.page)) { groups.push(it.page); }
            cards.push(itemCard(it, i, n++));
        });
        cards.push(card('s-photos', n++, 'Additional Photos', 'Optional · anything not tied to one item', photoBlock('general')));
        cards.push(card('s-sign', n++, 'Summary & Signature', null, `
            <div class="gi-summary" id="g-summary"></div>
            <div id="g-notify"></div>
            <div class="rp-grid" style="margin-top:14px">
                <div class="rp-field full"><span class="rp-label">Inspector signature *</span>
                    <div class="rp-sig" id="sig-box"><canvas id="sig"></canvas><span class="hint" id="sig-hint">Sign here</span></div>
                    <div class="rp-row" style="margin-top:8px">
                        <button type="button" class="rp-btn" id="sig-clear">Clear</button>
                        <button type="button" class="rp-btn" id="sig-undo">Undo</button>
                        <span class="rp-sig-tag" id="sig-tag" hidden>Signed automatically for Sgt. Dorman</span>
                    </div></div>
            </div>`));

        document.body.innerHTML = `
            <header class="rp-header"><div class="rp-header-inner">
                <img src="${A.PATCH_IMG || ''}" alt="CFD Training Division">
                <div><div class="rp-dept">Centerville Fire Department</div><div class="rp-title">PPE Gear Inspection</div></div>
                <a class="home" href="../">← Home</a>
            </div></header>
            <nav class="rp-steps"><div class="rp-steps-inner">
                <a class="rp-step" href="#s-who" data-step="s-who"><span class="n">1</span>Member</a>
                ${C.items.map((it, i) => `<a class="rp-step" href="#s-${it.id}" data-step="s-${it.id}"><span class="n">${i + 2}</span>${esc(it.short || it.title)}</a>`).join('')}
                <a class="rp-step" href="#s-sign" data-step="s-sign"><span class="n">${C.items.length + 3}</span>Sign</a>
            </div></nav>
            <main class="rp-main"><form id="gearForm" autocomplete="off" novalidate>${cards.join('')}</form></main>
            <div class="rp-motto">Punctual · Valuable · Selfless</div>
            <div class="rp-actions"><div class="rp-actions-inner">
                <span class="rp-saved" id="saved"></span>
                <button type="button" class="rp-btn" id="btn-clear">Clear</button>
                <button type="button" class="rp-btn" id="btn-preview">Preview PDF</button>
                <button type="button" class="rp-btn dl" id="btn-download">Download PDF</button>
                <button type="button" class="rp-btn primary" id="btn-submit">Submit Inspection</button>
            </div></div>
            <div class="rp-modal-back" id="modal"><div class="rp-modal" role="dialog" aria-modal="true"></div></div>
            <div class="rp-toast" id="toast"></div>`;
    }

    // ─────────────────────────── item rendering ───────────────────────────
    function renderItem(id) {
        const it = C.items.find(x => x.id === id), s = state.items[id], idx = C.items.indexOf(it);
        const sec = $('#s-' + id);
        sec.classList.toggle('not-issued', s.notIssued);
        const oos = !s.notIssued && isOOS(s.condition);
        sec.classList.toggle('oos', oos);
        const tag = $('[data-tag]', sec);
        tag.className = 'tag ' + (s.notIssued ? 'na' : oos ? 'oos' : s.condition === 'Needs cleaning' ? 'warn' : s.condition ? 'ok' : '');
        tag.textContent = s.notIssued ? 'Not issued' : oos ? 'Out of service' : (s.condition || 'Not inspected');
        const rt = $(`[data-redtag="${id}"]`);
        rt.hidden = !oos;
        $(`[data-tagno="${id}"]`).textContent = oos ? `Tag ${tagNumber(idx)} · command staff will be notified` : '';
        // ten-year check
        const age = yearsSince(s.fields.mfgDate, ($('#g-date') || {}).value);
        const ageBox = $(`[data-age="${id}"]`);
        if (age != null && age >= 10 && !s.notIssued && s.condition !== 'Retire') {
            ageBox.innerHTML = `<div class="gi-alert age">Made ${esc(monthLabel(s.fields.mfgDate))} — ${Math.floor(age)} years ago. NFPA 1851 retires gear ten years from its date of manufacture.<button type="button" class="rp-btn" data-retire="${id}">Mark Retire</button></div>`;
        } else ageBox.innerHTML = '';
        renderPins(id);
        renderPhotos(id);
    }

    function renderPins(id) {
        const s = state.items[id];
        $$(`.gi-view[data-item="${id}"] .gi-pin`).forEach(p => p.remove());
        s.pins.forEach((p, i) => {
            const view = $(`.gi-view[data-item="${id}"][data-view="${p.layer}|${p.view}"]`);
            if (!view) return;
            const el = document.createElement('span');
            el.className = 'gi-pin'; el.dataset.pinIdx = `${id}|${i}`;
            el.innerHTML = damageIcon(p.type, 26) + `<b>${i + 1}</b>`;
            el.style.left = (p.x * 100) + '%'; el.style.top = (p.y * 100) + '%';
            el.title = `${i + 1}. ${dmg(p.type).label} — drag to move`;
            view.appendChild(el);
        });
        const list = $(`[data-pins="${id}"]`);
        if (!list) return;
        const it = C.items.find(x => x.id === id);
        list.innerHTML = s.pins.map((p, i) => {
            const layer = (it.layers || []).find(l => l.id === p.layer);
            const vn = ((layer ? viewsOf(layer) : VIEW_NAMES).find(v => v[0] === p.view) || [])[1] || p.view;
            const photos = (p.photos || []).map(ph => `<div class="gi-photo">${ph.thumb ? `<img src="${ph.thumb}" alt="">` : '<div class="busy">…</div>'}<button type="button" data-photo-del="pin:${id}:${i}|${ph.id}" aria-label="Remove photo">✕</button></div>`).join('');
            return `<div class="gi-pinrow" data-pin="${i}">
                <span class="gi-pinicon">${damageIcon(p.type, 24)}<b>${i + 1}</b></span>
                <div class="gi-pinbody">
                    <div class="gi-pinhead">
                        <select data-pin-type="${id}|${i}" aria-label="Type of damage">${DAMAGE.map(d => `<option value="${d.id}"${d.id === p.type ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}</select>
                        <span class="gi-pinwhere">${esc((layer ? layer.title + ' · ' : '') + vn)}</span>
                        <button type="button" class="gi-pindel" data-pin-del="${id}|${i}" aria-label="Remove mark ${i + 1}">✕</button>
                    </div>
                    <input value="${esc(p.note)}" placeholder="Size and detail — e.g. 2-inch tear through outer shell" data-pin-note="${id}|${i}">
                    <div class="gi-photos">${photos}</div>
                    <div class="gi-photo-add">
                        <label class="rp-btn gi-small">📷 Photo<input type="file" accept="image/*" capture="environment" hidden data-add-photo="pin:${id}:${i}"></label>
                        <label class="rp-btn gi-small">Choose<input type="file" accept="image/*,.heic,.heif" multiple hidden data-add-photo="pin:${id}:${i}"></label>
                    </div>
                </div></div>`;
        }).join('');
    }

    function photoList(scope) {
        if (scope === 'general') return state.general;
        if (scope.startsWith('pin:')) { const [, id, i] = scope.split(':'); const p = state.items[id].pins[+i]; return p ? (p.photos = p.photos || []) : []; }
        return state.items[scope].photos;
    }
    function renderPhotos(scope) {
        if (scope.startsWith('pin:')) return renderPins(scope.split(':')[1]);
        const list = photoList(scope);
        const box = $(`[data-photos="${scope}"]`);
        if (!box) return;
        box.innerHTML = list.map(p => `<div class="gi-photo">${p.thumb ? `<img src="${p.thumb}" alt="">` : '<div class="busy">Preparing…</div>'}<button type="button" data-photo-del="${scope}|${p.id}" aria-label="Remove photo">✕</button></div>`).join('');
    }

    // ─────────────────────────── photos ───────────────────────────
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

    async function addPhotos(scope, files) {
        const list = photoList(scope);
        for (const f of Array.from(files || [])) {
            const p = { id: uid(), name: f.name };
            list.push(p); renderPhotos(scope);
            try {
                const { img, url } = await loadImage(f);
                const w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, 2000 / Math.max(w, h));
                const cv = document.createElement('canvas'); cv.width = Math.round(w * s); cv.height = Math.round(h * s);
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                p.blob = await toBlob(cv, 0.82);
                const ts = Math.min(1, 360 / Math.max(w, h)), tc = document.createElement('canvas');
                tc.width = Math.max(1, Math.round(w * ts)); tc.height = Math.max(1, Math.round(h * ts));
                tc.getContext('2d').drawImage(img, 0, 0, tc.width, tc.height);
                p.thumb = tc.toDataURL('image/jpeg', 0.7); p.tw = tc.width; p.th = tc.height;
                URL.revokeObjectURL(url);
            } catch (e) {
                list.splice(list.indexOf(p), 1);
                toast(`${f.name}: ${e.message}`);
            }
            renderPhotos(scope);
        }
        changed();
    }
    function allPhotos() {
        const out = [];
        C.items.forEach(it => {
            const s = state.items[it.id];
            if (s.notIssued) return;
            s.photos.forEach((p, i) => out.push({ ...p, label: `${it.title} - photo ${i + 1}`, item: it }));
            s.pins.forEach((pin, n) => (pin.photos || []).forEach((p, i) => out.push({ ...p, label: `${it.title} - mark ${n + 1} ${dmg(pin.type).label}${pin.photos.length > 1 ? ' ' + (i + 1) : ''}`, item: it })));
        });
        state.general.forEach((p, i) => out.push({ ...p, label: `Inspection - photo ${i + 1}` }));
        return out;
    }
    const photoBytes = () => allPhotos().reduce((a, p) => a + (p.blob ? p.blob.size : 0), 0);

    // ─────────────────────────── signature ───────────────────────────
    function setupSignature() {
        const canvas = $('#sig');
        pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)', penColor: '#1e3a8a' });
        pad.addEventListener('beginStroke', () => {
            if (state.sigSource === 'dorman') pad.clear();
            state.sigSource = 'drawn'; $('#sig-tag').hidden = true; $('#sig-hint').hidden = true;
        });
        pad.addEventListener('endStroke', () => changed());
        const resize = () => {
            const data = state.sigSource === 'drawn' ? pad.toData() : null, r = Math.max(window.devicePixelRatio || 1, 1);
            canvas.width = canvas.offsetWidth * r; canvas.height = canvas.offsetHeight * r;
            canvas.getContext('2d').scale(r, r); pad.clear();
            if (data && data.length) pad.fromData(data);
            if (state.sigSource === 'dorman') drawDorman();
        };
        window.addEventListener('resize', resize); resize();
        $('#sig-clear').onclick = () => { pad.clear(); state.sigSource = null; $('#sig-tag').hidden = true; $('#sig-hint').hidden = false; changed(); };
        $('#sig-undo').onclick = () => {
            if (state.sigSource === 'dorman') return $('#sig-clear').onclick();
            const d = pad.toData(); d.pop(); pad.fromData(d);
            if (!d.length) { state.sigSource = null; $('#sig-hint').hidden = false; }
            changed();
        };
    }
    function drawDorman() {
        if (!A.DORMAN_SIG) return;
        const canvas = $('#sig'), img = new Image();
        img.onload = () => {
            pad.clear();
            const r = Math.max(window.devicePixelRatio || 1, 1), cw = canvas.width / r, ch = canvas.height / r;
            const s = Math.min((cw * 0.6) / img.width, (ch * 0.7) / img.height);
            canvas.getContext('2d').drawImage(img, (cw - img.width * s) / 2, (ch - img.height * s) / 2, img.width * s, img.height * s);
        };
        img.src = A.DORMAN_SIG;
    }
    function inspectorChanged() {
        const v = $('#g-inspector').value.trim();
        const isDorman = /^(sgt\.?|sergeant)\s+dorman$|^dorman,?\s*david$/i.test(v);
        if (isDorman && state.sigSource !== 'drawn') {
            state.sigSource = 'dorman'; $('#sig-tag').hidden = false; $('#sig-hint').hidden = true; drawDorman();
        } else if (!isDorman && state.sigSource === 'dorman') {
            pad.clear(); state.sigSource = null; $('#sig-tag').hidden = true; $('#sig-hint').hidden = false;
        }
    }

    // ─────────────────────────── data, drafts, progress ───────────────────────────
    function header() {
        return {
            set: ($('input[name="set"]:checked') || {}).value || '',
            member: $('#g-member').value.trim(), date: $('#g-date').value,
            inspector: $('#g-inspector').value.trim(), shift: $('#g-shift').value
        };
    }
    function tagged() {
        return C.items.map((it, i) => ({ it, i, s: state.items[it.id] })).filter(x => !x.s.notIssued && isOOS(x.s.condition));
    }

    function save() {
        try {
            const items = {};
            C.items.forEach(it => { const s = state.items[it.id]; items[it.id] = { notIssued: s.notIssued, condition: s.condition, fields: s.fields, pins: s.pins.map(({ photos, ...p }) => p) }; });
            localStorage.setItem(C.storageKey, JSON.stringify({ v: 1, header: header(), items, savedAt: Date.now() }));
            $('#saved').textContent = 'Draft saved ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        } catch (e) { }
    }
    function restore() {
        let d = null;
        try { d = JSON.parse(localStorage.getItem(C.storageKey) || 'null'); } catch (e) { }
        if (!d || d.v !== 1) return false;
        const h = d.header || {};
        if (h.set) { const r = $(`input[name="set"][value="${CSS.escape(h.set)}"]`); if (r) r.checked = true; }
        $('#g-member').value = h.member || ''; $('#g-date').value = h.date || '';
        $('#g-inspector').value = h.inspector || ''; $('#g-shift').value = h.shift || '';
        C.items.forEach(it => {
            const src = (d.items || {})[it.id]; if (!src) return;
            const s = state.items[it.id];
            s.notIssued = !!src.notIssued; s.condition = src.condition || ''; s.fields = src.fields || {}; s.pins = Array.isArray(src.pins) ? src.pins.map(p => ({ type: 'other', photos: [], ...p, photos: [] })) : [];
            $(`[data-not-issued="${it.id}"]`).checked = s.notIssued;
            $$(`[data-item="${it.id}"][data-f]`).forEach(el => el.value = s.fields[el.dataset.f] || '');
            const r = $(`input[name="cond-${it.id}"][value="${CSS.escape(s.condition)}"]`); if (r) r.checked = true;
        });
        return true;
    }
    function changed() {
        state.sent = false;
        C.items.forEach(it => renderItem(it.id));
        updateProgress();
        clearTimeout(state.saveTimer); state.saveTimer = setTimeout(save, 350);
    }

    function problems() {
        const h = header(), out = [];
        const need = (ok, label, target, step) => { if (!ok) out.push({ label, target, step }); };
        need(h.set, 'Primary or Backup set', '.gi-set', 's-who');
        need(h.member, 'Member name', '#g-member', 's-who');
        need(h.date, 'Inspection date', '#g-date', 's-who');
        need(h.inspector, 'Inspected by', '#g-inspector', 's-who');
        C.items.forEach(it => {
            const s = state.items[it.id];
            if (s.notIssued) return;
            need(s.condition, `${it.title}: condition (or mark it not issued)`, `#s-${it.id} .gi-cond`, 's-' + it.id);
            if (isOOS(s.condition)) need((s.fields.reason || '').trim(), `${it.title}: what's wrong (it's tagged out of service)`, `[data-redtag="${it.id}"] textarea`, 's-' + it.id);
        });
        if (C.items.every(it => state.items[it.id].notIssued)) out.push({ label: 'Inspect at least one item', target: '#s-' + C.items[0].id, step: 's-' + C.items[0].id });
        if (photoBytes() > MAX_TOTAL) out.push({ label: `Photos total ${fmtSize(photoBytes())} — remove some (limit ${fmtSize(MAX_TOTAL)})`, target: '#s-photos', step: 's-photos' });
        if (allPhotos().some(p => !p.blob)) out.push({ label: 'Photos are still being prepared — wait a moment', target: '#s-photos', step: 's-photos' });
        need(state.sigSource, 'Inspector signature', '#sig-box', 's-sign');
        return out;
    }

    function updateProgress() {
        const probs = problems(), by = {};
        probs.forEach(p => by[p.step] = (by[p.step] || 0) + 1);
        $$('[data-step]').forEach(a => { a.classList.remove('done', 'partial'); if (!by[a.dataset.step]) a.classList.add('done'); });
        const inspected = C.items.filter(it => !state.items[it.id].notIssued && state.items[it.id].condition).length;
        const ni = C.items.filter(it => state.items[it.id].notIssued).length;
        const tg = tagged();
        $('#g-summary').innerHTML = `<div><b>${inspected}</b><span>Inspected</span></div><div><b>${ni}</b><span>Not issued</span></div><div class="${tg.length ? 'oos' : ''}"><b>${tg.length}</b><span>Out of service</span></div>`;
        $('#g-notify').innerHTML = tg.length
            ? `<div class="gi-notify"><b>${tg.length} item${tg.length === 1 ? '' : 's'} tagged out of service:</b> ${esc(tg.map(x => x.it.title).join(', '))}. Submitting emails the report to Training <b>and command staff</b>, with a printable red tag for each.</div>`
            : `<div class="gi-notify quiet">Nothing is tagged out of service. The report goes to Training.</div>`;
    }

    function goTo(target, step) {
        const sec = document.getElementById(step); if (sec) sec.classList.remove('collapsed');
        const el = $(target); if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const f = el.matches('input,select,textarea') ? el : $('input,select,textarea', el);
        setTimeout(() => f && f.focus({ preventScroll: true }), 350);
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

    // ─────────────────────────── PDF ───────────────────────────
    const pdfText = s => String(s == null ? '' : s).replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

    function buildPDF() {
        const h = header();
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
        const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 14, PW = W - 2 * M;
        const SLATE = [44, 62, 80], RED = [183, 28, 28], INK = [34, 39, 46], DIM = [107, 112, 121], LINE = [223, 220, 212], SOFT = [247, 246, 242];
        const OOS = [198, 40, 40], OK = [46, 125, 50], CLEAN = [21, 101, 192], NA = [150, 150, 150];
        let y = 0;
        const font = (st, sz, col) => { pdf.setFont('helvetica', st); pdf.setFontSize(sz); pdf.setTextColor(...(col || INK)); };
        const need = hh => { if (y + hh > H - 18) { pdf.addPage(); slim(); } };
        const tg = tagged();
        const condRgb = (v, ni) => ni ? NA : isOOS(v) ? OOS : v === 'Needs cleaning' ? CLEAN : v ? OK : NA;
        function top() {
            pdf.setFillColor(...SLATE); pdf.rect(0, 0, W, 38, 'F'); pdf.setFillColor(...RED); pdf.rect(0, 38, W, 1.8, 'F');
            try { pdf.addImage(A.PATCH_IMG, 'PNG', M, 5, 28, 28, 'patch', 'FAST'); } catch (e) { }
            font('bold', 9, [255, 255, 255]); pdf.text('CENTERVILLE FIRE DEPARTMENT', M + 34, 12);
            font('bold', 16, [255, 255, 255]); pdf.text('Personal Protective Equipment Inspection', M + 34, 21);
            font('normal', 11, [255, 170, 160]); pdf.text(pdfText(`${h.member}  ·  ${h.set} set  ·  ${dayLabel(h.date)}`), M + 34, 29);
            y = 46;
        }
        function slim() {
            pdf.setFillColor(...SLATE); pdf.rect(0, 0, W, 16, 'F'); pdf.setFillColor(...RED); pdf.rect(0, 16, W, 1.2, 'F');
            font('bold', 9.5, [255, 255, 255]); pdf.text('PPE Inspection', M, 10);
            font('normal', 9.5, [255, 190, 180]); pdf.text(pdfText(`${h.member} · ${h.set} · ${dayLabel(h.date)}`), W - M, 10, { align: 'right' });
            y = 24;
        }
        function heading(t, col) {
            need(16); font('bold', 10.5, col || RED); pdf.text(pdfText(t.toUpperCase()), M, y + 4);
            pdf.setDrawColor(...(col || RED)); pdf.setLineWidth(0.5); pdf.line(M, y + 6.2, M + PW, y + 6.2); y += 10;
        }
        // The damage icons, drawn to match the form's SVG icons; n = the mark's number.
        function drawDamage(type, cx, cy, n, small) {
            const c = dmg(type).rgb, r = small ? 2.2 : 2.6;
            pdf.setLineWidth(0.5);
            if (type === 'hole') { pdf.setFillColor(...c); pdf.circle(cx, cy, r, 'F'); pdf.setFillColor(255, 255, 255); pdf.circle(cx, cy, r * 0.45, 'F'); }
            else if (type === 'tear') { pdf.setFillColor(255, 255, 255); pdf.setDrawColor(...c); pdf.circle(cx, cy, r, 'FD'); pdf.setLineWidth(0.6); pdf.lines([[r * .5, -r * .8], [r * .4, r * .8], [r * .4, -r * .8], [r * .4, r * .8]], cx - r * .85, cy + r * .4); }
            else if (type === 'burn') { pdf.setFillColor(...c); pdf.triangle(cx, cy - r * 1.2, cx - r * .85, cy + r * .2, cx + r * .85, cy + r * .2, 'F'); pdf.circle(cx, cy + r * .3, r * .85, 'F'); pdf.setFillColor(255, 183, 77); pdf.circle(cx, cy + r * .5, r * .38, 'F'); }
            else if (type === 'abrasion') { pdf.setFillColor(255, 255, 255); pdf.setDrawColor(...c); pdf.circle(cx, cy, r, 'FD'); pdf.line(cx - r * .6, cy + r * .2, cx + r * .2, cy - r * .6); pdf.line(cx - r * .3, cy + r * .6, cx + r * .6, cy - r * .3); }
            else if (type === 'contamination') { pdf.setFillColor(...c); pdf.triangle(cx, cy - r * 1.25, cx - r * .8, cy + r * .1, cx + r * .8, cy + r * .1, 'F'); pdf.circle(cx, cy + r * .35, r * .82, 'F'); }
            else { pdf.setFillColor(...c); pdf.circle(cx, cy, r, 'F'); font('bold', 6, [255, 255, 255]); pdf.text('!', cx, cy + 0.9, { align: 'center' }); }
            if (n != null) {
                const bx = cx + r * 1.05, by = cy - r * 1.05;
                pdf.setFillColor(34, 39, 46); pdf.circle(bx, by, 1.5, 'F');
                font('bold', 5.2, [255, 255, 255]); pdf.text(String(n), bx, by + 0.7, { align: 'center' });
            }
        }
        function pill(text, rgb, x, yy, alignRight) {
            font('bold', 8, [255, 255, 255]);
            const w = pdf.getTextWidth(text) + 6, x0 = alignRight ? x - w : x;
            pdf.setFillColor(...rgb); pdf.roundedRect(x0, yy, w, 5.4, 2.4, 2.4, 'F'); pdf.text(text, x0 + w / 2, yy + 3.8, { align: 'center' });
        }
        function grid(rows, cols) {
            const cw = PW / cols;
            for (let i = 0; i < rows.length; i += cols) {
                const chunk = rows.slice(i, i + cols);
                const hts = chunk.map(([, v]) => pdf.splitTextToSize(pdfText(v || '—'), cw - 4).length);
                const hh = Math.max(...hts) * 4.2 + 7; need(hh);
                chunk.forEach(([k, v], j) => {
                    const x = M + j * cw;
                    font('bold', 6.8, DIM); pdf.text(pdfText(k.toUpperCase()), x, y + 3);
                    font('normal', 9.6, INK); pdf.text(pdf.splitTextToSize(pdfText(v || '—'), cw - 4), x, y + 7.4);
                });
                y += hh;
            }
        }

        top();
        if (tg.length) {
            need(14);
            pdf.setFillColor(...OOS); pdf.roundedRect(M, y, PW, 11, 2, 2, 'F');
            font('bold', 11, [255, 255, 255]);
            pdf.text(pdfText(`OUT OF SERVICE: ${tg.map(x => x.it.title).join(', ')}`), M + 4, y + 7.2, { maxWidth: PW - 8 });
            y += 15;
        }
        heading('Inspection');
        grid([['Member', h.member], ['Gear set', h.set], ['Inspection date', dayLabel(h.date)], ['Inspected by', h.inspector], ['Shift', h.shift || '—'], ['Items out of service', String(tg.length)]], 3);

        heading('Summary');
        C.items.forEach(it => {
            const s = state.items[it.id]; need(7);
            font('bold', 9.6, INK); pdf.text(pdfText(it.title), M + 1, y + 4);
            font('normal', 8.8, DIM); pdf.text(pdfText(s.notIssued ? '' : (s.fields.serial ? 'S/N ' + s.fields.serial : '')), M + 88, y + 4);
            pill(pdfText(s.notIssued ? 'Not issued' : (s.condition || 'Not inspected')), condRgb(s.condition, s.notIssued), M + PW, y + 0.3, true);
            y += 6.6; pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(M, y, M + PW, y); y += 0.8;
        });
        y += 3;

        C.items.forEach((it, idx) => {
            const s = state.items[it.id];
            if (s.notIssued) return;
            const oos = isOOS(s.condition);
            heading(it.title + (oos ? '  —  OUT OF SERVICE' : ''), oos ? OOS : RED);
            grid([['Manufacturer / Model', s.fields.mfr], ['Serial / Lot Number', s.fields.serial], ['Date of Mfgr', monthLabel(s.fields.mfgDate)],
                [it.sizeLabel || 'Size', s.fields.size], ['Date Issued', dayLabel(s.fields.issued)], ['Condition', s.condition]], 3);
            const age = yearsSince(s.fields.mfgDate, h.date);
            if (age != null && age >= 10) { need(7); font('bold', 8.8, OOS); pdf.text(pdfText(`Over ten years from manufacture (${Math.floor(age)} years) — NFPA 1851 retirement age.`), M, y + 4); y += 7; }
            if (oos) {
                const lines = pdf.splitTextToSize(pdfText(s.fields.reason || '—'), PW - 8);
                need(12 + lines.length * 4.2);
                pdf.setDrawColor(...OOS); pdf.setLineWidth(0.6); pdf.setLineDashPattern([1.5, 1], 0);
                pdf.roundedRect(M, y, PW, 9 + lines.length * 4.2, 2, 2, 'S'); pdf.setLineDashPattern([], 0);
                font('bold', 8.5, OOS); pdf.text(pdfText(`TAGGED ${tagNumber(idx)}`), M + 4, y + 5);
                font('normal', 9.6, INK); pdf.text(lines, M + 4, y + 9.8);
                y += 12 + lines.length * 4.2;
            }
            if (s.fields.comments) {
                const lines = pdf.splitTextToSize(pdfText(s.fields.comments), PW);
                need(8 + lines.length * 4.2); font('bold', 6.8, DIM); pdf.text('COMMENTS', M, y + 3);
                font('normal', 9.6, INK); pdf.text(lines, M, y + 7.4); y += 8 + lines.length * 4.2;
            }
            // damage drawings, only for layers that were marked
            (it.layers || []).forEach(l => {
                const pins = s.pins.map((p, i) => ({ ...p, n: i + 1 })).filter(p => p.layer === l.id);
                if (!pins.length) return;
                const vl = viewsOf(l), cols = Math.max(vl.length, 2), gap = 3;
                const cell = (PW - (cols - 1) * gap) / cols;
                const imgs = vl.map(([vk]) => VIEWS[`${l.views}--${vk}`]);
                const scaleFor = v => Math.min(cell / v.w, (vl.length > 2 ? 58 : 70) / v.h);
                const maxH = Math.max(...imgs.map(v => v ? v.h * scaleFor(v) : 0));
                need(maxH + 12);
                font('bold', 7.5, DIM); pdf.text(pdfText(`${l.title.toUpperCase()} — DAMAGE MARKS`), M, y + 3); y += 5;
                vl.forEach(([vk, vn], j) => {
                    const v = imgs[j]; if (!v) return;
                    const sc = scaleFor(v), w = v.w * sc, hh = v.h * sc, x = M + j * (cell + gap) + (cell - w) / 2;
                    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.rect(M + j * (cell + gap), y, cell, maxH);
                    try { pdf.addImage(v.src, 'JPEG', x, y + (maxH - hh) / 2, w, hh, `${l.views}-${vk}`, 'FAST'); } catch (e) { }
                    pins.filter(p => p.view === vk).forEach(p => drawDamage(p.type, x + p.x * w, y + (maxH - hh) / 2 + p.y * hh, p.n));
                    font('normal', 6.5, DIM); pdf.text(pdfText(vn), M + j * (cell + gap) + cell / 2, y + maxH + 3, { align: 'center' });
                });
                y += maxH + 6;
                pins.forEach(p => {
                    const lines = pdf.splitTextToSize(pdfText(`${dmg(p.type).label}${p.note ? ' — ' + p.note : ''}`), PW - 12);
                    need(lines.length * 4.2 + 3);
                    drawDamage(p.type, M + 3, y + 2.6, p.n, true);
                    font('normal', 9.2, INK); pdf.text(lines, M + 9, y + 3.6); y += lines.length * 4.2 + 1.8;
                    const ph = (p.photos || []).filter(x => x.thumb).slice(0, 4);
                    if (ph.length) {
                        const pc = 30; need(pc + 3);
                        ph.forEach((q, qi) => {
                            const sc = Math.min(pc / q.tw, pc / q.th), w = q.tw * sc, hh = q.th * sc, x = M + 9 + qi * (pc + 3);
                            pdf.setFillColor(...SOFT); pdf.rect(x, y, pc, pc, 'F');
                            try { pdf.addImage(q.thumb, 'JPEG', x + (pc - w) / 2, y + (pc - hh) / 2, w, hh, undefined, 'FAST'); } catch (e) { }
                        });
                        y += pc + 3;
                    }
                });
                y += 2;
            });
            const pics = s.photos.filter(p => p.thumb).slice(0, 8);
            if (pics.length) {
                const cell = (PW - 3 * 4) / 4;
                font('bold', 6.8, DIM); need(cell + 8); pdf.text('PHOTOS', M, y + 3); y += 5;
                for (let i = 0; i < pics.length; i += 4) {
                    need(cell + 3);
                    pics.slice(i, i + 4).forEach((p, j) => {
                        const sc = Math.min(cell / p.tw, cell / p.th), w = p.tw * sc, hh = p.th * sc, x = M + j * (cell + 4);
                        pdf.setFillColor(...SOFT); pdf.rect(x, y, cell, cell, 'F');
                        try { pdf.addImage(p.thumb, 'JPEG', x + (cell - w) / 2, y + (cell - hh) / 2, w, hh, undefined, 'FAST'); } catch (e) { }
                    });
                    y += cell + 3;
                }
            }
            y += 3;
        });

        if (state.general.some(p => p.thumb)) {
            heading('Additional Photos');
            const pics = state.general.filter(p => p.thumb).slice(0, 12), cell = (PW - 3 * 4) / 4;
            for (let i = 0; i < pics.length; i += 4) {
                need(cell + 3);
                pics.slice(i, i + 4).forEach((p, j) => {
                    const sc = Math.min(cell / p.tw, cell / p.th), w = p.tw * sc, hh = p.th * sc, x = M + j * (cell + 4);
                    pdf.setFillColor(...SOFT); pdf.rect(x, y, cell, cell, 'F');
                    try { pdf.addImage(p.thumb, 'JPEG', x + (cell - w) / 2, y + (cell - hh) / 2, w, hh, undefined, 'FAST'); } catch (e) { }
                });
                y += cell + 3;
            }
        }

        heading('Inspector');
        need(30);
        grid([['Inspected by', h.inspector], ['Date', dayLabel(h.date)]], 2);
        font('bold', 6.8, DIM); pdf.text('SIGNATURE', M, y + 3);
        try {
            if (state.sigSource === 'dorman') { const pr = pdf.getImageProperties(A.DORMAN_SIG), sc = Math.min(55 / pr.width, 20 / pr.height); pdf.addImage(A.DORMAN_SIG, 'PNG', M, y + 5, pr.width * sc, pr.height * sc, 'dsig', 'FAST'); }
            else if (state.sigSource === 'drawn') pdf.addImage(pad.toDataURL('image/jpeg', 0.7), 'JPEG', M, y + 5, 60, 20, undefined, 'FAST');
        } catch (e) { }
        y += 28;

        // Printable red tags — cut out and attach one to each item.
        if (tg.length) {
            pdf.addPage(); slim();
            font('bold', 10.5, OOS); pdf.text('OUT OF SERVICE TAGS — cut along the dashed lines and attach to the gear', M, y + 4); y += 10;
            const tw = (PW - 6) / 2, th = 72;
            tg.forEach((x, k) => {
                const col = k % 2, row = Math.floor(k / 2);
                if (col === 0 && k > 0) y += th + 6;
                if (col === 0 && y + th > H - 18) { pdf.addPage(); slim(); }
                const tx = M + col * (tw + 6), ty = y;
                pdf.setDrawColor(150, 150, 150); pdf.setLineWidth(0.3); pdf.setLineDashPattern([2, 1.5], 0); pdf.rect(tx - 2, ty - 2, tw + 4, th + 4); pdf.setLineDashPattern([], 0);
                pdf.setFillColor(...OOS); pdf.rect(tx, ty, tw, 16, 'F');
                font('bold', 13, [255, 255, 255]); pdf.text('OUT OF SERVICE', tx + tw / 2, ty + 7.5, { align: 'center' });
                font('bold', 8.5, [255, 255, 255]); pdf.text('DO NOT USE', tx + tw / 2, ty + 12.8, { align: 'center' });
                pdf.setDrawColor(...OOS); pdf.setLineWidth(0.8); pdf.rect(tx, ty, tw, th);
                let yy = ty + 22;
                const line = (k2, v) => { font('bold', 6.8, DIM); pdf.text(k2, tx + 4, yy); font('normal', 9, INK); pdf.text(pdf.splitTextToSize(pdfText(v || '—'), tw - 30)[0], tx + 26, yy); yy += 6; };
                line('TAG', tagNumber(x.i)); line('ITEM', x.it.title); line('MEMBER', `${h.member} (${h.set})`); line('SERIAL', x.s.fields.serial); line('DATE', dayLabel(h.date)); line('BY', h.inspector);
                font('bold', 6.8, DIM); pdf.text('REASON', tx + 4, yy);
                font('normal', 8.5, INK); pdf.text(pdf.splitTextToSize(pdfText(x.s.fields.reason || '—'), tw - 30).slice(0, 2), tx + 26, yy);
            });
        }

        const pages = pdf.internal.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
            pdf.setPage(i);
            pdf.setDrawColor(...RED); pdf.setLineWidth(0.3); pdf.line(M, H - 13, W - M, H - 13);
            font('bold', 7.5, RED); pdf.text('PUNCTUAL · VALUABLE · SELFLESS', W / 2, H - 8.5, { align: 'center' });
            font('normal', 7.5, DIM); pdf.text(`Page ${i} of ${pages}`, W - M, H - 8.5, { align: 'right' });
        }
        return pdf;
    }

    const fileBase = () => { const h = header(); return `PPE_Inspection_${(h.member || 'member').replace(/[^A-Za-z0-9]+/g, '_')}_${h.set || 'set'}_${h.date || ''}`.replace(/_+/g, '_'); };

    function preview(download) {
        const probs = problems();
        if (probs.length) return showProblems(probs, download ? 'download the PDF' : 'preview the PDF');
        const blob = buildPDF().output('blob'), url = URL.createObjectURL(blob);
        let w = null;
        if (!download) w = window.open(url, '_blank');
        if (download || !w) { const a = document.createElement('a'); a.href = url; a.download = fileBase() + '.pdf'; document.body.appendChild(a); a.click(); a.remove(); }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // ─────────────────────────── submit ───────────────────────────
    function submit() {
        const probs = problems();
        if (probs.length) return showProblems(probs, 'submit');
        const h = header(), key = `cfdGearSent|${h.member}|${h.set}|${h.date}`;
        let prev = null; try { prev = localStorage.getItem(key); } catch (e) { }
        if (prev) {
            return modal('warn', 'This inspection was already sent', `<p>The ${esc(h.set)} gear inspection for <b>${esc(h.member)}</b> on ${esc(dayLabel(h.date))} was sent from this device at ${esc(new Date(+prev).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}.</p><p>Only send it again if you are correcting it.</p>`,
                [{ t: 'Cancel' }, { t: 'Send again', primary: true, fn: () => send(key) }]);
        }
        send(key);
    }

    async function send(key) {
        const btn = $('#btn-submit'); btn.disabled = true; btn.textContent = 'Sending…';
        const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 180000);
        const h = header(), tg = tagged();
        const to = Array.from(new Set([...C.email.training, ...(tg.length ? C.email.command : [])]));
        try {
            const pdf = buildPDF();
            const attachments = [{ filename: fileBase() + '.pdf', content: pdf.output('datauristring').split(',')[1] }];
            for (const p of allPhotos()) attachments.push({ filename: p.label.replace(/[\\/:*?"<>|]+/g, '_') + '.jpg', content: await toB64(p.blob) });
            const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7079;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v || '—')}</b></td></tr>`;
            const items = C.items.map(it => {
                const s = state.items[it.id], oos = !s.notIssued && isOOS(s.condition);
                const color = s.notIssued ? '#999' : oos ? '#c62828' : s.condition === 'Needs cleaning' ? '#1565c0' : '#2e7d32';
                return `<tr><td style="padding:3px 12px 3px 0">${esc(it.title)}</td><td style="padding:3px 0;color:${color};font-weight:700">${esc(s.notIssued ? 'Not issued' : s.condition)}${s.fields.serial && !s.notIssued ? ` <span style="color:#6b7079;font-weight:400">· S/N ${esc(s.fields.serial)}</span>` : ''}</td></tr>`;
            }).join('');
            const tagHtml = tg.length ? `<div style="border:2px solid #c62828;border-radius:8px;padding:10px 14px;margin:0 0 14px;background:#fff6f5">
                <div style="color:#c62828;font-weight:800;letter-spacing:.5px">⚠ OUT OF SERVICE — ${tg.length} item${tg.length === 1 ? '' : 's'} tagged</div>
                <ul style="margin:6px 0 0;padding-left:18px">${tg.map(x => `<li><b>${esc(x.it.title)}</b>${x.s.fields.serial ? ' (S/N ' + esc(x.s.fields.serial) + ')' : ''} — ${esc(x.s.condition)} — ${esc(x.s.fields.reason)} <span style="color:#6b7079">[${esc(tagNumber(x.i))}]</span></li>`).join('')}</ul>
                <div style="color:#6b7079;font-size:13px;margin-top:6px">Printable tags are on the last page of the PDF.</div></div>` : '';
            const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#22272e;max-width:640px">
                <h2 style="margin:0 0 4px;color:#b71c1c">PPE Inspection</h2>
                <div style="color:#6b7079;margin-bottom:12px">${esc(h.member)} · ${esc(h.set)} set · ${esc(dayLabel(h.date))}</div>
                ${tagHtml}
                <table style="border-collapse:collapse;font-size:14px;margin-bottom:12px">${row('Member', h.member)}${row('Gear set', h.set)}${row('Date', dayLabel(h.date))}${row('Inspected by', h.inspector)}${h.shift ? row('Shift', h.shift) : ''}</table>
                <table style="border-collapse:collapse;font-size:14px">${items}</table>
                <p style="color:#6b7079;font-size:13px;margin-top:14px">Full inspection attached as a PDF${allPhotos().length ? `, with ${allPhotos().length} photo${allPhotos().length === 1 ? '' : 's'}` : ''}.</p></div>`;
            const subject = tg.length
                ? `⚠ OUT OF SERVICE: ${h.member} — ${tg.map(x => x.it.title).join(', ')}`
                : `PPE Inspection — ${h.member} (${h.set}) — ${dayLabel(h.date)}`;
            const res = await fetch('/api/send-email', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
                body: JSON.stringify({ to, from_name: 'CFD Training Division', subject, html, attachments })
            });
            let result = {};
            try { result = await res.json(); } catch (e) { result = { error: 'Unreadable reply (HTTP ' + res.status + ')' }; }
            if (!res.ok || !result.success) throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error || ('HTTP ' + res.status)));
            try { localStorage.setItem(key, String(Date.now())); localStorage.removeItem(C.storageKey); } catch (e) { }
            state.sent = true;
            modal('ok', tg.length ? 'Inspection sent — command staff notified' : 'Inspection sent',
                `<p>Emailed to ${esc(to.join(', '))} with the PDF${allPhotos().length ? ' and photos' : ''}.</p>${tg.length ? `<p><b>${tg.length} item${tg.length === 1 ? ' is' : 's are'} tagged out of service.</b> Print the tags on the last page of the PDF and attach them to the gear.</p>` : ''}`,
                [{ t: 'Download PDF', fn: () => preview(true) }, { t: 'Close', primary: true }]);
        } catch (err) {
            const msg = err.name === 'AbortError' ? 'It took too long — the connection may have dropped.' : (err.message || 'Unknown error');
            modal('bad', 'STOP — this inspection did NOT send', `<p>${tg.length ? '<b>Command staff have not been told about the out-of-service gear.</b> ' : ''}Nothing was lost; the form is still filled in.</p><p style="font-family:monospace;font-size:.8rem;color:#8a1c1c">${esc(msg)}</p><p>Try again, or download the PDF and send it yourself.</p>`,
                [{ t: 'Download PDF', fn: () => preview(true) }, { t: 'Try again', primary: true, fn: () => send(key) }]);
        } finally {
            clearTimeout(timer); btn.disabled = false; btn.textContent = 'Submit Inspection';
        }
    }

    function resetAll() {
        modal('warn', 'Clear this inspection?', '<p>Everything entered, marks, photos, and the signature will be removed.</p>', [{ t: 'Keep it' }, {
            t: 'Clear everything', primary: true, fn: () => {
                $('#gearForm').reset();
                C.items.forEach(it => state.items[it.id] = { notIssued: false, condition: '', fields: {}, pins: [], photos: [] });
                state.general = []; renderPhotos('general');
                pad.clear(); state.sigSource = null; $('#sig-tag').hidden = true; $('#sig-hint').hidden = false;
                try { localStorage.removeItem(C.storageKey); } catch (e) { }
                $('#g-date').value = todayIso(); $('#saved').textContent = '';
                changed(); window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }]);
    }

    // ─────────────────────────── wire up ───────────────────────────
    function wire() {
        const form = $('#gearForm');
        form.addEventListener('click', e => {
            const head = e.target.closest('[data-toggle]');
            if (head) return head.parentElement.classList.toggle('collapsed');
            const view = e.target.closest('.gi-view');
            if (view && !e.target.closest('.gi-pin') && !drag.justMoved) {
                const r = view.getBoundingClientRect();
                const [layer, vk] = view.dataset.view.split('|');
                const id = view.dataset.item, s = state.items[id];
                const type = ($(`input[name="dmg-${id}"]:checked`) || {}).value || 'other';
                s.pins.push({ type, layer, view: vk, x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), note: '', photos: [] });
                changed();
                const inputs = $$(`[data-pin-note^="${id}|"]`);
                if (inputs.length) inputs[inputs.length - 1].focus({ preventScroll: true });
                return;
            }
            const del = e.target.closest('[data-pin-del]');
            if (del) {
                const [id, i] = del.dataset.pinDel.split('|'), pin = state.items[id].pins[+i];
                if (pin && (pin.note || (pin.photos || []).length) && !confirm(`Remove mark ${+i + 1} with its note and photos?`)) return;
                state.items[id].pins.splice(+i, 1); return changed();
            }
            const ph = e.target.closest('[data-photo-del]');
            if (ph) {
                const [scope, pid] = ph.dataset.photoDel.split('|'), list = photoList(scope);
                list.splice(list.findIndex(p => p.id === pid), 1); renderPhotos(scope); return changed();
            }
            const ret = e.target.closest('[data-retire]');
            if (ret) {
                const id = ret.dataset.retire; state.items[id].condition = 'Retire';
                const r = $(`input[name="cond-${id}"][value="Retire"]`); if (r) r.checked = true;
                changed(); const ta = $(`[data-redtag="${id}"] textarea`); if (ta && !ta.value) { ta.value = 'Over ten years from date of manufacture (NFPA 1851).'; state.items[id].fields.reason = ta.value; save(); }
            }
        });
        form.addEventListener('input', e => {
            const t = e.target;
            if (t.dataset.f && t.dataset.item) { state.items[t.dataset.item].fields[t.dataset.f] = t.value; }
            if (t.dataset.pinNote) { const [id, i] = t.dataset.pinNote.split('|'); state.items[id].pins[+i].note = t.value; clearTimeout(state.saveTimer); state.saveTimer = setTimeout(save, 350); return; }
            // A select fires input then change; take the value here, before a re-render replaces the element.
            if (t.dataset.pinType) { const [id, i] = t.dataset.pinType.split('|'); state.items[id].pins[+i].type = t.value; return changed(); }
            if (t.name && t.name.startsWith('dmg-')) return;
            if (t.dataset.f === 'reason' || t.dataset.f === 'comments' || t.dataset.f === 'mfr' || t.dataset.f === 'serial' || t.dataset.f === 'size') { updateProgress(); clearTimeout(state.saveTimer); state.saveTimer = setTimeout(save, 350); return; }
            changed();
        });
        form.addEventListener('change', e => {
            const t = e.target;
            if (t.dataset.notIssued) { state.items[t.dataset.notIssued].notIssued = t.checked; }
            if (t.name && t.name.startsWith('cond-')) { state.items[t.name.slice(5)].condition = t.value; }
            if (t.dataset.addPhoto) { addPhotos(t.dataset.addPhoto, t.files); t.value = ''; return; }
            if (t.dataset.pinType || (t.name && t.name.startsWith('dmg-'))) return;   // handled on input
            if (t.id === 'g-inspector') inspectorChanged();
            if (t.dataset.f && t.dataset.item) state.items[t.dataset.item].fields[t.dataset.f] = t.value;
            changed();
        });
        // Drag a mark to move it (mouse, finger, or pencil).
        form.addEventListener('pointerdown', e => {
            const pin = e.target.closest('.gi-pin'); if (!pin) return;
            e.preventDefault();
            const [id, i] = pin.dataset.pinIdx.split('|');
            drag.on = { id, i: +i, pin, view: pin.parentElement, x0: e.clientX, y0: e.clientY, moved: false };
            pin.setPointerCapture(e.pointerId); pin.classList.add('dragging');
        });
        form.addEventListener('pointermove', e => {
            const d = drag.on; if (!d) return;
            if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 4) d.moved = true;
            if (!d.moved) return;
            const r = d.view.getBoundingClientRect(), p = state.items[d.id].pins[d.i];
            p.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); p.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
            d.pin.style.left = (p.x * 100) + '%'; d.pin.style.top = (p.y * 100) + '%';
        });
        const endDrag = () => {
            const d = drag.on; if (!d) return;
            d.pin.classList.remove('dragging'); drag.on = null;
            if (d.moved) { drag.justMoved = true; setTimeout(() => drag.justMoved = false, 50); save(); }
            else { const row = $(`[data-pins="${d.id}"] [data-pin="${d.i}"]`); if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); const n = $('input', row); n && n.focus({ preventScroll: true }); } }
        };
        form.addEventListener('pointerup', endDrag); form.addEventListener('pointercancel', endDrag);
        $$('[data-step]').forEach(a => a.addEventListener('click', () => { const s = document.getElementById(a.dataset.step); if (s) s.classList.remove('collapsed'); }));
        $('#btn-clear').onclick = resetAll;
        $('#btn-preview').onclick = () => preview(false);
        $('#btn-download').onclick = () => preview(true);
        $('#btn-submit').onclick = submit;
        $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
        window.addEventListener('beforeunload', e => { if (allPhotos().length && !state.sent) { e.preventDefault(); e.returnValue = ''; } });
    }

    function init() {
        build();
        setupSignature();
        wire();
        const restored = restore();
        if (!$('#g-date').value) $('#g-date').value = todayIso();
        inspectorChanged();
        changed();
        if (restored) $('#saved').textContent = 'Draft restored';
    }

    window.CFDGear = { state, problems, buildPDF, submit, send, addPhotos, changed, header, tagged, tagNumber, DAMAGE };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
