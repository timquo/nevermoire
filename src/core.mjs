import { fft2d, signedFrequency } from './fft.mjs';
import { VERSION } from './version.mjs';

const MAX_ANALYSIS_TILES = 25_000;

export const DEFAULT_OPTIONS = Object.freeze({
  tileSize: 128,
  step: 96,
  strength: 0.75,
  zThreshold: 4.6,
  zFullConfidence: 10.0,
  minFrequency: 0.035,
  maxFrequency: 0.46,
  maxPeaks: 3,
  minimumEnergyRatio: 0.000005,
  notchWidth: 1.35,
  chromaAttenuation: 0.85,
  luminanceAttenuation: 0.38,
  processLuminance: false,
  textureProtection: false,
  textureProtectionStrength: 0.92,
  chromaSmoothRadius: 0,
  chromaSmoothStrength: 0.85,
  guidedEpsilon: 0.001,
  minimumConfidence: 0.12,
  coherenceToleranceBins: 2.5,
});

const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

export function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(value) {
  const safe = clamp(value);
  return safe <= 0.0031308 ? 12.92 * safe : 1.055 * safe ** (1 / 2.4) - 0.055;
}

export function rgbBufferToPlanes(data, width, height) {
  if (data.length !== width * height * 3) throw new Error('Expected an RGB buffer');
  const length = width * height;
  const y = new Float32Array(length);
  const cb = new Float32Array(length);
  const cr = new Float32Array(length);

  for (let i = 0, pixel = 0; pixel < length; pixel += 1, i += 3) {
    const red = srgbToLinear(data[i] / 255);
    const green = srgbToLinear(data[i + 1] / 255);
    const blue = srgbToLinear(data[i + 2] / 255);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    y[pixel] = luminance;
    cb[pixel] = (blue - luminance) / 1.8556;
    cr[pixel] = (red - luminance) / 1.5748;
  }
  return { y, cb, cr };
}

export function planesToRgbBuffer({ y, cb, cr }, width, height) {
  const length = width * height;
  const output = Buffer.allocUnsafe(length * 3);
  for (let pixel = 0, i = 0; pixel < length; pixel += 1, i += 3) {
    const red = y[pixel] + 1.5748 * cr[pixel];
    const blue = y[pixel] + 1.8556 * cb[pixel];
    const green = (y[pixel] - 0.2126 * red - 0.0722 * blue) / 0.7152;
    output[i] = Math.round(255 * linearToSrgb(red));
    output[i + 1] = Math.round(255 * linearToSrgb(green));
    output[i + 2] = Math.round(255 * linearToSrgb(blue));
  }
  return output;
}

export function validateOptions(options) {
  if (!Number.isSafeInteger(options.tileSize)
    || options.tileSize < 32
    || options.tileSize > 1024
    || (options.tileSize & (options.tileSize - 1)) !== 0) {
    throw new Error('--tile must be a power of two between 32 and 1024');
  }
  if (!Number.isSafeInteger(options.step) || options.step < 1 || options.step > options.tileSize) {
    throw new Error('--step must be an integer between 1 and --tile');
  }
  if (!(options.strength >= 0 && options.strength <= 1)) {
    throw new Error('--strength must be between 0 and 1');
  }
  if (!(options.luminanceAttenuation >= 0 && options.luminanceAttenuation <= 1)) {
    throw new Error('--luma-strength must be between 0 and 1');
  }
  if (!Number.isSafeInteger(options.maxPeaks) || options.maxPeaks < 1 || options.maxPeaks > 16) {
    throw new Error('--max-peaks must be an integer between 1 and 16');
  }
  if (!(options.notchWidth > 0 && options.notchWidth <= 32)) {
    throw new Error('--notch-width must be greater than 0 and at most 32');
  }
  if (!(options.zThreshold > 0 && options.zThreshold <= 100)) {
    throw new Error('--threshold must be greater than 0 and at most 100');
  }
  if (!(options.minFrequency > 0 && options.minFrequency < 0.5)) {
    throw new Error('--min-frequency must be greater than 0 and less than 0.5');
  }
  if (!(options.maxFrequency > 0 && options.maxFrequency <= 0.5)) {
    throw new Error('--max-frequency must be greater than 0 and at most 0.5');
  }
  if (options.minFrequency >= options.maxFrequency) {
    throw new Error('--min-frequency must be less than --max-frequency');
  }
  if (!Number.isSafeInteger(options.chromaSmoothRadius)
    || options.chromaSmoothRadius < 0
    || options.chromaSmoothRadius > 256) {
    throw new Error('--chroma-smooth must be an integer between 0 and 256');
  }
  if (!(options.chromaSmoothStrength >= 0 && options.chromaSmoothStrength <= 1)) {
    throw new Error('--smooth-strength must be between 0 and 1');
  }
}

function makeWindow(size) {
  const oneDimensional = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    // A half-sample shift leaves non-zero weights on the outer image boundary.
    oneDimensional[i] = Math.sin(Math.PI * (i + 0.5) / size);
  }
  const twoDimensional = new Float64Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      twoDimensional[y * size + x] = oneDimensional[x] * oneDimensional[y];
    }
  }
  return twoDimensional;
}

function tileOrigins(length, tileSize, step) {
  if (length <= tileSize) return [0];
  const origins = [];
  for (let origin = 0; origin <= length - tileSize; origin += step) origins.push(origin);
  const last = length - tileSize;
  if (origins.at(-1) !== last) origins.push(last);
  return origins;
}

function reflectIndex(index, length) {
  if (length <= 1) return 0;
  const period = 2 * length - 2;
  const wrapped = ((index % period) + period) % period;
  return wrapped < length ? wrapped : period - wrapped;
}

function fillPackedChroma(planes, width, height, originX, originY, size, window) {
  const real = new Float64Array(size * size);
  const imag = new Float64Array(size * size);
  let meanCb = 0;
  let meanCr = 0;
  let meanSquare = 0;

  for (let y = 0; y < size; y += 1) {
    const sourceY = reflectIndex(originY + y, height);
    for (let x = 0; x < size; x += 1) {
      const sourceX = reflectIndex(originX + x, width);
      const source = sourceY * width + sourceX;
      meanCb += planes.cb[source];
      meanCr += planes.cr[source];
      meanSquare += planes.cb[source] ** 2 + planes.cr[source] ** 2;
    }
  }

  const count = size * size;
  meanCb /= count;
  meanCr /= count;
  const variance = Math.max(0, meanSquare / count - meanCb ** 2 - meanCr ** 2);
  for (let y = 0; y < size; y += 1) {
    const sourceY = reflectIndex(originY + y, height);
    for (let x = 0; x < size; x += 1) {
      const sourceX = reflectIndex(originX + x, width);
      const source = sourceY * width + sourceX;
      const target = y * size + x;
      real[target] = (planes.cb[source] - meanCb) * window[target];
      imag[target] = (planes.cr[source] - meanCr) * window[target];
    }
  }
  return { real, imag, meanReal: meanCb, meanImag: meanCr, variance };
}

function fillLuminance(planes, width, height, originX, originY, size, window) {
  const real = new Float64Array(size * size);
  const imag = new Float64Array(size * size);
  let mean = 0;
  let meanSquare = 0;
  for (let y = 0; y < size; y += 1) {
    const sourceY = reflectIndex(originY + y, height);
    for (let x = 0; x < size; x += 1) {
      const sourceX = reflectIndex(originX + x, width);
      const value = planes.y[sourceY * width + sourceX];
      mean += value;
      meanSquare += value * value;
    }
  }
  const count = size * size;
  mean /= count;
  const variance = Math.max(0, meanSquare / count - mean * mean);
  for (let y = 0; y < size; y += 1) {
    const sourceY = reflectIndex(originY + y, height);
    for (let x = 0; x < size; x += 1) {
      const sourceX = reflectIndex(originX + x, width);
      const target = y * size + x;
      real[target] = (planes.y[sourceY * width + sourceX] - mean) * window[target];
    }
  }
  return { real, imag, meanReal: mean, meanImag: 0, variance };
}

function packedChromaPower(real, imag, size) {
  const power = new Float64Array(size * size);
  let total = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const oppositeX = (size - x) % size;
      const oppositeY = (size - y) % size;
      const opposite = oppositeY * size + oppositeX;

      const aReal = 0.5 * (real[index] + real[opposite]);
      const aImag = 0.5 * (imag[index] - imag[opposite]);
      const bReal = 0.5 * (imag[index] + imag[opposite]);
      const bImag = 0.5 * (real[opposite] - real[index]);
      const value = aReal ** 2 + aImag ** 2 + bReal ** 2 + bImag ** 2;
      power[index] = value;
      total += value;
    }
  }
  return { power, total };
}

function ordinaryPower(real, imag) {
  const power = new Float64Array(real.length);
  let total = 0;
  for (let i = 0; i < real.length; i += 1) {
    const value = real[i] ** 2 + imag[i] ** 2;
    power[i] = value;
    total += value;
  }
  return { power, total };
}

function findPeaks(power, totalPower, size, options, channel) {
  const maxRadius = Math.ceil(size * Math.SQRT1_2);
  const ringValues = Array.from({ length: maxRadius + 1 }, () => []);
  const ringMean = new Float64Array(maxRadius + 1);
  const ringDeviation = new Float64Array(maxRadius + 1);
  const logPower = new Float64Array(power.length);

  for (let y = 0; y < size; y += 1) {
    const fy = signedFrequency(y, size);
    for (let x = 0; x < size; x += 1) {
      const fx = signedFrequency(x, size);
      const index = y * size + x;
      const radius = Math.min(maxRadius, Math.round(Math.hypot(fx, fy)));
      const value = Math.log1p(power[index]);
      logPower[index] = value;
      ringValues[radius].push(value);
    }
  }

  // The moire peaks themselves must not inflate the estimated radial background.
  // A lower 85% trimmed estimate is both compact and considerably more robust
  // than ordinary mean/std for sparse periodic spectra.
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    const values = ringValues[radius];
    if (values.length === 0) continue;
    values.sort((a, b) => a - b);
    const retained = Math.max(1, Math.floor(values.length * 0.85));
    let sum = 0;
    let squareSum = 0;
    for (let i = 0; i < retained; i += 1) {
      sum += values[i];
      squareSum += values[i] ** 2;
    }
    const mean = sum / retained;
    ringMean[radius] = mean;
    // The floor prevents floating-point dust from receiving absurd z-scores.
    ringDeviation[radius] = Math.max(0.2, Math.sqrt(Math.max(0, squareSum / retained - mean ** 2)));
  }

  const candidates = [];
  const minimumRadius = options.minFrequency * size;
  const maximumRadius = options.maxFrequency * size;
  for (let y = 0; y < size; y += 1) {
    const fy = signedFrequency(y, size);
    for (let x = 0; x < size; x += 1) {
      const fx = signedFrequency(x, size);
      if (fy < 0 || (fy === 0 && fx <= 0)) continue;
      const radiusFloat = Math.hypot(fx, fy);
      if (radiusFloat < minimumRadius || radiusFloat > maximumRadius) continue;
      const radius = Math.round(radiusFloat);
      if (ringValues[radius].length < 4) continue;
      const index = y * size + x;
      const value = logPower[index];

      let localMaximum = true;
      for (let dy = -1; dy <= 1 && localMaximum; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighborX = (x + dx + size) % size;
          const neighborY = (y + dy + size) % size;
          if (logPower[neighborY * size + neighborX] > value) {
            localMaximum = false;
            break;
          }
        }
      }
      if (!localMaximum) continue;

      const zScore = (value - ringMean[radius]) / ringDeviation[radius];
      if (zScore < options.zThreshold) continue;

      const oppositeX = (size - x) % size;
      const oppositeY = (size - y) % size;
      const pairEnergy = power[index] + power[oppositeY * size + oppositeX];
      const energyRatio = pairEnergy / Math.max(totalPower, 1e-20);
      if (energyRatio < options.minimumEnergyRatio) continue;
      const zConfidence = clamp(
        (zScore - options.zThreshold) / (options.zFullConfidence - options.zThreshold),
      );
      const energyConfidence = clamp(
        Math.log10(energyRatio / options.minimumEnergyRatio)
          / Math.log10(0.02 / options.minimumEnergyRatio),
      );
      const confidence = clamp(0.48 * zConfidence + 0.52 * energyConfidence);
      candidates.push({
        binX: fx,
        binY: fy,
        fx: fx / size,
        fy: fy / size,
        zScore,
        energyRatio,
        confidence,
        priority: confidence + 0.08 * Math.log10(1 + energyRatio / options.minimumEnergyRatio),
        channel,
      });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority || b.energyRatio - a.energyRatio);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((peak) => Math.hypot(peak.binX - candidate.binX, peak.binY - candidate.binY) < 3)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= options.maxPeaks) break;
  }
  return selected;
}

function analyzeTile(planes, width, height, tile, size, window, options) {
  const chroma = fillPackedChroma(planes, width, height, tile.x, tile.y, size, window);
  let chromaPeaks = [];
  if (chroma.variance > 1e-8) {
    fft2d(chroma.real, chroma.imag, size);
    const spectrum = packedChromaPower(chroma.real, chroma.imag, size);
    chromaPeaks = findPeaks(spectrum.power, spectrum.total, size, options, 'chroma');
  }

  let luminancePeaks = [];
  if (options.processLuminance || options.textureProtection) {
    const luminance = fillLuminance(planes, width, height, tile.x, tile.y, size, window);
    if (luminance.variance > 1e-8) {
      fft2d(luminance.real, luminance.imag, size);
      const spectrum = ordinaryPower(luminance.real, luminance.imag);
      const luminanceOptions = {
        ...options,
        zThreshold: options.zThreshold + 1.25,
        maxPeaks: options.textureProtection ? Math.max(options.maxPeaks * 2, 6) : options.maxPeaks,
      };
      luminancePeaks = findPeaks(spectrum.power, spectrum.total, size, luminanceOptions, 'luminance');
    }
  }

  if (options.textureProtection && luminancePeaks.length > 0) {
    for (const chromaPeak of chromaPeaks) {
      let closest = Number.POSITIVE_INFINITY;
      for (const luminancePeak of luminancePeaks) {
        closest = Math.min(
          closest,
          Math.hypot(chromaPeak.binX - luminancePeak.binX, chromaPeak.binY - luminancePeak.binY),
          Math.hypot(chromaPeak.binX + luminancePeak.binX, chromaPeak.binY + luminancePeak.binY),
        );
      }
      chromaPeak.luminanceDistanceBins = closest;
      if (closest <= options.coherenceToleranceBins) {
        chromaPeak.textureProtected = true;
        chromaPeak.confidence *= 1 - options.textureProtectionStrength;
      }
    }
  }
  return { ...tile, chromaPeaks, luminancePeaks, confidence: 0 };
}

function applyNeighbourCoherence(tiles, columns, rows, options) {
  const groups = ['chromaPeaks', 'luminancePeaks'];
  for (let gridY = 0; gridY < rows; gridY += 1) {
    for (let gridX = 0; gridX < columns; gridX += 1) {
      const tile = tiles[gridY * columns + gridX];
      for (const group of groups) {
        for (const peak of tile[group]) {
          let neighbours = 0;
          let matches = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) continue;
              const nx = gridX + dx;
              const ny = gridY + dy;
              if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
              neighbours += 1;
              const neighbour = tiles[ny * columns + nx];
              if (neighbour[group].some((other) =>
                Math.hypot(other.binX - peak.binX, other.binY - peak.binY)
                  <= options.coherenceToleranceBins)) {
                matches += 1;
              }
            }
          }
          const support = neighbours === 0 ? 0 : matches / neighbours;
          peak.neighbourSupport = support;
          peak.confidence = clamp(peak.confidence * (0.72 + 0.56 * support));
        }
      }
      const effectiveLuminancePeaks = options.processLuminance ? tile.luminancePeaks : [];
      tile.confidence = Math.max(
        0,
        ...tile.chromaPeaks.map((peak) => peak.confidence),
        ...effectiveLuminancePeaks.map((peak) => peak.confidence),
      );
    }
  }
}

export function detectMoire(planes, width, height, userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  validateOptions(options);
  const window = makeWindow(options.tileSize);
  const originsX = tileOrigins(width, options.tileSize, options.step);
  const originsY = tileOrigins(height, options.tileSize, options.step);
  if (originsX.length * originsY.length > MAX_ANALYSIS_TILES) {
    throw new Error(
      `analysis would require more than ${MAX_ANALYSIS_TILES.toLocaleString('en-US')} tiles; `
      + 'increase --step or --tile',
    );
  }
  const tiles = [];
  for (let gridY = 0; gridY < originsY.length; gridY += 1) {
    for (let gridX = 0; gridX < originsX.length; gridX += 1) {
      tiles.push(analyzeTile(
        planes,
        width,
        height,
        { x: originsX[gridX], y: originsY[gridY], gridX, gridY },
        options.tileSize,
        window,
        options,
      ));
    }
  }
  applyNeighbourCoherence(tiles, originsX.length, originsY.length, options);
  return { tiles, columns: originsX.length, rows: originsY.length, window, options };
}

function applyNotches(real, imag, size, peaks, attenuation, width) {
  if (peaks.length === 0 || attenuation <= 0) return;
  const denominator = 2 * width * width;
  for (let y = 0; y < size; y += 1) {
    const fy = signedFrequency(y, size);
    for (let x = 0; x < size; x += 1) {
      const fx = signedFrequency(x, size);
      let response = 1;
      for (const peak of peaks) {
        const positiveDistance = (fx - peak.binX) ** 2 + (fy - peak.binY) ** 2;
        const negativeDistance = (fx + peak.binX) ** 2 + (fy + peak.binY) ** 2;
        const notch = Math.exp(-Math.min(positiveDistance, negativeDistance) / denominator);
        response *= 1 - attenuation * notch;
      }
      const index = y * size + x;
      real[index] *= response;
      imag[index] *= response;
    }
  }
}

function accumulateOriginal(accumulator, normalization, plane, width, height, tile, size, window) {
  for (let y = 0; y < size && tile.y + y < height; y += 1) {
    for (let x = 0; x < size && tile.x + x < width; x += 1) {
      const local = y * size + x;
      const target = (tile.y + y) * width + tile.x + x;
      const weight = window[local] ** 2;
      accumulator[target] += plane[target] * weight;
      normalization[target] += weight;
    }
  }
}

function accumulateFiltered(
  accumulator,
  normalization,
  maskAccumulator,
  transformed,
  width,
  height,
  tile,
  size,
  window,
  component,
  confidence,
) {
  for (let y = 0; y < size && tile.y + y < height; y += 1) {
    for (let x = 0; x < size && tile.x + x < width; x += 1) {
      const local = y * size + x;
      const target = (tile.y + y) * width + tile.x + x;
      const analysisWeight = window[local];
      const weight = analysisWeight ** 2;
      const value = component === 'real'
        ? transformed.real[local] + transformed.meanReal * analysisWeight
        : transformed.imag[local] + transformed.meanImag * analysisWeight;
      accumulator[target] += value * analysisWeight;
      normalization[target] += weight;
      maskAccumulator[target] += confidence * weight;
    }
  }
}

function gradientProtection(luminance, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  const left = luminance[y * width + Math.max(0, x - 1)];
  const right = luminance[y * width + Math.min(width - 1, x + 1)];
  const top = luminance[Math.max(0, y - 1) * width + x];
  const bottom = luminance[Math.min(height - 1, y + 1) * width + x];
  const gradient = 0.5 * Math.hypot(right - left, bottom - top);
  return 0.68 + 0.32 / (1 + 24 * gradient);
}

function chromaActivityGate(planes, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  const left = y * width + Math.max(0, x - 1);
  const right = y * width + Math.min(width - 1, x + 1);
  const top = Math.max(0, y - 1) * width + x;
  const bottom = Math.min(height - 1, y + 1) * width + x;
  const activity = 0.5 * Math.hypot(
    planes.cb[right] - planes.cb[left],
    planes.cb[bottom] - planes.cb[top],
    planes.cr[right] - planes.cr[left],
    planes.cr[bottom] - planes.cr[top],
  );
  return clamp((activity - 0.00025) / 0.004);
}

function luminanceActivityGate(luminance, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  const left = luminance[y * width + Math.max(0, x - 1)];
  const right = luminance[y * width + Math.min(width - 1, x + 1)];
  const top = luminance[Math.max(0, y - 1) * width + x];
  const bottom = luminance[Math.min(height - 1, y + 1) * width + x];
  const activity = 0.5 * Math.hypot(right - left, bottom - top);
  return clamp((activity - 0.0004) / 0.006);
}

function boxMean(input, width, height, radius) {
  const integralWidth = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const integralRow = (y + 1) * integralWidth;
    const previousRow = y * integralWidth;
    for (let x = 0; x < width; x += 1) {
      rowSum += input[y * width + x];
      integral[integralRow + x + 1] = integral[previousRow + x + 1] + rowSum;
    }
  }

  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const sum = integral[(bottom + 1) * integralWidth + right + 1]
        - integral[top * integralWidth + right + 1]
        - integral[(bottom + 1) * integralWidth + left]
        + integral[top * integralWidth + left];
      output[y * width + x] = sum / ((right - left + 1) * (bottom - top + 1));
    }
  }
  return output;
}

/** Edge-preserving guided filter (He et al.) using luminance as the guide. */
export function guidedFilter(guide, input, width, height, radius, epsilon = 0.001) {
  if (radius < 1) return Float32Array.from(input);
  const length = width * height;
  const guideSquare = new Float32Array(length);
  const guideInput = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    guideSquare[i] = guide[i] * guide[i];
    guideInput[i] = guide[i] * input[i];
  }

  const meanGuide = boxMean(guide, width, height, radius);
  const meanInput = boxMean(input, width, height, radius);
  const correlationGuide = boxMean(guideSquare, width, height, radius);
  const correlationGuideInput = boxMean(guideInput, width, height, radius);
  const a = new Float32Array(length);
  const b = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const varianceGuide = Math.max(0, correlationGuide[i] - meanGuide[i] ** 2);
    const covariance = correlationGuideInput[i] - meanGuide[i] * meanInput[i];
    a[i] = covariance / (varianceGuide + epsilon);
    b[i] = meanInput[i] - a[i] * meanGuide[i];
  }
  const meanA = boxMean(a, width, height, radius);
  const meanB = boxMean(b, width, height, radius);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) output[i] = meanA[i] * guide[i] + meanB[i];
  return output;
}

export function restoreMoire(planes, width, height, detection, userOptions = {}) {
  const options = { ...detection.options, ...userOptions };
  validateOptions(options);
  const length = width * height;
  const cbAccumulator = new Float64Array(length);
  const crAccumulator = new Float64Array(length);
  const chromaNormalization = new Float64Array(length);
  const chromaMaskAccumulator = new Float64Array(length);
  const yAccumulator = new Float64Array(length);
  const yNormalization = new Float64Array(length);
  const yMaskAccumulator = new Float64Array(length);
  const size = options.tileSize;
  const window = detection.window;

  for (const tile of detection.tiles) {
    const chromaPeaks = tile.chromaPeaks.filter((peak) => peak.confidence >= options.minimumConfidence);
    if (chromaPeaks.length === 0) {
      accumulateOriginal(cbAccumulator, chromaNormalization, planes.cb, width, height, tile, size, window);
      // Share the same normalization: Cr receives the same weights, but must not add them twice.
      for (let y = 0; y < size && tile.y + y < height; y += 1) {
        for (let x = 0; x < size && tile.x + x < width; x += 1) {
          const local = y * size + x;
          const target = (tile.y + y) * width + tile.x + x;
          crAccumulator[target] += planes.cr[target] * window[local] ** 2;
        }
      }
    } else {
      const packed = fillPackedChroma(planes, width, height, tile.x, tile.y, size, window);
      fft2d(packed.real, packed.imag, size);
      applyNotches(
        packed.real,
        packed.imag,
        size,
        chromaPeaks,
        options.strength * options.chromaAttenuation,
        options.notchWidth,
      );
      fft2d(packed.real, packed.imag, size, true);
      const confidence = Math.max(...chromaPeaks.map((peak) => peak.confidence));
      accumulateFiltered(
        cbAccumulator,
        chromaNormalization,
        chromaMaskAccumulator,
        packed,
        width,
        height,
        tile,
        size,
        window,
        'real',
        confidence,
      );
      for (let y = 0; y < size && tile.y + y < height; y += 1) {
        for (let x = 0; x < size && tile.x + x < width; x += 1) {
          const local = y * size + x;
          const target = (tile.y + y) * width + tile.x + x;
          const analysisWeight = window[local];
          const value = packed.imag[local] + packed.meanImag * analysisWeight;
          crAccumulator[target] += value * analysisWeight;
        }
      }
    }

    const luminancePeaks = options.processLuminance
      ? tile.luminancePeaks.filter((peak) => peak.confidence >= options.minimumConfidence)
      : [];
    if (luminancePeaks.length === 0) {
      accumulateOriginal(yAccumulator, yNormalization, planes.y, width, height, tile, size, window);
    } else {
      const luminance = fillLuminance(planes, width, height, tile.x, tile.y, size, window);
      fft2d(luminance.real, luminance.imag, size);
      applyNotches(
        luminance.real,
        luminance.imag,
        size,
        luminancePeaks,
        options.strength * options.luminanceAttenuation,
        options.notchWidth,
      );
      fft2d(luminance.real, luminance.imag, size, true);
      const confidence = Math.max(...luminancePeaks.map((peak) => peak.confidence));
      accumulateFiltered(
        yAccumulator,
        yNormalization,
        yMaskAccumulator,
        luminance,
        width,
        height,
        tile,
        size,
        window,
        'real',
        confidence,
      );
    }
  }

  const restored = {
    y: new Float32Array(length),
    cb: new Float32Array(length),
    cr: new Float32Array(length),
  };
  const mask = new Float32Array(length);
  const luminanceMask = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const chromaNorm = Math.max(chromaNormalization[i], 1e-12);
    const yNorm = Math.max(yNormalization[i], 1e-12);
    const filteredCb = cbAccumulator[i] / chromaNorm;
    const filteredCr = crAccumulator[i] / chromaNorm;
    const filteredY = yAccumulator[i] / yNorm;
    const chromaConfidence = clamp(chromaMaskAccumulator[i] / chromaNorm);
    const yConfidence = clamp(yMaskAccumulator[i] / yNorm);
    const protection = gradientProtection(planes.y, width, height, i);
    const chromaBlend = chromaConfidence * chromaActivityGate(planes, width, height, i);
    const luminanceBlend = yConfidence * luminanceActivityGate(planes.y, width, height, i);

    restored.cb[i] = planes.cb[i] + chromaBlend * protection * (filteredCb - planes.cb[i]);
    restored.cr[i] = planes.cr[i] + chromaBlend * protection * (filteredCr - planes.cr[i]);
    restored.y[i] = planes.y[i] + luminanceBlend * protection * (filteredY - planes.y[i]);
    mask[i] = Math.max(chromaBlend, luminanceBlend);
    luminanceMask[i] = luminanceBlend;
  }

  const smoothingRadius = Math.round(options.chromaSmoothRadius);
  if (smoothingRadius > 0 && options.chromaSmoothStrength > 0) {
    const smoothCb = guidedFilter(
      restored.y,
      restored.cb,
      width,
      height,
      smoothingRadius,
      options.guidedEpsilon,
    );
    const smoothCr = guidedFilter(
      restored.y,
      restored.cr,
      width,
      height,
      smoothingRadius,
      options.guidedEpsilon,
    );
    for (let i = 0; i < length; i += 1) {
      const blend = clamp(mask[i] * options.chromaSmoothStrength);
      restored.cb[i] += blend * (smoothCb[i] - restored.cb[i]);
      restored.cr[i] += blend * (smoothCr[i] - restored.cr[i]);
    }
  }
  return { planes: restored, mask, luminanceMask };
}

export function processImagePlanes(planes, width, height, options = {}) {
  const detection = detectMoire(planes, width, height, options);
  const restoration = restoreMoire(planes, width, height, detection, options);
  return { detection, ...restoration };
}

export function maskToBuffer(mask) {
  const output = Buffer.allocUnsafe(mask.length);
  for (let i = 0; i < mask.length; i += 1) output[i] = Math.round(255 * clamp(mask[i]));
  return output;
}

export function buildReport(detection, width, height) {
  const activeTiles = detection.tiles.filter(
    (tile) => tile.confidence >= detection.options.minimumConfidence,
  );
  const reportPeak = (peak) => ({
    binX: peak.binX,
    binY: peak.binY,
    fx: peak.fx,
    fy: peak.fy,
    zScore: peak.zScore,
    energyRatio: peak.energyRatio,
    confidence: peak.confidence,
    neighbourSupport: peak.neighbourSupport,
    luminanceDistanceBins: peak.luminanceDistanceBins,
    textureProtected: peak.textureProtected,
    channel: peak.channel,
  });
  return {
    version: VERSION,
    image: { width, height },
    grid: { columns: detection.columns, rows: detection.rows, tileSize: detection.options.tileSize },
    summary: {
      tiles: detection.tiles.length,
      activeTiles: activeTiles.length,
      maxConfidence: activeTiles.reduce((maximum, tile) => Math.max(maximum, tile.confidence), 0),
      chromaPeaks: detection.tiles.reduce((sum, tile) => sum + tile.chromaPeaks.length, 0),
      luminancePeaks: detection.tiles.reduce((sum, tile) => sum + tile.luminancePeaks.length, 0),
    },
    tiles: activeTiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      confidence: tile.confidence,
      chromaPeaks: tile.chromaPeaks.map(reportPeak),
      luminancePeaks: tile.luminancePeaks.map(reportPeak),
    })),
  };
}
