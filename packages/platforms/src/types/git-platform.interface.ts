import type { GitPlatformConfig } from './config.js';
import type {
  Repository,
  Branch,
  Issue,
  PullRequest,
  Comment,
  CIStatus,
  MergeResult,
  CommitInfo,
} from './models.js';
import type {
  CreatePROptions,
  UpdatePROptions,
  MergePROptions,
  ListIssuesOptions,
  UpdateIssueOptions,
  ListCommitsOptions,
  CreateIssueOptions,
} from './options.js';
import type { PaginatedResponse } from './pagination.js';

export interface IGitPlatform {
  readonly platformName: string;

  initialize(config: GitPlatformConfig): Promise<void>;
  dispose(): Promise<void>;

  // Repository
  getRepository(owner: string, repo: string): Promise<Repository>;

  // Branch
  getBranch(owner: string, repo: string, branch: string): Promise<Branch>;
  createBranch(
    owner: string,
    repo: string,
    branch: string,
    fromRef: string,
  ): Promise<Branch>;
  deleteBranch(owner: string, repo: string, branch: string): Promise<void>;

  // Pull Request
  createPR(
    owner: string,
    repo: string,
    options: CreatePROptions,
  ): Promise<PullRequest>;
  getPR(owner: string, repo: string, prNumber: number): Promise<PullRequest>;
  updatePR(
    owner: string,
    repo: string,
    prNumber: number,
    options: UpdatePROptions,
  ): Promise<PullRequest>;
  mergePR(
    owner: string,
    repo: string,
    prNumber: number,
    options?: MergePROptions,
  ): Promise<MergeResult>;
  addPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<Comment>;

  // Issue
  getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue>;
  listIssues(
    owner: string,
    repo: string,
    options?: ListIssuesOptions,
  ): Promise<PaginatedResponse<Issue>>;
  updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    options: UpdateIssueOptions,
  ): Promise<Issue>;
  addIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<Comment>;
  createIssue(
    owner: string,
    repo: string,
    options: CreateIssueOptions,
  ): Promise<Issue>;
  assignIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    assignees: string[],
  ): Promise<Issue>;

  // Commits
  listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<CommitInfo[]>;

  // CI Status
  getCIStatus(owner: string, repo: string, ref: string): Promise<CIStatus>;
}
