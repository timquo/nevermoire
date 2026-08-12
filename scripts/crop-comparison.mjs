import path from 'node:path';
import sharp from 'sharp';

const [directory, output, cropRaw, ...names] = process.argv.slice(2);
if (!directory || !output || !cropRaw || names.length < 2) {
  throw new Error('Usage: crop-comparison.mjs <dir> <output> <left,top,width,height> <files...>');
}
const [left, top, width, height] = cropRaw.split(',').map(Number);
const pieces = [];
for (const name of names) {
  pieces.push(await sharp(path.join(directory, name))
    .extract({ left, top, width, height })
    .png()
    .toBuffer());
}
await sharp({ create: { width: width * pieces.length, height, channels: 3, background: '#ffffff' } })
  .composite(pieces.map((input, index) => ({ input, left: index * width, top: 0 })))
  .png()
  .toFile(path.join(directory, output));
