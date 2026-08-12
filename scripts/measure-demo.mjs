import sharp from 'sharp';
import { rgbBufferToPlanes } from '../src/core.mjs';

const outputFilename = process.argv[2] ?? 'demo-output/cleaned.png';

async function load(filename) {
  const decoded = await sharp(filename).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { ...rgbBufferToPlanes(decoded.data, decoded.info.width, decoded.info.height), ...decoded.info };
}

function projection(plane, width, bounds, fx, fy) {
  let sine = 0;
  let cosine = 0;
  let count = 0;
  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const phase = 2 * Math.PI * (fx * x + fy * y);
      const value = plane[y * width + x];
      sine += value * Math.sin(phase);
      cosine += value * Math.cos(phase);
      count += 1;
    }
  }
  return Math.hypot(sine, cosine) / count;
}

const before = await load('demo-output/synthetic-moire.png');
const after = await load(outputFilename);
const bounds = { left: 100, top: 75, right: before.width - 90, bottom: before.height - 70 };
const fx = 0.125;
const fy = 0.046875;
const beforeAmplitude = Math.hypot(
  projection(before.cb, before.width, bounds, fx, fy),
  projection(before.cr, before.width, bounds, fx, fy),
);
const afterAmplitude = Math.hypot(
  projection(after.cb, after.width, bounds, fx, fy),
  projection(after.cr, after.width, bounds, fx, fy),
);
console.log(JSON.stringify({
  output: outputFilename,
  beforeAmplitude,
  afterAmplitude,
  reductionPercent: 100 * (1 - afterAmplitude / beforeAmplitude),
}, null, 2));
