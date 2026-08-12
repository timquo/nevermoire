#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { VERSION } from './version.mjs';
import {
  DEFAULT_OPTIONS,
  buildReport,
  maskToBuffer,
  planesToRgbBuffer,
  processImagePlanes,
  rgbBufferToPlanes,
  validateOptions,
} from './core.mjs';

const DEFAULT_MAX_INPUT_PIXELS = 8_000_000;
const ABSOLUTE_MAX_INPUT_PIXELS = 30_000_000;
const OUTPUT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const INPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'tiff']);

const HELP = `Nevermoire ${VERSION}

Local classical moire detector and suppressor. No neural networks or network access.

Usage:
  nevermoire <input> [options]

Options:
  -o, --output <file>       Output image (default: <input>.nevermoire.<ext>)
  --mode <name>             auto, screen, fabric, or chroma-only (default: auto)
  --strength <0..1>         Suppression strength (default: 0.75)
  --tile <pixels>           FFT tile size, power of two (default: 128)
  --step <pixels>           Tile step (default: 96)
  --threshold <number>      Spectral z-score threshold (default: 4.6)
  --min-frequency <0..0.5> Lowest analysed cycles/pixel (default: 0.035)
  --max-frequency <0..0.5> Highest analysed cycles/pixel (default: 0.46)
  --max-peaks <number>      Maximum frequency pairs per tile (default: 3)
  --notch-width <number>    Gaussian notch width in FFT bins (default: 1.35)
  --chroma-smooth <pixels>  Guided chroma smoothing radius (default: off)
  --smooth-strength <0..1>  Guided smoothing strength (default: 0.85)
  --luma                    Allow conservative luminance correction
  --luma-strength <0..1>    Luminance-notch attenuation (default: 0.38)
  --chroma-only             Never modify luminance
  --mask <file>             Save the confidence mask as PNG
  --report <file>           Save detections as JSON
  --diagnostics <dir>       Save mask.png and report.json into a directory
  --quality <1..100>        JPEG/WebP output quality (default: 95)
  --max-input-pixels <n>    Decoded pixel limit (default: 8000000, max: 30000000)
  --dry-run                 Detect and report without changing the image
  -h, --help                Show this help
  -v, --version             Show the version

Examples:
  nevermoire photo.jpg -o cleaned.jpg
  nevermoire screen.jpg -o cleaned.png --mode screen --mask mask.png
  nevermoire fabric.png --mode fabric --strength 0.55 --diagnostics diagnostics
`;

function takeValue(args, index, option) {
  if (index + 1 >= args.length) throw new Error(`${option} expects a value`);
  return args[index + 1];
}

function numberValue(raw, option) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${option} expects a number`);
  return parsed;
}

export function parseArgs(args) {
  const parsed = {
    input: null,
    output: null,
    mode: 'auto',
    mask: null,
    report: null,
    diagnostics: null,
    quality: 95,
    maxInputPixels: DEFAULT_MAX_INPUT_PIXELS,
    dryRun: false,
    help: false,
    version: false,
    luminanceOverride: null,
    options: { ...DEFAULT_OPTIONS },
  };

  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === '-h' || argument === '--help') parsed.help = true;
    else if (argument === '-v' || argument === '--version') parsed.version = true;
    else if (argument === '-o' || argument === '--output') parsed.output = takeValue(args, i++, argument);
    else if (argument === '--mode') parsed.mode = takeValue(args, i++, argument);
    else if (argument === '--strength') parsed.options.strength = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--tile') parsed.options.tileSize = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--step') parsed.options.step = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--threshold') parsed.options.zThreshold = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--min-frequency') parsed.options.minFrequency = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--max-frequency') parsed.options.maxFrequency = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--max-peaks') parsed.options.maxPeaks = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--notch-width') parsed.options.notchWidth = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--chroma-smooth') parsed.options.chromaSmoothRadius = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--smooth-strength') parsed.options.chromaSmoothStrength = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--luma-strength') parsed.options.luminanceAttenuation = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--quality') parsed.quality = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--max-input-pixels') parsed.maxInputPixels = numberValue(takeValue(args, i++, argument), argument);
    else if (argument === '--mask') parsed.mask = takeValue(args, i++, argument);
    else if (argument === '--report') parsed.report = takeValue(args, i++, argument);
    else if (argument === '--diagnostics') parsed.diagnostics = takeValue(args, i++, argument);
    else if (argument === '--luma') parsed.luminanceOverride = true;
    else if (argument === '--chroma-only') parsed.luminanceOverride = false;
    else if (argument === '--dry-run') parsed.dryRun = true;
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else if (parsed.input === null) parsed.input = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }

  const modes = new Set(['auto', 'screen', 'fabric', 'chroma-only']);
  if (!modes.has(parsed.mode)) throw new Error(`Unknown mode: ${parsed.mode}`);
  if (parsed.mode === 'screen') {
    parsed.options.processLuminance = true;
    parsed.options.zThreshold = Math.min(parsed.options.zThreshold, 4.4);
  } else if (parsed.mode === 'fabric') {
    parsed.options.zThreshold = Math.max(parsed.options.zThreshold, 5.1);
    parsed.options.chromaAttenuation = 0.68;
    parsed.options.luminanceAttenuation = 0.28;
    parsed.options.textureProtection = true;
  } else if (parsed.mode === 'chroma-only') {
    parsed.options.processLuminance = false;
  }

  if (parsed.mode === 'chroma-only' || parsed.luminanceOverride === false) {
    parsed.options.processLuminance = false;
  } else if (parsed.luminanceOverride === true) {
    parsed.options.processLuminance = true;
  }
  delete parsed.luminanceOverride;

  if (!(parsed.quality >= 1 && parsed.quality <= 100)) throw new Error('--quality must be between 1 and 100');
  if (!Number.isSafeInteger(parsed.maxInputPixels)
    || parsed.maxInputPixels < 1
    || parsed.maxInputPixels > ABSOLUTE_MAX_INPUT_PIXELS) {
    throw new Error('--max-input-pixels must be an integer between 1 and 30000000');
  }
  validateOptions(parsed.options);
  return parsed;
}

function defaultOutputPath(input) {
  const extension = path.extname(input);
  const stem = extension ? input.slice(0, -extension.length) : input;
  return `${stem}.nevermoire${extension || '.png'}`;
}

function normalizedPath(filename) {
  const resolved = path.resolve(filename);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function pathsReferToSameFile(first, second) {
  if (normalizedPath(first) === normalizedPath(second)) return true;
  try {
    const [firstStat, secondStat] = await Promise.all([fs.stat(first), fs.stat(second)]);
    return firstStat.dev === secondStat.dev && firstStat.ino === secondStat.ino;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function validateWriteTargets(input, targets) {
  const present = targets.filter((target) => target?.filename);
  for (const target of present) {
    if (await pathsReferToSameFile(input, target.filename)) {
      throw new Error(`refusing to overwrite the input image through ${target.option}`);
    }
  }
  for (let first = 0; first < present.length; first += 1) {
    for (let second = first + 1; second < present.length; second += 1) {
      if (await pathsReferToSameFile(present[first].filename, present[second].filename)) {
        throw new Error(`${present[first].option} and ${present[second].option} must use different files`);
      }
    }
  }
}

async function detectInputSignature(filename) {
  const handle = await fs.open(filename, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'jpeg';
    if (bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (bytesRead >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    if (bytesRead >= 4) {
      const signature = header.toString('hex', 0, 4);
      if (['49492a00', '4d4d002a', '49492b00', '4d4d002b'].includes(signature)) return 'tiff';
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function ensureParent(filename) {
  await fs.mkdir(path.dirname(path.resolve(filename)), { recursive: true });
}

async function writeRgb(filename, buffer, width, height, quality) {
  await ensureParent(filename);
  const extension = path.extname(filename).toLowerCase();
  if (!OUTPUT_EXTENSIONS.has(extension)) {
    throw new Error(`unsupported output format: ${extension || '(no extension)'}`);
  }
  let pipeline = sharp(buffer, { raw: { width, height, channels: 3 } });
  if (extension === '.jpg' || extension === '.jpeg') pipeline = pipeline.jpeg({ quality, chromaSubsampling: '4:4:4' });
  else if (extension === '.webp') pipeline = pipeline.webp({ quality });
  else if (extension === '.tif' || extension === '.tiff') pipeline = pipeline.tiff({ compression: 'lzw' });
  else pipeline = pipeline.png({ compressionLevel: 9 });
  // Intentionally omit EXIF/XMP/IPTC metadata so output files do not inherit
  // GPS coordinates, device identifiers, comments, or other private fields.
  await pipeline.toFile(filename);
}

async function writeMask(filename, mask, width, height) {
  await ensureParent(filename);
  await sharp(maskToBuffer(mask), { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(filename);
}

async function run() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`nevermoire: ${error.message}`);
    console.error('Run nevermoire --help for usage.');
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.version) {
    console.log(VERSION);
    return;
  }
  if (!args.input) {
    console.error('nevermoire: an input image is required');
    console.error('Run nevermoire --help for usage.');
    process.exitCode = 2;
    return;
  }

  const output = args.output ?? defaultOutputPath(args.input);
  try {
    let maskPath = args.mask;
    let reportPath = args.report;
    if (args.diagnostics) {
      maskPath ??= path.join(args.diagnostics, 'mask.png');
      reportPath ??= path.join(args.diagnostics, 'report.json');
    }
    await validateWriteTargets(args.input, [
      { option: '--output', filename: args.dryRun ? null : output },
      { option: '--mask', filename: maskPath },
      { option: '--report', filename: reportPath },
    ]);

    console.error(`[Nevermoire] Loading ${args.input}`);
    const signatureFormat = await detectInputSignature(args.input);
    if (!signatureFormat) {
      throw new Error('unsupported input signature; expected JPEG, PNG, WebP, or TIFF');
    }
    const source = sharp(args.input, { failOn: 'error', limitInputPixels: args.maxInputPixels });
    const sourceMetadata = await source.metadata();
    if (!INPUT_FORMATS.has(sourceMetadata.format) || sourceMetadata.format !== signatureFormat) {
      throw new Error(`unsupported input format: ${sourceMetadata.format ?? 'unknown'}`);
    }
    if ((sourceMetadata.pages ?? 1) !== 1) {
      throw new Error('multi-page or animated images are not supported');
    }
    const decoded = await source
      .rotate()
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = decoded.info;
    if (channels !== 3) throw new Error(`decoded image has ${channels} channels instead of RGB`);

    console.error(`[Nevermoire] Analysing ${width}x${height} pixels`);
    const originalPlanes = rgbBufferToPlanes(decoded.data, width, height);
    const result = processImagePlanes(originalPlanes, width, height, args.options);
    const report = buildReport(result.detection, width, height);
    report.mode = args.mode;
    report.options = args.options;

    if (!args.dryRun) {
      console.error(`[Nevermoire] Writing ${output}`);
      await writeRgb(output, planesToRgbBuffer(result.planes, width, height), width, height, args.quality);
    }

    if (args.diagnostics) {
      await fs.mkdir(args.diagnostics, { recursive: true });
    }
    if (maskPath) await writeMask(maskPath, result.mask, width, height);
    if (reportPath) {
      await ensureParent(reportPath);
      await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }

    const { summary } = report;
    console.error(
      `[Nevermoire] Done: ${summary.activeTiles}/${summary.tiles} tiles flagged, `
      + `maximum confidence ${(100 * summary.maxConfidence).toFixed(1)}%`,
    );
  } catch (error) {
    console.error(`nevermoire: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
