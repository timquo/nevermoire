import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { parseArgs } from '../src/cli.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

test('screen mode enables luminance restoration', () => {
  const args = parseArgs(['photo.png', '--mode', 'screen']);
  assert.equal(args.options.processLuminance, true);
});

test('explicit chroma-only protection overrides screen mode', () => {
  const args = parseArgs(['photo.png', '--mode', 'screen', '--chroma-only']);
  assert.equal(args.options.processLuminance, false);
});

test('chroma-only mode cannot be accidentally overridden', () => {
  const args = parseArgs(['photo.png', '--mode', 'chroma-only', '--luma']);
  assert.equal(args.options.processLuminance, false);
});

test('unknown CLI options are rejected', () => {
  assert.throws(() => parseArgs(['photo.png', '--mystery']), /Unknown option/);
});

test('unsafe resource parameters are rejected', () => {
  assert.throws(() => parseArgs(['photo.png', '--tile', '65536']), /between 32 and 1024/);
  assert.throws(() => parseArgs(['photo.png', '--max-peaks', '999']), /between 1 and 16/);
  assert.throws(() => parseArgs(['photo.png', '--chroma-smooth', '10000']), /between 0 and 256/);
  assert.throws(() => parseArgs(['photo.png', '--luma-strength', '2']), /between 0 and 1/);
  assert.throws(() => parseArgs(['photo.png', '--max-input-pixels', '30000001']), /between 1 and 30000000/);
  assert.throws(
    () => parseArgs(['photo.png', '--min-frequency', '0.2', '--max-frequency', '0.1']),
    /less than --max-frequency/,
  );
});

test('frequency bounds can target broad moire bands', () => {
  const args = parseArgs([
    'photo.png', '--min-frequency', '0.006', '--max-frequency', '0.08',
  ]);
  assert.equal(args.options.minFrequency, 0.006);
  assert.equal(args.options.maxFrequency, 0.08);
});

test('CLI refuses to overwrite its input', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nevermoire-overwrite-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.png');
  await sharp({ create: { width: 40, height: 40, channels: 3, background: '#336699' } })
    .png()
    .toFile(input);
  const result = spawnSync(process.execPath, [cli, input, '-o', input], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to overwrite the input image/);
});

test('CLI strips metadata and diagnostics exclude filenames and paths', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nevermoire-privacy-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'private-person-name.jpg');
  const output = path.join(directory, 'output.jpg');
  const report = path.join(directory, 'report.json');
  await sharp({ create: { width: 40, height: 40, channels: 3, background: '#775533' } })
    .withMetadata({ exif: { IFD0: { Copyright: 'private marker' } } })
    .jpeg()
    .toFile(input);
  const result = spawnSync(
    process.execPath,
    [cli, input, '-o', output, '--report', report],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const outputMetadata = await sharp(output).metadata();
  assert.equal(outputMetadata.exif, undefined);
  assert.equal(outputMetadata.xmp, undefined);
  const reportText = fs.readFileSync(report, 'utf8');
  assert.doesNotMatch(reportText, /private-person-name|nevermoire-privacy-|[A-Za-z]:\\/);
});
