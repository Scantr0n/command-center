/*
 * Pure crop-preview math for the photo audit tool's per-platform crop
 * overlay. Same shared-core pattern as garage-core.js/validate-core.js in
 * this same directory: no Node-only APIs, so app.js and crop-core.test.js
 * both load the exact same function.
 *
 * The three platforms below crop a listing's cover photo to a fixed ratio
 * server-side, cutting off whatever falls outside it, the same class of
 * silent-failure risk as the Haggar corduroy pants bug logged in
 * activity.json (a real issue only caught by looking at the actual cover
 * frame, not by any automated check). Poshmark moved its cover crop from
 * square to 3:4 portrait in March 2026; Depop and Vinted's ratios below are
 * their long-documented center-crop behavior. eBay is deliberately not
 * listed here: it doesn't force a fixed-ratio crop, only the 500px minimum
 * this tool already flags separately.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GarageCropCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const PLATFORM_CROPS = {
    poshmark: { label: 'Poshmark (3:4 portrait)', ratio: 3 / 4 },
    vinted: { label: 'Vinted (4:5 portrait)', ratio: 4 / 5 },
    depop: { label: 'Depop (1:1 square)', ratio: 1 }
  };

  // How a photo of aspect ratio imgAspect sits inside a container of
  // aspect ratio containerAspect under object-fit: contain, as fractions
  // of the container (0-1). Whichever dimension is the tighter fit fills
  // its full side; the other is letterboxed and centered.
  function fitContain(imgAspect, containerAspect) {
    if (!(imgAspect > 0) || !(containerAspect > 0)) return null;
    if (imgAspect > containerAspect) {
      const heightFrac = containerAspect / imgAspect;
      return { widthFrac: 1, heightFrac, offsetXFrac: 0, offsetYFrac: (1 - heightFrac) / 2 };
    }
    const widthFrac = imgAspect / containerAspect;
    return { widthFrac, heightFrac: 1, offsetXFrac: (1 - widthFrac) / 2, offsetYFrac: 0 };
  }

  // The center-crop box a platform keeps from a photo of aspect ratio
  // imgAspect when it crops to targetRatio, as fractions of that photo's
  // own full frame (0-1).
  function cropBoxFraction(imgAspect, targetRatio) {
    if (!(imgAspect > 0) || !(targetRatio > 0)) return null;
    if (imgAspect >= targetRatio) {
      const widthFrac = targetRatio / imgAspect;
      return { leftFrac: (1 - widthFrac) / 2, topFrac: 0, widthFrac, heightFrac: 1 };
    }
    const heightFrac = imgAspect / targetRatio;
    return { leftFrac: 0, topFrac: (1 - heightFrac) / 2, widthFrac: 1, heightFrac };
  }

  // Where to draw the crop-preview overlay, in percent of the audit
  // grid's square (1:1) card, for a photo of naturalWidth x naturalHeight
  // being cropped to targetRatio. Combines the two fractions above: first
  // where the full photo renders inside the square card (contain, so
  // nothing is pre-cropped for display), then where within that rendered
  // photo the platform's own crop box falls.
  function computeCropOverlay(naturalWidth, naturalHeight, targetRatio) {
    if (!(naturalWidth > 0) || !(naturalHeight > 0) || !(targetRatio > 0)) return null;
    const imgAspect = naturalWidth / naturalHeight;
    const contain = fitContain(imgAspect, 1);
    const crop = cropBoxFraction(imgAspect, targetRatio);
    return {
      leftPct: (contain.offsetXFrac + crop.leftFrac * contain.widthFrac) * 100,
      topPct: (contain.offsetYFrac + crop.topFrac * contain.heightFrac) * 100,
      widthPct: crop.widthFrac * contain.widthFrac * 100,
      heightPct: crop.heightFrac * contain.heightFrac * 100
    };
  }

  return { PLATFORM_CROPS, fitContain, cropBoxFraction, computeCropOverlay };
});
