import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const directory = process.argv[2];
const names = process.argv.slice(3);
if (!directory || names.length < 2) throw new Error('Usage: compare-real.mjs <directory> <before> <variant...>');

const loaded = [];
for (const name of names) {
  const filename = path.join(directory, name);
  const decoded = await sharp(filename).removeAlpha().toColourspace('srgb').raw()
    .toBuffer({ resolveWithObject: true });
  loaded.push({ name, ...decoded.info, data: decoded.data });
}
const before = loaded[0];
const metrics = [];
for (const variant of loaded.slice(1)) {
  if (variant.width !== before.width || variant.height !== before.height) throw new Error('Image sizes differ');
  let absolute = 0;
  let square = 0;
  let changed = 0;
  let maximum = 0;
  for (let i = 0; i < before.data.length; i += 1) {
    const difference = Math.abs(variant.data[i] - before.data[i]);
    absolute += difference;
    square += difference * difference;
    maximum = Math.max(maximum, difference);
    if (difference >= 3) changed += 1;
  }
  metrics.push({
    file: variant.name,
    meanAbsoluteDifference: absolute / before.data.length,
    rootMeanSquareDifference: Math.sqrt(square / before.data.length),
    channelsChangedByAtLeast3Percent: 100 * changed / before.data.length,
    maximumDifference: maximum,
  });
}

const cropSize = Math.min(420, before.width, before.height);
const crops = [
  { name: 'left-centre', left: Math.round(before.width * 0.17), top: Math.round(before.height * 0.28) },
  { name: 'right-detail', left: Math.round(before.width * 0.52), top: Math.round(before.height * 0.12) },
];
for (const crop of crops) {
  crop.left = Math.min(before.width - cropSize, crop.left);
  crop.top = Math.min(before.height - cropSize, crop.top);
  const pieces = [];
  for (const image of loaded) {
    pieces.push(await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } })
      .extract({ left: crop.left, top: crop.top, width: cropSize, height: cropSize })
      .png()
      .toBuffer());
  }
  await sharp({
    create: { width: cropSize * pieces.length, height: cropSize, channels: 3, background: '#ffffff' },
  }).composite(pieces.map((input, index) => ({ input, left: index * cropSize, top: 0 })))
    .png()
    .toFile(path.join(directory, `comparison-${crop.name}.png`));
}

await fs.writeFile(path.join(directory, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics, null, 2));
