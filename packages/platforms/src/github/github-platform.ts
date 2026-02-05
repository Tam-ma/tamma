import { Octokit } from '@octokit/rest';
import type { IGitPlatform } from '../types/git-platform.interface.js';
import type { GitPlatformConfig } from '../types/config.js';
import type {
  Repository,
  Branch,
  Issue,
  PullRequest,
  Comment,
  CIStatus,
  MergeResult,
  CommitInfo,
} from '../types/models.js';
import type {
  CreatePROptions,
  UpdatePROptions,
  MergePROptions,
  ListIssuesOptions,
  UpdateIssueOptions,
  ListCommitsOptions,
} from '../types/options.js';
import type { PaginatedResponse } from '../types/pagination.js';
import {
  mapRepository,
  mapBranch,
  mapIssue,
  mapComment,
  mapPullRequest,
  mapCIStatus,
  mapCommit,
} from './github-mappers.js';
import { withRateLimit } from './github-rate-limiter.js';
import { mapGitHubError } from './github-error-mapper.js';

export class GitHubPlatform implements IGitPlatform {
  readonly platformName = 'github';
  private octokit: Octokit | null = null;

  private getClient(): Octokit {
    if (this.octokit === null) {
      throw new Error('GitHubPlatform not initialized. Call initialize() first.');
    }
    return this.octokit;
  }

  async initialize(config: GitPlatformConfig): Promise<void> {
    this.octokit = new Octokit({
      auth: config.token,
      ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    });
  }

  async dispose(): Promise<void> {
    this.octokit = null;
  }

  async getRepository(owner: string, repo: string): Promise<Repository> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.repos.get({ owner, repo });
      return mapRepository(data);
    });
  }

  async getBranch(owner: string, repo: string, branch: string): Promise<Branch> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      return mapBranch(data, branch);
    });
  }

  async createBranch(
    owner: string,
    repo: string,
    branch: string,
    fromRef: string,
  ): Promise<Branch> {
    return this.wrap(async () => {
      const { data: refData } = await this.getClient().rest.git.getRef({
        owner,
        repo,
        ref: `heads/${fromRef}`,
      });
      const sha = refData.object.sha;

      const { data } = await this.getClient().rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha,
      });
      return mapBranch(data, branch);
    });
  }

  async deleteBranch(owner: string, repo: string, branch: string): Promise<void> {
    await this.wrap(async () => {
      await this.getClient().rest.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
    });
  }

  async createPR(
    owner: string,
    repo: string,
    options: CreatePROptions,
  ): Promise<PullRequest> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.pulls.create({
        owner,
        repo,
        title: options.title,
        body: options.body,
        head: options.head,
        base: options.base,
      });

      if (
        options.labels !== undefined &&
        options.labels.length > 0
      ) {
        await this.getClient().rest.issues.addLabels({
          owner,
          repo,
          issue_number: data.number,
          labels: options.labels,
        });
      }

      return mapPullRequest(data);
    });
  }

  async getPR(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      return mapPullRequest(data);
    });
  }

  async updatePR(
    owner: string,
    repo: string,
    prNumber: number,
    options: UpdatePROptions,
  ): Promise<PullRequest> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.pulls.update({
        owner,
        repo,
        pull_number: prNumber,
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.body !== undefined ? { body: options.body } : {}),
        ...(options.state !== undefined ? { state: options.state } : {}),
      });
      return mapPullRequest(data);
    });
  }

  async mergePR(
    owner: string,
    repo: string,
    prNumber: number,
    options?: MergePROptions,
  ): Promise<MergeResult> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: options?.mergeMethod ?? 'squash',
        ...(options?.commitMessage !== undefined
          ? { commit_message: options.commitMessage }
          : {}),
      });
      return {
        merged: data.merged,
        sha: data.sha,
        message: data.message,
      };
    });
  }

  async addPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<Comment> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
      return mapComment(data);
    });
  }

  async getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });

      const { data: commentsData } =
        await this.getClient().rest.issues.listComments({
          owner,
          repo,
          issue_number: issueNumber,
          per_page: 100,
        });

      const comments = commentsData.map(mapComment);
      return mapIssue(data, comments);
    });
  }

  async listIssues(
    owner: string,
    repo: string,
    options?: ListIssuesOptions,
  ): Promise<PaginatedResponse<Issue>> {
    return this.wrap(async () => {
      const { data, headers } = await this.getClient().rest.issues.listForRepo({
        owner,
        repo,
        state: options?.state ?? 'open',
        labels: options?.labels?.join(','),
        sort: options?.sort ?? 'created',
        direction: options?.direction ?? 'asc',
        per_page: options?.perPage ?? 30,
        page: options?.page ?? 1,
      });

      // Filter out pull requests (GitHub API includes them in issues)
      const issues = data
        .filter((item) => !('pull_request' in item && item.pull_request !== undefined))
        .map((item) => mapIssue(item));

      const hasNextPage =
        typeof headers.link === 'string' && headers.link.includes('rel="next"');

      return {
        data: issues,
        totalCount: issues.length,
        hasNextPage,
        page: options?.page ?? 1,
      };
    });
  }

  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    options: UpdateIssueOptions,
  ): Promise<Issue> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        ...(options.state !== undefined ? { state: options.state } : {}),
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.body !== undefined ? { body: options.body } : {}),
        ...(options.labels !== undefined ? { labels: options.labels } : {}),
      });
      return mapIssue(data);
    });
  }

  async addIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<Comment> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
      return mapComment(data);
    });
  }

  async assignIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    assignees: string[],
  ): Promise<Issue> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.issues.addAssignees({
        owner,
        repo,
        issue_number: issueNumber,
        assignees,
      });
      return mapIssue(data);
    });
  }

  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<CommitInfo[]> {
    return this.wrap(async () => {
      const { data } = await this.getClient().rest.repos.listCommits({
        owner,
        repo,
        per_page: options?.perPage ?? 10,
        ...(options?.sha !== undefined ? { sha: options.sha } : {}),
      });
      return data.map(mapCommit);
    });
  }

  async getCIStatus(owner: string, repo: string, ref: string): Promise<CIStatus> {
    return this.wrap(async () => {
      const [statusResponse, checksResponse] = await Promise.all([
        this.getClient().rest.repos.getCombinedStatusForRef({ owner, repo, ref }),
        this.getClient().rest.checks.listForRef({ owner, repo, ref }),
      ]);

      return mapCIStatus(statusResponse.data, checksResponse.data);
    });
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await withRateLimit(fn);
    } catch (err: unknown) {
      throw mapGitHubError(err);
    }
  }
}
