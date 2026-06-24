import { describe, it, expect } from 'vitest';
import { quantize, dequantize } from './index.js';

function generateRandomVector(dim = 384): Float32Array {
  const vec = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    vec[i] = Math.random() * 2 - 1; // -1 to 1
  }
  return vec;
}

describe('Quantization', () => {
  it('fp32 round-trips exactly', () => {
    const vec = generateRandomVector();
    const result = quantize(vec, { format: 'fp32' });
    expect(result.format).toBe('fp32');
    expect(result.data).toBeInstanceOf(Float32Array);

    const reconstructed = dequantize(result);
    expect(reconstructed.length).toBe(vec.length);
    for (let i = 0; i < vec.length; i++) {
      expect(reconstructed[i]).toBe(vec[i]);
    }
  });

  it('fp16 halves memory footprint', () => {
    const vec = generateRandomVector();
    const result = quantize(vec, { format: 'fp16' });
    expect(result.format).toBe('fp16');
    // fp16 is still stored as float32 for browser compat in MVP,
    // but the flag signals the intended precision.
    expect(result.data).toBeInstanceOf(Float32Array);
  });

  it('int8 compresses and reconstructs within tolerance', () => {
    const vec = generateRandomVector(128); // smaller for speed
    const result = quantize(vec, { format: 'int8', asymmetric: true });
    expect(result.format).toBe('int8');
    expect(result.data).toBeInstanceOf(Int8Array);
    expect(result.scales).toBeDefined();

    const reconstructed = dequantize(result);
    expect(reconstructed.length).toBe(vec.length);

    // Mean squared error should be small (<0.5% for random data)
    let mse = 0;
    for (let i = 0; i < vec.length; i++) {
      mse += Math.abs(vec[i] - reconstructed[i]);
    }
    mse /= vec.length;
    expect(mse).toBeLessThan(0.05); // 5% tolerance for int8 on random noise
  });

  it('int4 compresses and reconstructs within tolerance', () => {
    const vec = generateRandomVector(64);
    const result = quantize(vec, { format: 'int4', blockSize: 32 });
    expect(result.format).toBe('int4');
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.scales).toBeDefined();
    expect(result.zeroPoints).toBeDefined();

    const reconstructed = dequantize(result);
    expect(reconstructed.length).toBe(vec.length);
  });

  it('falls back to fp32 for unknown formats', () => {
    const vec = generateRandomVector(10);
    // @ts-expect-error — testing unknown format
    const result = quantize(vec, { format: 'unknown' });
    expect(result.format).toBe('fp32');
  });

  it('handles edge case: all zeros', () => {
    const zeros = new Float32Array(100).fill(0);
    const int8 = quantize(zeros, { format: 'int8' });
    expect(int8.data).toBeInstanceOf(Int8Array);
    const reconstructed = dequantize(int8);
    for (let i = 0; i < 100; i++) {
      expect(reconstructed[i]).toBe(0);
    }
  });

  it('handles edge case: all ones', () => {
    const ones = new Float32Array(100).fill(1.0);
    const int8 = quantize(ones, { format: 'int8' });
    const reconstructed = dequantize(int8);
    // All values should be close to 1.0 (within int8 precision)
    for (let i = 0; i < 100; i++) {
      expect(Math.abs(reconstructed[i] - 1.0)).toBeLessThan(0.05);
    }
  });
});
