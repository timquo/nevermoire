import assert from 'node:assert/strict';
import test from 'node:test';
import { fft1d, fft2d } from '../src/fft.mjs';

test('1D FFT round-trip reconstructs its input', () => {
  const real = Float64Array.from([0.5, 1, -2, 0.25, 3, -1, 0.75, 2]);
  const original = Array.from(real);
  const imag = new Float64Array(real.length);
  fft1d(real, imag);
  fft1d(real, imag, true);
  original.forEach((value, index) => assert.ok(Math.abs(real[index] - value) < 1e-10));
  imag.forEach((value) => assert.ok(Math.abs(value) < 1e-10));
});

test('2D FFT round-trip reconstructs its input', () => {
  const size = 8;
  const real = Float64Array.from({ length: size * size }, (_, i) => Math.sin(i * 0.37));
  const original = Array.from(real);
  const imag = new Float64Array(real.length);
  fft2d(real, imag, size);
  fft2d(real, imag, size, true);
  original.forEach((value, index) => assert.ok(Math.abs(real[index] - value) < 1e-9));
});
