/*
 * Pure validation-support rules for the Job Search hub, with no Node-only
 * APIs (no fs/path), so the exact same rules run in two places: the CLI
 * validator (public/job-search/data/validate.js, which requires this file
 * directly) and the dashboard's own "Possible duplicates" panel
 * (public/job-search/app.js), which needs the real application objects to
 * render clickable rows, not just a pre-formatted warning string. Same
 * shared-core pattern as CGT's, CSM's, Garage's, and Sondrik's own
 * validate-core.js, so the two can never quietly drift apart. The date/URL/
 * em-dash checks below have no dashboard consumer (this hub's page is a
 * read-only reference, see index.html's own note), only findDuplicateApplications
 * is shared both ways.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JobSearchValidateCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isDateOrNull(v) {
    if (v === null || v === undefined) return true;
    if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
    const [y, m, d] = v.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
  }

  function isFutureDate(v) {
    if (!v || !DATE_RE.test(v)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(v + 'T00:00:00') > today;
  }

  // Every real field on this page is transcribed straight out of the tracker,
  // so a hand-typed field with an em dash reads as a paste-in from somewhere
  // other than that source file, or a new claim nobody actually verified
  // against it. Warning-level only, matches every other hub's own check.
  function emDashFields(obj, fields) {
    const hits = [];
    if (!obj) return hits;
    fields.forEach(f => {
      const v = obj[f];
      if (typeof v === 'string' && v.includes(String.fromCharCode(8212))) hits.push(f);
    });
    return hits;
  }

  // A source link is only ever real if it's an actual http(s) URL or a
  // mailto: (Curb Creations has no posting URL, only an email address to
  // apply to). Anything else hand-typed into sourceUrl (a bare "TBD", a
  // placeholder) would render as a broken or misleading link.
  function isValidSourceUrlOrNull(v) {
    if (v === null || v === undefined) return true;
    if (typeof v !== 'string') return false;
    return /^https?:\/\//.test(v) || /^mailto:/.test(v);
  }

  // applications.json's only existing uniqueness check is on "num" (an
  // auto-incrementing counter that can't naturally collide except by
  // mistake), so a tracker entry hand-transcribed twice under two different
  // "num" values would otherwise go completely undetected, unlike every
  // other hub's own hand-maintained record list (CSM's prospects, Garage's
  // listings, Sondrik's leads), which all already catch this. Groups by
  // company + role, normalized, since that pair is what actually identifies
  // "the same real application" here; a company applied to twice for two
  // different roles is not a duplicate.
  function findDuplicateApplications(applications) {
    const byKey = new Map();
    (applications || []).forEach(a => {
      // `(a.company || '')` only guards a falsy value: a truthy non-string
      // (company or role logged as something other than a string) sails
      // past it and throws on the .trim() right after, so both are checked
      // before either is touched.
      if ((a.company !== undefined && a.company !== null && typeof a.company !== 'string') ||
        (a.role !== undefined && a.role !== null && typeof a.role !== 'string')) return;
      const company = (a.company || '').trim().toLowerCase();
      const role = (a.role || '').trim().toLowerCase();
      if (!company || !role) return;
      const key = company + '|' + role;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(a);
    });
    return [...byKey.values()].filter(group => group.length > 1);
  }

  // The same per-application field rules validate.js's own applications.json
  // loop already runs, pulled out so the CSV importer (import.js, which
  // needs the real application objects to render a preview/validation panel,
  // not just a pass/fail string) can run the exact same checks against an
  // imported batch before it's downloaded, rather than a second, possibly
  // drifted copy of the same rules. statusLabels is passed in rather than
  // required from followup-core.js directly, so this file never has to know
  // that file exists, same split CSM's validateProspects uses for `stages`.
  function validateApplications(applications, statusLabels) {
    const errors = [];
    const warnings = [];
    const seenNums = new Set();
    (applications || []).forEach((a, idx) => {
      const where = 'applications[' + idx + ']' + (a && a.company ? ' (' + a.company + ')' : '');
      if (typeof a.num !== 'number') errors.push(where + ': missing numeric "num"');
      else if (seenNums.has(a.num)) errors.push(where + ': duplicate "num" ' + a.num);
      else seenNums.add(a.num);
      ['role', 'company', 'location', 'pay'].forEach(f => {
        if (!a[f]) {
          errors.push(where + ': missing "' + f + '"');
        } else if (typeof a[f] !== 'string') {
          errors.push(where + ': "' + f + '" must be a string, got ' + typeof a[f]);
        }
      });
      if (!isDateOrNull(a.appliedDate)) errors.push(where + ': "appliedDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(a.appliedDate));
      else if (!a.appliedDate) warnings.push(where + ': no appliedDate logged, an application row with no real date reads as unconfirmed');
      else if (isFutureDate(a.appliedDate)) warnings.push(where + ': "appliedDate" (' + a.appliedDate + ') is in the future, check for a typo');
      if (a.status != null && statusLabels && !Object.prototype.hasOwnProperty.call(statusLabels, a.status)) {
        errors.push(where + ': "status" must be one of ' + Object.keys(statusLabels).join(', ') + ' or omitted, got ' + JSON.stringify(a.status));
      }
      emDashFields(a, ['role', 'company', 'location', 'pay']).forEach(f =>
        warnings.push(where + ': "' + f + '" contains an em dash, this is a transcription field, check it against the source tracker'));
    });
    findDuplicateApplications(applications || []).forEach(group => {
      warnings.push('applications: ' + group.length + ' entries match on company + role (' +
        group.map(a => '#' + a.num).join(', ') + '), check for a duplicate transcription');
    });
    return { errors, warnings };
  }

  return {
    isDateOrNull, isFutureDate, emDashFields, isValidSourceUrlOrNull, findDuplicateApplications,
    validateApplications
  };
});
