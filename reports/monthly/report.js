/* Monthly position reports — shared engine.
 *
 * Each report page (firefighter-report, rescue-driver-report, engine-driver-report,
 * aoic-report) defines window.REPORT_CONFIG and loads this file. Everything else —
 * the form, the days evaluated, ratings, attachments, signature, PDF and email —
 * lives here so the four reports stay alike.
 *
 * Why monthly and why a days list: members are evaluated on the days they
 * actually work in the month, which may be two or five, so the report records
 * each of those days and then one overall evaluation for the month.
 */
(function () {
    'use strict';

    const C = window.REPORT_CONFIG;
    const A = window.CFD_REPORT_ASSETS || {};

    const RATINGS = [
        { v: 'Unsatisfactory', short: 'U', cls: 'u', rgb: [198, 40, 40] },
        { v: 'Needs Improvement', short: 'NI', cls: 'ni', rgb: [239, 108, 0] },
        { v: 'Satisfactory', short: 'S', cls: 's', rgb: [46, 125, 50] },
        { v: 'Exceeds Expectations', short: 'EE', cls: 'ee', rgb: [21, 101, 192] },
        { v: 'Not Applicable', short: 'N/A', cls: 'na', rgb: [117, 117, 117] }
    ];
    const OVERALL = RATINGS.slice(0, 4);
    const CATEGORIES = ['Report', 'Picture', 'Training Sheet', 'Other'];
    const MB = 1024 * 1024;
    // Resend caps a whole email at 40 MB and attachments travel as base64
    // (a third bigger), so the files themselves must stay under ~28 MB.
    const MAX_TOTAL = 28 * MB;
    const MAX_FILE = 20 * MB;
    const SEND_TIMEOUT_MS = 180000;

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const uid = () => Math.random().toString(36).slice(2, 10);

    const state = {
        days: [],
        files: [],
        sigSource: null,       // 'drawn' | 'dorman' | null
        sent: false,
        saveTimer: null
    };
    let pad = null;

    // ─────────────────────────────── dates ───────────────────────────────
    function monthValue() { return ($('#f-month') || {}).value || ''; }
    function parseMonth(v) {
        const m = /^(\d{4})-(\d{1,2})/.exec(v || '');
        return m ? { y: +m[1], m: +m[2] } : null;
    }
    function monthLabel(v) {
        const p = parseMonth(v);
        return p ? new Date(p.y, p.m - 1, 15).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : (v || '');
    }
    function monthBounds(v) {
        const p = parseMonth(v);
        if (!p) return null;
        const last = new Date(p.y, p.m, 0).getDate();
        const mm = String(p.m).padStart(2, '0');
        return { min: `${p.y}-${mm}-01`, max: `${p.y}-${mm}-${String(last).padStart(2, '0')}` };
    }
    function dayLabel(iso, withYear) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
        if (!m) return iso || '';
        return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US',
            withYear ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
    }
    function todayIso() {
        const t = new Date();
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    }
    function fmtSize(b) { return b >= MB ? (b / MB).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }

    // ─────────────────────────────── build ───────────────────────────────
    function options(list, placeholder) {
        return `<option value="">${esc(placeholder || '— Select —')}</option>` + list.map(o => `<option>${esc(o)}</option>`).join('');
    }

    function steps() {
        const s = [{ id: 's-member', t: C.memberLabel + ' & Month' }, { id: 's-days', t: 'Days' }];
        C.sections.forEach((sec, i) => s.push({ id: 's-sec-' + i, t: sec.title }));
        s.push({ id: 's-overall', t: 'Overall' }, { id: 's-files', t: 'Attachments' }, { id: 's-sign', t: 'Sign' });
        return s;
    }

    function card(id, num, title, sub, body, meta) {
        return `<section class="rp-card" id="${id}">
            <button type="button" class="rp-card-head" data-toggle>
                <span class="num">${num}</span>
                <span><h2>${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</span>
                <span class="meta" data-meta>${meta || ''}</span>
                <span class="chev">▼</span>
            </button>
            <div class="rp-card-body">${body}</div>
        </section>`;
    }

    function memberCard(n) {
        const ap = C.apparatus;
        let apHtml = '';
        if (ap && ap.mode === 'multi') {
            apHtml = `<div class="rp-field full"><span class="rp-label">${esc(ap.label)}</span><div class="rp-chips">` +
                ap.options.map(o => `<label class="rp-chip"><input type="checkbox" name="Apparatus" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('') +
                `</div></div>`;
        } else if (ap && ap.mode === 'single') {
            apHtml = `<div class="rp-field full" id="f-apparatus"><span class="rp-label">${esc(ap.label)} *</span><div class="rp-chips">` +
                ap.options.map(o => `<label class="rp-chip"><input type="radio" name="Apparatus Assignment" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('') +
                `</div><div class="rp-infoline" id="apparatus-info"></div></div>`;
        } else if (ap && ap.mode === 'fixed') {
            apHtml = `<div class="rp-field"><label>Apparatus Assignment</label><input type="text" name="Apparatus Assignment" value="${esc(ap.assignment)}" readonly></div>
                      <div class="rp-field"><label>Apparatus Type</label><input type="text" name="Apparatus Type" value="${esc(ap.type)}" readonly></div>`;
        }
        const extras = (C.extraFields || []).map(f =>
            `<div class="rp-field"><label>${esc(f.label || f.name)}</label><input type="text" name="${esc(f.name)}" placeholder="${esc(f.placeholder || '')}"></div>`).join('');
        const body = `<div class="rp-grid">
            <div class="rp-field"><label for="f-month">Evaluation Month *</label><input type="month" id="f-month" name="Evaluation Month" placeholder="YYYY-MM"></div>
            <div class="rp-field"><label for="f-member">${esc(C.memberLabel)} *</label><select id="f-member" name="${esc(C.memberField)}">${options(C.members)}</select></div>
            <div class="rp-field"><label for="f-shift">Assigned Shift *</label><select id="f-shift" name="Shift">${options(C.shifts)}</select></div>
            <div class="rp-field"><label for="f-officer">${esc(C.officerLabel || 'Officer')} *</label><select id="f-officer" name="Officer">${options(C.officers)}</select></div>
            ${apHtml}${extras}
        </div>`;
        return card('s-member', n, C.memberLabel + ' & Month', 'Who is being evaluated, and for which month', body);
    }

    function daysCard(n) {
        const body = `<p class="rp-help">Add each day in the month you worked with or observed this ${esc(C.memberLabel.toLowerCase())} — two days or twenty. The ratings below are one overall evaluation across these days.</p>
            <div class="rp-days" id="days"></div>
            <div class="rp-row">
                <button type="button" class="rp-btn primary" id="add-day">＋ Add a day</button>
            </div>
            <div class="rp-days-summary" id="days-summary"></div>`;
        return card('s-days', n, 'Days Evaluated', 'The dates this month the evaluation covers', body);
    }

    function sectionCard(sec, i, n) {
        const items = sec.items.map(it => {
            const id = 'r-' + slug(it.key);
            const seg = RATINGS.map(r =>
                `<label><input type="radio" name="${esc(it.key)} Rating" value="${esc(r.v)}"><span><span class="long">${esc(r.v)}</span><span class="short">${esc(r.short)}</span></span></label>`).join('');
            return `<div class="rp-item" id="${id}" data-item="${esc(it.key)}">
                <div class="rp-item-head">
                    <div><div class="rp-item-key">${esc(it.key)}</div><div class="rp-item-label">${esc(it.label)}</div></div>
                    <button type="button" class="rp-note-toggle" data-note-toggle>＋ Note</button>
                </div>
                <div class="rp-seg" role="radiogroup" aria-label="${esc(it.key)} rating">${seg}</div>
                <div class="rp-note" hidden><textarea name="${esc(it.key)} Note" placeholder="${esc(it.note || 'Evaluator notes…')}"></textarea></div>
            </div>`;
        }).join('');
        return card('s-sec-' + i, n, sec.title, `${sec.items.length} items · rate the month overall`, items);
    }

    function overallCard(n) {
        const o = C.overall;
        const seg = OVERALL.map(r =>
            `<label><input type="radio" name="${esc(o.ratingField)}" value="${esc(r.v)}"><span><span class="long">${esc(r.v)}</span><span class="short">${esc(r.short)}</span></span></label>`).join('');
        const narratives = o.narratives.map(f =>
            `<div class="rp-field full"><label>${esc(f.label || f.name)}</label><textarea name="${esc(f.name)}" placeholder="${esc(f.placeholder || '')}"></textarea></div>`).join('');
        const body = `<div class="rp-tally" id="tally"></div>
            <div class="rp-field full" id="f-overall"><span class="rp-label">${esc(o.ratingLabel || o.ratingField)} *</span>
                <div class="rp-seg" style="grid-template-columns:repeat(4,1fr)">${seg}</div></div>
            <div class="rp-grid" style="margin-top:14px">
                <div class="rp-field full"><label for="f-result">${esc(o.resultLabel || o.resultField)} *</label>
                    <select id="f-result" name="${esc(o.resultField)}">${options(o.resultOptions)}</select></div>
                ${narratives}
            </div>`;
        return card('s-overall', n, 'Overall Month Evaluation', 'One overall rating for the whole month', body);
    }

    function filesCard(n) {
        const body = `<p class="rp-help">Add anything that supports this month's evaluation — incident reports, pictures, training sheets. They are emailed with the PDF and archived. Photos are resized automatically.</p>
            <div class="rp-drop" id="drop">
                <div class="big">Drop files here</div>
                <div class="small">Reports, pictures, training sheets — PDF, photos, Word, Excel · several at once</div>
                <div class="rp-row">
                    <label class="rp-btn primary">Choose files<input type="file" id="file-input" multiple hidden
                        accept="image/*,.heic,.heif,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf"></label>
                    <label class="rp-btn">📷 Take photo<input type="file" id="camera-input" accept="image/*" capture="environment" hidden></label>
                </div>
            </div>
            <div class="rp-files" id="files"></div>
            <div class="rp-meter" id="meter" hidden><div class="rp-meter-bar"><i></i></div><div class="rp-meter-text"></div></div>`;
        return card('s-files', n, 'Attachments', 'Optional · reports, pictures, training sheets', body, '<span style="font-weight:600">Optional</span>');
    }

    function signCard(n) {
        const body = `<div class="rp-grid">
                <div class="rp-field"><label for="f-evname">Evaluator Name *</label><input type="text" id="f-evname" name="Evaluator Name" autocomplete="name"></div>
                <div class="rp-field"><label for="f-evrank">Evaluator Rank *</label><select id="f-evrank" name="Evaluator Rank">${options(C.ranks)}</select></div>
                <div class="rp-field full"><span class="rp-label">Evaluator Signature *</span>
                    <div class="rp-sig" id="sig-box"><canvas id="sig"></canvas><span class="hint" id="sig-hint">Sign here</span></div>
                    <div class="rp-row" style="margin-top:8px">
                        <button type="button" class="rp-btn" id="sig-clear">Clear</button>
                        <button type="button" class="rp-btn" id="sig-undo">Undo</button>
                        <span class="rp-sig-tag" id="sig-tag" hidden>Signed automatically for Sgt. Dorman</span>
                    </div>
                </div>
            </div>`;
        return card('s-sign', n, 'Evaluator & Signature', null, body);
    }

    function build() {
        document.title = 'Centerville FD — ' + C.title;
        const st = steps();
        let n = 1;
        const cards = [memberCard(n++), daysCard(n++)];
        C.sections.forEach((sec, i) => cards.push(sectionCard(sec, i, n++)));
        cards.push(overallCard(n++), filesCard(n++), signCard(n++));

        document.body.innerHTML = `
            <header class="rp-header"><div class="rp-header-inner">
                <img src="${A.PATCH_IMG || ''}" alt="CFD Training Division">
                <div><div class="rp-dept">Centerville Fire Department</div><div class="rp-title">${esc(C.title)}</div></div>
                <a class="home" href="../monthly-evaluations/">← All evaluations</a>
            </div></header>
            <nav class="rp-steps"><div class="rp-steps-inner">
                ${st.map((s, i) => `<a class="rp-step" href="#${s.id}" data-step="${s.id}"><span class="n">${i + 1}</span>${esc(s.t)}</a>`).join('')}
            </div></nav>
            <main class="rp-main"><form id="reportForm" autocomplete="off" novalidate>${cards.join('')}</form></main>
            <div class="rp-motto">Punctual · Valuable · Selfless</div>
            <div class="rp-actions"><div class="rp-actions-inner">
                <span class="rp-saved" id="saved"></span>
                <button type="button" class="rp-btn" id="btn-clear">Clear</button>
                <button type="button" class="rp-btn" id="btn-preview">Preview PDF</button>
                <button type="button" class="rp-btn dl" id="btn-download">Download PDF</button>
                <button type="button" class="rp-btn primary" id="btn-submit">Submit Report</button>
            </div></div>
            <div class="rp-modal-back" id="modal"><div class="rp-modal" role="dialog" aria-modal="true"></div></div>
            <div class="rp-toast" id="toast"></div>`;
    }

    // ─────────────────────────────── days ───────────────────────────────
    function renderDays() {
        const wrap = $('#days');
        const b = monthBounds(monthValue());
        if (!state.days.length) {
            wrap.innerHTML = `<div class="rp-empty">No days added yet. Add each day you evaluated in ${esc(monthLabel(monthValue()) || 'this month')}.</div>`;
        } else {
            const assignList = C.dayAssignments || [];
            wrap.innerHTML = state.days.map((d, i) => {
                const problems = dayProblems(d, i);
                return `<div class="rp-day${problems.length ? ' bad' : ''}" data-day="${d.id}">
                    <div class="rp-field"><label>Day ${i + 1} · Date *</label><input type="date" data-f="date" value="${esc(d.date)}" ${b ? `min="${b.min}" max="${b.max}"` : ''}></div>
                    <div class="rp-field"><label>Shift</label><select data-f="shift">${options(C.shifts)}</select></div>
                    <div class="rp-field assign"><label>Assignment / Activity</label><input type="text" data-f="activity" list="assign-list" value="${esc(d.activity)}" placeholder="${esc(C.dayActivityHint || 'e.g. Engine 1 · 2 calls · hose drill')}"></div>
                    <button type="button" class="del" data-del-day title="Remove this day" aria-label="Remove day ${i + 1}">✕</button>
                    <div class="rp-field note"><textarea data-f="note" placeholder="Notes for this day (optional) — what you saw, calls run, training done">${esc(d.note)}</textarea></div>
                    ${problems.length ? `<div class="rp-day-warn">${esc(problems.join(' · '))}</div>` : ''}
                </div>`;
            }).join('') + `<datalist id="assign-list">${assignList.map(a => `<option value="${esc(a)}">`).join('')}</datalist>`;
            state.days.forEach(d => {
                const sel = $(`[data-day="${d.id}"] select[data-f="shift"]`);
                if (sel) sel.value = d.shift || '';
            });
        }
        renderDaysSummary();
    }

    function dayProblems(d, i) {
        const p = [];
        const b = monthBounds(monthValue());
        if (!d.date) p.push('Pick the date');
        else if (b && (d.date < b.min || d.date > b.max)) p.push(`${dayLabel(d.date, true)} is not in ${monthLabel(monthValue())}`);
        if (d.date && state.days.some((o, j) => j < i && o.date === d.date)) p.push('Same date as an earlier day');
        return p;
    }

    function renderDaysSummary() {
        const el = $('#days-summary');
        const dated = state.days.filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
        el.innerHTML = dated.length
            ? `<b>${dated.length} day${dated.length === 1 ? '' : 's'} evaluated</b> · ${esc(dated.map(d => dayLabel(d.date)).join(', '))}`
            : '';
    }

    function addDay() {
        const b = monthBounds(monthValue());
        const t = todayIso();
        const used = new Set(state.days.map(d => d.date));
        const date = b && t >= b.min && t <= b.max && !used.has(t) ? t : '';
        state.days.push({ id: uid(), date, shift: ($('#f-shift') || {}).value || '', activity: '', note: '' });
        renderDays();
        const last = $$('.rp-day').pop();
        if (last) { const inp = $('input[data-f="date"]', last); inp && inp.focus(); }
        changed();
    }

    // ─────────────────────────────── attachments ───────────────────────────────
    function guessCategory(file) {
        if (/^image\//.test(file.type) || /\.(heic|heif|jpe?g|png|gif|webp)$/i.test(file.name)) return 'Picture';
        if (/training|sheet/i.test(file.name)) return 'Training Sheet';
        return 'Report';
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => resolve({ img, url });
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not decodable')); };
            img.src = url;
        });
    }
    function canvasBlob(canvas, type, q) { return new Promise(r => canvas.toBlob(r, type, q)); }
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
            fr.onerror = reject;
            fr.readAsDataURL(blob);
        });
    }

    // Photos straight off a phone are 3–8 MB each; resized to 2400 px they are
    // a few hundred KB and still sharp enough to read a label in. Anything the
    // browser can't decode (HEIC outside Safari, PDFs, documents) goes as-is.
    async function prepare(entry) {
        const f = entry.file;
        let blob = f, name = f.name;
        if (/^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name)) {
            try {
                const { img, url } = await loadImage(f);
                const w = img.naturalWidth, h = img.naturalHeight;
                const scale = Math.min(1, 2400 / Math.max(w, h));
                if (scale < 1 || f.size > 1.5 * MB || /heic|heif/i.test(f.type + f.name)) {
                    const cv = document.createElement('canvas');
                    cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
                    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                    const out = await canvasBlob(cv, 'image/jpeg', 0.85);
                    if (out && out.size < f.size) { blob = out; name = f.name.replace(/\.[^.]+$/, '') + '.jpg'; }
                }
                const ts = Math.min(1, 360 / Math.max(w, h));
                const tc = document.createElement('canvas');
                tc.width = Math.max(1, Math.round(w * ts)); tc.height = Math.max(1, Math.round(h * ts));
                tc.getContext('2d').drawImage(img, 0, 0, tc.width, tc.height);
                entry.thumb = tc.toDataURL('image/jpeg', 0.7);
                entry.thumbW = tc.width; entry.thumbH = tc.height;
                URL.revokeObjectURL(url);
            } catch (e) { /* keep original */ }
        }
        entry.blob = blob;
        entry.sendName = name;
        entry.size = blob.size;
        entry.ready = true;
    }

    async function addFiles(list) {
        const incoming = Array.from(list || []);
        for (const f of incoming) {
            if (f.size > MAX_FILE && !/^image\//.test(f.type)) {
                toast(`${f.name} is ${fmtSize(f.size)} — the limit is ${fmtSize(MAX_FILE)} per file`);
                continue;
            }
            const entry = { id: uid(), file: f, name: f.name, size: f.size, category: guessCategory(f), ready: false };
            state.files.push(entry);
            renderFiles();
            await prepare(entry);
            if (entry.size > MAX_FILE) {
                state.files = state.files.filter(x => x !== entry);
                toast(`${f.name} is still ${fmtSize(entry.size)} after resizing — too large to email`);
            }
            renderFiles();
        }
        changed();
    }

    function totalSize() { return state.files.reduce((a, f) => a + (f.size || 0), 0); }

    function renderFiles() {
        const wrap = $('#files');
        wrap.innerHTML = state.files.map(f => {
            const ext = (f.name.split('.').pop() || '').slice(0, 4).toUpperCase();
            const thumb = f.thumb ? `<img class="thumb" src="${f.thumb}" alt="">` : `<div class="thumb">${esc(ext || 'FILE')}</div>`;
            return `<div class="rp-file" data-file="${f.id}">
                ${thumb}
                <div style="min-width:0"><div class="name" title="${esc(f.name)}">${esc(f.name)}</div>
                    <div class="size">${f.ready ? fmtSize(f.size) + (f.sendName && f.sendName !== f.name ? ' · resized' : '') : 'Preparing…'}</div></div>
                <select data-cat aria-label="Type of attachment">${CATEGORIES.map(c => `<option${c === f.category ? ' selected' : ''}>${c}</option>`).join('')}</select>
                <button type="button" class="del" data-del-file aria-label="Remove ${esc(f.name)}">✕</button>
            </div>`;
        }).join('');
        const meter = $('#meter');
        meter.hidden = !state.files.length;
        const total = totalSize();
        meter.classList.toggle('over', total > MAX_TOTAL);
        $('i', meter).style.width = Math.min(100, total / MAX_TOTAL * 100) + '%';
        $('.rp-meter-text', meter).textContent = `${state.files.length} file${state.files.length === 1 ? '' : 's'} · ${fmtSize(total)} of ${fmtSize(MAX_TOTAL)}` +
            (total > MAX_TOTAL ? ' — too much to email; remove some files' : '');
        updateProgress();
    }

    // ─────────────────────────────── signature ───────────────────────────────
    function setupSignature() {
        const canvas = $('#sig');
        pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)', penColor: '#1e3a8a' });
        pad.addEventListener('beginStroke', () => {
            if (state.sigSource === 'dorman') { pad.clear(); }
            state.sigSource = 'drawn';
            $('#sig-tag').hidden = true;
            $('#sig-hint').hidden = true;
        });
        pad.addEventListener('endStroke', () => changed());
        const resize = () => {
            const data = state.sigSource === 'drawn' ? pad.toData() : null;
            const r = Math.max(window.devicePixelRatio || 1, 1);
            canvas.width = canvas.offsetWidth * r;
            canvas.height = canvas.offsetHeight * r;
            canvas.getContext('2d').scale(r, r);
            pad.clear();
            if (data && data.length) pad.fromData(data);
            if (state.sigSource === 'dorman') drawDorman();
        };
        window.addEventListener('resize', resize);
        resize();
        $('#sig-clear').onclick = () => { pad.clear(); state.sigSource = null; $('#sig-tag').hidden = true; $('#sig-hint').hidden = false; changed(); };
        $('#sig-undo').onclick = () => {
            if (state.sigSource === 'dorman') { $('#sig-clear').onclick(); return; }
            const d = pad.toData(); d.pop(); pad.fromData(d);
            if (!d.length) { state.sigSource = null; $('#sig-hint').hidden = false; }
            changed();
        };
    }

    function drawDorman() {
        if (!A.DORMAN_SIG) return;
        const canvas = $('#sig');
        const img = new Image();
        img.onload = () => {
            pad.clear();
            const r = Math.max(window.devicePixelRatio || 1, 1);
            const cw = canvas.width / r, ch = canvas.height / r;
            const s = Math.min((cw * 0.6) / img.width, (ch * 0.7) / img.height);
            canvas.getContext('2d').drawImage(img, (cw - img.width * s) / 2, (ch - img.height * s) / 2, img.width * s, img.height * s);
        };
        img.src = A.DORMAN_SIG;
    }

    // Sgt. Dorman's reports sign themselves, as they always have.
    function officerChanged() {
        const off = $('#f-officer').value;
        const name = $('#f-evname'), rank = $('#f-evrank');
        if (off === 'Sergeant Dorman') {
            if (!name.value || name.value === 'Dorman, David') { name.value = 'Dorman, David'; rank.value = 'Sergeant'; }
            if (state.sigSource !== 'drawn' && name.value === 'Dorman, David') {
                state.sigSource = 'dorman';
                $('#sig-tag').hidden = false;
                $('#sig-hint').hidden = true;
                drawDorman();
            }
        } else if (state.sigSource === 'dorman') {
            pad.clear(); state.sigSource = null;
            $('#sig-tag').hidden = true; $('#sig-hint').hidden = false;
            if (name.value === 'Dorman, David') { name.value = ''; rank.value = ''; }
        }
    }

    // ─────────────────────────────── data ───────────────────────────────
    function collect() {
        const d = {};
        $$('#reportForm [name]').forEach(el => {
            if (el.type === 'file') return;
            if (el.type === 'checkbox') { if (el.checked) (d[el.name] = d[el.name] || []).push(el.value); }
            else if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; }
            else if (el.value) d[el.name] = el.value;
        });
        return d;
    }

    function sortedDays() {
        return state.days.filter(x => x.date).slice().sort((a, b) => a.date.localeCompare(b.date));
    }

    function tally(d) {
        const t = {};
        RATINGS.forEach(r => t[r.v] = 0);
        let rated = 0, total = 0;
        C.sections.forEach(s => s.items.forEach(it => {
            total++;
            const v = d[it.key + ' Rating'];
            if (v) { rated++; t[v] = (t[v] || 0) + 1; }
        }));
        return { t, rated, total };
    }

    function save() {
        try {
            localStorage.setItem(C.storageKey, JSON.stringify({ v: 2, fields: collect(), days: state.days, savedAt: Date.now() }));
            const t = new Date();
            $('#saved').textContent = 'Draft saved ' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        } catch (e) { /* storage full or blocked — the form still works */ }
    }

    function restore() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(C.storageKey) || 'null'); } catch (e) { saved = null; }
        if (!saved || saved.v !== 2) return false;
        const f = saved.fields || {};
        Object.keys(f).forEach(k => {
            $$(`#reportForm [name="${CSS.escape(k)}"]`).forEach(el => {
                if (el.type === 'checkbox') el.checked = Array.isArray(f[k]) && f[k].includes(el.value);
                else if (el.type === 'radio') el.checked = el.value === f[k];
                else if (!el.readOnly) el.value = f[k];
            });
        });
        state.days = Array.isArray(saved.days) ? saved.days.map(x => ({ id: x.id || uid(), date: x.date || '', shift: x.shift || '', activity: x.activity || '', note: x.note || '' })) : [];
        $$('.rp-item').forEach(it => {
            const ta = $('textarea', it);
            if (ta.value) { $('.rp-note', it).hidden = false; $('[data-note-toggle]', it).textContent = '− Note'; }
        });
        return true;
    }

    function changed() {
        state.sent = false;
        updateProgress();
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(save, 350);
    }

    // ─────────────────────────────── progress & validation ───────────────────────────────
    function problems() {
        const d = collect();
        const out = [];
        const need = (ok, label, target, step) => { if (!ok) out.push({ label, target, step }); };
        need(parseMonth(d['Evaluation Month']), 'Evaluation month', '#f-month', 's-member');
        need(d[C.memberField], C.memberLabel, '#f-member', 's-member');
        need(d['Shift'], 'Assigned shift', '#f-shift', 's-member');
        need(d['Officer'], C.officerLabel || 'Officer', '#f-officer', 's-member');
        if (C.apparatus && C.apparatus.mode === 'single') need(d['Apparatus Assignment'], C.apparatus.label, '#f-apparatus', 's-member');
        if (!state.days.length) out.push({ label: 'At least one day evaluated', target: '#add-day', step: 's-days' });
        state.days.forEach((x, i) => dayProblems(x, i).forEach(p => out.push({ label: `Day ${i + 1}: ${p}`, target: `[data-day="${x.id}"] input`, step: 's-days' })));
        C.sections.forEach((s, i) => s.items.forEach(it => need(d[it.key + ' Rating'], `${it.key} rating`, '#r-' + slug(it.key), 's-sec-' + i)));
        need(d[C.overall.ratingField], C.overall.ratingLabel || C.overall.ratingField, '#f-overall', 's-overall');
        need(d[C.overall.resultField], C.overall.resultLabel || C.overall.resultField, '#f-result', 's-overall');
        if (totalSize() > MAX_TOTAL) out.push({ label: `Attachments total ${fmtSize(totalSize())} — remove some (limit ${fmtSize(MAX_TOTAL)})`, target: '#files', step: 's-files' });
        if (state.files.some(f => !f.ready)) out.push({ label: 'Attachments are still being prepared — wait a moment', target: '#files', step: 's-files' });
        need(d['Evaluator Name'], 'Evaluator name', '#f-evname', 's-sign');
        need(d['Evaluator Rank'], 'Evaluator rank', '#f-evrank', 's-sign');
        need(state.sigSource, 'Evaluator signature', '#sig-box', 's-sign');
        return out;
    }

    function updateProgress() {
        const probs = problems();
        const byStep = {};
        probs.forEach(p => (byStep[p.step] = (byStep[p.step] || 0) + 1));
        const d = collect();
        $$('[data-step]').forEach(a => {
            const id = a.dataset.step;
            a.classList.remove('done', 'partial');
            if (id === 's-files') { if (state.files.length && !byStep[id]) a.classList.add('done'); else if (byStep[id]) a.classList.add('partial'); return; }
            if (!byStep[id]) a.classList.add('done');
            else if (touched(id, d)) a.classList.add('partial');
        });
        C.sections.forEach((s, i) => {
            const rated = s.items.filter(it => d[it.key + ' Rating']).length;
            const m = $(`#s-sec-${i} [data-meta]`);
            m.textContent = `${rated}/${s.items.length} rated`;
            m.classList.toggle('ok', rated === s.items.length);
        });
        const dm = $('#s-days [data-meta]');
        const n = sortedDays().length;
        dm.textContent = n ? `${n} day${n === 1 ? '' : 's'}` : '';
        dm.classList.toggle('ok', n > 0 && !byStep['s-days']);
        const fm = $('#s-files [data-meta]');
        fm.innerHTML = state.files.length ? `${state.files.length} file${state.files.length === 1 ? '' : 's'}` : '<span style="font-weight:600">Optional</span>';
        const t = tally(d);
        $('#tally').innerHTML = `<span>${t.rated}/${t.total} items rated</span>` +
            RATINGS.filter(r => t.t[r.v]).map(r => `<span class="${r.cls}">${t.t[r.v]} ${esc(r.v)}</span>`).join('');
        renderDaysSummary();
    }

    function touched(id, d) {
        if (id === 's-member') return !!(d[C.memberField] || d['Shift'] || d['Officer']);
        if (id === 's-days') return state.days.length > 0;
        if (id.startsWith('s-sec-')) return C.sections[+id.slice(6)].items.some(it => d[it.key + ' Rating']);
        if (id === 's-overall') return !!(d[C.overall.ratingField] || d[C.overall.resultField]);
        if (id === 's-sign') return !!(d['Evaluator Name'] || state.sigSource);
        return false;
    }

    function goTo(target, step) {
        const sec = document.getElementById(step);
        if (sec) sec.classList.remove('collapsed');
        const el = $(target);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const focusable = el.matches('input,select,textarea,button') ? el : $('input,select,textarea,button', el);
        el.classList.add('missing');
        if (el.matches('input,select,textarea')) el.classList.add('rp-invalid');
        setTimeout(() => focusable && focusable.focus({ preventScroll: true }), 350);
    }

    function showProblems(list, verb) {
        modal('warn', 'A few things still need filling in', `<p>Before you can ${verb}:</p><ul>${list.slice(0, 14).map((p, i) =>
            `<li><a href="#" data-go="${i}">${esc(p.label)}</a></li>`).join('')}${list.length > 14 ? `<li>…and ${list.length - 14} more</li>` : ''}</ul>`,
            [{ t: 'Take me to the first one', primary: true, fn: () => goTo(list[0].target, list[0].step) }, { t: 'Close' }]);
        $$('[data-go]', $('#modal')).forEach(a => a.onclick = e => { e.preventDefault(); closeModal(); const p = list[+a.dataset.go]; goTo(p.target, p.step); });
    }

    // ─────────────────────────────── modal & toast ───────────────────────────────
    function modal(kind, title, html, buttons) {
        const back = $('#modal');
        const box = $('.rp-modal', back);
        box.className = 'rp-modal ' + (kind || '');
        box.innerHTML = `<div class="rp-modal-body"><h3>${esc(title)}</h3>${html}</div><div class="rp-modal-foot"></div>`;
        const foot = $('.rp-modal-foot', box);
        (buttons || [{ t: 'Close' }]).forEach(b => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rp-btn' + (b.primary ? ' primary' : '');
            btn.textContent = b.t;
            btn.onclick = () => { if (!b.keepOpen) closeModal(); b.fn && b.fn(); };
            foot.appendChild(btn);
        });
        back.classList.add('open');
    }
    function closeModal() { $('#modal').classList.remove('open'); }
    function toast(msg) {
        const t = $('#toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(t._h);
        t._h = setTimeout(() => t.classList.remove('show'), 3200);
    }

    // ─────────────────────────────── PDF ───────────────────────────────
    const pdfText = s => String(s == null ? '' : s).replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

    async function buildPDF() {
        const d = collect();
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true });
        const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
        const M = 14, PW = W - 2 * M;
        const SLATE = [44, 62, 80], RED = [183, 28, 28], INK = [34, 39, 46], DIM = [107, 112, 121], LINE = [223, 220, 212], SOFT = [247, 246, 242];
        const member = d[C.memberField] || '';
        const month = monthLabel(d['Evaluation Month']);
        let y = 0;

        const font = (style, size, color) => { pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(...(color || INK)); };
        const need = h => { if (y + h > H - 18) { pdf.addPage(); slimHeader(); } };

        function fullHeader() {
            pdf.setFillColor(...SLATE); pdf.rect(0, 0, W, 40, 'F');
            pdf.setFillColor(...RED); pdf.rect(0, 40, W, 1.8, 'F');
            try { pdf.addImage(A.PATCH_IMG, 'PNG', M, 6, 28, 28, 'patch', 'FAST'); } catch (e) { }
            font('bold', 9, [255, 255, 255]); pdf.text('CENTERVILLE FIRE DEPARTMENT · TRAINING DIVISION', M + 34, 13);
            font('bold', 17, [255, 255, 255]); pdf.text(pdfText(C.title), M + 34, 22);
            font('normal', 11, [255, 170, 160]); pdf.text(pdfText(`${member}  ·  ${month}`), M + 34, 30);
            y = 49;
        }
        function slimHeader() {
            pdf.setFillColor(...SLATE); pdf.rect(0, 0, W, 16, 'F');
            pdf.setFillColor(...RED); pdf.rect(0, 16, W, 1.2, 'F');
            font('bold', 9.5, [255, 255, 255]); pdf.text(pdfText(C.title), M, 10);
            font('normal', 9.5, [255, 190, 180]); pdf.text(pdfText(`${member} · ${month}`), W - M, 10, { align: 'right' });
            y = 24;
        }
        function heading(t) {
            need(16);
            font('bold', 10.5, RED); pdf.text(pdfText(t.toUpperCase()), M, y + 4);
            pdf.setDrawColor(...RED); pdf.setLineWidth(0.5); pdf.line(M, y + 6.2, M + PW, y + 6.2);
            y += 10;
        }
        function pill(text, rgb, xRight, yTop) {
            font('bold', 8, [255, 255, 255]);
            const w = pdf.getTextWidth(text) + 6;
            pdf.setFillColor(...rgb); pdf.roundedRect(xRight - w, yTop, w, 5.4, 2.4, 2.4, 'F');
            pdf.text(text, xRight - w / 2, yTop + 3.8, { align: 'center' });
            return w;
        }
        function ratingRgb(v) { const r = RATINGS.find(x => x.v === v); return r ? r.rgb : DIM; }
        function kvGrid(rows) {
            const colW = PW / 2;
            for (let i = 0; i < rows.length; i += 2) {
                const pair = rows.slice(i, i + 2);
                const hts = pair.map(([, v]) => pdf.splitTextToSize(pdfText(v || '—'), colW - 6).length);
                const h = Math.max(...hts) * 4.4 + 7;
                need(h);
                pair.forEach(([k, v], j) => {
                    const x = M + j * colW;
                    font('bold', 7, DIM); pdf.text(pdfText(k.toUpperCase()), x, y + 3);
                    font('normal', 10, INK); pdf.text(pdf.splitTextToSize(pdfText(v || '—'), colW - 6), x, y + 7.6);
                });
                y += h;
            }
            y += 2;
        }
        function paragraph(label, text) {
            if (!text) return;
            const lines = pdf.splitTextToSize(pdfText(text), PW);
            need(8 + lines.length * 4.4);
            font('bold', 7, DIM); pdf.text(pdfText(label.toUpperCase()), M, y + 3);
            font('normal', 10, INK); pdf.text(lines, M, y + 7.6);
            y += 8 + lines.length * 4.4;
        }

        fullHeader();

        // Who, when
        heading('Evaluation');
        const kv = [
            [C.memberLabel, member],
            ['Evaluation Month', month],
            ['Assigned Shift', d['Shift']],
            [C.officerLabel || 'Officer', d['Officer']]
        ];
        if (C.apparatus && C.apparatus.mode === 'multi') kv.push([C.apparatus.label, (d['Apparatus'] || []).join(', ') || 'None']);
        if (C.apparatus && C.apparatus.mode === 'single') kv.push([C.apparatus.label, d['Apparatus Assignment'] + (C.apparatus.details && C.apparatus.details[d['Apparatus Assignment']] ? ' — ' + C.apparatus.details[d['Apparatus Assignment']] : '')]);
        if (C.apparatus && C.apparatus.mode === 'fixed') kv.push(['Apparatus', `${d['Apparatus Assignment'] || ''} — ${d['Apparatus Type'] || ''}`]);
        (C.extraFields || []).forEach(f => { if (d[f.name]) kv.push([f.label || f.name, d[f.name]]); });
        kv.push(['Days Evaluated', String(sortedDays().length)]);
        kvGrid(kv);

        // Days table
        heading(`Days Evaluated (${sortedDays().length})`);
        const cols = [{ t: 'Date', w: 38 }, { t: 'Shift', w: 26 }, { t: 'Assignment / Activity', w: PW - 64 }];
        need(9);
        pdf.setFillColor(...SOFT); pdf.rect(M, y, PW, 6.5, 'F');
        let cx = M + 2;
        cols.forEach(c => { font('bold', 7.5, DIM); pdf.text(c.t.toUpperCase(), cx, y + 4.4); cx += c.w; });
        y += 8;
        sortedDays().forEach(day => {
            const act = pdf.splitTextToSize(pdfText(day.activity || '—'), cols[2].w - 4);
            const note = day.note ? pdf.splitTextToSize(pdfText(day.note), PW - 8) : [];
            const h = Math.max(1, act.length) * 4.3 + (note.length ? note.length * 3.9 + 1.5 : 0) + 3;
            need(h + 1);
            font('bold', 9.5, INK); pdf.text(pdfText(dayLabel(day.date)), M + 2, y + 3.6);
            font('normal', 9.5, INK); pdf.text(pdfText(day.shift || '—'), M + 2 + cols[0].w, y + 3.6);
            pdf.text(act, M + 2 + cols[0].w + cols[1].w, y + 3.6);
            if (note.length) { font('italic', 8.8, DIM); pdf.text(note, M + 6, y + 3.6 + act.length * 4.3 + 0.6); }
            y += h;
            pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(M, y - 1, M + PW, y - 1);
        });
        y += 3;

        // Overall
        heading('Overall Month Evaluation');
        const t = tally(d);
        need(12);
        let px = M;
        RATINGS.forEach(r => {
            if (!t.t[r.v]) return;
            const label = `${t.t[r.v]} ${r.v}`;
            font('bold', 8, [255, 255, 255]);
            const w = pdf.getTextWidth(label) + 6;
            pdf.setFillColor(...r.rgb); pdf.roundedRect(px, y, w, 5.4, 2.4, 2.4, 'F');
            pdf.text(label, px + w / 2, y + 3.8, { align: 'center' });
            px += w + 2.5;
        });
        y += 9;
        need(14);
        font('bold', 7, DIM); pdf.text(pdfText((C.overall.ratingLabel || C.overall.ratingField).toUpperCase()), M, y + 3);
        const overallText = pdfText(d[C.overall.ratingField] || '—');
        font('bold', 8, [255, 255, 255]);
        pill(overallText, ratingRgb(d[C.overall.ratingField]), M + pdf.getTextWidth(overallText) + 6, y + 4.6);
        font('bold', 7, DIM); pdf.text(pdfText((C.overall.resultLabel || C.overall.resultField).toUpperCase()), M + PW / 2 + 4, y + 3);
        font('bold', 10, INK); pdf.text(pdf.splitTextToSize(pdfText(d[C.overall.resultField] || '—'), PW / 2 - 6), M + PW / 2 + 4, y + 8.4);
        y += 15;
        C.overall.narratives.forEach(f => paragraph(f.label || f.name, d[f.name]));

        // Sections
        C.sections.forEach(sec => {
            heading(sec.title);
            sec.items.forEach(it => {
                const v = d[it.key + ' Rating'] || '—';
                const note = d[it.key + ' Note'];
                const noteLines = note ? pdf.splitTextToSize(pdfText(note), PW - 10) : [];
                const h = 7 + (noteLines.length ? noteLines.length * 3.9 + 1.5 : 0);
                need(h + 1);
                font('bold', 9.8, INK); pdf.text(pdfText(it.key), M + 1, y + 4.2);
                pill(pdfText(v), ratingRgb(v), M + PW, y + 0.4);
                if (noteLines.length) { font('italic', 8.8, DIM); pdf.text(noteLines, M + 5, y + 8.6); }
                y += h;
                pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(M, y, M + PW, y);
                y += 1.2;
            });
            y += 3;
        });

        // Attachments
        if (state.files.length) {
            heading(`Attachments (${state.files.length})`);
            state.files.forEach(f => {
                need(6);
                font('bold', 9, INK); pdf.text(pdfText(f.category), M + 1, y + 3.6);
                font('normal', 9, INK); pdf.text(pdf.splitTextToSize(pdfText(f.sendName || f.name), PW - 60)[0], M + 32, y + 3.6);
                font('normal', 8.5, DIM); pdf.text(fmtSize(f.size || 0), M + PW, y + 3.6, { align: 'right' });
                y += 5.6;
            });
            const pics = state.files.filter(f => f.thumb).slice(0, 12);
            if (pics.length) {
                y += 3;
                const cell = (PW - 3 * 4) / 4;
                for (let i = 0; i < pics.length; i += 4) {
                    need(cell + 4);
                    pics.slice(i, i + 4).forEach((p, j) => {
                        const s = Math.min(cell / p.thumbW, cell / p.thumbH);
                        const w = p.thumbW * s, h = p.thumbH * s;
                        const x = M + j * (cell + 4) + (cell - w) / 2;
                        pdf.setFillColor(...SOFT); pdf.rect(M + j * (cell + 4), y, cell, cell, 'F');
                        try { pdf.addImage(p.thumb, 'JPEG', x, y + (cell - h) / 2, w, h, undefined, 'FAST'); } catch (e) { }
                    });
                    y += cell + 4;
                }
            }
            y += 2;
        }

        // Evaluator
        heading('Evaluator');
        need(34);
        kvGrid([['Evaluator', d['Evaluator Name']], ['Rank', d['Evaluator Rank']]]);
        font('bold', 7, DIM); pdf.text('SIGNATURE', M, y + 3);
        try {
            if (state.sigSource === 'dorman') {
                const pr = pdf.getImageProperties(A.DORMAN_SIG);
                const s = Math.min(55 / pr.width, 20 / pr.height);
                pdf.addImage(A.DORMAN_SIG, 'PNG', M, y + 5, pr.width * s, pr.height * s, 'dsig', 'FAST');
            } else if (state.sigSource === 'drawn') {
                pdf.addImage(pad.toDataURL('image/jpeg', 0.7), 'JPEG', M, y + 5, 60, 20, undefined, 'FAST');
            }
        } catch (e) { }
        font('normal', 8, DIM);
        pdf.text('Generated ' + new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }), M + PW, y + 24, { align: 'right' });
        y += 28;

        // Footer
        const pages = pdf.internal.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
            pdf.setPage(i);
            pdf.setDrawColor(...RED); pdf.setLineWidth(0.3); pdf.line(M, H - 13, W - M, H - 13);
            font('bold', 7.5, RED); pdf.text('PUNCTUAL · VALUABLE · SELFLESS', W / 2, H - 8.5, { align: 'center' });
            font('normal', 7.5, DIM); pdf.text(`Page ${i} of ${pages}`, W - M, H - 8.5, { align: 'right' });
        }
        return pdf;
    }

    function fileBase() {
        const d = collect();
        return `${C.shortTitle}_Monthly_${(d[C.memberField] || 'report').replace(/[^A-Za-z0-9]+/g, '_')}_${monthLabel(d['Evaluation Month']).replace(/\s+/g, '_')}`.replace(/_+/g, '_');
    }

    async function previewPDF(download) {
        const probs = problems();
        if (probs.length) { showProblems(probs, download ? 'download the PDF' : 'preview the PDF'); return; }
        const pdf = await buildPDF();
        const blob = pdf.output('blob');
        const url = URL.createObjectURL(blob);
        let opened = null;
        if (!download) opened = window.open(url, '_blank');
        if (download || !opened) {
            const a = document.createElement('a');
            a.href = url; a.download = fileBase() + '.pdf';
            document.body.appendChild(a); a.click(); a.remove();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // ─────────────────────────────── submit ───────────────────────────────
    function sentKey(d) { return `cfdMonthlySent|${C.id}|${d[C.memberField] || ''}|${d['Evaluation Month'] || ''}`; }

    async function submit() {
        const probs = problems();
        if (probs.length) { showProblems(probs, 'submit'); return; }
        const d = collect();
        let prev = null;
        try { prev = localStorage.getItem(sentKey(d)); } catch (e) { }
        if (prev) {
            modal('warn', 'This report was already sent', `<p>A ${esc(C.title)} for <b>${esc(d[C.memberField])}</b>, ${esc(monthLabel(d['Evaluation Month']))}, was sent from this device on ${esc(new Date(+prev).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}.</p><p>Only send it again if you are correcting it.</p>`,
                [{ t: 'Cancel' }, { t: 'Send again', primary: true, fn: () => send(d) }]);
            return;
        }
        send(d);
    }

    async function send(d) {
        const btn = $('#btn-submit');
        btn.disabled = true; btn.textContent = 'Sending…';
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
        try {
            const pdf = await buildPDF();
            const pdfB64 = pdf.output('datauristring').split(',')[1];
            const month = monthLabel(d['Evaluation Month']);
            const used = new Set();
            const attachments = [{ filename: fileBase() + '.pdf', content: pdfB64 }];
            for (const f of state.files) {
                let name = `${f.category} - ${f.sendName || f.name}`.replace(/[\\/:*?"<>|]+/g, '_');
                let n = 2, base = name;
                while (used.has(name.toLowerCase())) name = base.replace(/(\.[^.]+)?$/, m => ` (${n++})` + (m || ''));
                used.add(name.toLowerCase());
                attachments.push({ filename: name, content: await blobToBase64(f.blob || f.file) });
            }
            const t = tally(d);
            const days = sortedDays();
            const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7079;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v || '—')}</b></td></tr>`;
            const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#22272e;max-width:640px">
                <h2 style="margin:0 0 4px;color:#b71c1c">${esc(C.title)}</h2>
                <div style="color:#6b7079;margin-bottom:12px">${esc(d[C.memberField])} · ${esc(month)}</div>
                <table style="border-collapse:collapse;font-size:14px">
                    ${row(C.memberLabel, d[C.memberField])}${row('Month', month)}${row('Assigned shift', d['Shift'])}${row(C.officerLabel || 'Officer', d['Officer'])}
                    ${row(C.overall.ratingLabel || C.overall.ratingField, d[C.overall.ratingField])}${row(C.overall.resultLabel || C.overall.resultField, d[C.overall.resultField])}
                    ${row('Items rated', RATINGS.filter(r => t.t[r.v]).map(r => `${t.t[r.v]} ${r.v}`).join(', '))}
                    ${row('Evaluator', `${d['Evaluator Name'] || ''} (${d['Evaluator Rank'] || ''})`)}
                </table>
                <h3 style="margin:16px 0 6px;font-size:15px">Days evaluated (${days.length})</h3>
                <ul style="margin:0;padding-left:18px;font-size:14px">${days.map(x => `<li><b>${esc(dayLabel(x.date))}</b>${x.shift ? ' · ' + esc(x.shift) : ''}${x.activity ? ' — ' + esc(x.activity) : ''}</li>`).join('')}</ul>
                ${state.files.length ? `<h3 style="margin:16px 0 6px;font-size:15px">Attachments (${state.files.length})</h3><ul style="margin:0;padding-left:18px;font-size:14px">${state.files.map(f => `<li>${esc(f.category)} — ${esc(f.sendName || f.name)} (${fmtSize(f.size)})</li>`).join('')}</ul>` : ''}
                <p style="color:#6b7079;font-size:13px;margin-top:16px">The full report is attached as a PDF.</p></div>`;

            const res = await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: ctrl.signal,
                body: JSON.stringify({
                    // The endpoint no longer guesses a recipient (2026-07-26), so the
                    // report names it — these reports had been failing without it.
                    to: C.email.to,
                    from_name: 'CFD Training Division',
                    subject: `${C.email.subjectPrefix} — ${d[C.memberField]} — ${month} (${days.length} day${days.length === 1 ? '' : 's'})`,
                    html,
                    attachments
                })
            });
            let result = {};
            try { result = await res.json(); } catch (e) { result = { error: 'The server sent back something unreadable (HTTP ' + res.status + ')' }; }
            if (!res.ok || !result.success) throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error || ('HTTP ' + res.status)));

            try { localStorage.setItem(sentKey(d), String(Date.now())); localStorage.removeItem(C.storageKey); } catch (e) { }
            state.sent = true;
            modal('ok', 'Report sent', `<p><b>${esc(C.title)}</b> for ${esc(d[C.memberField])}, ${esc(month)}, was emailed to ${esc(C.email.to.join(', '))} with the PDF${state.files.length ? ` and ${state.files.length} attachment${state.files.length === 1 ? '' : 's'}` : ''}.</p>`,
                [{ t: 'Close' }, { t: 'Start a new report', primary: true, fn: () => resetForm(true) }]);
        } catch (err) {
            const msg = err.name === 'AbortError' ? 'It took too long — the connection may have dropped.' : (err.message || 'Unknown error');
            modal('bad', 'STOP — this report did NOT send', `<p>Training has not received it. Nothing was lost; the form is still filled in.</p><p style="font-family:monospace;font-size:.8rem;color:#8a1c1c">${esc(msg)}</p><p>Try again, or download the PDF and email it to ${esc(C.email.to.join(', '))} yourself.</p>`,
                [{ t: 'Download PDF', fn: () => previewPDF(true) }, { t: 'Try again', primary: true, fn: () => send(d) }]);
        } finally {
            clearTimeout(timer);
            btn.disabled = false; btn.textContent = 'Submit Report';
        }
    }

    function resetForm(skipConfirm) {
        const go = () => {
            $('#reportForm').reset();
            $$('.rp-note').forEach(n => n.hidden = true);
            $$('[data-note-toggle]').forEach(b => b.textContent = '＋ Note');
            state.days = []; state.files = []; state.sigSource = null;
            pad.clear(); $('#sig-tag').hidden = true; $('#sig-hint').hidden = false;
            try { localStorage.removeItem(C.storageKey); } catch (e) { }
            defaults();
            renderDays(); renderFiles(); updateProgress();
            $('#saved').textContent = '';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        if (skipConfirm) go();
        else modal('warn', 'Clear this report?', '<p>Everything you have entered, the days, attachments and the signature will be removed.</p>',
            [{ t: 'Keep it' }, { t: 'Clear everything', primary: true, fn: go }]);
    }

    function defaults() {
        const t = new Date();
        const m = $('#f-month');
        if (!m.value) m.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
    }

    function apparatusInfo() {
        const ap = C.apparatus;
        if (!ap || ap.mode !== 'single' || !ap.details) return;
        const sel = $('input[name="Apparatus Assignment"]:checked');
        $('#apparatus-info').textContent = sel ? `${sel.value} — ${ap.details[sel.value] || ''}` : 'Select an engine';
    }

    // ─────────────────────────────── wire up ───────────────────────────────
    function wire() {
        const form = $('#reportForm');

        form.addEventListener('click', e => {
            const head = e.target.closest('[data-toggle]');
            if (head) { head.parentElement.classList.toggle('collapsed'); return; }
            const nt = e.target.closest('[data-note-toggle]');
            if (nt) {
                const item = nt.closest('.rp-item'), note = $('.rp-note', item);
                note.hidden = !note.hidden;
                nt.textContent = note.hidden ? '＋ Note' : '− Note';
                if (!note.hidden) $('textarea', note).focus();
                return;
            }
            if (e.target.closest('[data-del-day]')) {
                const id = e.target.closest('[data-day]').dataset.day;
                state.days = state.days.filter(x => x.id !== id);
                renderDays(); changed(); return;
            }
            if (e.target.closest('[data-del-file]')) {
                const id = e.target.closest('[data-file]').dataset.file;
                state.files = state.files.filter(x => x.id !== id);
                renderFiles(); changed(); return;
            }
        });

        form.addEventListener('input', e => {
            e.target.classList && e.target.classList.remove('rp-invalid');
            const item = e.target.closest('.rp-item'); if (item) item.classList.remove('missing');
            const dayEl = e.target.closest('[data-day]');
            if (dayEl && e.target.dataset.f) {
                const day = state.days.find(x => x.id === dayEl.dataset.day);
                if (day) day[e.target.dataset.f] = e.target.value;
                if (e.target.dataset.f !== 'note' && e.target.dataset.f !== 'activity') {
                    // re-render only on blur-like changes so typing isn't interrupted
                }
            }
            changed();
        });

        form.addEventListener('change', e => {
            const dayEl = e.target.closest('[data-day]');
            if (dayEl && e.target.dataset.f) {
                const day = state.days.find(x => x.id === dayEl.dataset.day);
                if (day) day[e.target.dataset.f] = e.target.value;
                if (e.target.dataset.f === 'date') {
                    // Keep the days in date order, however they were entered.
                    state.days.sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999'));
                }
                if (e.target.dataset.f === 'date' || e.target.dataset.f === 'shift') renderDays();
            }
            if (e.target.dataset.cat !== undefined) {
                const f = state.files.find(x => x.id === e.target.closest('[data-file]').dataset.file);
                if (f) f.category = e.target.value;
            }
            if (e.target.id === 'f-month') renderDays();
            if (e.target.id === 'f-officer') officerChanged();
            if (e.target.id === 'f-shift') state.days.forEach(x => { if (!x.shift) x.shift = e.target.value; }), renderDays();
            if (e.target.name === 'Apparatus Assignment') apparatusInfo();
            if (e.target.id === 'f-evname' && state.sigSource === 'dorman' && e.target.value !== 'Dorman, David') {
                pad.clear(); state.sigSource = null; $('#sig-tag').hidden = true; $('#sig-hint').hidden = false;
            }
            changed();
        });

        $('#add-day').onclick = addDay;

        const input = $('#file-input'), cam = $('#camera-input'), drop = $('#drop');
        input.onchange = () => { addFiles(input.files); input.value = ''; };
        cam.onchange = () => { addFiles(cam.files); cam.value = ''; };
        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));

        $$('[data-step]').forEach(a => a.addEventListener('click', e => {
            const sec = document.getElementById(a.dataset.step);
            if (sec) sec.classList.remove('collapsed');
        }));

        $('#btn-clear').onclick = () => resetForm(false);
        $('#btn-preview').onclick = () => previewPDF(false);
        $('#btn-download').onclick = () => previewPDF(true);
        $('#btn-submit').onclick = submit;
        $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

        // Attachments live only in memory; don't let them vanish on an accidental back swipe.
        window.addEventListener('beforeunload', e => {
            if (state.files.length && !state.sent) { e.preventDefault(); e.returnValue = ''; }
        });
    }

    function init() {
        build();
        setupSignature();
        wire();
        const restored = restore();
        defaults();
        renderDays();
        renderFiles();
        apparatusInfo();
        if ($('#f-officer').value === 'Sergeant Dorman') officerChanged();
        updateProgress();
        if (restored) $('#saved').textContent = 'Draft restored';
    }

    // Test hook: lets a harness add files and read state without a file picker.
    window.CFDReport = { addFiles, state, collect, problems, buildPDF, submit, send, addDay, renderDays, updateProgress };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
