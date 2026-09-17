/* =======================================================================
   logo.js — brand assets.

   Drop the official artwork into assets/img/ and it is picked up
   automatically, both on the page and inside the generated Claim PDF:

       assets/img/logo-uzma.png          (or .jpg / .svg)
       assets/img/logo-geospatial.png    (or .jpg / .svg)

   When a file is absent the app falls back to a vector drawing that
   approximates the mark, so nothing ever renders blank.
   ======================================================================= */

const LOGO_SOURCES = {
  uzma:       ['assets/img/logo-uzma.png', 'assets/img/logo-uzma.jpg', 'assets/img/logo-uzma.svg'],
  /* The payment advice carries the mark with the circles, which is what its
     own template prints; the claim form carries the wordmark alone. They are
     two different pieces of artwork, not two sizes of one. */
  uzmaAdvice: ['assets/img/logo-uzma-advice.png'],
  geospatial: ['assets/img/logo-geospatial.png', 'assets/img/logo-geospatial.jpg', 'assets/img/logo-geospatial.svg']
};

const logoCache = {};

/**
 * Crop the fully-transparent margin off a rasterised logo.
 *
 * Supplied artwork is usually exported with breathing room baked in — the
 * Uzma PNG is 270x92 for a wordmark that is only 228x41. Sizing that box to
 * the height the printed form uses would render the mark at half scale and
 * sitting off-centre, because the padding is not symmetric. Trimming first
 * means every caller measures the mark itself.
 *
 * Returns the original canvas when the source is opaque, when reading the
 * pixels is not allowed, or when nothing would be gained.
 */
function trimTransparent (canvas) {
  const w = canvas.width, h = canvas.height;
  let data;
  try {
    data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  } catch (e) {
    return canvas;                              // tainted — leave it alone
  }

  const ALPHA = 12;                             // ignore near-invisible pixels
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;                  // fully transparent
  if (minX === 0 && minY === 0 && maxX === w - 1 && maxY === h - 1) return canvas;

  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height,
                                 0, 0, out.width, out.height);
  return out;
}

/**
 * Resolve a logo to a PNG data URL usable by both <img> and jsPDF.
 * Returns null when no file is present — callers then draw their fallback.
 * Vector sources are rasterised at 4x so they stay crisp in print.
 * `w`/`h` describe the trimmed mark, so they are safe to size against.
 */
function loadLogo (key) {
  if (logoCache[key] !== undefined) return Promise.resolve(logoCache[key]);

  const sources = LOGO_SOURCES[key] || [];
  const attempt = i => new Promise(resolve => {
    if (i >= sources.length) return resolve(null);
    const src = sources[i];
    const img = new Image();
    img.onload = () => {
      const scale = src.endsWith('.svg') ? 4 : 1;
      const w = (img.naturalWidth || img.width || 300) * scale;
      const h = (img.naturalHeight || img.height || 100) * scale;
      try {
        let c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c = trimTransparent(c);
        resolve({ url: c.toDataURL('image/png'), w: c.width, h: c.height, src });
      } catch (e) {
        resolve({ url: src, w, h, src });        // tainted canvas — hand back the path
      }
    };
    img.onerror = () => resolve(attempt(i + 1));
    img.src = src;
  });

  return attempt(0).then(res => {
    logoCache[key] = res;
    return res;
  });
}

/* ---------------------------------------------------------------------
   Fallback drawing: the Uzma wordmark for the Claim PDF header.
   Grey "UZMA" with the orange stroke rising through the final A.
   Drawn in jsPDF units (mm); `x`/`y` is the top-right corner of the mark.
   --------------------------------------------------------------------- */
function drawUzmaFallback (doc, xRight, yTop, height) {
  const h = height || 7;
  const grey = [88, 89, 91], orange = [242, 101, 34];

  doc.setFont('helvetica', 'bold').setFontSize(h * 2.7).setTextColor(...grey);
  doc.text('UZMA', xRight - h * 0.9, yTop + h, { align: 'right' });

  // the orange swoosh, a tapered quadrilateral rising to the right
  doc.setFillColor(...orange);
  const x2 = xRight, x1 = xRight - h * 1.5;
  doc.triangle(x1, yTop + h * 0.95, x2, yTop - h * 0.05, x2, yTop + h * 0.35, 'F');
  doc.triangle(x1, yTop + h * 0.95, x1, yTop + h * 1.25, x2, yTop + h * 0.35, 'F');
}

/* ---------------------------------------------------------------------
   Site header mark — inline SVG recreation of the Geospatial AI wordmark,
   used until assets/img/logo-geospatial.* is supplied.
   --------------------------------------------------------------------- */
function geospatialFallbackMarkup () {
  return `
    <span class="gwordmark" aria-label="Geospatial AI">
      <span class="gw-main">G<span class="gw-eo">[EO]</span>SPATIAL<sup class="gw-ai">AI</sup></span>
      <span class="gw-sub">An Uzma Company</span>
    </span>`;
}

/** Swap the fallback wordmark for the real artwork when it exists. */
function mountBrandLogo () {
  const host = document.getElementById('brandLogo');
  if (!host) return;
  host.innerHTML = geospatialFallbackMarkup();
  loadLogo('geospatial').then(logo => {
    if (!logo) return;
    host.innerHTML = `<img src="${logo.url}" alt="Geospatial AI" class="brand-img">`;
  });
}
