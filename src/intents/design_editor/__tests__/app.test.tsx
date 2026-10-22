import { useFeatureSupport } from "@canva/app-hooks";
import { addElementAtCursor, addElementAtPoint } from "@canva/design";
import type { Feature } from "@canva/platform";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { quantizeCanvasToPattern } from "../../../utils/pattern_generator";
import { renderInTestProvider } from "../../../utils/test_render";
import { App } from "../app";

jest.mock("@canva/app-hooks");
jest.mock("@canva/design", () => ({
  addElementAtPoint: jest.fn(),
  addElementAtCursor: jest.fn(),
}));
jest.mock("@canva/asset", () => ({
  upload: jest.fn().mockResolvedValue({ ref: "mock-asset-ref" }),
}));

describe("Cross-Stitch & Pixel Pattern App Tests", () => {
  const mockIsSupported = jest.fn();
  const mockUseFeatureSupport = jest.mocked(useFeatureSupport);

  const createMockContext = () => ({
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    bezierCurveTo: jest.fn(),
    arc: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    drawImage: jest.fn(),
    measureText: jest.fn().mockReturnValue({ width: 100 }),
    fillText: jest.fn(),
    getImageData: jest.fn().mockReturnValue({
      data: new Uint8ClampedArray([
        255,
        46,
        99,
        255, // stitch pixel 1 (pink-red)
        255,
        46,
        99,
        255, // stitch pixel 2 (pink-red)
        30,
        30,
        36,
        255, // stitch pixel 3 (dark gray)
        255,
        255,
        255,
        255, // white background (ignored)
      ]),
      width: 2,
      height: 2,
    }),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
    lineWidth: 1,
    lineCap: "round",
    strokeStyle: "#000",
    fillStyle: "#000",
    font: "10px sans-serif",
    textAlign: "center",
    textBaseline: "middle",
  });

  beforeEach(() => {
    jest.resetAllMocks();

    if (typeof window !== "undefined") {
      window.URL.createObjectURL = jest
        .fn()
        .mockReturnValue("blob:mock-svg-url");
      window.URL.revokeObjectURL = jest.fn();
    }

    HTMLCanvasElement.prototype.getContext = jest
      .fn()
      .mockImplementation(() =>
        createMockContext(),
      ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toDataURL = jest
      .fn()
      .mockReturnValue("data:image/png;base64,mockpngdata");

    mockIsSupported.mockImplementation(
      (fn: Feature) => fn === addElementAtPoint || fn === addElementAtCursor,
    );
    mockUseFeatureSupport.mockReturnValue(mockIsSupported);
  });

  it("should render UI controls including Grid Size, Stitch Style, and Color Count selectors", () => {
    const result = renderInTestProvider(<App />);

    expect(result.getByText("Cross-Stitch & Pixel Pattern")).toBeDefined();
    expect(result.getByText("Grid Size")).toBeDefined();
    expect(result.getByText("Stitch Style")).toBeDefined();
    expect(result.getByText("Color Count")).toBeDefined();
    expect(result.getByText("Background Filter")).toBeDefined();

    const generateBtn = result.getByRole("button", {
      name: "Generate Pattern",
    });
    expect(generateBtn).toBeDefined();
  });

  it("should generate a pattern, support interactive palette editing/removal, and add to Canva", async () => {
    const result = renderInTestProvider(<App />);

    const generateBtn = result.getByRole("button", {
      name: "Generate Pattern",
    });

    await act(async () => {
      fireEvent.click(generateBtn);
      await new Promise((r) => setTimeout(r, 60));
    });

    await waitFor(() => {
      expect(
        result.getByRole("button", { name: "Add Pattern to Canva" }),
      ).toBeDefined();
    });

    // Verify numbered palette swatches and Edit Color section
    const removeColorBtn = result.getByRole("button", {
      name: "Remove Color",
    });
    expect(removeColorBtn).toBeDefined();

    // Remove the selected color and verify Restore Color / Restore All Colors appear
    await act(async () => {
      fireEvent.click(removeColorBtn);
    });

    expect(result.getByRole("button", { name: "Restore Color" })).toBeDefined();
    expect(
      result.getAllByRole("button", { name: "Restore All Colors" }).length,
    ).toBeGreaterThan(0);

    // Restore color
    await act(async () => {
      fireEvent.click(result.getByRole("button", { name: "Restore Color" }));
    });

    const addBtn = result.getByRole("button", {
      name: "Add Pattern to Canva",
    });

    await act(async () => {
      fireEvent.click(addBtn);
    });

    await waitFor(() => {
      expect(addElementAtPoint).toHaveBeenCalled();
    });
  });

  it("should switch between input tabs: Upload, Presets, and Text Logo", async () => {
    const result = renderInTestProvider(<App />);

    const presetsTab = result.getByRole("radio", { name: "Presets" });
    await act(async () => {
      fireEvent.click(presetsTab);
    });

    expect(result.getByText("Select a sample design to stitch:")).toBeDefined();
    expect(result.getByRole("button", { name: "Star" })).toBeDefined();

    const textTab = result.getByRole("radio", { name: "Text Logo" });
    await act(async () => {
      fireEvent.click(textTab);
    });

    expect(result.getByText("Text / Word")).toBeDefined();
  });

  it("should preserve thin calligraphy strokes with contrast boost and bridge 1-cell curve gaps", () => {
    const gridSize = 20;
    const ss = 8;
    const sampleDim = gridSize * ss; // 160x160 sub-pixel buffer
    const buffer = new Uint8ClampedArray(sampleDim * sampleDim * 4).fill(255);

    const setSubPixel = (
      cellRow: number,
      cellCol: number,
      subY: number,
      subX: number,
      rgb: number,
    ) => {
      const py = cellRow * ss + subY;
      const px = cellCol * ss + subX;
      const idx = (py * sampleDim + px) * 4;
      buffer[idx] = rgb;
      buffer[idx + 1] = rgb;
      buffer[idx + 2] = rgb;
      buffer[idx + 3] = 255;
    };

    // Simulate a thin script curve across cells (5, 5), (5, 6), grazed (6, 7), and (7, 8)
    // where each active cell only has 3 dark/diluted sub-pixels out of 64 (far below the old 18/64 threshold)
    setSubPixel(5, 5, 3, 3, 90);
    setSubPixel(5, 5, 3, 4, 110);
    setSubPixel(5, 5, 4, 4, 95);

    setSubPixel(5, 6, 4, 2, 85);
    setSubPixel(5, 6, 4, 3, 100);
    setSubPixel(5, 6, 5, 3, 90);

    // Cell (6, 7) has only 1 faint grazed sub-pixel (rgb = 232) bridging (5, 6) and (7, 8)
    setSubPixel(6, 7, 4, 4, 232);

    setSubPixel(7, 8, 2, 2, 80);
    setSubPixel(7, 8, 2, 3, 95);
    setSubPixel(7, 8, 3, 3, 85);

    HTMLCanvasElement.prototype.getContext = jest
      .fn()
      .mockImplementation(() => ({
        ...createMockContext(),
        getImageData: jest.fn().mockReturnValue({
          data: buffer,
          width: sampleDim,
          height: sampleDim,
        }),
      })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const canvas = document.createElement("canvas");
    canvas.width = sampleDim;
    canvas.height = sampleDim;

    const quantized = quantizeCanvasToPattern(canvas, {
      gridSize: 20,
      stitchStyle: "cross_stitch",
      ignoreBackground: true,
      autoCrop: false,
      colorCountLimit: 4,
    });

    const activeCoords = new Set(
      quantized.cells.map((cell) => `${cell.row},${cell.col}`),
    );

    // Verify thin-stroke cells (with only 3/64 sub-pixels) were preserved and not averaged out to white
    expect(activeCoords.has("5,5")).toBe(true);
    expect(activeCoords.has("5,6")).toBe(true);
    expect(activeCoords.has("7,8")).toBe(true);
    // Verify the 1-cell curve gap at (6, 7) was bridged for continuous line preservation
    expect(activeCoords.has("6,7")).toBe(true);
  });

  it("should preserve the complete cursive 'P' at 30x30 without broken hairlines or missing loops", () => {
    const gridSize = 30;
    const ss = 8;
    const sampleDim = gridSize * ss; // 240x240 buffer
    const buffer = new Uint8ClampedArray(sampleDim * sampleDim * 4).fill(255);

    const markStrokeCell = (
      row: number,
      col: number,
      subCount: number,
      lum: number,
    ) => {
      for (let i = 0; i < subCount; i++) {
        const sy = Math.floor(i / ss);
        const sx = i % ss;
        const py = row * ss + sy;
        const px = col * ss + sx;
        const idx = (py * sampleDim + px) * 4;
        buffer[idx] = lum;
        buffer[idx + 1] = lum;
        buffer[idx + 2] = lum;
        buffer[idx + 3] = 255;
      }
    };

    // 1. Cursive "P" vertical stem: rows 5..24, col 10 (medium-weight stroke)
    for (let r = 5; r <= 24; r++) {
      markStrokeCell(r, 10, 22, 20);
    }

    // 2. Thin entry hairline sweep leading into top of "P": (10, 7) -> (8, 8) -> (6, 9)
    // Only 2 dark pixels per cell (simulating a 1px calligraphy hairline)
    markStrokeCell(10, 7, 2, 60);
    markStrokeCell(9, 8, 2, 65);
    markStrokeCell(7, 9, 2, 60);

    // 3. Cursive "P" upper loop starting at (5, 11), curving out to col 17, and rejoining stem at (14, 11)
    // Includes a single-cell diagonal break at (9, 17) where both sides are already attached to the stem!
    const loopCells: [number, number][] = [
      [5, 11],
      [5, 12],
      [5, 13],
      [5, 14],
      [6, 15],
      [7, 16],
      [8, 17],
      // (9, 17) intentionally skipped to test closed-loop 8-way continuity bridging!
      [10, 17],
      [11, 16],
      [12, 15],
      [13, 14],
      [14, 13],
      [14, 12],
      [14, 11],
    ];
    for (const [r, c] of loopCells) {
      markStrokeCell(r, c, 2, 55);
    }

    HTMLCanvasElement.prototype.getContext = jest
      .fn()
      .mockImplementation(() => ({
        ...createMockContext(),
        getImageData: jest.fn().mockReturnValue({
          data: buffer,
          width: sampleDim,
          height: sampleDim,
        }),
      })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const canvas = document.createElement("canvas");
    canvas.width = sampleDim;
    canvas.height = sampleDim;

    const quantized = quantizeCanvasToPattern(canvas, {
      gridSize: 30,
      stitchStyle: "cross_stitch",
      ignoreBackground: true,
      autoCrop: false,
      colorCountLimit: 4,
    });

    const activeCoords = new Set(
      quantized.cells.map((cell) => `${cell.row},${cell.col}`),
    );

    // Verify hairline entry sweep is preserved
    expect(activeCoords.has("10,7")).toBe(true);
    expect(activeCoords.has("9,8")).toBe(true);
    expect(activeCoords.has("7,9")).toBe(true);

    // Verify the closed loop of the cursive "P" is preserved AND the 1-cell break at (9, 17) was bridged
    expect(activeCoords.has("8,17")).toBe(true);
    expect(activeCoords.has("9,17")).toBe(true);
    expect(activeCoords.has("10,17")).toBe(true);
    expect(quantized.initialPalette[0]?.currentHex).toBe("#000000");
  });
});
