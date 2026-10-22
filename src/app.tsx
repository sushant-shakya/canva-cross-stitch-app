import { useFeatureSupport } from "@canva/app-hooks";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  ColorSelector,
  FileInput,
  FormField,
  ImageCard,
  NumberInput,
  Rows,
  SegmentedControl,
  Select,
  Swatch,
  Text,
  TextInput,
  Title,
} from "@canva/app-ui-kit";
import type { ImageRef } from "@canva/asset";
import { upload } from "@canva/asset";
import type { ImageElement } from "@canva/design";
import { addElementAtCursor, addElementAtPoint } from "@canva/design";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import * as styles from "styles/components.css";
import type {
  GridSize,
  PaletteColorEntry,
  QuantizedPatternBase,
  StitchStyle,
} from "./utils/pattern_generator";
import {
  buildPatternResultFromQuantized,
  getContrastTextColor,
  imageToCanvas,
  loadImageFromFile,
  normalizeHexColor,
  quantizeCanvasToPattern,
  renderTextToCanvas,
} from "./utils/pattern_generator";
import { PRESETS } from "./utils/presets";

type InputSource = "upload" | "text" | "presets";

const QUICK_THREAD_COLORS = [
  "#000000",
  "#FFFFFF",
  "#E63946",
  "#FF2E63",
  "#FFB703",
  "#2A9D8F",
  "#1D3557",
  "#7D2AE8",
];

export const App = () => {
  const intl = useIntl();
  const isSupported = useFeatureSupport();

  // Intent / Canva canvas insertion methods
  const addElement = [addElementAtPoint, addElementAtCursor].find((fn) =>
    isSupported(fn),
  );
  const canAdd = Boolean(addElement);

  // Configuration State
  const [inputSource, setInputSource] = useState<InputSource>("upload");
  const [gridSize, setGridSize] = useState<GridSize>(40);
  const [stitchStyle, setStitchStyle] = useState<StitchStyle>("cross_stitch");
  const [colorCountLimit, setColorCountLimit] = useState<number>(8);
  const [ignoreBackground, setIgnoreBackground] = useState<boolean>(true);

  // Source image / text state
  const [activeCanvas, setActiveCanvas] = useState<HTMLCanvasElement | null>(
    null,
  );
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string>("");
  const [customText, setCustomText] = useState<string>("CANVA");

  // Quantized Pattern Base & Interactive Palette State
  const [quantizedBase, setQuantizedBase] =
    useState<QuantizedPatternBase | null>(null);
  const [paletteEntries, setPaletteEntries] = useState<PaletteColorEntry[]>([]);
  const [selectedColorIndex, setSelectedColorIndex] = useState<number | null>(
    0,
  );
  const [hexInputText, setHexInputText] = useState<string>("");

  // UI Status State
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live reactive pattern computation whenever palette, stitchStyle, or quantizedBase changes
  const patternResult = useMemo(() => {
    if (!quantizedBase) {
      return null;
    }
    return buildPatternResultFromQuantized(
      quantizedBase,
      paletteEntries,
      stitchStyle,
    );
  }, [quantizedBase, paletteEntries, stitchStyle]);

  // Sync hexInputText when selectedColorIndex or paletteEntries changes
  const selectedPaletteItem =
    selectedColorIndex != null
      ? (paletteEntries[selectedColorIndex] ?? null)
      : null;

  useEffect(() => {
    if (selectedPaletteItem) {
      setHexInputText(selectedPaletteItem.currentHex);
    }
  }, [selectedPaletteItem]);

  // Initialize with heart preset so users see immediate value
  useEffect(() => {
    const defaultPreset = PRESETS[0];
    if (defaultPreset) {
      const cvs = defaultPreset.createCanvas();
      setActiveCanvas(cvs);
      try {
        const initialBase = quantizeCanvasToPattern(cvs, {
          gridSize: 40,
          stitchStyle: "cross_stitch",
          ignoreBackground: true,
          colorCountLimit: 8,
        });
        setQuantizedBase(initialBase);
        setPaletteEntries(initialBase.initialPalette);
        setSelectedColorIndex(initialBase.initialPalette.length > 0 ? 0 : null);
      } catch {
        // Fallback gracefully if canvas context is not ready
      }
    }
  }, []);

  // Update object URL when patternResult changes
  useEffect(() => {
    if (!patternResult) {
      setPreviewObjectUrl("");
      return;
    }

    const blob = new Blob([patternResult.svgString], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    setPreviewObjectUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [patternResult]);

  // Handle uploaded file
  const handleFileChange = useCallback(
    async (file: File) => {
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const img = await loadImageFromFile(file);
        const cvs = imageToCanvas(img);
        setActiveCanvas(cvs);
        setUploadedFileName(file.name);
        setUploadedPreviewUrl(img.src);
      } catch {
        setErrorMessage(
          intl.formatMessage({
            defaultMessage: "Failed to load the selected image file.",
            description:
              "Error message when uploaded image file cannot be read",
          }),
        );
      }
    },
    [intl],
  );

  // Preset selector
  const handleSelectPreset = (presetId: string) => {
    const found = PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    const cvs = found.createCanvas();
    setActiveCanvas(cvs);
    setUploadedFileName(found.name);
    setUploadedPreviewUrl(cvs.toDataURL());
    setErrorMessage(null);
  };

  // Text logo generation
  const handleApplyText = () => {
    if (!customText.trim()) return;
    const cvs = renderTextToCanvas(customText.trim(), "#7D2AE8");
    setActiveCanvas(cvs);
    setUploadedFileName(`Text: ${customText}`);
    setUploadedPreviewUrl(cvs.toDataURL());
    setErrorMessage(null);
  };

  // Generate Pattern Core Logic
  const handleGenerate = useCallback(() => {
    let source = activeCanvas;

    if (inputSource === "text" && customText.trim()) {
      source = renderTextToCanvas(customText.trim(), "#7D2AE8");
      setActiveCanvas(source);
    }

    if (!source) {
      setErrorMessage(
        intl.formatMessage({
          defaultMessage: "Please upload an image or choose a preset first.",
          description:
            "Error message when user tries to generate without source image",
        }),
      );
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setStatusMessage(null);

    setTimeout(() => {
      try {
        if (!source) return;
        const nextBase = quantizeCanvasToPattern(source, {
          gridSize,
          stitchStyle,
          ignoreBackground,
          colorCountLimit,
        });
        const built = buildPatternResultFromQuantized(
          nextBase,
          nextBase.initialPalette,
          stitchStyle,
        );
        setQuantizedBase(nextBase);
        setPaletteEntries(nextBase.initialPalette);
        setSelectedColorIndex(nextBase.initialPalette.length > 0 ? 0 : null);
        setStatusMessage(
          intl.formatMessage(
            {
              defaultMessage:
                "Pattern created! {stitches} stitches with {colors} colors.",
              description:
                "Status message indicating successful pattern generation",
            },
            {
              stitches: built.stitchCount,
              colors: built.colorCount,
            },
          ),
        );
      } catch {
        setErrorMessage(
          intl.formatMessage({
            defaultMessage: "Could not generate vector pattern from image.",
            description: "Error message on pattern generation failure",
          }),
        );
      } finally {
        setIsGenerating(false);
      }
    }, 20);
  }, [
    activeCanvas,
    colorCountLimit,
    customText,
    gridSize,
    ignoreBackground,
    inputSource,
    intl,
    stitchStyle,
  ]);

  // Interactive Palette Actions
  const handleSelectSwatch = (index: number) => {
    setSelectedColorIndex(index);
    const entry = paletteEntries[index];
    if (entry) {
      setHexInputText(entry.currentHex);
    }
  };

  const handleUpdateSelectedColor = useCallback(
    (newColorInput: string) => {
      if (selectedColorIndex == null) return;
      const normalized = normalizeHexColor(newColorInput);
      if (!normalized) return;

      setPaletteEntries((prev) =>
        prev.map((entry, idx) =>
          idx === selectedColorIndex
            ? { ...entry, currentHex: normalized, removed: false }
            : entry,
        ),
      );
    },
    [selectedColorIndex],
  );

  const handleHexInputChange = (value: string) => {
    setHexInputText(value);
    const normalized = normalizeHexColor(value);
    if (normalized) {
      handleUpdateSelectedColor(normalized);
    }
  };

  const handleToggleRemoveColor = useCallback((index: number) => {
    setPaletteEntries((prev) =>
      prev.map((entry, idx) =>
        idx === index ? { ...entry, removed: !entry.removed } : entry,
      ),
    );
  }, []);

  const handleRestoreAllColors = useCallback(() => {
    setPaletteEntries((prev) =>
      prev.map((entry) => ({
        ...entry,
        removed: false,
        currentHex: entry.originalHex,
      })),
    );
  }, []);

  const hasRemovedOrEditedColors = useMemo(
    () =>
      paletteEntries.some(
        (entry) => entry.removed || entry.currentHex !== entry.originalHex,
      ),
    [paletteEntries],
  );

  // Insert onto active Canva canvas
  const handleAddPatternToCanva = useCallback(async () => {
    if (!patternResult) return;

    setIsAdding(true);
    setErrorMessage(null);

    try {
      const dataUrl = patternResult.dataUrl;
      let assetRef: ImageRef | undefined;

      // Attempt official Canva asset upload first for high-fidelity vector insertion
      try {
        const uploadResult = await upload({
          type: "image",
          mimeType: "image/svg+xml",
          url: dataUrl,
          thumbnailUrl: dataUrl,
          name: `Stitch_Pattern_${stitchStyle}.svg`,
          aiDisclosure: "none",
        });
        assetRef = uploadResult.ref;
      } catch {
        // Fallback gracefully in testing / offline / mock mode
      }

      const elementData: ImageElement = assetRef
        ? {
            type: "image",
            ref: assetRef,
            altText: {
              text: `Cross-stitch vector pattern (${stitchStyle}, ${gridSize}x${gridSize})`,
              decorative: false,
            },
          }
        : {
            type: "image",
            dataUrl,
            altText: {
              text: `Cross-stitch vector pattern (${stitchStyle}, ${gridSize}x${gridSize})`,
              decorative: false,
            },
          };

      // Insert onto design canvas via addElementAtPoint (or addElementAtCursor)
      const insertElement = addElement ?? addElementAtPoint;
      await insertElement(elementData);

      setStatusMessage(
        intl.formatMessage({
          defaultMessage: "Vector pattern added to your Canva design!",
          description: "Success message after pattern is added to canvas",
        }),
      );
    } catch {
      setErrorMessage(
        intl.formatMessage({
          defaultMessage: "Failed to add pattern to Canva. Please try again.",
          description: "Error message when adding pattern to Canva fails",
        }),
      );
    } finally {
      setIsAdding(false);
    }
  }, [addElement, gridSize, intl, patternResult, stitchStyle]);

  // Grid size select options
  const gridSizeOptions = useMemo(
    () => [
      {
        value: 20 as GridSize,
        label: intl.formatMessage({
          defaultMessage: "20x20 (Coarse / Fast)",
          description: "20x20 grid size option",
        }),
      },
      {
        value: 30 as GridSize,
        label: intl.formatMessage({
          defaultMessage: "30x30 (Medium-Low)",
          description: "30x30 grid size option",
        }),
      },
      {
        value: 40 as GridSize,
        label: intl.formatMessage({
          defaultMessage: "40x40 (Standard - Recommended)",
          description: "40x40 grid size option",
        }),
      },
      {
        value: 50 as GridSize,
        label: intl.formatMessage({
          defaultMessage: "50x50 (Detailed)",
          description: "50x50 grid size option",
        }),
      },
      {
        value: 60 as GridSize,
        label: intl.formatMessage({
          defaultMessage: "60x60 (High Detail)",
          description: "60x60 grid size option",
        }),
      },
      {
        value: 80 as GridSize,
        label: intl.formatMessage({
          defaultMessage: "80x80 (Ultra Fine)",
          description: "80x80 grid size option",
        }),
      },
    ],
    [intl],
  );

  // Stitch style select options
  const stitchStyleOptions = useMemo(
    () => [
      {
        value: "cross_stitch" as StitchStyle,
        label: intl.formatMessage({
          defaultMessage: "Cross Stitch (X)",
          description: "Cross-stitch stitch style option",
        }),
      },
      {
        value: "sparkle" as StitchStyle,
        label: intl.formatMessage({
          defaultMessage: "4-Point Sparkle",
          description: "4-point sparkle stitch style option",
        }),
      },
      {
        value: "pixel_square" as StitchStyle,
        label: intl.formatMessage({
          defaultMessage: "Pixel Square",
          description: "Pixel square stitch style option",
        }),
      },
      {
        value: "polka_dot" as StitchStyle,
        label: intl.formatMessage({
          defaultMessage: "Polka Dot",
          description: "Polka dot stitch style option",
        }),
      },
    ],
    [intl],
  );

  // Segmented control options for input mode
  const inputSourceOptions = useMemo(
    () => [
      {
        value: "upload" as InputSource,
        label: intl.formatMessage({
          defaultMessage: "Upload",
          description: "Upload tab label for image source",
        }),
      },
      {
        value: "presets" as InputSource,
        label: intl.formatMessage({
          defaultMessage: "Presets",
          description: "Presets tab label for sample images",
        }),
      },
      {
        value: "text" as InputSource,
        label: intl.formatMessage({
          defaultMessage: "Text Logo",
          description: "Text logo tab label for custom typography",
        }),
      },
    ],
    [intl],
  );

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        {/* Title & Introduction */}
        <Box>
          <Title size="small">
            <FormattedMessage
              defaultMessage="Cross-Stitch & Pixel Pattern"
              description="App header title"
            />
          </Title>
          <Text size="small" tone="tertiary">
            <FormattedMessage
              defaultMessage="Convert any image, logo, or text into embroidery & pixel vector art."
              description="App description subtitle"
            />
          </Text>
        </Box>

        {/* Input Source Mode Selection */}
        <SegmentedControl<InputSource>
          value={inputSource}
          options={inputSourceOptions}
          onChange={(val) => {
            setInputSource(val);
            if (val === "text") {
              handleApplyText();
            }
          }}
        />

        {/* Upload Mode UI */}
        {inputSource === "upload" && (
          <Rows spacing="1.5u">
            <FormField
              label={intl.formatMessage({
                defaultMessage: "Select an image file",
                description: "Label for image file selector input",
              })}
              control={(props) => (
                <FileInput
                  {...props}
                  accept={[
                    "image/png",
                    "image/jpeg",
                    "image/webp",
                    "image/svg+xml",
                  ]}
                  onDropAcceptedFiles={(files) => {
                    if (files.length > 0 && files[0]) {
                      handleFileChange(files[0]);
                    }
                  }}
                />
              )}
            />

            {uploadedFileName && uploadedPreviewUrl && (
              <div className={styles.thumbnailContainer}>
                <ImageCard
                  thumbnailUrl={uploadedPreviewUrl}
                  alt={intl.formatMessage({
                    defaultMessage: "Uploaded thumbnail preview",
                    description: "Alt text for source image thumbnail",
                  })}
                  borderRadius="standard"
                  thumbnailHeight={48}
                  thumbnailAspectRatio={1}
                />
                <div className={styles.thumbnailDetails}>
                  <Text size="small">{uploadedFileName}</Text>
                  <Text size="xsmall" tone="tertiary">
                    <FormattedMessage
                      defaultMessage="Image ready to stitch"
                      description="Indicates uploaded file is loaded and ready"
                    />
                  </Text>
                </div>
              </div>
            )}
          </Rows>
        )}

        {/* Presets Mode UI */}
        {inputSource === "presets" && (
          <Rows spacing="1u">
            <Text size="small">
              <FormattedMessage
                defaultMessage="Select a sample design to stitch:"
                description="Prompt for selecting a built-in sample preset"
              />
            </Text>
            <div className={styles.presetGrid}>
              {PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant="secondary"
                  size="small"
                  onClick={() => handleSelectPreset(preset.id)}
                >
                  {preset.name}
                </Button>
              ))}
            </div>
            {uploadedPreviewUrl && (
              <div className={styles.thumbnailContainer}>
                <ImageCard
                  thumbnailUrl={uploadedPreviewUrl}
                  alt={intl.formatMessage({
                    defaultMessage: "Preset thumbnail preview",
                    description: "Alt text for preset thumbnail",
                  })}
                  borderRadius="standard"
                  thumbnailHeight={48}
                  thumbnailAspectRatio={1}
                />
                <div className={styles.thumbnailDetails}>
                  <Text size="small">{uploadedFileName}</Text>
                </div>
              </div>
            )}
          </Rows>
        )}

        {/* Text Logo Mode UI */}
        {inputSource === "text" && (
          <Rows spacing="1.5u">
            <FormField
              label={intl.formatMessage({
                defaultMessage: "Text / Word",
                description: "Input label for text logo content",
              })}
              control={(props) => (
                <TextInput
                  {...props}
                  value={customText}
                  onChange={(val) => setCustomText(val)}
                  placeholder={intl.formatMessage({
                    defaultMessage: "Type your logo text...",
                    description: "Placeholder for custom text input",
                  })}
                />
              )}
            />
            <Button variant="secondary" size="small" onClick={handleApplyText}>
              {intl.formatMessage({
                defaultMessage: "Update Text Preview",
                description: "Button text to update text canvas",
              })}
            </Button>
          </Rows>
        )}

        {/* Grid Size dropdown selector */}
        <FormField
          label={intl.formatMessage({
            defaultMessage: "Grid Size",
            description: "Grid resolution dropdown label",
          })}
          description={intl.formatMessage({
            defaultMessage: "Resolution of the cross-stitch grid",
            description: "Grid size description",
          })}
          control={(props) => (
            <Select<GridSize>
              {...props}
              stretch
              value={gridSize}
              options={gridSizeOptions}
              onChange={(val) => setGridSize(val)}
            />
          )}
        />

        {/* Stitch Style dropdown selector */}
        <FormField
          label={intl.formatMessage({
            defaultMessage: "Stitch Style",
            description: "Stitch shape dropdown label",
          })}
          description={intl.formatMessage({
            defaultMessage: "Vector shape for each grid cell",
            description: "Stitch style description",
          })}
          control={(props) => (
            <Select<StitchStyle>
              {...props}
              stretch
              value={stitchStyle}
              options={stitchStyleOptions}
              onChange={(val) => setStitchStyle(val)}
            />
          )}
        />

        {/* Color Count selector (2 to 16 colors) */}
        <FormField
          label={intl.formatMessage({
            defaultMessage: "Color Count",
            description: "Color quantization count input label",
          })}
          description={intl.formatMessage({
            defaultMessage:
              "Quantize pattern into 2 to 16 dominant thread colors",
            description: "Color count selector description",
          })}
          control={(props) => (
            <NumberInput
              {...props}
              min={2}
              max={16}
              step={1}
              value={colorCountLimit}
              hasSpinButtons
              decrementAriaLabel={intl.formatMessage({
                defaultMessage: "Decrease color count",
                description: "Aria label for decrementing color count",
              })}
              incrementAriaLabel={intl.formatMessage({
                defaultMessage: "Increase color count",
                description: "Aria label for incrementing color count",
              })}
              onChange={(val) => {
                if (typeof val === "number" && !Number.isNaN(val)) {
                  const clamped = Math.max(2, Math.min(16, Math.round(val)));
                  setColorCountLimit(clamped);
                }
              }}
            />
          )}
        />

        {/* Background Filter */}
        <FormField
          label={intl.formatMessage({
            defaultMessage: "Background Filter",
            description: "Background filtering section label",
          })}
          description={intl.formatMessage({
            defaultMessage:
              "Automatically ignore transparent and near-white pixels",
            description: "Background filter explanation",
          })}
          control={(props) => (
            <Checkbox
              {...props}
              checked={ignoreBackground}
              onChange={(_, checked) => setIgnoreBackground(checked)}
              label={intl.formatMessage({
                defaultMessage: "Filter out white & transparent backgrounds",
                description: "Checkbox label for ignoring background pixels",
              })}
            />
          )}
        />

        {/* Generate Pattern Button */}
        <Button
          variant="primary"
          stretch
          loading={isGenerating}
          onClick={handleGenerate}
        >
          {intl.formatMessage({
            defaultMessage: "Generate Pattern",
            description: "Button to process and generate vector pattern",
          })}
        </Button>

        {/* Alerts / Feedback */}
        {errorMessage && (
          <Alert
            tone="critical"
            title={intl.formatMessage({
              defaultMessage: "Error",
              description: "Error alert title",
            })}
          >
            {errorMessage}
          </Alert>
        )}

        {statusMessage && !errorMessage && (
          <Alert
            tone="positive"
            title={intl.formatMessage({
              defaultMessage: "Success",
              description: "Success alert title",
            })}
          >
            {statusMessage}
          </Alert>
        )}

        {/* Pattern Preview & Interactive Thread Palette Section */}
        {patternResult && (previewObjectUrl || patternResult.dataUrl) && (
          <Rows spacing="1.5u">
            <Title size="small">
              <FormattedMessage
                defaultMessage="Pattern Preview"
                description="Header for inline vector pattern preview"
              />
            </Title>

            {/* Needlework canvas checkered container with ImageCard */}
            <div className={styles.previewBox}>
              <ImageCard
                thumbnailUrl={previewObjectUrl || patternResult.dataUrl}
                alt={intl.formatMessage({
                  defaultMessage: "Generated vector cross-stitch pattern",
                  description: "Alt text for generated vector preview",
                })}
                thumbnailBackground="secondary"
                borderRadius="standard"
                thumbnailHeight={220}
                thumbnailAspectRatio={
                  patternResult.width / patternResult.height
                }
              />
            </div>

            {/* Pattern Statistics */}
            <div className={styles.statsRow}>
              <div className={styles.statBadge}>
                <Text size="xsmall">
                  <FormattedMessage
                    defaultMessage="Stitches: {count}"
                    description="Total stitches count badge"
                    values={{ count: patternResult.stitchCount }}
                  />
                </Text>
              </div>
              <div className={styles.statBadge}>
                <Text size="xsmall">
                  <FormattedMessage
                    defaultMessage="Colors: {count}"
                    description="Unique thread colors count badge"
                    values={{ count: patternResult.colorCount }}
                  />
                </Text>
              </div>
              <div className={styles.statBadge}>
                <Text size="xsmall">
                  <FormattedMessage
                    defaultMessage="Grid: {cols}x{rows}"
                    description="Grid dimensions badge"
                    values={{
                      cols: patternResult.gridCols,
                      rows: patternResult.gridRows,
                    }}
                  />
                </Text>
              </div>
            </div>

            {/* Interactive Numbered Thread Palette Bar */}
            {paletteEntries.length > 0 && (
              <Rows spacing="1u">
                <div className={styles.paletteHeaderRow}>
                  <Text size="xsmall" tone="tertiary">
                    <FormattedMessage
                      defaultMessage="Palette (click a number to edit or remove):"
                      description="Interactive numbered thread palette header"
                    />
                  </Text>
                  {hasRemovedOrEditedColors && (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={handleRestoreAllColors}
                    >
                      {intl.formatMessage({
                        defaultMessage: "Restore All Colors",
                        description:
                          "Button to restore all removed or modified palette colors",
                      })}
                    </Button>
                  )}
                </div>

                <div className={styles.paletteContainer}>
                  {paletteEntries.map((entry, idx) => {
                    const isSelected = selectedColorIndex === idx;
                    const textColor = getContrastTextColor(entry.currentHex);
                    const boxClasses = [
                      styles.paletteSwatchBox,
                      isSelected ? styles.paletteSwatchActive : "",
                      entry.removed ? styles.paletteSwatchRemoved : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    const swatchAriaLabel = intl.formatMessage(
                      {
                        defaultMessage: "Palette color {number} ({hex})",
                        description:
                          "Accessible label for numbered palette swatch button",
                      },
                      {
                        number: idx + 1,
                        hex: entry.currentHex,
                      },
                    );
                    const swatchDisplayLabel = entry.removed
                      ? intl.formatMessage({
                          defaultMessage: "X",
                          description: "Removed color marker on palette swatch",
                        })
                      : String(idx + 1);

                    return (
                      <div
                        key={entry.index}
                        role="button"
                        tabIndex={0}
                        aria-label={swatchAriaLabel}
                        className={boxClasses}
                        style={{
                          backgroundColor: entry.currentHex,
                          color: textColor,
                        }}
                        title={swatchAriaLabel}
                        onClick={() => handleSelectSwatch(idx)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelectSwatch(idx);
                          }
                        }}
                      >
                        {swatchDisplayLabel}
                      </div>
                    );
                  })}
                </div>

                {/* Edit Color Section for Selected Palette Swatch */}
                {selectedPaletteItem && selectedColorIndex != null && (
                  <div className={styles.editColorPanel}>
                    <Rows spacing="1.5u">
                      <div className={styles.editColorHeader}>
                        <Text size="small">
                          <FormattedMessage
                            defaultMessage="Edit Color #{number} ({hex})"
                            description="Title of the Edit Color panel for the selected palette swatch"
                            values={{
                              number: selectedColorIndex + 1,
                              hex: selectedPaletteItem.currentHex,
                            }}
                          />
                        </Text>
                        <Text size="xsmall" tone="tertiary">
                          <FormattedMessage
                            defaultMessage="{count} stitches"
                            description="Number of stitches belonging to the selected palette color"
                            values={{ count: selectedPaletteItem.stitchCount }}
                          />
                        </Text>
                      </div>

                      <div className={styles.colorPickerRow}>
                        <ColorSelector
                          color={selectedPaletteItem.currentHex}
                          onChange={(newColor) => {
                            setHexInputText(newColor.toUpperCase());
                            handleUpdateSelectedColor(newColor);
                          }}
                        />
                        <div className={styles.hexInputWrapper}>
                          <TextInput
                            value={hexInputText}
                            onChange={handleHexInputChange}
                            placeholder={intl.formatMessage({
                              defaultMessage: "#000000",
                              description: "Hex color code input placeholder",
                            })}
                          />
                        </div>
                      </div>

                      <div className={styles.quickSwatchRow}>
                        {QUICK_THREAD_COLORS.map((presetHex) => (
                          <Swatch
                            key={presetHex}
                            fill={[presetHex]}
                            active={
                              selectedPaletteItem.currentHex.toUpperCase() ===
                              presetHex
                            }
                            tooltipLabel={presetHex}
                            onClick={() => {
                              setHexInputText(presetHex);
                              handleUpdateSelectedColor(presetHex);
                            }}
                          />
                        ))}
                      </div>

                      <div className={styles.actionButtonRow}>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() =>
                            handleToggleRemoveColor(selectedColorIndex)
                          }
                        >
                          {selectedPaletteItem.removed
                            ? intl.formatMessage({
                                defaultMessage: "Restore Color",
                                description:
                                  "Button to restore a removed palette color",
                              })
                            : intl.formatMessage({
                                defaultMessage: "Remove Color",
                                description:
                                  "Button to remove the selected palette color from the pattern",
                              })}
                        </Button>
                        {hasRemovedOrEditedColors && (
                          <Button
                            variant="secondary"
                            size="small"
                            onClick={handleRestoreAllColors}
                          >
                            {intl.formatMessage({
                              defaultMessage: "Restore All Colors",
                              description:
                                "Button in edit panel to restore all palette colors",
                            })}
                          </Button>
                        )}
                      </div>
                    </Rows>
                  </div>
                )}
              </Rows>
            )}

            {/* Add Pattern to Canva Button */}
            <Button
              variant="primary"
              stretch
              loading={isAdding}
              disabled={!canAdd || isAdding || patternResult.stitchCount === 0}
              onClick={handleAddPatternToCanva}
            >
              {intl.formatMessage({
                defaultMessage: "Add Pattern to Canva",
                description:
                  "Button to insert generated vector pattern into design",
              })}
            </Button>
          </Rows>
        )}
      </Rows>
    </div>
  );
};
