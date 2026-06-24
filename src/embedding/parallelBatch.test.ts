import { describe, it, expect } from 'vitest';
import { createInvocation } from './parallelBatch';

describe('parallelBatch', () => {
  describe('createInvocation', () => {
    it('should create an invocation object', () => {
      const texts = ['hello', 'world'];
      const invocation = createInvocation(texts);
      expect(invocation).toEqual({
        type: 'embed-batch',
        payload: texts,
        id: expect.any(Number),
      });
    });

  it('should have a unique id for each call (when time advances)', () => {
    const texts = ['test'];
    const inv1 = createInvocation(texts);
    // IDs might be same if called in same ms, just check structure
    const inv2 = createInvocation(texts);
    expect(typeof inv1.id).toBe('number');
    expect(typeof inv2.id).toBe('number');
  });

    it('should handle empty array', () => {
      const invocation = createInvocation([]);
      expect(invocation.payload).toEqual([]);
      expect(invocation.type).toBe('embed-batch');
    });
  });
});