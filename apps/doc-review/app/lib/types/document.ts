export interface Document {
  path: string;
  title: string;
  description?: string;
  content: string;
  category: 'main' | 'epic' | 'story' | 'research' | 'retrospective';
  epicId?: string;
  storyId?: string;
  wordCount: number;
  lineCount: number;
  lastModified: number;
  headings: Array<{
    level: number;
    text: string;
    id: string;
  }>;
}

export interface DocumentMetadata {
  path: string;
  title: string;
  description?: string;
  category: Document['category'];
  epicId?: string;
  storyId?: string;
  wordCount: number;
  lineCount: number;
  lastModified: number;
}

export interface DocumentNavigation {
  main: Array<{
    id: string;
    title: string;
    path: string;
  }>;
  epics: Array<{
    id: string;
    title: string;
    techSpec?: string;
    stories: Array<{
      id: string;
      title: string;
      path: string;
    }>;
  }>;
  research: Array<{
    id: string;
    title: string;
    path: string;
  }>;
  retrospectives: Array<{
    id: string;
    title: string;
    path: string;
  }>;
}

// Re-export types from other modules for convenience
export type { Comment, CommentThread, CommentsByLine } from './comment';
export type { Suggestion, SuggestionStatus, SuggestionFilter, DiffLine, DiffHunk, ParsedDiff } from './suggestion';

// Discussion types
export interface Discussion {
  id: string;
  docPath: string;
  title: string;
  description: string | null;
  status: 'open' | 'resolved' | 'closed';
  userId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  author?: {
    id: string | null;
    name: string | null;
    avatarUrl: string | null;
    role: string | null;
  };
  messageCount?: number;
}

export interface DiscussionMessage {
  id: string;
  discussionId: string;
  content: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  author?: {
    id: string | null;
    name: string | null;
    avatarUrl: string | null;
    role: string | null;
  };
}
