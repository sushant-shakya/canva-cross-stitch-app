export type StitchStyle =
  | "cross_stitch"
  | "sparkle"
  | "pixel_square"
  | "polka_dot";

export type GridSize = 20 | 30 | 40 | 50 | 60 | 80;

export interface PatternOptions {
  gridSize: GridSize;
  stitchStyle: StitchStyle;
  ignoreBackground: boolean;
  backgroundThreshold?: number; // 0 - 255, default 225
  cellSize?: number; // viewBox units per cell, default 12
  quantizeColors?: boolean; // group similar shades to thread colors
  colorCountLimit?: number; // target palette size (2 - 16), default 8
  autoCrop?: boolean; // trim empty background margins so low grid sizes get maximum detail
}

export interface StitchItem {
  col: number;
  row: number;
  color: string;
}

export interface PaletteColorEntry {
  /** 0-based index in the palette (displayed as 1, 2, 3...) */
  index: number;
  /** Initial quantized hex color (#RRGGBB) */
  originalHex: string;
  /** Active hex color after user edits (#RRGGBB) */
  currentHex: string;
  /** If true, stitches with this palette color are omitted */
  removed: boolean;
  /** Number of grid cells mapped to this color */
  stitchCount: number;
}

export interface SampledCell {
  col: number;
  row: number;
  paletteIndex: number;
}

export interface QuantizedPatternBase {
  cells: SampledCell[];
  initialPalette: PaletteColorEntry[];
  gridCols: number;
  gridRows: number;
  width: number;
  height: number;
  cellSize: number;
}

export interface PatternResult {
  svgString: string;
  dataUrl: string;
  stitchCount: number;
  colorCount: number;
  palette: string[];
  paletteEntries: PaletteColorEntry[];
  gridCols: number;
  gridRows: number;
  width: number;
  height: number;
}

/**
 * Checks whether a sampled RGBA pixel represents a background pixel that should be filtered out.
 */
export function isBackgroundPixel(
  r: number,
  g: number,
  b: number,
  a: number,
  ignoreBackground: boolean,
  threshold = 225,
): boolean {
  // Alpha check: transparent or semi-transparent
  if (a < 50) {
    return true;
  }

  if (!ignoreBackground) {
    return false;
  }

  // Pure or near-white
  if (r >= threshold && g >= threshold && b >= threshold) {
    return true;
  }

  // Light neutral / anti-aliased grey fringe against white background
  const lightness = (r * 299 + g * 587 + b * 114) / 1000;
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  if (lightness >= threshold - 10 && maxDiff <= 22) {
    return true;
  }

  return false;
}

/**
 * Converts RGB components (0-255) into a 6-digit uppercase hex string (#RRGGBB).
 */
export function rgbToHex(
  r: number,
  g: number,
  b: number,
  quantize = false,
): string {
  const step = quantize ? 4 : 1;
  let qr = Math.min(255, Math.max(0, Math.round(r / step) * step));
  let qg = Math.min(255, Math.max(0, Math.round(g / step) * step));
  let qb = Math.min(255, Math.max(0, Math.round(b / step) * step));

  // Snap near-black JPEG compression values to pure black #000000
  if (qr <= 16 && qg <= 16 && qb <= 16) {
    qr = 0;
    qg = 0;
    qb = 0;
  }

  const hexR = qr.toString(16).padStart(2, "0");
  const hexG = qg.toString(16).padStart(2, "0");
  const hexB = qb.toString(16).padStart(2, "0");
  return `#${hexR}${hexG}${hexB}`.toUpperCase();
}

/**
 * Parses a hex color string into RGB components, returning null if invalid.
 */
export function hexToRgb(
  hex: string,
): { r: number; g: number; b: number } | null {
  const cleaned = hex.trim().replace(/^#/, "");
  if (/^[0-9A-Fa-f]{3}$/.test(cleaned)) {
    const r = parseInt((cleaned[0] ?? "0") + (cleaned[0] ?? "0"), 16);
    const g = parseInt((cleaned[1] ?? "0") + (cleaned[1] ?? "0"), 16);
    const b = parseInt((cleaned[2] ?? "0") + (cleaned[2] ?? "0"), 16);
    return { r, g, b };
  }
  if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

/**
 * Normalizes a user-entered hex color string to uppercase #RRGGBB format if valid.
 */
export function normalizeHexColor(input: string): string | null {
  const rgb = hexToRgb(input);
  if (!rgb) return null;
  return rgbToHex(rgb.r, rgb.g, rgb.b, false);
}

/**
 * Returns contrasting text color (#FFFFFF or #1E1E24) for readability on a given hex background.
 */
export function getContrastTextColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#1E1E24";
  const luminance = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return luminance > 165 ? "#1E1E24" : "#FFFFFF";
}

interface RawSampledPixel {
  col: number;
  row: number;
  r: number;
  g: number;
  b: number;
}

interface WeightedColorBucket {
  r: number;
  g: number;
  b: number;
  count: number;
}

function colorDistSq(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * Quantizes raw sampled pixels into at most `maxColors` dominant palette colors
 * using deterministic frequency-weighted k-means++ clustering and perceptual cluster merging.
 */
export function quantizePixelsToPalette(
  rawPixels: RawSampledPixel[],
  maxColors: number,
): { cells: SampledCell[]; initialPalette: PaletteColorEntry[] } {
  if (rawPixels.length === 0) {
    return { cells: [], initialPalette: [] };
  }

  const targetK = Math.max(2, Math.min(16, Math.round(maxColors)));

  // Pre-bucket close RGB shades (step 4) to speed up clustering and reduce compression noise
  const bucketMap = new Map<string, WeightedColorBucket>();
  for (const px of rawPixels) {
    let br = Math.min(255, Math.round(px.r / 4) * 4);
    let bg = Math.min(255, Math.round(px.g / 4) * 4);
    let bb = Math.min(255, Math.round(px.b / 4) * 4);
    if (br <= 16 && bg <= 16 && bb <= 16) {
      br = 0;
      bg = 0;
      bb = 0;
    }
    const key = `${br},${bg},${bb}`;
    const existing = bucketMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      bucketMap.set(key, { r: br, g: bg, b: bb, count: 1 });
    }
  }

  const buckets = Array.from(bucketMap.values()).sort(
    (a, b) => b.count - a.count || a.r - b.r || a.g - b.g || a.b - b.b,
  );

  const k = Math.min(targetK, buckets.length);
  // Minimum perceptual RGB distance squared (32^2 = 1024) to avoid splitting JPEG noise into separate colors
  const minClusterDistSq = 32 * 32;

  const centroids: { r: number; g: number; b: number }[] = [];
  const firstBucket = buckets[0];
  if (firstBucket) {
    centroids.push({
      r: firstBucket.r,
      g: firstBucket.g,
      b: firstBucket.b,
    });
  }

  while (centroids.length < k) {
    let bestBucket: WeightedColorBucket | undefined;
    let bestScore = -1;
    let bestMinDist = 0;

    for (const b of buckets) {
      let minDist = Infinity;
      for (const c of centroids) {
        const d = colorDistSq(b.r, b.g, b.b, c.r, c.g, c.b);
        if (d < minDist) {
          minDist = d;
        }
      }
      const score = minDist * Math.sqrt(b.count);
      if (score > bestScore) {
        bestScore = score;
        bestBucket = b;
        bestMinDist = minDist;
      }
    }

    // Stop adding centroids if all remaining colors are perceptually indistinct from existing centroids
    if (!bestBucket || bestMinDist < minClusterDistSq) {
      break;
    }

    centroids.push({
      r: bestBucket.r,
      g: bestBucket.g,
      b: bestBucket.b,
    });
  }

  // Run k-means refinement iterations
  const iterations = 12;
  for (let iter = 0; iter < iterations; iter++) {
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, weight: 0 }));

    for (const b of buckets) {
      let nearestIdx = 0;
      let nearestDist = Infinity;

      for (let cIdx = 0; cIdx < centroids.length; cIdx++) {
        const c = centroids[cIdx];
        if (!c) continue;
        const d = colorDistSq(b.r, b.g, b.b, c.r, c.g, c.b);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = cIdx;
        }
      }

      const acc = sums[nearestIdx];
      if (acc) {
        acc.r += b.r * b.count;
        acc.g += b.g * b.count;
        acc.b += b.b * b.count;
        acc.weight += b.count;
      }
    }

    for (let cIdx = 0; cIdx < centroids.length; cIdx++) {
      const acc = sums[cIdx];
      const current = centroids[cIdx];
      if (acc && acc.weight > 0 && current) {
        current.r = acc.r / acc.weight;
        current.g = acc.g / acc.weight;
        current.b = acc.b / acc.weight;
      }
    }
  }

  // Deduplicate and merge centroids that converged within perceptual threshold (dist < 28)
  const uniqueHexCentroids: {
    hex: string;
    r: number;
    g: number;
    b: number;
    count: number;
  }[] = [];

  for (const c of centroids) {
    const hex = rgbToHex(c.r, c.g, c.b, false);
    const parsed = hexToRgb(hex) ?? {
      r: Math.round(c.r),
      g: Math.round(c.g),
      b: Math.round(c.b),
    };
    const isCloseToExisting = uniqueHexCentroids.some(
      (u) =>
        u.hex === hex ||
        colorDistSq(u.r, u.g, u.b, parsed.r, parsed.g, parsed.b) < 28 * 28,
    );
    if (!isCloseToExisting) {
      uniqueHexCentroids.push({
        hex,
        r: parsed.r,
        g: parsed.g,
        b: parsed.b,
        count: 0,
      });
    }
  }

  // Assign each raw pixel to nearest unique centroid and count frequencies
  const rawAssignments: number[] = [];
  for (const px of rawPixels) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < uniqueHexCentroids.length; i++) {
      const c = uniqueHexCentroids[i];
      if (!c) continue;
      const d = colorDistSq(px.r, px.g, px.b, c.r, c.g, c.b);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    rawAssignments.push(bestIdx);
    const chosen = uniqueHexCentroids[bestIdx];
    if (chosen) {
      chosen.count += 1;
    }
  }

  // Filter out empty clusters and sort by stitch count descending
  const activeClusters = uniqueHexCentroids
    .map((cluster, oldIdx) => ({ ...cluster, oldIdx }))
    .filter((cluster) => cluster.count > 0)
    .sort((a, b) => b.count - a.count);

  const oldToNewIndex = new Map<number, number>();
  const initialPalette: PaletteColorEntry[] = activeClusters.map(
    (cluster, newIdx) => {
      oldToNewIndex.set(cluster.oldIdx, newIdx);
      return {
        index: newIdx,
        originalHex: cluster.hex,
        currentHex: cluster.hex,
        removed: false,
        stitchCount: cluster.count,
      };
    },
  );

  const cells: SampledCell[] = rawPixels.map((px, i) => {
    const oldIdx = rawAssignments[i] ?? 0;
    const paletteIndex = oldToNewIndex.get(oldIdx) ?? 0;
    return {
      col: px.col,
      row: px.row,
      paletteIndex,
    };
  });

  return { cells, initialPalette };
}

/**
 * Scans the source canvas to find the tight bounding box of non-background artwork
 * so empty margins don't waste grid resolution at small grid sizes (e.g. 20x20, 30x30).
 */
function findForegroundBounds(
  sourceCanvas: HTMLCanvasElement,
  ignoreBackground: boolean,
  backgroundThreshold: number,
): { x: number; y: number; w: number; h: number } {
  const srcW = sourceCanvas.width || 160;
  const srcH = sourceCanvas.height || 160;

  if (!ignoreBackground) {
    return { x: 0, y: 0, w: srcW, h: srcH };
  }

  const maxScanDim = 400;
  const scale = Math.min(1, maxScanDim / Math.max(srcW, srcH));
  const scanW = Math.max(1, Math.round(srcW * scale));
  const scanH = Math.max(1, Math.round(srcH * scale));

  const scanCanvas = document.createElement("canvas");
  scanCanvas.width = scanW;
  scanCanvas.height = scanH;
  const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
  if (!scanCtx) {
    return { x: 0, y: 0, w: srcW, h: srcH };
  }

  scanCtx.drawImage(sourceCanvas, 0, 0, scanW, scanH);
  const imgData = scanCtx.getImageData(0, 0, scanW, scanH);
  const data = imgData.data;

  // Guard for JSDOM mock environments where getImageData returns a tiny fixed buffer
  if (data.length < scanW * scanH * 4) {
    return { x: 0, y: 0, w: srcW, h: srcH };
  }

  let minX = scanW;
  let minY = scanH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < scanH; y++) {
    for (let x = 0; x < scanW; x++) {
      const idx = (y * scanW + x) * 4;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const a = data[idx + 3] ?? 0;

      if (
        !isBackgroundPixel(r, g, b, a, ignoreBackground, backgroundThreshold)
      ) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, w: srcW, h: srcH };
  }

  const invScaleX = srcW / scanW;
  const invScaleY = srcH / scanH;
  const cropX = Math.max(0, Math.floor(minX * invScaleX));
  const cropY = Math.max(0, Math.floor(minY * invScaleY));
  const cropRight = Math.min(srcW, Math.ceil((maxX + 1) * invScaleX));
  const cropBottom = Math.min(srcH, Math.ceil((maxY + 1) * invScaleY));

  return {
    x: cropX,
    y: cropY,
    w: Math.max(1, cropRight - cropX),
    h: Math.max(1, cropBottom - cropY),
  };
}

/**
 * Generates an SVG path segment for a cross-stitch (X).
 */
function makeCrossStitchPath(
  x: number,
  y: number,
  size: number,
  pad: number,
): string {
  const x1 = (x + pad).toFixed(1);
  const y1 = (y + pad).toFixed(1);
  const x2 = (x + size - pad).toFixed(1);
  const y2 = (y + size - pad).toFixed(1);

  return `M ${x1} ${y1} L ${x2} ${y2} M ${x2} ${y1} L ${x1} ${y2} `;
}

/**
 * Generates an SVG path segment for a 4-point sparkle star.
 */
function makeSparklePath(
  x: number,
  y: number,
  size: number,
  pad: number,
): string {
  const cx = (x + size / 2).toFixed(1);
  const cy = (y + size / 2).toFixed(1);
  const topY = (y + pad).toFixed(1);
  const rightX = (x + size - pad).toFixed(1);
  const bottomY = (y + size - pad).toFixed(1);
  const leftX = (x + pad).toFixed(1);

  return `M ${cx} ${topY} Q ${cx} ${cy} ${rightX} ${cy} Q ${cx} ${cy} ${cx} ${bottomY} Q ${cx} ${cy} ${leftX} ${cy} Z `;
}

/**
 * Generates an SVG path segment for a pixel square with subtle rounded corners.
 */
function makePixelSquarePath(
  x: number,
  y: number,
  size: number,
  pad: number,
): string {
  const rx = 1;
  const w = size - 2 * pad;
  const left = (x + pad).toFixed(1);
  const top = (y + pad).toFixed(1);
  const innerW = (w - 2 * rx).toFixed(1);

  return `M ${Number(left) + rx} ${top} h ${innerW} a ${rx} ${rx} 0 0 1 ${rx} ${rx} v ${innerW} a ${rx} ${rx} 0 0 1 -${rx} ${rx} h -${innerW} a ${rx} ${rx} 0 0 1 -${rx} -${rx} v -${innerW} a ${rx} ${rx} 0 0 1 ${rx} -${rx} Z `;
}

/**
 * Generates an SVG path segment for a polka dot circle.
 */
function makePolkaDotPath(
  x: number,
  y: number,
  size: number,
  pad: number,
): string {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = (size / 2 - pad).toFixed(1);
  const startX = (cx - Number(r)).toFixed(1);
  const cyFixed = cy.toFixed(1);
  const diam = (Number(r) * 2).toFixed(1);

  return `M ${startX} ${cyFixed} a ${r} ${r} 0 1 0 ${diam} 0 a ${r} ${r} 0 1 0 -${diam} 0 `;
}

interface CellSubSample {
  fgCount: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Step 1: Auto-crops foreground bounds, performs 8x8 sub-pixel supersampling per cell
 * (computing cell color exclusively from core foreground sub-pixels so white backgrounds never
 * bleed into gray edge halos), and quantizes into `colorCountLimit` palette colors.
 */
export function quantizeCanvasToPattern(
  sourceCanvas: HTMLCanvasElement,
  options: PatternOptions,
): QuantizedPatternBase {
  const {
    gridSize,
    ignoreBackground,
    backgroundThreshold = 225,
    cellSize = 12,
    colorCountLimit = 8,
    autoCrop = true,
  } = options;

  const bounds = autoCrop
    ? findForegroundBounds(sourceCanvas, ignoreBackground, backgroundThreshold)
    : {
        x: 0,
        y: 0,
        w: sourceCanvas.width || 160,
        h: sourceCanvas.height || 160,
      };

  const aspect = bounds.w / bounds.h;

  let cols: number = gridSize;
  let rows: number = gridSize;

  if (aspect >= 1) {
    cols = gridSize;
    rows = Math.max(1, Math.round(gridSize / aspect));
  } else {
    rows = gridSize;
    cols = Math.max(1, Math.round(gridSize * aspect));
  }

  const ss = 8; // 8x8 = 64 sub-pixels per stitch cell
  const sampleW = cols * ss;
  const sampleH = rows * ss;

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleW;
  sampleCanvas.height = sampleH;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

  if (!sampleCtx) {
    throw new Error("Unable to create canvas 2d context for pixel sampling.");
  }

  sampleCtx.imageSmoothingEnabled = true;
  sampleCtx.imageSmoothingQuality = "high";
  sampleCtx.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.w,
    bounds.h,
    0,
    0,
    sampleW,
    sampleH,
  );

  const imgData = sampleCtx.getImageData(0, 0, sampleW, sampleH);
  const data = imgData.data;

  const rawPixels: RawSampledPixel[] = [];

  // Fallback for unit test mocks that return a small fixed buffer
  if (data.length < sampleW * sampleH * 4) {
    const mockCols = Math.min(cols, imgData.width || 2);
    const mockRows = Math.min(rows, imgData.height || 2);
    for (let r = 0; r < mockRows; r++) {
      for (let c = 0; c < mockCols; c++) {
        const idx = (r * mockCols + c) * 4;
        const red = data[idx] ?? 0;
        const green = data[idx + 1] ?? 0;
        const blue = data[idx + 2] ?? 0;
        const alpha = data[idx + 3] ?? 0;
        if (
          !isBackgroundPixel(
            red,
            green,
            blue,
            alpha,
            ignoreBackground,
            backgroundThreshold,
          )
        ) {
          rawPixels.push({ col: c, row: r, r: red, g: green, b: blue });
        }
      }
    }
  } else {
    // 8x8 Sub-pixel supersampling per grid cell
    const cellMatrix: CellSubSample[][] = [];

    for (let r = 0; r < rows; r++) {
      const rowCells: CellSubSample[] = [];
      for (let c = 0; c < cols; c++) {
        const fgSubs: { distW: number; r: number; g: number; b: number }[] = [];

        for (let sy = 0; sy < ss; sy++) {
          const py = r * ss + sy;
          for (let sx = 0; sx < ss; sx++) {
            const px = c * ss + sx;
            const idx = (py * sampleW + px) * 4;
            const red = data[idx] ?? 0;
            const green = data[idx + 1] ?? 0;
            const blue = data[idx + 2] ?? 0;
            const alpha = data[idx + 3] ?? 0;

            if (
              !isBackgroundPixel(
                red,
                green,
                blue,
                alpha,
                ignoreBackground,
                backgroundThreshold,
              )
            ) {
              const distW =
                (255 - red) * (255 - red) +
                (255 - green) * (255 - green) +
                (255 - blue) * (255 - blue);
              fgSubs.push({ distW, r: red, g: green, b: blue });
            }
          }
        }

        if (fgSubs.length === 0) {
          rowCells.push({ fgCount: 0, r: 0, g: 0, b: 0 });
        } else {
          // Sort foreground sub-pixels by distance from white background so core interior
          // color dominates and anti-aliased edge sub-pixels never create gray halos
          fgSubs.sort((a, b) => b.distW - a.distW);
          const coreCount = Math.max(1, Math.ceil(fgSubs.length * 0.5));
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          for (let i = 0; i < coreCount; i++) {
            const sub = fgSubs[i];
            if (sub) {
              sumR += sub.r;
              sumG += sub.g;
              sumB += sub.b;
            }
          }
          rowCells.push({
            fgCount: fgSubs.length,
            r: Math.round(sumR / coreCount),
            g: Math.round(sumG / coreCount),
            b: Math.round(sumB / coreCount),
          });
        }
      }
      cellMatrix.push(rowCells);
    }

    // Standard coverage threshold: 18/64 (~28%)
    const minSubPixels = 18;
    const activeGrid: boolean[][] = cellMatrix.map((row) =>
      row.map((cell) => cell.fgCount >= minSubPixels),
    );

    // Preserve sharp extreme tips on the top and bottom rows of the tight bounding box
    const topRow = cellMatrix[0];
    const activeTopRow = activeGrid[0];
    if (topRow && activeTopRow && !activeTopRow.some(Boolean)) {
      const maxFg = Math.max(...topRow.map((cell) => cell.fgCount));
      if (maxFg >= 6) {
        for (let c = 0; c < cols; c++) {
          const cell = topRow[c];
          if (cell && cell.fgCount >= maxFg * 0.75) {
            activeTopRow[c] = true;
          }
        }
      }
    }

    const bottomRow = cellMatrix[rows - 1];
    const activeBottomRow = activeGrid[rows - 1];
    if (bottomRow && activeBottomRow && !activeBottomRow.some(Boolean)) {
      const maxFg = Math.max(...bottomRow.map((cell) => cell.fgCount));
      if (maxFg >= 6) {
        for (let c = 0; c < cols; c++) {
          const cell = bottomRow[c];
          if (cell && cell.fgCount >= maxFg * 0.75) {
            activeBottomRow[c] = true;
          }
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (activeGrid[r]?.[c]) {
          const cell = cellMatrix[r]?.[c];
          if (cell) {
            rawPixels.push({
              col: c,
              row: r,
              r: cell.r,
              g: cell.g,
              b: cell.b,
            });
          }
        }
      }
    }
  }

  const { cells, initialPalette } = quantizePixelsToPalette(
    rawPixels,
    colorCountLimit,
  );

  return {
    cells,
    initialPalette,
    gridCols: cols,
    gridRows: rows,
    width: cols * cellSize,
    height: rows * cellSize,
    cellSize,
  };
}

/**
 * Step 2: Builds the SVG string and PatternResult reactively from a QuantizedPatternBase
 * and the current interactive palette state (reflecting any color overrides and removed colors).
 */
export function buildPatternResultFromQuantized(
  base: QuantizedPatternBase,
  paletteEntries: PaletteColorEntry[],
  stitchStyle: StitchStyle,
): PatternResult {
  const { cells, gridCols, gridRows, width, height, cellSize } = base;

  const pad =
    stitchStyle === "pixel_square"
      ? 0.5
      : stitchStyle === "sparkle"
        ? 1.2
        : stitchStyle === "polka_dot"
          ? 1.2
          : 1.6;

  const stitchesByColor = new Map<string, string[]>();
  let activeStitchCount = 0;

  for (const cell of cells) {
    const entry = paletteEntries[cell.paletteIndex];
    if (!entry || entry.removed) {
      continue;
    }

    const hex = entry.currentHex;
    const x = cell.col * cellSize;
    const y = cell.row * cellSize;

    let pathD = "";
    switch (stitchStyle) {
      case "cross_stitch":
        pathD = makeCrossStitchPath(x, y, cellSize, pad);
        break;
      case "sparkle":
        pathD = makeSparklePath(x, y, cellSize, pad);
        break;
      case "pixel_square":
        pathD = makePixelSquarePath(x, y, cellSize, pad);
        break;
      case "polka_dot":
        pathD = makePolkaDotPath(x, y, cellSize, pad);
        break;
      default:
        break;
    }

    const existing = stitchesByColor.get(hex);
    if (existing) {
      existing.push(pathD);
    } else {
      stitchesByColor.set(hex, [pathD]);
    }
    activeStitchCount++;
  }

  const svgParts: string[] = [];
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  );
  svgParts.push(
    `  <desc>Cross-Stitch and Pixel Vector Pattern generated with Canva Apps SDK</desc>`,
  );

  const isStrokeStyle = stitchStyle === "cross_stitch";
  const strokeWidth = (cellSize * 0.2).toFixed(1);

  stitchesByColor.forEach((paths, color) => {
    const combinedPath = paths.join("");
    if (isStrokeStyle) {
      svgParts.push(
        `  <path d="${combinedPath}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none" />`,
      );
    } else {
      svgParts.push(`  <path d="${combinedPath}" fill="${color}" />`);
    }
  });

  svgParts.push("</svg>");
  const svgString = svgParts.join("\n");

  const base64Data =
    typeof window !== "undefined" && typeof window.btoa === "function"
      ? window.btoa(unescape(encodeURIComponent(svgString)))
      : Buffer.from(svgString, "utf-8").toString("base64");
  const dataUrl = `data:image/svg+xml;base64,${base64Data}`;

  const activeColors = paletteEntries
    .filter((entry) => !entry.removed)
    .map((entry) => entry.currentHex);

  return {
    svgString,
    dataUrl,
    stitchCount: activeStitchCount,
    colorCount: activeColors.length,
    palette: activeColors,
    paletteEntries,
    gridCols,
    gridRows,
    width,
    height,
  };
}

/**
 * Samples pixel colors from an offscreen HTML5 canvas, quantizes them into the target palette size,
 * and converts them into a scalable SVG pattern according to the chosen stitch style and grid resolution.
 */
export function generatePatternFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  options: PatternOptions,
): PatternResult {
  const base = quantizeCanvasToPattern(sourceCanvas, options);
  return buildPatternResultFromQuantized(
    base,
    base.initialPalette,
    options.stitchStyle,
  );
}

/**
 * Creates an image element from an uploaded File or Blob.
 */
export function loadImageFromFile(
  file: File | Blob,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load uploaded image."));
      img.src = src;
    };
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Draws an HTMLImageElement to an offscreen canvas.
 */
export function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to create canvas 2d context.");
  }
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/**
 * Renders custom text onto an offscreen canvas to allow text/logo pattern generation.
 */
export function renderTextToCanvas(
  text: string,
  textColor = "#7D2AE8",
  fontFamily = "sans-serif",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }

  const fontSize = 120;
  ctx.font = `900 ${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(text);

  const textWidth = Math.max(60, Math.ceil(metrics.width));
  const textHeight = Math.max(60, Math.ceil(fontSize * 1.3));

  const padding = 20;
  canvas.width = textWidth + padding * 2;
  canvas.height = textHeight + padding * 2;

  const drawCtx = canvas.getContext("2d");
  if (!drawCtx) return canvas;

  drawCtx.clearRect(0, 0, canvas.width, canvas.height);

  drawCtx.font = `900 ${fontSize}px ${fontFamily}`;
  drawCtx.fillStyle = textColor;
  drawCtx.textAlign = "center";
  drawCtx.textBaseline = "middle";
  drawCtx.fillText(text, canvas.width / 2, canvas.height / 2);

  return canvas;
}
