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
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return new Date(v + 'T00:00:00') > tomorrow;
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
      const company = (a.company || '').trim().toLowerCase();
      const role = (a.role || '').trim().toLowerCase();
      if (!company || !role) return;
      const key = company + '|' + role;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(a);
    });
    return [...byKey.values()].filter(group => group.length > 1);
  }

  return { isDateOrNull, isFutureDate, emDashFields, isValidSourceUrlOrNull, findDuplicateApplications };
});
