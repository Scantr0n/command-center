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
      if (l.status !== 'live' || !l.title || l.price == null) return;
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

  // eBay's own item-specifics documentation: once a buyer applies a search
  // filter (brand, size, condition, color, etc.), Cassini excludes a listing
  // from that filtered result set entirely when the field is missing, it
  // doesn't just rank it lower. "brand" and "condition" are treated as
  // universal, real buyer filters on every category this store lists in
  // (shoes and electronics alike); "size" and "color" only meaningfully
  // apply to the "shoes" category, so they're only required there, not on
  // something like the swing analyzer.
  const ITEM_SPECIFIC_LABELS = { brand: 'brand', size: 'size', color: 'color', condition: 'condition' };
  function requiredItemSpecificFields(listing) {
    const fields = ['brand', 'condition'];
    if (listing && listing.category === 'shoes') fields.push('size', 'color');
    return fields;
  }
  function missingItemSpecifics(listing) {
    const specifics = (listing && listing.itemSpecifics) || {};
    return requiredItemSpecificFields(listing).filter(f => !specifics[f]);
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
    requiredItemSpecificFields,
    missingItemSpecifics,
    isDepopIneligible,
    emDashFields
  };
});
