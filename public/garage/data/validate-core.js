/*
 * Pure validation-support rules and constants for the Garage listings array,
 * with no Node-only APIs (no fs/path), so the exact same rule runs in two
 * places: the CLI validator (public/garage/data/validate.js, which reads
 * listings.json off disk and calls this) and the dashboard itself
 * (public/garage/app.js), which needs the real listing objects to render
 * clickable rows, not just a pre-formatted warning string, plus the same
 * platform list and title-length caps the CLI validator checks against. Same
 * shared-core pattern as CGT's and CSM's own validate-core.js, so the two
 * can never quietly drift apart.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GarageValidateCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // The canonical platform list, previously defined independently four times
  // (validate.js's own PLATFORMS, plus app.js's VALID_PLATFORMS and
  // PAYOUT_PLATFORMS, which were really the same array under two different
  // names). One shared source instead, so a fifth platform ever being added
  // can't miss one of the four copies silently.
  const PLATFORMS = ['ebay', 'vinted', 'poshmark', 'depop'];

  // Real published title-length hard caps as of September 2026 (see the
  // "Title & photo specs" reference on the Garage page for sourcing). Depop
  // has no published hard cap, only a soft mobile-truncation point, so it's
  // a separate DEPOP_TITLE_SOFT_LIMIT below rather than a hard cap here.
  // This constant used to be defined separately in validate.js and app.js;
  // the two drifted apart once already (Vinted wrongly at 70 in both copies
  // at the same time, fixed in a1fd471), and having two independently
  // hand-maintained copies of the same table is exactly the shape of risk
  // that already caused, so there is now only one.
  const TITLE_HARD_LIMITS = { ebay: 80, vinted: 100, poshmark: 80 };
  const DEPOP_TITLE_SOFT_LIMIT = 50;

  // Groups live listings by a normalized key of the fields that actually
  // identify the same physical item, title + price, and flags any group with
  // more than one member. The real risk this catches: re-adding an item
  // after a platform sync, or copy-pasting an existing listing as a starting
  // point for a new one and forgetting to change the id, would otherwise
  // silently double-count in "Total live asking value" and every other stat
  // tile with no flag ever surfacing. Scoped to live listings only, since a
  // sold item legitimately gets relisted (new id, same title/price) without
  // that being a mistake.
  function findDuplicateListings(listings) {
    const byKey = new Map();
    (listings || []).forEach(l => {
      // The typeof check matters as much as the truthiness one: a truthy
      // non-string title would otherwise reach .trim() below and throw, and
      // both validate.js and app.js's own duplicate-listings panel call this
      // function unconditionally on every run.
      if (l.status !== 'live' || !l.title || typeof l.title !== 'string' || l.price == null) return;
      const key = l.title.trim().toLowerCase() + '|' + l.price;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(l);
    });
    return [...byKey.values()].filter(group => group.length > 1);
  }

  // Catches the exact shape of the real eBay return-policy bug logged in
  // activity.json: all three eBay listings had silently inherited a
  // "30-Day Seller-Paid Returns (Parts & Accessories)" policy meant for auto
  // parts, which blocked publish until caught by hand. Nothing else here
  // reads the real per-listing eBay return policy at all, so a future
  // relist or copy-pasted listing could inherit the same wrong template
  // again with no flag ever surfacing. Text match only, since there's no
  // live eBay connection to read the real policy id from; a policy name
  // mentioning parts, accessories, or auto is never right for this store's
  // actual inventory (shoes, electronics, clothing).
  const SUSPICIOUS_EBAY_RETURN_POLICY_RE = /\b(parts|accessor(?:y|ies)|auto(?:motive)?)\b/i;
  function isSuspiciousEbayReturnPolicy(policy) {
    return typeof policy === 'string' && SUSPICIOUS_EBAY_RETURN_POLICY_RE.test(policy);
  }

  // Not an eBay-only rule: eBay's own item-specifics documentation is the
  // clearest public statement of it (Cassini excludes a listing from a
  // buyer's filtered result set entirely once a brand/size/condition/color
  // filter is applied and the field is missing, it doesn't just rank it
  // lower), but Poshmark, Vinted, and Depop all expose the same brand/size/
  // condition/color options as buyer search filters on their own listing
  // and search pages, so a listing missing the field drops out of a
  // filtered search there too, not just on eBay. "brand" and "condition"
  // are treated as universal, real buyer filters on every category this
  // store lists in (shoes and electronics alike); "size" and "color" only
  // meaningfully apply to the "shoes" category, so they're only required
  // there, not on something like the swing analyzer.
  const ITEM_SPECIFIC_LABELS = { brand: 'brand', size: 'size', color: 'color', condition: 'condition' };
  const ITEM_SPECIFIC_KEYS = Object.keys(ITEM_SPECIFIC_LABELS);
  function requiredItemSpecificFields(listing) {
    const fields = ['brand', 'condition'];
    if (listing && listing.category === 'shoes') fields.push('size', 'color');
    return fields;
  }
  function missingItemSpecifics(listing) {
    const specifics = (listing && listing.itemSpecifics) || {};
    return requiredItemSpecificFields(listing).filter(f => !specifics[f]);
  }

  const STATUSES = ['draft', 'ready-to-post', 'live', 'sold'];
  // Same two categories validate.js's own LISTING_CATEGORIES names: "shoes"
  // drives the real eBay Clothing/Shoes/Accessories fee rate and the
  // size/color item-specifics requirement above; "electronics" drives
  // isDepopIneligible. Everything else stays null (the standard rate, no
  // extra required fields, no Depop restriction).
  const LISTING_CATEGORIES = ['shoes', 'electronics'];

  // Local copy of the same shape+calendar check every hub's own validate.js
  // defines for itself (see validate.js's own isDateOrNull): kept private
  // and unexported here rather than shared, since every other date field in
  // listings.json's sibling files (sales/expenses/disputes/etc.) is validated
  // directly in validate.js and never needs to run in the browser the way
  // validateListings below does for the CSV importer.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function isDateOrNull(v) {
    if (v === null || v === undefined) return true;
    if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
    const [y, m, d] = v.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
  }

  // The full set of per-listing checks validate.js's CLI runs, pulled out so
  // the CSV importer (import.js) can run the exact same rules in the browser
  // against a merged existing-plus-imported listings array before anyone
  // downloads a file, rather than only finding out about a bad import after
  // the next `node validate.js` run. Returns the same { errors, warnings }
  // shape as every other hub's own validateX function (see e.g. job-search's
  // validateApplications). Message text and ordering match validate.js's own
  // inline checks exactly, so the CLI's real output is unchanged by this
  // extraction (validate.js now just calls this instead of inlining it).
  function validateListings(listings) {
    const errors = [];
    const warnings = [];
    const seenIds = new Set();

    (listings || []).forEach((l, idx) => {
      const where = 'listings[' + idx + ']' + (l && l.id ? ' (' + l.id + ')' : '');

      if (!l.id) errors.push(where + ': missing "id"');
      else if (seenIds.has(l.id)) errors.push(where + ': duplicate id "' + l.id + '"');
      else seenIds.add(l.id);

      if (!l.title) {
        errors.push(where + ': missing "title"');
      } else if (typeof l.title !== 'string') {
        errors.push(where + ': "title" must be a string, got ' + typeof l.title);
      }

      if (l.notes !== null && l.notes !== undefined && typeof l.notes !== 'string') {
        errors.push(where + ': "notes" must be a string or null, got ' + typeof l.notes);
      }

      if (l.price !== null && l.price !== undefined) {
        if (typeof l.price !== 'number' || l.price < 0) {
          errors.push(where + ': "price" must be a non-negative number or null');
        }
      }

      if (l.costBasis !== null && l.costBasis !== undefined) {
        if (typeof l.costBasis !== 'number' || l.costBasis < 0) {
          errors.push(where + ': "costBasis" must be a non-negative number or null');
        }
      }

      if (l.category !== null && l.category !== undefined && !LISTING_CATEGORIES.includes(l.category)) {
        errors.push(where + ': category "' + l.category + '" is not one of ' + LISTING_CATEGORIES.join(', ') + ' (omit or use null for the standard eBay rate)');
      }

      if (!Array.isArray(l.platforms) || l.platforms.length === 0) {
        errors.push(where + ': "platforms" must be a non-empty array');
      } else {
        l.platforms.forEach(p => {
          if (!PLATFORMS.includes(p)) {
            errors.push(where + ': platform "' + p + '" is not one of ' + PLATFORMS.join(', '));
          }
        });
        if (isDepopIneligible(l) && l.platforms.includes('depop')) {
          errors.push(where + ': "platforms" includes "depop" but category is "electronics", Depop bans battery-' +
            'powered/electronic items outright (see the Electronics & battery-item rules reference on the page), ' +
            'this really risks account suspension if actually published, remove depop from platforms and listingUrls');
        }
      }

      if (l.listingUrls !== undefined && l.listingUrls !== null) {
        if (typeof l.listingUrls !== 'object' || Array.isArray(l.listingUrls)) {
          errors.push(where + ': "listingUrls" must be an object keyed by platform, or omitted');
        } else {
          Object.keys(l.listingUrls).forEach(p => {
            const v = l.listingUrls[p];
            if (!PLATFORMS.includes(p)) {
              errors.push(where + ': listingUrls platform "' + p + '" is not one of ' + PLATFORMS.join(', '));
            } else if (Array.isArray(l.platforms) && !l.platforms.includes(p)) {
              errors.push(where + ': listingUrls platform "' + p + '" is not in this listing\'s "platforms"');
            }
            if (v !== null && v !== undefined) {
              if (typeof v !== 'string' || !/^https?:\/\//.test(v)) {
                errors.push(where + ': listingUrls.' + p + ' must be a real http(s) URL string, or null until logged');
              }
            }
          });
        }
      }

      if (l.soldOn !== undefined) {
        if (!Array.isArray(l.soldOn)) {
          errors.push(where + ': "soldOn" must be an array');
        } else {
          l.soldOn.forEach(p => {
            if (!PLATFORMS.includes(p)) {
              errors.push(where + ': soldOn platform "' + p + '" is not one of ' + PLATFORMS.join(', '));
            } else if (Array.isArray(l.platforms) && !l.platforms.includes(p)) {
              errors.push(where + ': soldOn platform "' + p + '" is not in this listing\'s "platforms"');
            }
          });
        }
      }

      if (!l.status) {
        errors.push(where + ': missing "status"');
      } else if (!STATUSES.includes(l.status)) {
        errors.push(where + ': status "' + l.status + '" is not one of ' + STATUSES.join(', '));
      }

      if (!isDateOrNull(l.datePublished)) {
        errors.push(where + ': "datePublished" is not a YYYY-MM-DD date or null: ' + JSON.stringify(l.datePublished));
      }

      if (l.location !== null && l.location !== undefined && typeof l.location !== 'string') {
        errors.push(where + ': "location" must be a string (real bin/shelf label) or null');
      }

      if (l.ebayReturnPolicy !== null && l.ebayReturnPolicy !== undefined && typeof l.ebayReturnPolicy !== 'string') {
        errors.push(where + ': "ebayReturnPolicy" must be a string (the real policy name set on the eBay listing) or null');
      }

      if (l.handlingTimeDays !== null && l.handlingTimeDays !== undefined) {
        if (!Number.isInteger(l.handlingTimeDays) || l.handlingTimeDays < 1 || l.handlingTimeDays > 30) {
          errors.push(where + ': "handlingTimeDays" must be a whole number of business days from 1 to 30 (eBay\'s own real range), or null');
        }
      }

      if (l.itemSpecifics !== undefined && l.itemSpecifics !== null) {
        if (typeof l.itemSpecifics !== 'object' || Array.isArray(l.itemSpecifics)) {
          errors.push(where + ': "itemSpecifics" must be an object keyed by brand/size/color/condition, or omitted');
        } else {
          Object.keys(l.itemSpecifics).forEach(k => {
            if (!ITEM_SPECIFIC_KEYS.includes(k)) {
              errors.push(where + ': itemSpecifics key "' + k + '" is not one of ' + ITEM_SPECIFIC_KEYS.join(', '));
            } else if (l.itemSpecifics[k] !== null && typeof l.itemSpecifics[k] !== 'string') {
              errors.push(where + ': itemSpecifics.' + k + ' must be a string or null');
            }
          });
        }
      }
      if (l.status === 'live' && Array.isArray(l.platforms) && l.platforms.includes('ebay')) {
        if (!l.ebayReturnPolicy) {
          warnings.push(where + ': live on eBay with no "ebayReturnPolicy" logged, confirm the real listing isn\'t ' +
            'silently carrying a wrong inherited policy (the exact bug already caught once, see activity.json)');
        } else if (isSuspiciousEbayReturnPolicy(l.ebayReturnPolicy)) {
          warnings.push(where + ': "ebayReturnPolicy" is "' + l.ebayReturnPolicy + '", which mentions parts/' +
            'accessories/auto, the same wrong-template pattern as the real bug already caught once. Confirm this ' +
            'listing\'s actual eBay return policy and fix it if it really did inherit that template again.');
        }
        if (l.handlingTimeDays == null) {
          warnings.push(where + ': live on eBay with no "handlingTimeDays" logged, the real Seller status & ' +
            'standards table on the page can\'t judge eBay\'s late-shipment-rate requirement pass/fail for any ' +
            'sale of this item until the real handling time set on the listing is logged here');
        }
      }
      if (l.status === 'live' && Array.isArray(l.platforms) && l.platforms.length) {
        const missingSpecifics = missingItemSpecifics(l);
        if (missingSpecifics.length) {
          warnings.push(where + ': live on ' + l.platforms.join(', ') + ' with no "' + missingSpecifics.join('", "') +
            '" logged in "itemSpecifics". Each of those platforms lets a buyer filter search results by that ' +
            'field (eBay calls its search Cassini), and a listing missing the field drops out of the filtered ' +
            'results entirely there, it doesn\'t just rank lower.');
        }
      }

      if (l.title && Array.isArray(l.platforms)) {
        l.platforms.forEach(p => {
          const limit = TITLE_HARD_LIMITS[p];
          if (limit && l.title.length > limit) {
            warnings.push(where + ': title is ' + l.title.length + ' chars, over ' +
              p + '\'s ' + limit + '-char cap, it will get rejected or truncated there');
          }
        });
      }

      emDashFields(l, ['title', 'location', 'notes']).forEach(f =>
        warnings.push(where + ': "' + f + '" contains an em dash, this tracker never uses one, check for a paste-in'));
      emDashFields(l.itemSpecifics, ITEM_SPECIFIC_KEYS).forEach(f =>
        warnings.push(where + ': itemSpecifics.' + f + ' contains an em dash, this tracker never uses one, check for a paste-in'));
    });

    findDuplicateListings(listings).forEach(group => {
      const ids = group.map(l => l.id || '(missing id)');
      warnings.push('possible duplicate listing: "' + group[0].title + '" at $' + group[0].price +
        ' appears on ' + ids.length + ' live listings (' + ids.join(', ') + '). Confirm these are really ' +
        'separate items, not the same one logged twice.');
    });

    return { errors, warnings };
  }

  // Depop bans the sale of virtually any item that runs on electrical power
  // outright, batteries included, no opt-in or workaround (see the
  // Electronics & battery-item rules reference on the page, sourced from
  // Depop's own Technology and Electronics Policy). eBay, Vinted, and
  // Poshmark all allow a battery item, with their own real handling rules,
  // so this is the one real per-category platform restriction currently
  // modeled, not a general eligibility matrix. "electronics" is the only
  // category this applies to right now (this store's real inventory has no
  // other electrical item), so this stays a plain category check rather than
  // a broader denylist.
  function isDepopIneligible(listing) {
    return !!(listing && listing.category === 'electronics');
  }

  // Every real free-text field this tracker renders is written without em
  // dashes, so a hand-typed or pasted-in field that has one reads as coming
  // from somewhere else rather than Jack's own voice. Previously lived only
  // in validate.js (CLI-only, no browser access), so a title or location
  // pasted in with an em dash through the quick-log or edit forms in app.js
  // went uncaught until the next `node validate.js` run; moved here so both
  // sides share the same check, same fix CSM's own emDashFields just got.
  // Warning-level only: an em dash never breaks anything rendered, this is a
  // style nudge, not a data error.
  function emDashFields(obj, fields) {
    const hits = [];
    if (!obj) return hits;
    fields.forEach(f => {
      const v = obj[f];
      if (typeof v === 'string' && v.includes(String.fromCharCode(8212))) hits.push(f);
    });
    return hits;
  }

  return {
    PLATFORMS,
    TITLE_HARD_LIMITS,
    DEPOP_TITLE_SOFT_LIMIT,
    findDuplicateListings,
    isSuspiciousEbayReturnPolicy,
    ITEM_SPECIFIC_LABELS,
    ITEM_SPECIFIC_KEYS,
    requiredItemSpecificFields,
    missingItemSpecifics,
    isDepopIneligible,
    emDashFields,
    STATUSES,
    LISTING_CATEGORIES,
    validateListings
  };
});
