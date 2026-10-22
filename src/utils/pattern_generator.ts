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
  backgroundThreshold?: number; // 0 - 255, default 238
  cellSize?: number; // viewBox units per cell, default 12
  quantizeColors?: boolean; // group similar shades to thread colors
}

export interface StitchItem {
  col: number;
  row: number;
  color: string;
}

export interface PatternResult {
  svgString: string;
  dataUrl: string;
  stitchCount: number;
  colorCount: number;
  palette: string[];
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
  threshold = 238,
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

  // Light neutral / grey background
  const lightness = (r * 299 + g * 587 + b * 114) / 1000;
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  if (lightness >= threshold && maxDiff <= 18) {
    return true;
  }

  return false;
}

/**
 * Quantizes an RGB color to align with discrete thread/floss color steps.
 */
export function rgbToHex(
  r: number,
  g: number,
  b: number,
  quantize = true,
): string {
  const step = quantize ? 8 : 1;
  const qr = Math.min(255, Math.max(0, Math.round(r / step) * step));
  const qg = Math.min(255, Math.max(0, Math.round(g / step) * step));
  const qb = Math.min(255, Math.max(0, Math.round(b / step) * step));

  const hexR = qr.toString(16).padStart(2, "0");
  const hexG = qg.toString(16).padStart(2, "0");
  const hexB = qb.toString(16).padStart(2, "0");
  return `#${hexR}${hexG}${hexB}`.toUpperCase();
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

/**
 * Samples pixel colors from an offscreen HTML5 canvas and converts them into
 * a scalable SVG pattern according to the chosen stitch style and grid resolution.
 */
export function generatePatternFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  options: PatternOptions,
): PatternResult {
  const {
    gridSize,
    stitchStyle,
    ignoreBackground,
    backgroundThreshold = 238,
    cellSize = 12,
    quantizeColors = true,
  } = options;

  // Determine aspect ratio preserving grid bounds
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  const aspect = srcW / srcH;

  let cols: number = gridSize;
  let rows: number = gridSize;

  if (aspect >= 1) {
    cols = gridSize;
    rows = Math.max(1, Math.round(gridSize / aspect));
  } else {
    rows = gridSize;
    cols = Math.max(1, Math.round(gridSize * aspect));
  }

  // Draw scaled down to offscreen sampling canvas
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = cols;
  sampleCanvas.height = rows;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

  if (!sampleCtx) {
    throw new Error("Unable to create canvas 2d context for pixel sampling.");
  }

  // Ensure high quality downsampling
  sampleCtx.imageSmoothingEnabled = true;
  sampleCtx.imageSmoothingQuality = "high";
  sampleCtx.drawImage(sourceCanvas, 0, 0, cols, rows);

  const imgData = sampleCtx.getImageData(0, 0, cols, rows);
  const data = imgData.data;

  // Map each non-background pixel to a stitch
  const stitchesByColor = new Map<string, string[]>();
  const colorCounts = new Map<string, number>();
  let totalStitches = 0;

  const pad =
    stitchStyle === "pixel_square"
      ? 0.5
      : stitchStyle === "sparkle"
        ? 1.2
        : stitchStyle === "polka_dot"
          ? 1.2
          : 1.6;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = (r * cols + c) * 4;
      const red = data[idx] ?? 0;
      const green = data[idx + 1] ?? 0;
      const blue = data[idx + 2] ?? 0;
      const alpha = data[idx + 3] ?? 0;

      if (
        isBackgroundPixel(
          red,
          green,
          blue,
          alpha,
          ignoreBackground,
          backgroundThreshold,
        )
      ) {
        continue;
      }

      const hex = rgbToHex(red, green, blue, quantizeColors);
      const x = c * cellSize;
      const y = r * cellSize;

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

      if (!stitchesByColor.has(hex)) {
        stitchesByColor.set(hex, []);
      }
      stitchesByColor.get(hex)?.push(pathD);

      colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1);
      totalStitches++;
    }
  }

  // Sort palette by most frequent colors
  const palette = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color);

  const totalWidth = cols * cellSize;
  const totalHeight = rows * cellSize;

  // Assemble clean SVG string grouping paths by color
  const svgParts: string[] = [];
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">`,
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

  // Create clean data URL for rendering and upload
  const base64Data =
    typeof window !== "undefined" && typeof window.btoa === "function"
      ? window.btoa(unescape(encodeURIComponent(svgString)))
      : Buffer.from(svgString, "utf-8").toString("base64");
  const dataUrl = `data:image/svg+xml;base64,${base64Data}`;

  return {
    svgString,
    dataUrl,
    stitchCount: totalStitches,
    colorCount: palette.length,
    palette,
    gridCols: cols,
    gridRows: rows,
    width: totalWidth,
    height: totalHeight,
  };
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

  // Re-fetch context after dimensions resize
  const drawCtx = canvas.getContext("2d");
  if (!drawCtx) return canvas;

  // Clear background (transparent)
  drawCtx.clearRect(0, 0, canvas.width, canvas.height);

  drawCtx.font = `900 ${fontSize}px ${fontFamily}`;
  drawCtx.fillStyle = textColor;
  drawCtx.textAlign = "center";
  drawCtx.textBaseline = "middle";
  drawCtx.fillText(text, canvas.width / 2, canvas.height / 2);

  return canvas;
}
