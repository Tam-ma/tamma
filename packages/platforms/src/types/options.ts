export interface CreatePROptions {
  title: string;
  body: string;
  head: string;
  base: string;
  labels?: string[];
}

export interface UpdatePROptions {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
}

export interface MergePROptions {
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  commitMessage?: string;
}

export interface ListIssuesOptions {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  sort?: 'created' | 'updated' | 'comments';
  direction?: 'asc' | 'desc';
  perPage?: number;
  page?: number;
}

export interface UpdateIssueOptions {
  state?: 'open' | 'closed';
  title?: string;
  body?: string;
  labels?: string[];
}
