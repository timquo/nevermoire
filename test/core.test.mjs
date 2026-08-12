import assert from 'node:assert/strict';
import test from 'node:test';
import { detectMoire, guidedFilter, processImagePlanes } from '../src/core.mjs';

function makePlanes(width, height, generator) {
  const length = width * height;
  const planes = {
    y: new Float32Array(length),
    cb: new Float32Array(length),
    cr: new Float32Array(length),
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = generator(x, y);
      const index = y * width + x;
      planes.y[index] = pixel.y;
      planes.cb[index] = pixel.cb;
      planes.cr[index] = pixel.cr;
    }
  }
  return planes;
}

function sinusoidProjection(plane, width, height, fx, fy) {
  let sine = 0;
  let cosine = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = plane[y * width + x];
      const phase = 2 * Math.PI * (fx * x + fy * y);
      sine += value * Math.sin(phase);
      cosine += value * Math.cos(phase);
    }
  }
  return Math.hypot(sine, cosine) / (width * height);
}

test('flat chroma remains effectively unchanged', () => {
  const width = 96;
  const height = 80;
  const planes = makePlanes(width, height, (x, y) => ({
    y: 0.25 + 0.4 * x / width + 0.08 * y / height,
    cb: 0.015,
    cr: -0.01,
  }));
  const result = processImagePlanes(planes, width, height, { tileSize: 64, step: 48 });
  const maximumMask = result.mask.reduce((maximum, value) => Math.max(maximum, value), 0);
  assert.equal(maximumMask, 0);
  assert.ok(Math.abs(result.planes.cb[100] - planes.cb[100]) < 1e-6);
  assert.ok(Math.abs(result.planes.cr[100] - planes.cr[100]) < 1e-6);
});

test('periodic chroma is detected and attenuated', () => {
  const width = 192;
  const height = 160;
  const fx = 8 / 64;
  const fy = 3 / 64;
  const planes = makePlanes(width, height, (x, y) => {
    const wave = Math.sin(2 * Math.PI * (fx * x + fy * y));
    return { y: 0.45, cb: 0.075 * wave, cr: -0.055 * wave };
  });
  const result = processImagePlanes(planes, width, height, {
    tileSize: 64,
    step: 32,
    strength: 1,
    zThreshold: 3.2,
    zFullConfidence: 6,
    notchWidth: 1.5,
  });
  const before = sinusoidProjection(planes.cb, width, height, fx, fy);
  const after = sinusoidProjection(result.planes.cb, width, height, fx, fy);
  const maximumMask = result.mask.reduce((maximum, value) => Math.max(maximum, value), 0);
  assert.ok(maximumMask > 0.25, `expected a visible detection mask, got ${maximumMask}`);
  assert.ok(after < before * 0.82, `expected attenuation, before=${before}, after=${after}`);
});

test('spatial activity gate protects a flat surround from tile ringing', () => {
  const width = 160;
  const height = 128;
  const planes = makePlanes(width, height, (x, y) => {
    const inside = x >= 32 && x < 128 && y >= 24 && y < 104;
    const wave = inside ? Math.sin(2 * Math.PI * (0.125 * x + 0.046875 * y)) : 0;
    return { y: 0.42, cb: 0.07 * wave, cr: -0.05 * wave };
  });
  const result = processImagePlanes(planes, width, height, {
    tileSize: 64,
    step: 48,
    strength: 1,
    zThreshold: 3.5,
  });

  let outsideDifference = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= 16 && x < 144 && y >= 12 && y < 116) continue;
      const index = y * width + x;
      outsideDifference = Math.max(
        outsideDifference,
        Math.abs(result.planes.cb[index] - planes.cb[index]),
        Math.abs(result.planes.cr[index] - planes.cr[index]),
      );
    }
  }
  assert.ok(outsideDifference < 1e-7, `flat surround changed by ${outsideDifference}`);
});

test('guided filter smooths chroma while respecting a luminance boundary', () => {
  const width = 64;
  const height = 32;
  const guide = new Float32Array(width * height);
  const input = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      guide[index] = x < width / 2 ? 0.2 : 0.8;
      input[index] = (x < width / 2 ? -0.08 : 0.08) + 0.025 * Math.sin(y * 1.7);
    }
  }
  const output = guidedFilter(guide, input, width, height, 6, 0.0001);
  const left = output[16 * width + 28];
  const right = output[16 * width + 35];
  assert.ok(right - left > 0.1, `expected boundary preservation, got ${right - left}`);
  assert.ok(Math.abs(output[16 * width + 12] + 0.08) < 0.015);
});

test('texture protection rejects chroma periodicity also present in luminance', () => {
  const width = 160;
  const height = 128;
  const fx = 9 / 64;
  const fy = 2 / 64;
  const planes = makePlanes(width, height, (x, y) => {
    const wave = Math.sin(2 * Math.PI * (fx * x + fy * y));
    return { y: 0.45 + 0.16 * wave, cb: 0.06 * wave, cr: -0.04 * wave };
  });
  const unprotected = processImagePlanes(planes, width, height, {
    tileSize: 64,
    step: 48,
    zThreshold: 3.2,
    zFullConfidence: 6,
    strength: 1,
  });
  const protectedResult = processImagePlanes(planes, width, height, {
    tileSize: 64,
    step: 48,
    zThreshold: 3.2,
    zFullConfidence: 6,
    strength: 1,
    textureProtection: true,
  });
  const unprotectedChange = Math.abs(unprotected.planes.cb[5000] - planes.cb[5000]);
  const protectedChange = Math.abs(protectedResult.planes.cb[5000] - planes.cb[5000]);
  assert.ok(protectedChange < unprotectedChange * 0.2);
  assert.ok(protectedResult.detection.tiles.some((tile) =>
    tile.chromaPeaks.some((peak) => peak.textureProtected)));
});

test('analysis rejects pathological tile counts before transforming', () => {
  const width = 400;
  const height = 400;
  const empty = new Float32Array(width * height);
  assert.throws(
    () => detectMoire({ y: empty, cb: empty, cr: empty }, width, height, { tileSize: 32, step: 1 }),
    /more than 25,000 tiles/,
  );
});
