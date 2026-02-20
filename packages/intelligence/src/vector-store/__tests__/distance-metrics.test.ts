/**
 * Tests for Distance Metric Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  cosineDistanceToSimilarity,
  cosineSimilarityToDistance,
  normalizeCosineScore,
  euclideanDistanceToSimilarity,
  dotProductToCosineSimilarity,
  vectorMagnitude,
  normalizeVector,
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalizeScore,
  getChromaDBDistanceFunction,
  getPgVectorOperator,
} from '../utils/distance-metrics.js';

describe('cosineDistanceToSimilarity', () => {
  it('should convert distance 0 to similarity 1', () => {
    expect(cosineDistanceToSimilarity(0)).toBe(1);
  });

  it('should convert distance 1 to similarity 0', () => {
    expect(cosineDistanceToSimilarity(1)).toBe(0);
  });

  it('should convert distance 2 to similarity -1', () => {
    expect(cosineDistanceToSimilarity(2)).toBe(-1);
  });

  it('should handle intermediate values', () => {
    expect(cosineDistanceToSimilarity(0.5)).toBe(0.5);
    expect(cosineDistanceToSimilarity(1.5)).toBe(-0.5);
  });
});

describe('cosineSimilarityToDistance', () => {
  it('should convert similarity 1 to distance 0', () => {
    expect(cosineSimilarityToDistance(1)).toBe(0);
  });

  it('should convert similarity 0 to distance 1', () => {
    expect(cosineSimilarityToDistance(0)).toBe(1);
  });

  it('should convert similarity -1 to distance 2', () => {
    expect(cosineSimilarityToDistance(-1)).toBe(2);
  });

  it('should be inverse of cosineDistanceToSimilarity', () => {
    const original = 0.75;
    const distance = cosineSimilarityToDistance(original);
    const backToSimilarity = cosineDistanceToSimilarity(distance);
    expect(backToSimilarity).toBeCloseTo(original);
  });
});

describe('normalizeCosineScore', () => {
  it('should normalize -1 to 0', () => {
    expect(normalizeCosineScore(-1)).toBe(0);
  });

  it('should normalize 0 to 0.5', () => {
    expect(normalizeCosineScore(0)).toBe(0.5);
  });

  it('should normalize 1 to 1', () => {
    expect(normalizeCosineScore(1)).toBe(1);
  });
});

describe('euclideanDistanceToSimilarity', () => {
  it('should convert distance 0 to similarity 1', () => {
    expect(euclideanDistanceToSimilarity(0)).toBe(1);
  });

  it('should return value between 0 and 1 for positive distance', () => {
    const sim = euclideanDistanceToSimilarity(1);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('should approach 0 as distance increases', () => {
    const sim10 = euclideanDistanceToSimilarity(10);
    const sim100 = euclideanDistanceToSimilarity(100);
    expect(sim10).toBeGreaterThan(sim100);
    expect(sim100).toBeCloseTo(0, 10);
  });
});

describe('dotProductToCosineSimilarity', () => {
  it('should return 0 for zero magnitude vectors', () => {
    expect(dotProductToCosineSimilarity(5, 0, 1)).toBe(0);
    expect(dotProductToCosineSimilarity(5, 1, 0)).toBe(0);
    expect(dotProductToCosineSimilarity(0, 0, 0)).toBe(0);
  });

  it('should normalize dot product by magnitudes', () => {
    // Two unit vectors with dot product 0.5 should return 0.5
    expect(dotProductToCosineSimilarity(0.5, 1, 1)).toBe(0.5);

    // Non-unit vectors
    expect(dotProductToCosineSimilarity(4, 2, 2)).toBe(1);
  });
});

describe('vectorMagnitude', () => {
  it('should return 0 for zero vector', () => {
    expect(vectorMagnitude([0, 0, 0])).toBe(0);
  });

  it('should return 1 for unit vectors', () => {
    expect(vectorMagnitude([1, 0, 0])).toBe(1);
    expect(vectorMagnitude([0, 1, 0])).toBe(1);
  });

  it('should calculate correct magnitude', () => {
    expect(vectorMagnitude([3, 4])).toBe(5); // 3-4-5 triangle
    expect(vectorMagnitude([1, 1, 1])).toBeCloseTo(Math.sqrt(3));
  });
});

describe('normalizeVector', () => {
  it('should return zero vector for zero input', () => {
    expect(normalizeVector([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('should normalize to unit length', () => {
    const normalized = normalizeVector([3, 4]);
    expect(vectorMagnitude(normalized)).toBeCloseTo(1);
    expect(normalized[0]).toBeCloseTo(0.6);
    expect(normalized[1]).toBeCloseTo(0.8);
  });

  it('should preserve direction', () => {
    const normalized = normalizeVector([10, 0, 0]);
    expect(normalized).toEqual([1, 0, 0]);
  });
});

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it('should return -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('should return 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('should throw for dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
  });

  it('should return 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });
});

describe('euclideanDistance', () => {
  it('should return 0 for identical vectors', () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it('should calculate correct distance', () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
    expect(euclideanDistance([1, 1], [4, 5])).toBe(5);
  });

  it('should throw for dimension mismatch', () => {
    expect(() => euclideanDistance([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
  });
});

describe('dotProduct', () => {
  it('should return 0 for orthogonal vectors', () => {
    expect(dotProduct([1, 0], [0, 1])).toBe(0);
  });

  it('should calculate correct dot product', () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32); // 1*4 + 2*5 + 3*6
    expect(dotProduct([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('should throw for dimension mismatch', () => {
    expect(() => dotProduct([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
  });
});

describe('normalizeScore', () => {
  describe('cosine metric', () => {
    it('should normalize similarity to 0-1 range', () => {
      expect(normalizeScore(1, 'cosine', false)).toBe(1);
      expect(normalizeScore(0, 'cosine', false)).toBe(0.5);
      expect(normalizeScore(-1, 'cosine', false)).toBe(0);
    });

    it('should handle distance input', () => {
      expect(normalizeScore(0, 'cosine', true)).toBe(1); // distance 0 = similarity 1
      expect(normalizeScore(2, 'cosine', true)).toBe(0); // distance 2 = similarity -1
    });
  });

  describe('euclidean metric', () => {
    it('should convert distance to similarity', () => {
      expect(normalizeScore(0, 'euclidean', true)).toBe(1);
      const score = normalizeScore(1, 'euclidean', true);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });
  });

  describe('dot_product metric', () => {
    it('should handle dot product scores', () => {
      expect(normalizeScore(1, 'dot_product', false)).toBe(1);
      expect(normalizeScore(0, 'dot_product', false)).toBe(0.5);
    });
  });
});

describe('getChromaDBDistanceFunction', () => {
  it('should return correct function names', () => {
    expect(getChromaDBDistanceFunction('cosine')).toBe('cosine');
    expect(getChromaDBDistanceFunction('euclidean')).toBe('l2');
    expect(getChromaDBDistanceFunction('dot_product')).toBe('ip');
  });
});

describe('getPgVectorOperator', () => {
  it('should return correct operators', () => {
    expect(getPgVectorOperator('cosine')).toBe('<=>');
    expect(getPgVectorOperator('euclidean')).toBe('<->');
    expect(getPgVectorOperator('dot_product')).toBe('<#>');
  });
});
