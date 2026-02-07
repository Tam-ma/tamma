/**
 * Hash Calculator
 *
 * Provides content hashing for change detection and deduplication.
 */

import * as crypto from 'node:crypto';

/**
 * Calculate SHA-256 hash of content
 * @param content - Content to hash
 * @returns Hex-encoded hash string
 */
export function calculateHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Generate a unique ID from content hash and metadata
 * @param content - Content to hash
 * @param prefix - Optional prefix for the ID
 * @returns Unique identifier
 */
export function generateContentId(content: string, prefix?: string): string {
  const hash = calculateHash(content);
  // Use first 16 chars of hash for reasonable uniqueness
  const shortHash = hash.substring(0, 16);
  return prefix ? `${prefix}-${shortHash}` : shortHash;
}

/**
 * Generate a file ID from file path
 * @param filePath - Relative file path
 * @returns Unique file identifier
 */
export function generateFileId(filePath: string): string {
  const hash = calculateHash(filePath);
  return `file-${hash.substring(0, 12)}`;
}

/**
 * Generate a chunk ID from file ID, chunk index, and content
 * @param fileId - Parent file ID
 * @param chunkIndex - Index of the chunk within the file
 * @param content - Chunk content
 * @returns Unique chunk identifier
 */
export function generateChunkId(
  fileId: string,
  chunkIndex: number,
  content: string,
): string {
  const contentHash = calculateHash(content).substring(0, 8);
  return `${fileId}-chunk-${chunkIndex}-${contentHash}`;
}

/**
 * Compare two hashes for equality
 * @param hash1 - First hash
 * @param hash2 - Second hash
 * @returns True if hashes are equal (timing-safe comparison)
 */
export function hashesEqual(hash1: string, hash2: string): boolean {
  if (hash1.length !== hash2.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash1, 'hex'),
      Buffer.from(hash2, 'hex'),
    );
  } catch {
    // If either is not valid hex, fall back to simple comparison
    return hash1 === hash2;
  }
}

/**
 * Calculate hash of a file's content and metadata
 * @param content - File content
 * @param filePath - File path
 * @returns Combined hash
 */
export function calculateFileHash(content: string, filePath: string): string {
  const combined = `${filePath}:${content}`;
  return calculateHash(combined);
}
