import type { DiffLine, DiffHunk, ParsedDiff } from '../types/suggestion';

/**
 * Parse a unified diff string into structured data
 *
 * The diff format from the 'diff' library looks like:
 * ```
 * --- original
 * +++ suggested
 * @@ -1,3 +1,4 @@
 *  unchanged line
 * -removed line
 * +added line
 *  unchanged line
 * ```
 */
export function parseUnifiedDiff(diffString: string): ParsedDiff {
  const lines = diffString.split('\n');

  // Extract file names
  let from = 'original';
  let to = 'suggested';

  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let lineNumberBefore = 0;
  let lineNumberAfter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse file headers
    if (line.startsWith('---')) {
      from = line.substring(4).trim();
      continue;
    }
    if (line.startsWith('+++')) {
      to = line.substring(4).trim();
      continue;
    }

    // Parse hunk header: @@ -1,3 +1,4 @@
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (match) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }

        const oldStart = parseInt(match[1], 10);
        const oldLines = match[2] ? parseInt(match[2], 10) : 1;
        const newStart = parseInt(match[3], 10);
        const newLines = match[4] ? parseInt(match[4], 10) : 1;

        currentHunk = {
          oldStart,
          oldLines,
          newStart,
          newLines,
          lines: []
        };

        lineNumberBefore = oldStart;
        lineNumberAfter = newStart;

        // Add header line
        currentHunk.lines.push({
          type: 'header',
          content: line,
        });
      }
      continue;
    }

    // Skip empty lines at the end
    if (!line && i === lines.length - 1) {
      continue;
    }

    // Parse diff content lines
    if (currentHunk) {
      if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'remove',
          content: line.substring(1),
          lineNumberBefore,
        });
        lineNumberBefore++;
      } else if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'add',
          content: line.substring(1),
          lineNumberAfter,
        });
        lineNumberAfter++;
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'normal',
          content: line.substring(1),
          lineNumberBefore,
          lineNumberAfter,
        });
        lineNumberBefore++;
        lineNumberAfter++;
      }
    }
  }

  // Add the last hunk
  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return { from, to, hunks };
}

/**
 * Collapse unchanged sections in a hunk if they exceed a threshold
 */
export function collapseUnchangedLines(
  hunk: DiffHunk,
  contextLines: number = 3
): DiffHunk {
  const lines = hunk.lines;
  const collapsedLines: DiffLine[] = [];

  let unchangedBuffer: DiffLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.type === 'normal') {
      unchangedBuffer.push(line);
    } else {
      // Flush unchanged buffer
      if (unchangedBuffer.length > contextLines * 2) {
        // Keep first N context lines
        collapsedLines.push(...unchangedBuffer.slice(0, contextLines));

        // Add collapse marker
        collapsedLines.push({
          type: 'normal',
          content: `... ${unchangedBuffer.length - contextLines * 2} unchanged lines ...`,
        });

        // Keep last N context lines
        collapsedLines.push(...unchangedBuffer.slice(-contextLines));
      } else {
        collapsedLines.push(...unchangedBuffer);
      }

      unchangedBuffer = [];
      collapsedLines.push(line);
    }
  }

  // Flush remaining unchanged buffer
  if (unchangedBuffer.length > contextLines) {
    collapsedLines.push(...unchangedBuffer.slice(0, contextLines));
    collapsedLines.push({
      type: 'normal',
      content: `... ${unchangedBuffer.length - contextLines} unchanged lines ...`,
    });
  } else {
    collapsedLines.push(...unchangedBuffer);
  }

  return {
    ...hunk,
    lines: collapsedLines,
  };
}

/**
 * Get a human-readable summary of the changes
 */
export function getDiffSummary(diff: ParsedDiff): {
  additions: number;
  deletions: number;
  changes: number;
} {
  let additions = 0;
  let deletions = 0;

  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') additions++;
      if (line.type === 'remove') deletions++;
    }
  }

  return {
    additions,
    deletions,
    changes: additions + deletions,
  };
}
