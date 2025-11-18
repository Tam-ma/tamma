export interface Suggestion {
  id: string;
  docPath: string;
  description: string;
  originalText: string;
  suggestedText: string;
  lineStart: number;
  lineEnd: number;
  status: SuggestionStatus;
  userId: string;
  sessionId: string | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  createdAt: number;
  updatedAt: number;
  diff?: string;
  author?: {
    id: string | null;
    name: string | null;
    avatarUrl?: string | null;
  };
  session?: {
    id: string;
    title: string;
    status: string;
    prNumber?: number | null;
    prUrl?: string | null;
  };
}

export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'deleted';

export interface SuggestionFilter {
  status?: SuggestionStatus;
  sessionId?: string;
  userId?: string;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'normal' | 'header';
  content: string;
  lineNumberBefore?: number;
  lineNumberAfter?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  from: string;
  to: string;
  hunks: DiffHunk[];
}
