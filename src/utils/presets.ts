/**
 * Built-in presets for quick one-click pattern testing without needing to upload an image.
 */

export interface PresetItem {
  id: string;
  name: string;
  createCanvas: () => HTMLCanvasElement;
}

export function createHeartCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.clearRect(0, 0, 160, 160);
  ctx.fillStyle = "#FF2E63";

  // Draw smooth heart
  ctx.beginPath();
  ctx.moveTo(80, 140);
  ctx.bezierCurveTo(30, 100, 10, 60, 40, 30);
  ctx.bezierCurveTo(60, 10, 80, 35, 80, 50);
  ctx.bezierCurveTo(80, 35, 100, 10, 120, 30);
  ctx.bezierCurveTo(150, 60, 130, 100, 80, 140);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

export function createStarCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.clearRect(0, 0, 160, 160);
  ctx.fillStyle = "#FFB800";

  const cx = 80;
  const cy = 80;
  const outerR = 65;
  const innerR = 30;
  const points = 5;

  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();

  return canvas;
}

export function createSmileyCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.clearRect(0, 0, 160, 160);

  // Yellow face
  ctx.fillStyle = "#FFD124";
  ctx.beginPath();
  ctx.arc(80, 80, 70, 0, Math.PI * 2);
  ctx.fill();

  // Dark eyes
  ctx.fillStyle = "#1E1E24";
  ctx.beginPath();
  ctx.arc(55, 65, 8, 0, Math.PI * 2);
  ctx.arc(105, 65, 8, 0, Math.PI * 2);
  ctx.fill();

  // Smile
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#1E1E24";
  ctx.beginPath();
  ctx.arc(80, 85, 35, 0.2 * Math.PI, 0.8 * Math.PI, false);
  ctx.stroke();

  return canvas;
}

export function createFlowerCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.clearRect(0, 0, 160, 160);

  // 6 petals
  const petals = 6;
  const cx = 80;
  const cy = 80;
  const petalR = 32;

  ctx.fillStyle = "#9B51E0";
  for (let i = 0; i < petals; i++) {
    const angle = (i * 2 * Math.PI) / petals;
    const px = cx + Math.cos(angle) * 38;
    const py = cy + Math.sin(angle) * 38;
    ctx.beginPath();
    ctx.arc(px, py, petalR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Yellow center
  ctx.fillStyle = "#F2C94C";
  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

export const PRESETS: PresetItem[] = [
  { id: "heart", name: "Heart", createCanvas: createHeartCanvas },
  { id: "star", name: "Star", createCanvas: createStarCanvas },
  { id: "smiley", name: "Smiley", createCanvas: createSmileyCanvas },
  { id: "flower", name: "Flower", createCanvas: createFlowerCanvas },
];
