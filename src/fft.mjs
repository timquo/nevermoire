/** In-place radix-2 FFT. */
export function fft1d(real, imag, inverse = false) {
  const n = real.length;
  if (n !== imag.length || n < 1 || (n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be a power of two, got ${n}`);
  }

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    const half = length >> 1;

    for (let start = 0; start < n; start += length) {
      let twiddleReal = 1;
      let twiddleImag = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * twiddleReal - imag[odd] * twiddleImag;
        const oddImag = real[odd] * twiddleImag + imag[odd] * twiddleReal;
        const evenReal = real[even];
        const evenImag = imag[even];

        real[even] = evenReal + oddReal;
        imag[even] = evenImag + oddImag;
        real[odd] = evenReal - oddReal;
        imag[odd] = evenImag - oddImag;

        const nextReal = twiddleReal * stepReal - twiddleImag * stepImag;
        twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
        twiddleReal = nextReal;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
}

function transformStride(real, imag, offset, stride, length, inverse, scratchReal, scratchImag) {
  for (let i = 0; i < length; i += 1) {
    scratchReal[i] = real[offset + i * stride];
    scratchImag[i] = imag[offset + i * stride];
  }
  fft1d(scratchReal, scratchImag, inverse);
  for (let i = 0; i < length; i += 1) {
    real[offset + i * stride] = scratchReal[i];
    imag[offset + i * stride] = scratchImag[i];
  }
}

/** In-place square 2D FFT. Arrays use row-major order. */
export function fft2d(real, imag, size, inverse = false) {
  if (real.length !== size * size || imag.length !== size * size) {
    throw new Error('2D FFT buffers do not match the requested size');
  }

  const scratchReal = new Float64Array(size);
  const scratchImag = new Float64Array(size);
  for (let y = 0; y < size; y += 1) {
    transformStride(real, imag, y * size, 1, size, inverse, scratchReal, scratchImag);
  }
  for (let x = 0; x < size; x += 1) {
    transformStride(real, imag, x, size, size, inverse, scratchReal, scratchImag);
  }
}

export function signedFrequency(index, size) {
  return index <= size / 2 ? index : index - size;
}

export function frequencyIndex(value, size) {
  return value < 0 ? size + value : value;
}
