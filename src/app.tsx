import { useFeatureSupport } from "@canva/app-hooks";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FileInput,
  FormField,
  ImageCard,
  Rows,
  SegmentedControl,
  Select,
  Text,
  TextInput,
  Title,
} from "@canva/app-ui-kit";
import type { ImageRef } from "@canva/asset";
import { upload } from "@canva/asset";
import {
  addElementAtCursor,
  addElementAtPoint,
  addNativeElement,
} from "@canva/design";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import * as styles from "styles/components.css";
import type {
  GridSize,
  PatternResult,
  StitchStyle,
} from "./utils/pattern_generator";
import {
  generatePatternFromCanvas,
  imageToCanvas,
  loadImageFromFile,
  renderTextToCanvas,
} from "./utils/pattern_generator";
import { PRESETS } from "./utils/presets";

type InputSource = "upload" | "text" | "presets";

export const App = () => {
  const intl = useIntl();
  const isSupported = useFeatureSupport();

  // Intent / Canva canvas insertion methods
  const addElement = [addElementAtPoint, addElementAtCursor].find((fn) =>
    isSupported(fn),
  );
  const canAdd = isSupported(addNativeElement) || !!addElement;

  // Form State
  const [inputSource, setInputSource] = useState<InputSource>("upload");
  const [gridSize, setGridSize] = useState<GridSize>(40);
  const [stitchStyle, setStitchStyle] = useState<StitchStyle>("cross_stitch");
  const [ignoreBackground, setIgnoreBackground] = useState<boolean>(true);

  // Source image / text state
  const [activeCanvas, setActiveCanvas] = useState<HTMLCanvasElement | null>(
    null,
  );
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string>("");
  const [customText, setCustomText] = useState<string>("CANVA");

  // Output pattern state
  const [patternResult, setPatternResult] = useState<PatternResult | null>(
    null,
  );
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize with heart preset so users see immediate value
  useEffect(() => {
    const defaultPreset = PRESETS[0];
    if (defaultPreset) {
      const cvs = defaultPreset.createCanvas();
      setActiveCanvas(cvs);
      try {
        const initial = generatePatternFromCanvas(cvs, {
          gridSize: 40,
          stitchStyle: "cross_stitch",
          ignoreBackground: true,
        });
        setPatternResult(initial);
        const blob = new Blob([initial.svgString], {
          type: "image/svg+xml;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        setPreviewObjectUrl(url);
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

    // Offscreen async generation to keep UI responsive
    setTimeout(() => {
      try {
        if (!source) return;
        const result = generatePatternFromCanvas(source, {
          gridSize,
          stitchStyle,
          ignoreBackground,
        });
        setPatternResult(result);
        setStatusMessage(
          intl.formatMessage(
            {
              defaultMessage:
                "Pattern created! {stitches} stitches with {colors} colors.",
              description:
                "Status message indicating successful pattern generation",
            },
            {
              stitches: result.stitchCount,
              colors: result.colorCount,
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
    customText,
    gridSize,
    ignoreBackground,
    inputSource,
    intl,
    stitchStyle,
  ]);

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

      const elementData = assetRef
        ? {
            type: "image" as const,
            ref: assetRef,
            altText: {
              text: `Cross-stitch vector pattern (${stitchStyle}, ${gridSize}x${gridSize})`,
              decorative: false,
            },
          }
        : {
            type: "image" as const,
            dataUrl,
            altText: {
              text: `Cross-stitch vector pattern (${stitchStyle}, ${gridSize}x${gridSize})`,
              decorative: false,
            },
          };

      // Insert onto design canvas via addNativeElement or addElement fallback
      try {
        await addNativeElement(elementData);
      } catch {
        if (addElement) {
          await addElement(elementData);
        } else {
          throw new Error("Unable to insert element onto Canva canvas.");
        }
      }

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

        {/* Pattern Preview Section */}
        {patternResult && previewObjectUrl && (
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
                thumbnailUrl={previewObjectUrl}
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

            {/* Thread Palette swatches */}
            {patternResult.palette.length > 0 && (
              <Box>
                <Text size="xsmall" tone="tertiary">
                  <FormattedMessage
                    defaultMessage="Thread Palette:"
                    description="Thread colors list label"
                  />
                </Text>
                <div className={styles.paletteContainer}>
                  {patternResult.palette.slice(0, 16).map((hex) => (
                    <div
                      key={hex}
                      className={styles.paletteChip}
                      style={{ backgroundColor: hex }}
                      title={hex}
                    />
                  ))}
                </div>
              </Box>
            )}

            {/* Add Pattern to Canva Button */}
            <Button
              variant="primary"
              stretch
              loading={isAdding}
              disabled={!canAdd || isAdding}
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
