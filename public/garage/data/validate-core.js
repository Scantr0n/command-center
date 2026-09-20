/*
 * Pure validation-support rules for the Garage listings array, with no
 * Node-only APIs (no fs/path), so the exact same rule runs in two places: the
 * CLI validator (public/garage/data/validate.js, which reads listings.json
 * off disk and calls this) and the dashboard's own "Possible duplicates"
 * panel (public/garage/app.js), which needs the real listing objects to
 * render clickable rows, not just a pre-formatted warning string. Same
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
  // apply to the "shoes" category (the same category classifier the eBay fee
  // math already uses), so they're only required there, not on something
  // like the swing analyzer.
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

  return {
    findDuplicateListings,
    isSuspiciousEbayReturnPolicy,
    ITEM_SPECIFIC_LABELS,
    requiredItemSpecificFields,
    missingItemSpecifics
  };
});
