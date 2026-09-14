/*
 * Pure validation rules for a CGT cards array, with no Node-only APIs (no
 * fs/path), so the exact same rules run in two places: the CLI validator
 * (public/cgt/data/validate.js, which reads cards.json off disk and calls
 * this) and the browser-side CSV import tool (public/cgt/import.js, which
 * calls this on parsed-and-mapped rows before letting anyone download a
 * cards.json to replace the real file with). Keeping one copy of the rules
 * means a row that would fail the CLI validator gets caught at import time
 * too, instead of the two checks silently drifting apart.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CGTValidateCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const SPORTS = ['hockey', 'baseball', 'football'];
  const GRADING_COMPANIES = ['PSA', 'BGS', 'SGC', 'CGC', 'HGA', 'KSA'];
  const VALUATION_BASES = ['recent-sale', 'comp-estimate'];
  const SUBMISSION_STATUSES = ['submitted', 'in-queue', 'grading', 'shipped-back', 'returned'];

  function isDateOrNull(v) {
    return v === null || v === undefined || (typeof v === 'string' && DATE_RE.test(v));
  }

  function validateCards(cards) {
    const errors = [];
    const warnings = [];

    const seenIds = new Set();
    // Keyed by grading company since cert numbers are only guaranteed unique
    // within one company's own numbering, not across PSA/BGS/SGC/etc.
    const seenCerts = new Map();
    // Keyed by cardName + year + gradingCompany + grade, to catch the same
    // physical card accidentally logged twice under two different ids (e.g. a
    // copy-pasted entry that only got the id changed). Distinct cert numbers
    // don't rule this out on their own, since a typo'd cert reads as "distinct"
    // too, so this is reported as a warning to confirm by hand, not an error:
    // genuinely owning two real copies of the same card at the same grade is
    // a real thing collectors have, not a mistake.
    const seenNameGradeCombos = new Map();

    (cards || []).forEach((c, idx) => {
      const where = 'cards[' + idx + ']' + (c && c.id ? ' (' + c.id + ')' : '');

      if (!c.id) errors.push(where + ': missing "id"');
      else if (seenIds.has(c.id)) errors.push(where + ': duplicate id "' + c.id + '"');
      else seenIds.add(c.id);

      if (c.certNumber && c.gradingCompany) {
        const certKey = c.gradingCompany + ':' + c.certNumber;
        if (seenCerts.has(certKey)) {
          errors.push(where + ': cert number "' + c.certNumber + '" for ' + c.gradingCompany +
            ' is already used by "' + seenCerts.get(certKey) + '". Same physical card logged twice, or a typo\'d cert.');
        } else {
          seenCerts.set(certKey, c.id);
        }
      }

      if (!c.cardName) errors.push(where + ': missing "cardName"');

      if (c.cardName && c.gradingCompany && c.grade != null) {
        const comboKey = c.cardName.trim().toLowerCase() + '|' + (c.year ?? '') + '|' + c.gradingCompany + '|' + c.grade;
        if (!seenNameGradeCombos.has(comboKey)) seenNameGradeCombos.set(comboKey, []);
        seenNameGradeCombos.get(comboKey).push(c.id || where);
      }

      if (!c.sport) {
        errors.push(where + ': missing "sport"');
      } else if (!SPORTS.includes(c.sport)) {
        errors.push(where + ': sport "' + c.sport + '" is not one of ' + SPORTS.join(', '));
      }

      if (c.gradingCompany !== null && c.gradingCompany !== undefined && !GRADING_COMPANIES.includes(c.gradingCompany)) {
        warnings.push(where + ': gradingCompany "' + c.gradingCompany + '" is not one of the known companies (' +
          GRADING_COMPANIES.join(', ') + '). Not an error, just double-check it is not a typo.');
      }

      if (c.estimatedValue !== null && c.estimatedValue !== undefined) {
        if (typeof c.estimatedValue !== 'number' || Number.isNaN(c.estimatedValue) || c.estimatedValue < 0) {
          errors.push(where + ': "estimatedValue" must be a non-negative number or null');
        }
        if (!c.valuationBasis) {
          errors.push(where + ': has an estimatedValue but no "valuationBasis". Every price must be labeled ' +
            '"recent-sale" or "comp-estimate", never left ambiguous.');
        } else if (!VALUATION_BASES.includes(c.valuationBasis)) {
          errors.push(where + ': valuationBasis "' + c.valuationBasis + '" is not "recent-sale" or "comp-estimate"');
        } else if (c.valuationBasis === 'comp-estimate' && !c.compNote) {
          errors.push(where + ': valuationBasis is "comp-estimate" but "compNote" is empty. A comp-based estimate ' +
            'must say what it was based on, not just carry the label.');
        }
        if (!c.datePriced) {
          warnings.push(where + ': has an estimatedValue but no "datePriced". Backfill when known, a price with ' +
            'no date looks live when it may be stale.');
        }
      } else if (c.valuationBasis) {
        warnings.push(where + ': has a "valuationBasis" but no "estimatedValue". Probably a leftover field.');
      }

      if (c.costBasis !== null && c.costBasis !== undefined) {
        if (typeof c.costBasis !== 'number' || Number.isNaN(c.costBasis) || c.costBasis < 0) {
          errors.push(where + ': "costBasis" must be a non-negative number or null');
        }
      }

      if (!isDateOrNull(c.datePriced)) {
        errors.push(where + ': "datePriced" is not a YYYY-MM-DD date or null: ' + JSON.stringify(c.datePriced));
      }

      // The batch filter chip list (public/cgt/app.js, renderBatchFilter) sorts
      // batches by a plain string sort on the label, newest first. That only
      // produces newest-first order when every label leads with an ISO date, so
      // a batch that doesn't follow the convention would silently sort out of
      // order in the UI instead of erroring anywhere.
      if (c.backlogBatch && !DATE_RE.test(c.backlogBatch.slice(0, 10))) {
        warnings.push(where + ': "backlogBatch" ("' + c.backlogBatch + '") does not start with a YYYY-MM-DD date. ' +
          'The batch filter sorts by this label as a plain string, so it needs an ISO-date prefix to sort newest-first.');
      }
    });

    seenNameGradeCombos.forEach((ids) => {
      if (ids.length > 1) {
        warnings.push('possible duplicate entry: the same card name + year + grading company + grade appears on ' +
          ids.length + ' rows (' + ids.join(', ') + '). Confirm these are really separate physical copies, not the ' +
          'same card logged twice under two different ids.');
      }
    });

    return { errors, warnings };
  }

  // Validates the separate "cards sent off and not back yet" log
  // (public/cgt/data/submissions.json). This is a distinct real-world thing
  // from a graded card row: a submission is a batch shipped to a grading
  // company that has not returned with grades yet, so it has no grade,
  // certNumber, or estimatedValue of its own. Once cards come back, real
  // graded rows get added to cards.json (with real cert numbers) and this
  // submission is marked "returned" rather than deleted, so there is still a
  // record of how long that batch actually took.
  function validateSubmissions(submissions) {
    const errors = [];
    const warnings = [];
    const seenIds = new Set();

    (submissions || []).forEach((s, idx) => {
      const where = 'submissions[' + idx + ']' + (s && s.id ? ' (' + s.id + ')' : '');

      if (!s.id) errors.push(where + ': missing "id"');
      else if (seenIds.has(s.id)) errors.push(where + ': duplicate id "' + s.id + '"');
      else seenIds.add(s.id);

      if (!s.description) errors.push(where + ': missing "description"');

      if (!s.gradingCompany) {
        errors.push(where + ': missing "gradingCompany"');
      } else if (!GRADING_COMPANIES.includes(s.gradingCompany)) {
        warnings.push(where + ': gradingCompany "' + s.gradingCompany + '" is not one of the known companies (' +
          GRADING_COMPANIES.join(', ') + '). Not an error, just double-check it is not a typo.');
      }

      if (!s.status) {
        errors.push(where + ': missing "status"');
      } else if (!SUBMISSION_STATUSES.includes(s.status)) {
        errors.push(where + ': status "' + s.status + '" is not one of ' + SUBMISSION_STATUSES.join(', '));
      }

      if (s.cardCount !== null && s.cardCount !== undefined) {
        if (!Number.isInteger(s.cardCount) || s.cardCount <= 0) {
          errors.push(where + ': "cardCount" must be a positive whole number or null');
        }
      }

      if (!isDateOrNull(s.submittedDate)) {
        errors.push(where + ': "submittedDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(s.submittedDate));
      }
      if (!isDateOrNull(s.returnedDate)) {
        errors.push(where + ': "returnedDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(s.returnedDate));
      }

      // These two fields should agree about whether the batch is actually
      // back, since the days-in-queue display and the active/returned split
      // in the UI both key off "status", not off returnedDate directly.
      if (s.status === 'returned' && !s.returnedDate) {
        warnings.push(where + ': status is "returned" but "returnedDate" is empty. Backfill when known.');
      }
      if (s.status && s.status !== 'returned' && s.returnedDate) {
        warnings.push(where + ': has a "returnedDate" but status is "' + s.status + '", not "returned". ' +
          'Probably needs its status updated too.');
      }
      if (s.status && s.status !== 'returned' && !s.submittedDate) {
        warnings.push(where + ': has no "submittedDate", so days-in-queue can\'t be shown for it.');
      }
    });

    return { errors, warnings };
  }

  return {
    validateCards, validateSubmissions, isDateOrNull, DATE_RE,
    SPORTS, GRADING_COMPANIES, VALUATION_BASES, SUBMISSION_STATUSES
  };
});
