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

  return { findDuplicateListings };
});
