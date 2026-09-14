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
  const CANDIDATE_DECISIONS = ['submit', 'hold', 'sell-raw', 'pass'];

  function isDateOrNull(v) {
    return v === null || v === undefined || (typeof v === 'string' && DATE_RE.test(v));
  }

  // Groups cards by cardName + year + gradingCompany + grade, to catch the
  // same physical card accidentally logged twice under two different ids
  // (e.g. a copy-pasted entry that only got the id changed). Distinct cert
  // numbers don't rule this out on their own, since a typo'd cert reads as
  // "distinct" too. Only returns groups with more than one card in them.
  // Shared by validateCards below (which turns each group into a warning
  // string) and by the dashboard's own "Possible duplicates" panel
  // (public/cgt/app.js), which needs the real card objects, not just a
  // pre-formatted message, so it can render them as clickable rows.
  function findDuplicateGroups(cards) {
    const byCombo = new Map();
    (cards || []).forEach(c => {
      if (!c.cardName || !c.gradingCompany || c.grade == null) return;
      const key = c.cardName.trim().toLowerCase() + '|' + (c.year ?? '') + '|' + c.gradingCompany + '|' + c.grade;
      if (!byCombo.has(key)) byCombo.set(key, []);
      byCombo.get(key).push(c);
    });
    return [...byCombo.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => ({ key, cards: group }));
  }

  function validateCards(cards) {
    const errors = [];
    const warnings = [];

    const seenIds = new Set();
    // Keyed by grading company since cert numbers are only guaranteed unique
    // within one company's own numbering, not across PSA/BGS/SGC/etc.
    const seenCerts = new Map();

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

      // priceHistory holds prior researched prices for this card, so a
      // re-check overwrites estimatedValue/datePriced/valuationBasis but the
      // old numbers are moved here first rather than lost. Optional: a card
      // that has only ever been priced once has no history yet, and that's
      // not an error.
      if (c.priceHistory !== null && c.priceHistory !== undefined) {
        if (!Array.isArray(c.priceHistory)) {
          errors.push(where + ': "priceHistory" must be an array or null');
        } else {
          c.priceHistory.forEach((h, hIdx) => {
            const hWhere = where + '.priceHistory[' + hIdx + ']';
            if (typeof h.value !== 'number' || Number.isNaN(h.value) || h.value < 0) {
              errors.push(hWhere + ': "value" must be a non-negative number');
            }
            if (!DATE_RE.test(h.date || '')) {
              errors.push(hWhere + ': "date" is not a YYYY-MM-DD date: ' + JSON.stringify(h.date));
            } else if (c.datePriced && h.date >= c.datePriced) {
              errors.push(hWhere + ': dated ' + h.date + ', which is not before the card\'s current datePriced (' +
                c.datePriced + '). priceHistory should only hold prices from before the current one.');
            }
            if (h.basis !== undefined && h.basis !== null && !VALUATION_BASES.includes(h.basis)) {
              errors.push(hWhere + ': basis "' + h.basis + '" is not "recent-sale" or "comp-estimate"');
            }
          });
          if (c.priceHistory.length && c.estimatedValue == null) {
            warnings.push(where + ': has "priceHistory" logged but no current "estimatedValue". Probably means ' +
              'the card was re-checked and found unsellable/unpriceable, worth a note explaining why rather than ' +
              'just leaving the current price blank.');
          }
        }
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

    findDuplicateGroups(cards).forEach(({ cards: group }) => {
      const ids = group.map(c => c.id || '(missing id)');
      warnings.push('possible duplicate entry: the same card name + year + grading company + grade appears on ' +
        ids.length + ' rows (' + ids.join(', ') + '). Confirm these are really separate physical copies, not the ' +
        'same card logged twice under two different ids.');
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

      if (s.cost !== null && s.cost !== undefined) {
        if (typeof s.cost !== 'number' || Number.isNaN(s.cost) || s.cost < 0) {
          errors.push(where + ': "cost" must be a non-negative number or null');
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

  // Validates the "should I actually send this off?" list
  // (public/cgt/data/candidates.json). A candidate is a raw (ungraded) card
  // being weighed against the real cost of grading it, tracked separately
  // from both cards.json (already graded) and submissions.json (already
  // shipped) since it has neither a grade nor a tracking number yet. Once a
  // candidate is actually shipped, add a real row to submissions.json and
  // set this row's "decision" to "submit" rather than deleting it, same
  // "never silently lose a real number" rule as everything else here.
  function validateCandidates(candidates) {
    const errors = [];
    const warnings = [];
    const seenIds = new Set();

    // Shared by both rawValue and expectedGradedValue below: each is an
    // independent real-money estimate (what the card is worth raw right now,
    // vs. what it would likely sell for at the expected grade) and each
    // follows the exact same "never a silent guess" rule cards.json enforces
    // on estimatedValue, so the checks are identical, just applied twice
    // under two different field names.
    function checkPricedField(c, where, valueField, basisField, noteField, label) {
      const value = c[valueField];
      if (value === null || value === undefined) {
        if (c[basisField]) warnings.push(where + ': has a "' + basisField + '" but no "' + valueField + '". Probably a leftover field.');
        return;
      }
      if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
        errors.push(where + ': "' + valueField + '" must be a non-negative number or null');
      }
      if (!c[basisField]) {
        errors.push(where + ': has a ' + label + ' but no "' + basisField + '". Every price must be labeled ' +
          '"recent-sale" or "comp-estimate", never left ambiguous.');
      } else if (!VALUATION_BASES.includes(c[basisField])) {
        errors.push(where + ': "' + basisField + '" is not "recent-sale" or "comp-estimate"');
      } else if (c[basisField] === 'comp-estimate' && !c[noteField]) {
        errors.push(where + ': "' + basisField + '" is "comp-estimate" but "' + noteField + '" is empty. A ' +
          'comp-based estimate must say what it was based on, not just carry the label.');
      }
    }

    (candidates || []).forEach((c, idx) => {
      const where = 'candidates[' + idx + ']' + (c && c.id ? ' (' + c.id + ')' : '');

      if (!c.id) errors.push(where + ': missing "id"');
      else if (seenIds.has(c.id)) errors.push(where + ': duplicate id "' + c.id + '"');
      else seenIds.add(c.id);

      if (!c.cardName) errors.push(where + ': missing "cardName"');

      if (!c.sport) {
        errors.push(where + ': missing "sport"');
      } else if (!SPORTS.includes(c.sport)) {
        errors.push(where + ': sport "' + c.sport + '" is not one of ' + SPORTS.join(', '));
      }

      if (c.targetGradingCompany !== null && c.targetGradingCompany !== undefined && !GRADING_COMPANIES.includes(c.targetGradingCompany)) {
        warnings.push(where + ': targetGradingCompany "' + c.targetGradingCompany + '" is not one of the known ' +
          'companies (' + GRADING_COMPANIES.join(', ') + '). Not an error, just double-check it is not a typo.');
      }

      checkPricedField(c, where, 'rawValue', 'rawValueBasis', 'rawValueNote', '"rawValue"');
      checkPricedField(c, where, 'expectedGradedValue', 'gradedValueBasis', 'gradedValueNote', '"expectedGradedValue"');

      if (c.estimatedGradingCost !== null && c.estimatedGradingCost !== undefined) {
        if (typeof c.estimatedGradingCost !== 'number' || Number.isNaN(c.estimatedGradingCost) || c.estimatedGradingCost < 0) {
          errors.push(where + ': "estimatedGradingCost" must be a non-negative number or null');
        }
      }
      if (c.shippingCost !== null && c.shippingCost !== undefined) {
        if (typeof c.shippingCost !== 'number' || Number.isNaN(c.shippingCost) || c.shippingCost < 0) {
          errors.push(where + ': "shippingCost" must be a non-negative number or null');
        }
      }

      if (!isDateOrNull(c.datePriced)) {
        errors.push(where + ': "datePriced" is not a YYYY-MM-DD date or null: ' + JSON.stringify(c.datePriced));
      }

      if (c.decision !== null && c.decision !== undefined && !CANDIDATE_DECISIONS.includes(c.decision)) {
        errors.push(where + ': decision "' + c.decision + '" is not one of ' + CANDIDATE_DECISIONS.join(', ') + ', or null');
      }
      if (c.decision === 'submit' && !c.decisionNote) {
        warnings.push(where + ': decision is "submit" but no "decisionNote" logging the real submissions.json id ' +
          'it turned into once shipped. Not required, just makes it easier to trace later.');
      }
    });

    return { errors, warnings };
  }

  return {
    validateCards, validateSubmissions, validateCandidates, findDuplicateGroups, isDateOrNull, DATE_RE,
    SPORTS, GRADING_COMPANIES, VALUATION_BASES, SUBMISSION_STATUSES, CANDIDATE_DECISIONS
  };
});
