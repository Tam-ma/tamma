/**
 * Common utility functions shared across the Tamma platform
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert text to a URL/branch-safe slug.
 * Lowercase, replace non-alphanumeric with hyphens, collapse multiple hyphens, trim, limit to 50 chars.
 */
export function slugify(text: string): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

  // Trim leading hyphens
  while (slug.startsWith('-')) {
    slug = slug.slice(1);
  }
  // Trim trailing hyphens
  while (slug.endsWith('-')) {
    slug = slug.slice(0, -1);
  }

  slug = slug.slice(0, 50);

  // Trim trailing hyphen after truncation
  while (slug.endsWith('-')) {
    slug = slug.slice(0, -1);
  }

  return slug;
}

/**
 * Extract issue references (#123) from text.
 * Returns unique issue numbers.
 */
export function extractIssueReferences(text: string): number[] {
  const matches = text.matchAll(/#(\d+)/g);
  const numbers = new Set<number>();
  for (const match of matches) {
    const num = parseInt(match[1] ?? '0', 10);
    if (num > 0) {
      numbers.add(num);
    }
  }
  return [...numbers];
}
