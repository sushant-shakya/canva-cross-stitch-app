import { useFeatureSupport } from "@canva/app-hooks";
import {
  addElementAtCursor,
  addElementAtPoint,
  addNativeElement,
} from "@canva/design";
import type { Feature } from "@canva/platform";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { renderInTestProvider } from "../../../utils/test_render";
import { App } from "../app";

jest.mock("@canva/app-hooks");
jest.mock("@canva/design", () => ({
  addNativeElement: jest.fn(),
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
        255, // stitch pixel 1
        255,
        46,
        99,
        255, // stitch pixel 2
        255,
        255,
        255,
        255, // white background (ignored)
        0,
        0,
        0,
        0, // transparent background (ignored)
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
      (fn: Feature) =>
        fn === addNativeElement ||
        fn === addElementAtPoint ||
        fn === addElementAtCursor,
    );
    mockUseFeatureSupport.mockReturnValue(mockIsSupported);
  });

  it("should render UI controls including Grid Size and Stitch Style selectors", () => {
    const result = renderInTestProvider(<App />);

    expect(result.getByText("Cross-Stitch & Pixel Pattern")).toBeDefined();
    expect(result.getByText("Grid Size")).toBeDefined();
    expect(result.getByText("Stitch Style")).toBeDefined();
    expect(result.getByText("Background Filter")).toBeDefined();

    const generateBtn = result.getByRole("button", {
      name: "Generate Pattern",
    });
    expect(generateBtn).toBeDefined();
  });

  it("should generate a pattern and allow adding it to Canva", async () => {
    const result = renderInTestProvider(<App />);

    // Click Generate Pattern
    const generateBtn = result.getByRole("button", {
      name: "Generate Pattern",
    });

    await act(async () => {
      fireEvent.click(generateBtn);
      // Wait for internal generation setTimeout
      await new Promise((r) => setTimeout(r, 60));
    });

    // Check that Add Pattern to Canva button appears
    await waitFor(() => {
      expect(
        result.getByRole("button", { name: "Add Pattern to Canva" }),
      ).toBeDefined();
    });

    const addBtn = result.getByRole("button", {
      name: "Add Pattern to Canva",
    });

    await act(async () => {
      fireEvent.click(addBtn);
    });

    await waitFor(() => {
      expect(addNativeElement).toBeDefined();
    });
  });

  it("should switch between input tabs: Upload, Presets, and Text Logo", async () => {
    const result = renderInTestProvider(<App />);

    // Click Presets tab
    const presetsTab = result.getByRole("radio", { name: "Presets" });
    await act(async () => {
      fireEvent.click(presetsTab);
    });

    expect(result.getByText("Select a sample design to stitch:")).toBeDefined();
    expect(result.getByRole("button", { name: "Star" })).toBeDefined();

    // Click Text Logo tab
    const textTab = result.getByRole("radio", { name: "Text Logo" });
    await act(async () => {
      fireEvent.click(textTab);
    });

    expect(result.getByText("Text / Word")).toBeDefined();
  });
});
