import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const outputDirectory = path.resolve('demo-output');
await fs.mkdir(outputDirectory, { recursive: true });

const width = 768;
const height = 512;
const rgb = Buffer.alloc(width * height * 3);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 3;
    const shade = 0.25 + 0.55 * x / width;
    const circle = Math.hypot(x - width * 0.7, y - height * 0.48) < 115 ? 0.18 : 0;
    const stripe = 28 * Math.sin(2 * Math.PI * (0.125 * x + 0.047 * y));
    const envelope = x > 80 && x < width - 70 && y > 55 && y < height - 50 ? 1 : 0;
    rgb[index] = Math.max(0, Math.min(255, 255 * (shade + circle) + envelope * stripe));
    rgb[index + 1] = Math.max(0, Math.min(255, 255 * (shade + circle) - envelope * stripe * 0.65));
    rgb[index + 2] = Math.max(0, Math.min(255, 255 * (shade + circle) + envelope * stripe * 0.3));
  }
}

const filename = path.join(outputDirectory, 'synthetic-moire.png');
await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toFile(filename);
console.log(filename);
