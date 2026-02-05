import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GitHubPlatform } from '../github/github-platform.js';

const token = process.env['INTEGRATION_TEST_GITHUB_TOKEN'];
const owner = process.env['INTEGRATION_TEST_GITHUB_OWNER'];
const repo = process.env['INTEGRATION_TEST_GITHUB_REPO'];
const hasGithub = token !== undefined && owner !== undefined && repo !== undefined;

describe.skipIf(!hasGithub)('GitHubPlatform Integration', () => {
  let platform: GitHubPlatform;

  beforeAll(async () => {
    platform = new GitHubPlatform();
    await platform.initialize({ token: token! });
  });

  afterAll(async () => {
    await platform.dispose();
  });

  it('should get repository info', async () => {
    const repository = await platform.getRepository(owner!, repo!);
    expect(repository.owner).toBe(owner);
    expect(repository.name).toBe(repo);
    expect(repository.defaultBranch).toBeDefined();
  });

  it('should list issues', async () => {
    const result = await platform.listIssues(owner!, repo!, {
      state: 'open',
      perPage: 5,
    });
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.page).toBe(1);
  });

  it('should get CI status for default branch', async () => {
    const repository = await platform.getRepository(owner!, repo!);
    const status = await platform.getCIStatus(owner!, repo!, repository.defaultBranch);
    expect(status.state).toBeDefined();
    expect(typeof status.totalCount).toBe('number');
  });

  it('should list recent commits', async () => {
    const commits = await platform.listCommits(owner!, repo!, { perPage: 5 });
    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0]!.sha).toBeDefined();
    expect(commits[0]!.message).toBeDefined();
  });

  it('should get a specific issue if one exists', async () => {
    const issues = await platform.listIssues(owner!, repo!, { state: 'open', perPage: 1 });
    if (issues.data.length > 0) {
      const issue = await platform.getIssue(owner!, repo!, issues.data[0]!.number);
      expect(issue.number).toBe(issues.data[0]!.number);
      expect(issue.title).toBeDefined();
    }
  });
});
