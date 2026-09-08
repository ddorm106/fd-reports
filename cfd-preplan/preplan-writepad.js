/* ===========================================================================
 * preplan-writepad.js — a big place to write with a pencil
 *
 * Handwriting into a 50px field on a form full of other fields does not work.
 * The writing runs past the box and is dropped, or it lands on the control
 * underneath and taps it. Widening the fields helped; it did not solve it.
 *
 * So tapping a text field opens a sheet with one large writing area and
 * nothing else on it. Nothing behind the sheet can be touched, so a stroke
 * that overruns cannot press a button or move to another page, and the sheet
 * does NOT close when you touch outside it — the whole point is that it stays
 * put while you write. Clear empties it; Done puts it back in the field.
 *
 * TOUCH DEVICES ONLY. On a desktop the form is typed into, and a modal on
 * every field would be an obstacle rather than a help.
 * ======================================================================== */

(function () {
    'use strict';
    if (window.__preplanWritePad) return;
    window.__preplanWritePad = true;

    /* A pencil implies a touch screen, so a laptop is left alone.
     *
     * `any-pointer`, NOT `pointer`. `pointer` describes the PRIMARY pointing
     * device, and an iPad with a Magic Keyboard or any trackpad attached
     * reports that as fine — so the sheet would never appear on exactly the
     * setup most likely to be running the form on a truck. `any-pointer:
     * coarse` asks whether the device has a touch screen at all, which is the
     * real question. Touch is checked too, for anything that answers neither. */
    var touchy = false;
    try {
        touchy = (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches)
              || ('ontouchstart' in window)
              || (navigator.maxTouchPoints > 0);
    } catch (e) { touchy = false; }
    if (!touchy) return;

    /* Which fields are worth a sheet. Dates, numbers and selects have their own
       pickers and would be made worse by this; a short phone number is still
       written by hand often enough to include. */
    var TYPES = { text: 1, tel: 1, email: 1, url: 1, search: 1 };
    function eligible(el) {
        if (!el || el.disabled || el.readOnly) return false;
        if (el.tagName === 'TEXTAREA') return true;
        if (el.tagName !== 'INPUT') return false;
        return !!TYPES[(el.type || 'text').toLowerCase()];
    }

    /* The field's own label, so the sheet says what is being written. */
    function labelFor(el) {
        var id = el.id;
        if (id) {
            var l = document.querySelector('label[for="' + id + '"]');
            if (l) return l.textContent.replace(/\s+/g, ' ').replace(/:\s*$/, '').trim();
        }
        var p = el.closest ? el.closest('.form-field, label') : null;
        if (p) {
            var t = p.querySelector('label');
            if (t) return t.textContent.replace(/\s+/g, ' ').replace(/:\s*$/, '').trim();
        }
        return el.placeholder || 'Notes';
    }

    var pad, area, title, hint, target = null, justClosed = null;

    function build() {
        var css = document.createElement('style');
        css.textContent =
            '#pwp-wrap{position:fixed;inset:0;background:rgba(15,23,42,.72);z-index:100000;' +
            'display:none;align-items:flex-start;justify-content:center;padding:16px}' +
            '#pwp-wrap.on{display:flex}' +
            '#pwp{background:#fff;border-radius:16px;width:100%;max-width:900px;margin-top:4vh;' +
            'box-shadow:0 24px 60px rgba(0,0,0,.4);display:flex;flex-direction:column;overflow:hidden}' +
            '#pwp-t{font:700 17px/1.3 -apple-system,system-ui,sans-serif;color:#1e3a5f;' +
            'padding:16px 18px 4px}' +
            '#pwp-h{font:400 12px/1.4 -apple-system,system-ui,sans-serif;color:#64748b;padding:0 18px 12px}' +
            '#pwp-a{margin:0 18px;min-height:44vh;border:2px solid #cbd5e1;border-radius:10px;' +
            'padding:14px;font:400 20px/1.9 -apple-system,system-ui,sans-serif;color:#0f172a;' +
            'resize:none;width:calc(100% - 36px);box-sizing:border-box;' +
            /* Ruled lines give a pencil something to sit on. */
            'background:repeating-linear-gradient(#fff,#fff 52px,#e8eef5 52px,#e8eef5 53px)}' +
            '#pwp-a:focus{outline:none;border-color:#1e3a5f}' +
            '#pwp-b{display:flex;gap:10px;padding:14px 18px 18px;justify-content:flex-end}' +
            '#pwp-b button{border:none;border-radius:10px;font:600 16px -apple-system,system-ui,sans-serif;' +
            'padding:14px 26px;cursor:pointer;min-width:110px;min-height:52px}' +
            '#pwp-clear{background:#eef2f7;color:#41506b}' +
            '#pwp-done{background:#1e3a5f;color:#fff}' +
            '@media (max-height:560px){#pwp-a{min-height:34vh}#pwp{margin-top:2vh}}';
        document.head.appendChild(css);

        var wrap = document.createElement('div');
        wrap.id = 'pwp-wrap';
        wrap.innerHTML =
            '<div id="pwp" role="dialog" aria-modal="true">' +
            '<div id="pwp-t"></div><div id="pwp-h"></div>' +
            '<textarea id="pwp-a" autocomplete="off" autocorrect="on" spellcheck="true"></textarea>' +
            '<div id="pwp-b"><button type="button" id="pwp-clear">Clear</button>' +
            '<button type="button" id="pwp-done">Done</button></div></div>';
        document.body.appendChild(wrap);

        pad = wrap;
        area = wrap.querySelector('#pwp-a');
        title = wrap.querySelector('#pwp-t');
        hint = wrap.querySelector('#pwp-h');

        wrap.querySelector('#pwp-clear').addEventListener('click', function () {
            area.value = '';
            area.focus();
        });
        wrap.querySelector('#pwp-done').addEventListener('click', commit);

        /* Deliberately NOT closed by touching the backdrop. A stroke that runs
           off the edge of the writing area would otherwise throw the sheet away
           mid-sentence, which is the exact thing this exists to prevent. */
        wrap.addEventListener('click', function (e) { if (e.target === wrap) e.stopPropagation(); });
    }

    function open(el) {
        if (!pad) build();
        target = el;
        title.textContent = labelFor(el);
        hint.textContent = (el.tagName === 'TEXTAREA')
            ? 'Write or type here. Nothing behind this sheet can be touched.'
            : 'Write or type here, then Done. Nothing behind this sheet can be touched.';
        area.value = el.value || '';
        // Let the field's own keyboard go away before the sheet takes over.
        try { el.blur(); } catch (e) {}
        pad.classList.add('on');
        setTimeout(function () {
            area.focus();
            try { area.setSelectionRange(area.value.length, area.value.length); } catch (e) {}
        }, 30);
    }

    function commit() {
        if (!target) { close(); return; }
        var el = target;
        // Single-line fields cannot hold newlines; a wrapped sentence becomes
        // spaces rather than being silently truncated at the first return.
        var text = area.value;
        if (el.tagName !== 'TEXTAREA') text = text.replace(/\s*\n+\s*/g, ' ').trim();
        el.value = text;
        /* Both events: the form saves on `input` after a pause and on `change`
           straight away. Firing them by hand is what makes a written answer
           persist exactly like a typed one. */
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        close();
    }

    function close() {
        pad.classList.remove('on');
        var el = target;
        target = null;
        /* Closing a dialog makes some browsers put focus back on the field that
           opened it, which would reopen the sheet immediately. Ignore exactly
           that one refocus and nothing else.
           This was a 300 ms deadline at first, which also swallowed a real tap
           on the NEXT field if the crew moved quickly — the sheet simply would
           not open again. A macrotask is long enough to absorb the automatic
           refocus and far shorter than any human gesture. */
        justClosed = el;
        if (el) { try { el.blur(); } catch (e) {} }
        setTimeout(function () { justClosed = null; }, 0);
    }

    /* focusin, not click: it catches a tap, a pencil, and a Tab alike, and it
       fires before the on-screen keyboard is committed to appearing. */
    document.addEventListener('focusin', function (e) {
        if (target) return;
        var el = e.target;
        if (el === justClosed) return;      // the automatic refocus, see close()
        if (!eligible(el)) return;
        if (el.closest && el.closest('#pwp-wrap')) return;   // the sheet's own box
        open(el);
    }, true);

    // A hardware keyboard's Escape closes it the same way Done does.
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && target) { e.preventDefault(); commit(); }
    });

    // Exposed for the tests, and for anything that wants to open one directly.
    window.PreplanWritePad = { open: open, commit: commit, eligible: eligible, labelFor: labelFor };
})();
