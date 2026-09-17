/* Send a finished form's PDF to the Career Portal, into the member's documents.
 *
 * David, 2026-09-17: "make it were we can auto import it to the firefighter/
 * officers carrerr portal documents, so we dont have to print it of move it
 * mannually" — and gear inspections and training sheets the same way.
 *
 * Used by the monthly evaluations (reports/monthly/report.js), the gear
 * inspection (reports/gear/gear.js) and the training sheet. Call it AFTER the
 * email has gone: the email is the record of last resort and must never wait on
 * the portal being reachable.
 *
 *   const r = await CFDPortal.file({
 *     kind: 'evaluation' | 'gear-inspection' | 'training-sheet',
 *     title: 'Firefighter Monthly',     // what it is called in the file cabinet
 *     member: 'Mooney, W',              // one member…
 *     members: ['Mooney, W', 'Orona, A'],  // …or everyone on the sheet
 *     month: '2026-09',                 // evaluations
 *     date: '2026-09-17',               // everything else
 *     blob: pdfBlob
 *   });
 *   r.ok, r.summary, r.filed[], r.failed[], r.signedOut, r.offline
 *
 * The member names are matched to portal records on the server ("Mooney, W" →
 * William Mooney), so nothing here needs to know personnel ids. Whoever is
 * signed in to fdtraining.org is the one filing it — the portal checks that an
 * evaluation is being filed by an officer.
 */
(function () {
    'use strict';

    var ENDPOINT = 'https://career.fdtraining.org/api/documents/file';
    var TIMEOUT = 45000;

    async function file(opts) {
        if (!opts || !opts.blob || !opts.kind) return { ok: false, error: 'nothing to file' };
        var fd = new FormData();
        fd.append('kind', opts.kind);
        if (opts.title) fd.append('title', opts.title);
        if (opts.month) fd.append('month', opts.month);
        if (opts.date) fd.append('date', opts.date);
        if (opts.members && opts.members.length) fd.append('members', JSON.stringify(opts.members));
        else if (opts.member) fd.append('member', opts.member);
        fd.append('file', opts.blob, (opts.filename || 'report') + '.pdf');

        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
        try {
            var res = await fetch(ENDPOINT, {
                method: 'POST',
                body: fd,
                credentials: 'include',      // the fdt_session cookie is on .fdtraining.org
                signal: ctrl.signal
            });
            var out = {};
            try { out = await res.json(); } catch (e) { out = { error: 'the portal sent back something unreadable (HTTP ' + res.status + ')' }; }
            if (res.status === 401) return { ok: false, signedOut: true, error: out.error || 'the portal did not recognise your sign-in' };
            if (!res.ok && !out.error && !out.failed) out.error = 'HTTP ' + res.status;
            out.ok = !!out.ok;
            return out;
        } catch (e) {
            // offline, blocked, or the portal is down — the email already went
            return { ok: false, offline: true, error: e.name === 'AbortError' ? 'the portal took too long to answer' : (e.message || 'could not reach the portal') };
        } finally {
            clearTimeout(timer);
        }
    }

    // One line to put in a "sent" message, whatever happened.
    function line(r) {
        if (!r) return '';
        if (r.ok) {
            var extra = (r.failed && r.failed.length)
                ? ' ' + r.failed.length + ' name' + (r.failed.length === 1 ? '' : 's') + " didn't match a portal record: "
                  + r.failed.map(function (f) { return f.name; }).join(', ') + '.'
                : '';
            return '📁 ' + r.summary + extra;
        }
        if (r.signedOut) return '📁 Not filed in the portal — your fdtraining.org sign-in has expired. Sign in and submit again, or upload the PDF to the member\'s documents yourself.';
        if (r.offline) return '📁 Not filed in the portal (' + r.error + '). The email went through; file the PDF in the portal when you are back on a signal.';
        var why = r.error || (r.failed && r.failed.length && r.failed[0].error) || 'the portal refused it';
        return '📁 Not filed in the portal — ' + why + '.';
    }

    window.CFDPortal = { file: file, line: line, endpoint: ENDPOINT };
})();
