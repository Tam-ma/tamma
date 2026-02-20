/**
 * Distance Metric Utilities
 *
 * Conversion functions between different distance/similarity metrics.
 * Useful for normalizing scores across different vector store providers.
 */

import type { DistanceMetric } from '../interfaces.js';

/**
 * Convert cosine distance to cosine similarity
 * Cosine distance = 1 - cosine similarity
 *
 * @param distance - Cosine distance (0 to 2)
 * @returns Cosine similarity (-1 to 1)
 */
export function cosineDistanceToSimilarity(distance: number): number {
  return 1 - distance;
}

/**
 * Convert cosine similarity to cosine distance
 *
 * @param similarity - Cosine similarity (-1 to 1)
 * @returns Cosine distance (0 to 2)
 */
export function cosineSimilarityToDistance(similarity: number): number {
  return 1 - similarity;
}

/**
 * Normalize cosine similarity to a 0-1 range
 * Maps [-1, 1] to [0, 1]
 *
 * @param similarity - Cosine similarity (-1 to 1)
 * @returns Normalized score (0 to 1)
 */
export function normalizeCosineScore(similarity: number): number {
  return (similarity + 1) / 2;
}

/**
 * Convert Euclidean distance to a similarity score (0 to 1)
 * Uses exponential decay: similarity = exp(-distance)
 *
 * @param distance - Euclidean distance (0 to infinity)
 * @returns Similarity score (0 to 1)
 */
export function euclideanDistanceToSimilarity(distance: number): number {
  return Math.exp(-distance);
}

/**
 * Convert dot product to a normalized similarity score
 * For unit vectors, dot product equals cosine similarity.
 * For non-unit vectors, we need to normalize.
 *
 * @param dotProduct - Dot product value
 * @param magnitude1 - Magnitude of first vector
 * @param magnitude2 - Magnitude of second vector
 * @returns Normalized similarity (-1 to 1)
 */
export function dotProductToCosineSimilarity(
  dotProduct: number,
  magnitude1: number,
  magnitude2: number,
): number {
  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }
  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Calculate the Euclidean (L2) magnitude of a vector
 *
 * @param vector - Input vector
 * @returns Vector magnitude
 */
export function vectorMagnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
}

/**
 * Normalize a vector to unit length
 *
 * @param vector - Input vector
 * @returns Unit vector
 */
export function normalizeVector(vector: number[]): number[] {
  const magnitude = vectorMagnitude(vector);
  if (magnitude === 0) {
    return vector.map(() => 0);
  }
  return vector.map((val) => val / magnitude);
}

/**
 * Calculate cosine similarity between two vectors
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity (-1 to 1)
 * @throws Error if vectors have different dimensions
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    magnitudeA += aVal * aVal;
    magnitudeB += bVal * bVal;
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Calculate Euclidean distance between two vectors
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Euclidean distance
 * @throws Error if vectors have different dimensions
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let sumSquaredDiff = 0;
  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    const diff = aVal - bVal;
    sumSquaredDiff += diff * diff;
  }

  return Math.sqrt(sumSquaredDiff);
}

/**
 * Calculate dot product between two vectors
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Dot product
 * @throws Error if vectors have different dimensions
 */
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    result += aVal * bVal;
  }

  return result;
}

/**
 * Convert a raw score from a provider to a normalized similarity score (0-1)
 *
 * @param rawScore - Raw score from provider
 * @param metric - The distance metric used
 * @param isDistance - Whether the raw score is a distance (true) or similarity (false)
 * @returns Normalized similarity score (0-1)
 */
export function normalizeScore(
  rawScore: number,
  metric: DistanceMetric,
  isDistance: boolean,
): number {
  let similarity: number;

  switch (metric) {
    case 'cosine':
      similarity = isDistance ? cosineDistanceToSimilarity(rawScore) : rawScore;
      // Clamp to valid range and normalize to 0-1
      return Math.max(0, Math.min(1, (similarity + 1) / 2));

    case 'euclidean':
      if (isDistance) {
        similarity = euclideanDistanceToSimilarity(rawScore);
      } else {
        // Assume it's already a similarity
        similarity = rawScore;
      }
      return Math.max(0, Math.min(1, similarity));

    case 'dot_product':
      // For dot product, we assume unit vectors, so it's like cosine similarity
      similarity = isDistance ? 1 - rawScore : rawScore;
      return Math.max(0, Math.min(1, (similarity + 1) / 2));

    default:
      // Return as-is, clamped to 0-1
      return Math.max(0, Math.min(1, rawScore));
  }
}

/**
 * Get the ChromaDB distance function name for a distance metric
 */
export function getChromaDBDistanceFunction(metric: DistanceMetric): 'cosine' | 'l2' | 'ip' {
  switch (metric) {
    case 'cosine':
      return 'cosine';
    case 'euclidean':
      return 'l2';
    case 'dot_product':
      return 'ip'; // inner product
    default:
      return 'cosine';
  }
}

/**
 * Get the pgvector operator for a distance metric
 */
export function getPgVectorOperator(metric: DistanceMetric): '<->' | '<#>' | '<=>' {
  switch (metric) {
    case 'cosine':
      return '<=>'; // cosine distance
    case 'euclidean':
      return '<->'; // L2 distance
    case 'dot_product':
      return '<#>'; // negative inner product
    default:
      return '<=>';
  }
}
