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

  // Every real free-text field this tracker renders is written without em
  // dashes, so a hand-typed or pasted-in field that has one reads as coming
  // from somewhere else rather than Jack's own voice. Same emDashFields
  // helper public/sondrik/data/validate.js already uses for this reason,
  // shared here so both the CLI validator and the browser-side CSV import
  // tool (public/cgt/import.js) catch it the same way, same "one copy of
  // the rules, never drift apart" reasoning as the rest of this file.
  // Warning-level only: an em dash never breaks anything rendered, this is
  // a style nudge, not a data error.
  function emDashFields(obj, fields) {
    const hits = [];
    if (!obj) return hits;
    fields.forEach(f => {
      const v = obj[f];
      if (typeof v === 'string' && v.includes(String.fromCharCode(8212))) hits.push(f);
    });
    return hits;
  }

  // The shape regex alone accepts any two digits for month/day, including
  // "2026-13-45" or a real-looking but impossible "2026-02-30", so this
  // cross-checks the parsed date's own year/month/day against what was
  // actually typed: an impossible date never matches back.
  function isDateOrNull(v) {
    if (v === null || v === undefined) return true;
    if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
    const [y, m, d] = v.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
  }

  // Shared by validateCards and validateCandidates below, neither of which
  // validated "year" at all until now, unlike every other numeric/date field
  // each already checks. That mattered because findDuplicateGroups and
  // findGradeLadderInversions both fold year into their real cards.json
  // grouping key, so a typo'd year (a string, a decimal, a wrong century)
  // would silently form its own group of one instead of matching the real
  // duplicate or ladder-mate it belongs with. 1860 covers the earliest known
  // tobacco-era cards, well before any of SPORTS existed; next year covers a
  // pre-release card for the upcoming season.
  function isValidYearOrNull(year) {
    if (year === null || year === undefined) return true;
    return Number.isInteger(year) && year >= 1860 && year <= new Date().getFullYear() + 1;
  }

  // BGS (and, per its own public standards, SGC) publish four subgrades per
  // card -- centering, corners, edges, surface -- each on a 1-10 scale in
  // half-point steps, independent of the overall grade shown on the slab
  // label (grade is a separate, sometimes-rounded-down number, not just the
  // lowest subgrade). A card with all four at 10 is BGS's "Black Label",
  // a real, well-documented designation worth surfacing since it carries a
  // large real-world value premium over a plain BGS 10. Multiplying by 2 and
  // checking for a whole number is the standard way to test "is this a
  // multiple of 0.5" without floating-point equality problems.
  const SUBGRADE_FIELDS = ['subgradeCentering', 'subgradeCorners', 'subgradeEdges', 'subgradeSurface'];
  function isValidSubgradeOrNull(v) {
    if (v === null || v === undefined) return true;
    return typeof v === 'number' && !Number.isNaN(v) && v >= 1 && v <= 10 && Number.isInteger(v * 2);
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
      // The `typeof` check matters as much as the truthiness one: a truthy
      // non-string cardName (a number pasted into the name field) would
      // otherwise reach `.trim()` below and throw, and validateCards calls
      // this function unconditionally on every validate run, not just the
      // dashboard's own Data Quality panel.
      if (!c.cardName || typeof c.cardName !== 'string' || !c.gradingCompany || c.grade == null) return;
      const key = c.cardName.trim().toLowerCase() + '|' + (c.year ?? '') + '|' + c.gradingCompany + '|' + c.grade;
      if (!byCombo.has(key)) byCombo.set(key, []);
      byCombo.get(key).push(c);
    });
    return [...byCombo.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => ({ key, cards: group }));
  }

  // A stronger, more definitive signal than findDuplicateGroups above: two
  // rows can only share a real cert number if they are the same physical
  // slab logged twice, or one of them has a typo'd cert. validateCards
  // already flags this as an error inline while it walks the array once;
  // this is the same grouping pulled out standalone so the dashboard can
  // render it as a clickable panel the same way findDuplicateGroups is
  // rendered, without re-deriving the logic or drifting from the CLI rule.
  function findDuplicateCertGroups(cards) {
    const byCert = new Map();
    (cards || []).forEach(c => {
      if (!c.certNumber || !c.gradingCompany) return;
      const key = c.gradingCompany + ':' + c.certNumber;
      if (!byCert.has(key)) byCert.set(key, []);
      byCert.get(key).push(c);
    });
    return [...byCert.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => ({ key, cards: group }));
  }

  // Same idea as findDuplicateGroups above, applied to the raw (ungraded)
  // candidates list instead of graded cards: groups by cardName + year +
  // sport, with gradingCompany/grade left out of the key entirely since a
  // candidate has neither yet. Real multi-copy candidates already exist in
  // candidates.json (Jack tracks a second physical copy of the same card
  // with a "-copy-2" id suffix, e.g. the two Cam Neely rows), so this is a
  // warning-level "double check" flag, not an error, exactly like the cards
  // version: it could be a genuine second copy, or a row that got
  // copy-pasted and only the id changed. Only returns groups with more than
  // one candidate in them.
  function findDuplicateCandidateGroups(candidates) {
    const byCombo = new Map();
    (candidates || []).forEach(c => {
      // Same real gap as findDuplicateGroups' own guard above: a truthy
      // non-string cardName would otherwise reach `.trim()` and throw, and
      // validateCandidates calls this function unconditionally.
      if (!c.cardName || typeof c.cardName !== 'string' || !c.sport) return;
      const key = c.cardName.trim().toLowerCase() + '|' + (c.year ?? '') + '|' + c.sport;
      if (!byCombo.has(key)) byCombo.set(key, []);
      byCombo.get(key).push(c);
    });
    return [...byCombo.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => ({ key, candidates: group }));
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

      if (!c.cardName) {
        errors.push(where + ': missing "cardName"');
      } else if (typeof c.cardName !== 'string') {
        // findDuplicateGroups below (and the inventory search box in
        // app.js) both call `.trim().toLowerCase()` straight on cardName
        // with no type guard, only a truthiness check. A truthy non-string
        // (a card number pasted into the name field, say) sails past that
        // check and throws the moment either path reaches it, and
        // findDuplicateGroups runs unconditionally on every page load for
        // the Data Quality panel, not just on a search.
        errors.push(where + ': "cardName" must be a string, got ' + typeof c.cardName);
      }

      if (!isValidYearOrNull(c.year)) {
        errors.push(where + ': "year" must be a whole number between 1860 and ' + (new Date().getFullYear() + 1) +
          ' or null, got ' + JSON.stringify(c.year));
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

      // Subgrades are optional even on a real BGS card (Jack may not have
      // bothered logging them for a low-value common), so only the ones
      // actually present get checked; a card with none set is not an error.
      let anySubgradeSet = false;
      SUBGRADE_FIELDS.forEach(f => {
        if (c[f] === null || c[f] === undefined) return;
        anySubgradeSet = true;
        if (!isValidSubgradeOrNull(c[f])) {
          errors.push(where + ': "' + f + '" must be a number from 1 to 10 in half-point steps (e.g. 9, 9.5, 10) or null, got ' + JSON.stringify(c[f]));
        }
      });
      if (anySubgradeSet && c.gradingCompany !== 'BGS') {
        warnings.push(where + ': has a subgrade logged but "gradingCompany" is "' + (c.gradingCompany || 'null') +
          '", not "BGS". Subgrades are a BGS-specific concept, double-check this is not logged against the wrong row.');
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

      // acquisitionDate (when the card was actually bought/acquired) is what
      // lets grading-core.js's estimateCollectiblesTax tell a long-term sale
      // (held more than a year, federal collectibles gain capped at 28% per
      // 26 U.S.C. 1(h)(5)) apart from a short-term one (ordinary income
      // rates, no cap) once it sells. A card can have a costBasis with no
      // acquisitionDate (the amount paid is known, the exact date isn't), so
      // this is a warning, not an error, same "backfill when known" framing
      // as datePriced above.
      if (!isDateOrNull(c.acquisitionDate)) {
        errors.push(where + ': "acquisitionDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(c.acquisitionDate));
      }
      if (c.costBasis != null && !c.acquisitionDate) {
        warnings.push(where + ': has a "costBasis" but no "acquisitionDate". Backfill when known, without it a ' +
          'realized sale on this card can\'t be classified long-term vs. short-term for collectibles tax purposes.');
      }
      // A card cannot be sold before it was acquired; unlike the soldDate-vs-
      // datePriced check above (a real "priced before bought" ordering,
      // warning-only), this ordering is never legitimate, so it is an error.
      if (c.acquisitionDate && c.soldDate && c.soldDate < c.acquisitionDate) {
        errors.push(where + ': "soldDate" (' + c.soldDate + ') is before "acquisitionDate" (' + c.acquisitionDate +
          '). A card can\'t be sold before it was acquired, check the two dates were not swapped or mistyped.');
      }

      // storageLocation feeds the insurance/appraisal print view (see
      // public/cgt/app.js's "field" calls into that document) as free text.
      // Every other field that document renders is type-checked before it
      // gets there; a wrong type here (an accidentally pasted number or
      // object) would pass validation clean and only ever surface as a
      // garbled line on the printed document itself.
      if (c.storageLocation !== null && c.storageLocation !== undefined && typeof c.storageLocation !== 'string') {
        errors.push(where + ': "storageLocation" must be a string or null');
      }

      // Same "wrong type passes clean and only shows up garbled on render"
      // risk as storageLocation above. Whether submissionId actually points
      // at a real row in submissions.json is a cross-file question this
      // function can't answer (it only ever sees cards), so that check
      // lives separately in findOrphanSubmissionRefs below instead of here.
      if (c.submissionId !== null && c.submissionId !== undefined && typeof c.submissionId !== 'string') {
        errors.push(where + ': "submissionId" must be a string or null');
      }

      // Same "wrong type passes clean and only shows up garbled on render"
      // risk as storageLocation above, since imageUrl also only ever gets
      // rendered as-is (an <img src>, never re-validated as a URL string at
      // render time). Deliberately not requiring an http(s) prefix: a real
      // photo could legitimately come from a local file path or a data URI
      // during hand-editing, and rejecting those would just push someone to
      // fake a fully-formed URL instead of leaving the field honestly null.
      if (c.imageUrl !== null && c.imageUrl !== undefined) {
        if (typeof c.imageUrl !== 'string') {
          errors.push(where + ': "imageUrl" must be a string or null');
        } else if (!c.imageUrl.trim()) {
          errors.push(where + ': "imageUrl" is an empty string, use null instead of a blank string');
        }
      }

      // A real sale is one event with two halves (when, for how much), so
      // each half requires the other, same "never half-log a real number"
      // rule valuationBasis/estimatedValue already enforce on the price
      // itself. Once a card has both, it reads as sold (see isSold in
      // public/cgt/app.js) and drops out of the current-portfolio totals.
      if (c.soldPrice !== null && c.soldPrice !== undefined) {
        if (typeof c.soldPrice !== 'number' || Number.isNaN(c.soldPrice) || c.soldPrice < 0) {
          errors.push(where + ': "soldPrice" must be a non-negative number or null');
        }
        if (!c.soldDate) {
          errors.push(where + ': has a "soldPrice" but no "soldDate". A real sale needs both, not just the amount.');
        }
      } else if (c.soldDate) {
        errors.push(where + ': has a "soldDate" but no "soldPrice". A real sale needs both, not just the date.');
      }
      if (!isDateOrNull(c.soldDate)) {
        errors.push(where + ': "soldDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(c.soldDate));
      }

      // sellingFees is the real fee amount a marketplace actually withheld
      // from this specific sale (an eBay final value fee, a PWCC auction
      // commission, etc.), logged from the real payout statement, never an
      // estimated rate. Only meaningful on a real sale, same "needs the
      // event it modifies" rule as listedPrice/listedDate depending on each
      // other below. A fee that meets or exceeds the gross soldPrice is
      // possible in principle (e.g. a refunded/relisted sale) but rare
      // enough to be worth a second look rather than silently accepted.
      if (c.sellingFees !== null && c.sellingFees !== undefined) {
        if (typeof c.sellingFees !== 'number' || Number.isNaN(c.sellingFees) || c.sellingFees < 0) {
          errors.push(where + ': "sellingFees" must be a non-negative number or null');
        }
        if (c.soldPrice == null) {
          errors.push(where + ': has "sellingFees" but no "soldPrice". A selling fee only applies to a real sale.');
        } else if (typeof c.sellingFees === 'number' && c.sellingFees >= c.soldPrice) {
          warnings.push(where + ': "sellingFees" (' + c.sellingFees + ') is greater than or equal to "soldPrice" (' +
            c.soldPrice + '). Possible, but double-check this is the real fee and not a mistyped/misplaced number.');
        }
      }

      // Same "one event, two halves, neither optional alone" rule as
      // soldPrice/soldDate just above, for a card that is currently listed
      // for sale (not yet sold, just actively asking). Kept as its own pair
      // rather than reusing soldPrice/soldDate, since a listed-but-unsold
      // card and a sold card are different real states, not two names for
      // the same one, both need to coexist on a card that's been re-listed
      // after a prior sale fell through.
      if (c.listedPrice !== null && c.listedPrice !== undefined) {
        if (typeof c.listedPrice !== 'number' || Number.isNaN(c.listedPrice) || c.listedPrice < 0) {
          errors.push(where + ': "listedPrice" must be a non-negative number or null');
        }
        if (!c.listedDate) {
          errors.push(where + ': has a "listedPrice" but no "listedDate". A real listing needs both, not just the amount.');
        }
      } else if (c.listedDate) {
        errors.push(where + ': has a "listedDate" but no "listedPrice". A real listing needs both, not just the date.');
      }
      if (!isDateOrNull(c.listedDate)) {
        errors.push(where + ': "listedDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(c.listedDate));
      }

      // Same "wrong type passes clean and only shows up garbled on render"
      // risk as imageUrl above, since listingUrl also only ever gets
      // rendered as-is (an <a href>, never re-validated as a URL string at
      // render time). Only meaningful once the card is actually listed, same
      // "needs the event it modifies" rule as sellingFees needing soldPrice
      // above: a listingUrl with no listedPrice is a link to nothing real on
      // this card.
      if (c.listingUrl !== null && c.listingUrl !== undefined) {
        if (typeof c.listingUrl !== 'string') {
          errors.push(where + ': "listingUrl" must be a string or null');
        } else if (!c.listingUrl.trim()) {
          errors.push(where + ': "listingUrl" is an empty string, use null instead of a blank string');
        }
        if (c.listedPrice == null) {
          errors.push(where + ': has a "listingUrl" but no "listedPrice". A listing link only applies to a card that is actually listed.');
        }
      }
      // A sold card that still carries listing fields reads as both sold and
      // for sale at once, almost always because the listing was never
      // cleared once the sale went through rather than a real double state.
      if ((c.listedPrice != null || c.listedDate != null) && c.soldPrice != null && c.soldDate != null) {
        warnings.push(where + ': has both "soldPrice"/"soldDate" and "listedPrice"/"listedDate" set. Once a card ' +
          'sells, clear the listing fields (or confirm it was re-listed after the sale fell through).');
      }
      if (c.soldDate && c.datePriced && c.soldDate < c.datePriced) {
        warnings.push(where + ': "soldDate" (' + c.soldDate + ') is before "datePriced" (' + c.datePriced +
          '). Possible (sold before ever being individually priced), but double-check the two dates were not swapped.');
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
            // Same "never left ambiguous" rule as the card's own current
            // estimatedValue/valuationBasis pair above, applied to every past
            // price too: without this, a hand-edited priceHistory entry could
            // carry a real dollar value with no basis, and the modal's price
            // history list would silently render it as "unlabeled" instead of
            // catching it here at validation time.
            if (!h.basis) {
              errors.push(hWhere + ': has a "value" but no "basis". Every price, past or current, must be labeled ' +
                '"recent-sale" or "comp-estimate", never left ambiguous.');
            } else if (!VALUATION_BASES.includes(h.basis)) {
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

      emDashFields(c, ['cardName', 'storageLocation', 'compNote', 'backlogBatch']).forEach(f =>
        warnings.push(where + ': "' + f + '" contains an em dash, this tracker never uses one, check for a paste-in'));
    });

    findDuplicateGroups(cards).forEach(({ cards: group }) => {
      const ids = group.map(c => c.id || '(missing id)');
      warnings.push('possible duplicate entry: the same card name + year + grading company + grade appears on ' +
        ids.length + ' rows (' + ids.join(', ') + '). Confirm these are really separate physical copies, not the ' +
        'same card logged twice under two different ids.');
    });

    findGradeLadderInversions(cards).forEach(({ lower, higher }) => {
      warnings.push('possible grade/price mix-up: "' + (higher.cardName || higher.id) + '" at ' + higher.gradingCompany +
        ' ' + higher.grade + ' (' + (higher.id || '(missing id)') + ') is priced at $' + higher.estimatedValue +
        ', below the same card at the lower grade ' + lower.grade + ' ($' + lower.estimatedValue + ', ' +
        (lower.id || '(missing id)') + '). Could be a real market anomaly, but check the two rows were not priced ' +
        'or typed against the wrong grade.');
    });

    findListingPriceMismatches(cards).forEach(({ card, ratio, direction }) => {
      const pct = listingPriceMismatchPct(ratio);
      warnings.push('listed price looks ' + direction + ' the researched estimate: "' + (card.cardName || card.id) +
        '" (' + (card.id || '(missing id)') + ') is listed at $' + card.listedPrice + ', ' + pct + '% ' + direction +
        ' its own researched estimate of $' + card.estimatedValue + '. Could be intentional, but worth double-' +
        'checking the ask is still what was meant.');
    });

    findMissingListingSpecifics(cards).forEach(({ card, missing }) => {
      const labels = missing.map(f => LISTING_SPECIFIC_LABELS[f]).join(', ');
      warnings.push('listed card is missing ' + labels + ': "' + (card.cardName || card.id) + '" (' +
        (card.id || '(missing id)') + ') is up for sale at $' + card.listedPrice + ' with no ' + labels +
        ' logged. eBay buyers filter trading-card search results by these fields, a listing missing one drops ' +
        'out of the filtered results entirely, it does not just rank lower.');
    });

    return { errors, warnings };
  }

  // Groups real priced cards by cardName + year + sport + gradingCompany
  // (grade left out of the key on purpose, unlike findDuplicateGroups above,
  // since this check is comparing across grades of the same card rather than
  // looking for the same grade logged twice) and flags any pair where the
  // numerically higher grade is priced lower than the same card at a lower
  // grade. A higher grade selling for less than a lower grade of the exact
  // same card is unusual enough to be worth a second look, most often because
  // a price or a grade got typed against the wrong row rather than a real
  // market quirk. Only compares cards with a real numeric grade and a real
  // estimatedValue; "Authentic"/no-grade rows and unpriced rows are skipped
  // rather than guessed at. A warning, not an error, since a real anomaly
  // (a low-pop lower grade outselling a common higher grade) does happen.
  function findGradeLadderInversions(cards) {
    function gradeNumber(grade) {
      if (grade == null) return null;
      const n = parseFloat(grade);
      return Number.isNaN(n) ? null : n;
    }

    const byCombo = new Map();
    (cards || []).forEach(c => {
      if (!c.cardName || !c.year || !c.sport || !c.gradingCompany || c.estimatedValue == null) return;
      const gradeNum = gradeNumber(c.grade);
      if (gradeNum == null) return;
      const key = c.cardName.trim().toLowerCase() + '|' + c.year + '|' + c.sport + '|' + c.gradingCompany;
      if (!byCombo.has(key)) byCombo.set(key, []);
      byCombo.get(key).push({ card: c, gradeNum });
    });

    const flags = [];
    byCombo.forEach(group => {
      if (group.length < 2) return;
      group.sort((a, b) => a.gradeNum - b.gradeNum);
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const lower = group[i];
          const higher = group[j];
          if (higher.gradeNum > lower.gradeNum && higher.card.estimatedValue < lower.card.estimatedValue) {
            flags.push({ lower: lower.card, higher: higher.card });
          }
        }
      }
    });
    return flags;
  }

  // Flags a currently-listed card (listedPrice/listedDate both set, not yet
  // sold) whose active asking price has drifted far from its own researched
  // estimatedValue -- either direction, not just "overpriced" -- since both
  // are real signals something is stale: the listing was never updated after
  // a re-price, or the estimate itself is the one that's gone stale. 50% off
  // either way is the threshold: a real live listing is routinely 10-20%
  // above book on the hope of a motivated buyer (see the real McDavid/Broten
  // cards.json notes, which is normal and not worth flagging), but a full
  // 1.5x or 0.5x gap is far more often a forgotten re-list or a stale
  // estimate than a deliberate pricing choice. A warning, not an error: a
  // real collector sometimes does list well above or below book on purpose.
  // The exact 1.5x/0.5x thresholds above, as named constants: the card
  // detail modal (app.js) shows this same "listed X% above/below estimate"
  // note on its own Listed price field, and used to re-derive both the
  // thresholds and the rounding below as its own hardcoded copy rather than
  // importing these, a real drift risk (tune the threshold here and the
  // modal's copy silently stops matching what Data Quality actually flags
  // for the same card) even though nothing has drifted yet.
  const LISTING_PRICE_MISMATCH_RATIO_HIGH = 1.5;
  const LISTING_PRICE_MISMATCH_RATIO_LOW = 0.5;

  // The exact "how far off" percentage both findListingPriceMismatches'
  // own warning text above and the card detail modal display, extracted so
  // neither has its own copy of Math.round(Math.abs(ratio - 1) * 100).
  function listingPriceMismatchPct(ratio) {
    return Math.round(Math.abs(ratio - 1) * 100);
  }

  function findListingPriceMismatches(cards) {
    const flags = [];
    (cards || []).forEach(c => {
      if (c.listedPrice == null || c.estimatedValue == null || c.estimatedValue <= 0) return;
      if (c.soldPrice != null && c.soldDate != null) return;
      const ratio = c.listedPrice / c.estimatedValue;
      if (ratio >= LISTING_PRICE_MISMATCH_RATIO_HIGH) flags.push({ card: c, ratio, direction: 'above' });
      else if (ratio <= LISTING_PRICE_MISMATCH_RATIO_LOW) flags.push({ card: c, ratio, direction: 'below' });
    });
    return flags;
  }

  // eBay's own seller-center documentation for its trading-card categories
  // states plainly that Cassini (eBay's search engine) drops a listing out
  // of a buyer's filtered results entirely once a specifics filter is
  // applied and that field is missing, it doesn't just rank the listing
  // lower, same real behavior Garage's own missingItemSpecifics already
  // documents for shoes/electronics. "Set" (the real manufacturer/set name,
  // e.g. "1982-83 O-Pee-Chee") and "Card Number" (the set's own number,
  // e.g. "#164") are both real buyer search filters on that category page;
  // this tracker only grew setName/cardNumber fields once this rule existed
  // to need them structured, so a card described before that stayed
  // informally buried in free-text notes instead. certNumber is left out of
  // this check on purpose: a graded card missing it is already flagged
  // dashboard-wide by buildDataQualityFlags's "NO CERT NUMBER LOGGED"
  // (public/cgt/app.js) regardless of whether it's listed, so repeating it
  // here would just double-flag the exact same real gap under a second
  // name. Scoped to cards actually up for sale (listedPrice set, not yet
  // sold) since an unlisted or already-sold card has nothing live on eBay
  // for a missing specific to bury.
  const LISTING_SPECIFIC_LABELS = { setName: 'set/manufacturer', cardNumber: 'card number' };
  function missingListingSpecifics(c) {
    if (!c || c.listedPrice == null) return [];
    if (c.soldPrice != null && c.soldDate != null) return [];
    const missing = [];
    if (!c.setName) missing.push('setName');
    if (!c.cardNumber) missing.push('cardNumber');
    return missing;
  }
  function findMissingListingSpecifics(cards) {
    return (cards || [])
      .map(c => ({ card: c, missing: missingListingSpecifics(c) }))
      .filter(x => x.missing.length > 0);
  }

  // A card's optional submissionId is meant to point at a real row in
  // submissions.json (the batch it was actually graded in), so the
  // submission's own detail view can list what came back from it. That's a
  // cross-file question validateCards can't answer on its own (it only ever
  // sees the cards array), so it lives here instead, called separately by
  // the CLI (validate.js, which loads both files) and by the live page
  // (app.js, which already has both loaded) the same way
  // findDuplicateGroups/findListingPriceMismatches above are. A typo'd or
  // stale submissionId is worth a warning, not an error: it never breaks
  // anything rendered, the card's detail view just quietly shows no linked
  // submission, the same "wrong type passes clean" risk the type check in
  // validateCards above already flags for the field itself.
  function findOrphanSubmissionRefs(cards, submissions) {
    const knownIds = new Set((submissions || []).map(s => s.id));
    const flags = [];
    (cards || []).forEach(c => {
      if (c.submissionId != null && !knownIds.has(c.submissionId)) flags.push(c);
    });
    return flags;
  }

  // The inverse of findOrphanSubmissionRefs above: a submission marked
  // "returned" (the grading company actually shipped it back) with no card
  // in cards.json pointing back at it via submissionId means the graded
  // cards from that real batch never got logged, not that the batch came
  // back with zero cards (submissions.json's own cardCount would say that,
  // and a batch is never submitted with zero cards). Worth a warning, not
  // an error, same reasoning as findOrphanSubmissionRefs: it never breaks
  // anything rendered, it just means a real batch is sitting un-backfilled.
  function findReturnedSubmissionsMissingCards(submissions, cards) {
    const linkedIds = new Set((cards || []).filter(c => c.submissionId != null).map(c => c.submissionId));
    return (submissions || []).filter(s => s.status === 'returned' && !linkedIds.has(s.id));
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

      // Below every flat per-card fee this tracker's own "Grading service
      // tiers reference" knows about (BGS Base, $14.95/card, the real floor)
      // or above the highest (PSA Premier, $599/card) almost always means
      // "cost" or "cardCount" was typed wrong, not a real price -- the most
      // common real way this drifts is entering a batch's total invoice as
      // if it were already the per-card figure, or the reverse. Skips SGC
      // Expedited and CGC WalkThrough, the two tiers that price by the
      // card's own declared value rather than a flat per-card fee, since a
      // genuinely valuable card can fall well outside a flat range there.
      // These bounds are drawn from the reference table reviewed 2026-09-29;
      // widen them if a company's own published fee ever moves past either
      // edge for real.
      if (typeof s.cost === 'number' && !Number.isNaN(s.cost) && s.cost >= 0 &&
        Number.isInteger(s.cardCount) && s.cardCount > 0 &&
        !(s.gradingCompany === 'SGC' && s.serviceLevel === 'Expedited') &&
        !(s.gradingCompany === 'CGC' && s.serviceLevel === 'WalkThrough')) {
        const perCard = s.cost / s.cardCount;
        if (perCard < 10) {
          warnings.push(where + ': cost works out to $' + perCard.toFixed(2) + '/card across ' + s.cardCount +
            ' card(s), below every real flat per-card grading fee this tracker knows about. Common cause: "cost" ' +
            'got typed as a per-card price instead of the real total for the whole batch.');
        } else if (perCard > 700) {
          warnings.push(where + ': cost works out to $' + perCard.toFixed(2) + '/card across ' + s.cardCount +
            ' card(s), above every real flat per-card grading fee this tracker knows about (PSA Premier, the ' +
            'priciest flat tier, tops out at $599/card). Common cause: "cardCount" is missing a card, or "cost" ' +
            'is really the per-card price already multiplied in.');
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

      emDashFields(s, ['description']).forEach(f =>
        warnings.push(where + ': "' + f + '" contains an em dash, this tracker never uses one, check for a paste-in'));
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

      if (!c.cardName) {
        errors.push(where + ': missing "cardName"');
      } else if (typeof c.cardName !== 'string') {
        // Same real gap as validateCards' own cardName check above:
        // findDuplicateCandidateGroups calls `.trim().toLowerCase()` on
        // this field with only a truthiness guard, and runs on every page
        // load for the Data Quality panel.
        errors.push(where + ': "cardName" must be a string, got ' + typeof c.cardName);
      }

      if (!isValidYearOrNull(c.year)) {
        errors.push(where + ': "year" must be a whole number between 1860 and ' + (new Date().getFullYear() + 1) +
          ' or null, got ' + JSON.stringify(c.year));
      }

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

      emDashFields(c, ['cardName', 'rawValueNote', 'gradedValueNote', 'decisionNote']).forEach(f =>
        warnings.push(where + ': "' + f + '" contains an em dash, this tracker never uses one, check for a paste-in'));
    });

    findDuplicateCandidateGroups(candidates).forEach(({ candidates: group }) => {
      const ids = group.map(c => c.id || '(missing id)');
      warnings.push('possible duplicate candidate: the same card name + year + sport appears on ' +
        ids.length + ' rows (' + ids.join(', ') + '). Confirm these are really separate physical copies, not the ' +
        'same raw card logged twice under two different ids.');
    });

    return { errors, warnings };
  }

  return {
    validateCards, validateSubmissions, validateCandidates, findDuplicateGroups, findDuplicateCertGroups,
    findDuplicateCandidateGroups, findGradeLadderInversions, findListingPriceMismatches, findOrphanSubmissionRefs,
    findReturnedSubmissionsMissingCards, findMissingListingSpecifics, missingListingSpecifics,
    LISTING_PRICE_MISMATCH_RATIO_HIGH, LISTING_PRICE_MISMATCH_RATIO_LOW, listingPriceMismatchPct,
    LISTING_SPECIFIC_LABELS,
    isDateOrNull, isValidSubgradeOrNull, emDashFields, DATE_RE, SPORTS, GRADING_COMPANIES, VALUATION_BASES,
    SUBMISSION_STATUSES, CANDIDATE_DECISIONS, SUBGRADE_FIELDS
  };
});
