export interface Comment {
  id: string;
  docPath: string;
  content: string;
  lineNumber: number | null;
  lineContent: string | null;
  resolved: boolean;
  userId: string;
  parentId: string | null;
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

export interface CommentThread {
  parentComment: Comment;
  replies: Comment[];
}

export interface CommentsByLine {
  [lineNumber: number]: CommentThread[];
}
