export interface ReviewSession {
  id: string;
  title: string;
  summary?: string | null;
  docPaths: string[];
  primaryDocPath: string;
  branch?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  status: string;
  ownerId: string;
  createdAt: number;
}
