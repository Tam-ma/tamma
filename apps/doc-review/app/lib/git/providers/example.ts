/**
 * Example usage of the GitHubProvider
 *
 * This file demonstrates how to use the GitHubProvider class
 * for real GitHub API operations.
 *
 * To run this example:
 * 1. Set up environment variables in .env or .dev.vars:
 *    - GITHUB_TOKEN=ghp_your_token_here
 *    - GIT_OWNER=your-username-or-org
 *    - GIT_REPO=your-repo-name
 *
 * 2. Run with tsx or ts-node:
 *    npx tsx app/lib/git/providers/example.ts
 */

import { GitHubProvider } from './github';

async function main() {
  // Initialize the provider
  const provider = new GitHubProvider({
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GIT_TOKEN: process.env.GIT_TOKEN,
    GIT_OWNER: process.env.GIT_OWNER || 'meywd',
    GIT_REPO: process.env.GIT_REPO || 'tamma',
    GIT_DEFAULT_BRANCH: process.env.GIT_DEFAULT_BRANCH || 'main',
  });

  try {
    // Example 1: Get a file from the repository
    console.log('\n📄 Getting README.md from main branch...');
    const readme = await provider.getFile('README.md');
    console.log(`- File SHA: ${readme.sha}`);
    console.log(`- File size: ${readme.size} bytes`);
    console.log(`- First 100 chars: ${readme.content.substring(0, 100)}...`);

    // Example 2: List files in docs directory
    console.log('\n📁 Listing files in docs directory...');
    const files = await provider.listFiles('docs');
    console.log(`Found ${files.length} items:`);
    files.slice(0, 5).forEach(file => {
      console.log(`- ${file.type === 'tree' ? '📁' : '📄'} ${file.path}`);
    });

    // Example 3: Create a documentation review session
    console.log('\n🔄 Creating a documentation review session...');
    const sessionId = `demo-${Date.now()}`;
    const pr = await provider.ensureSessionPullRequest({
      sessionId,
      title: 'Documentation Review: API Guide Updates',
      summary: 'This is a demo pull request for testing the GitHub provider.',
      docPaths: [
        'docs/api/README.md',
        'docs/api/authentication.md',
      ],
    });

    console.log('Pull Request created:');
    console.log(`- PR Number: #${pr.prNumber}`);
    console.log(`- Branch: ${pr.branch}`);
    console.log(`- Status: ${pr.status}`);
    console.log(`- URL: ${pr.prUrl}`);

    // Example 4: List existing pull requests
    console.log('\n📝 Listing open pull requests...');
    const prs = await provider.listPullRequests({ state: 'open' });
    console.log(`Found ${prs.length} open PRs:`);
    prs.slice(0, 3).forEach(pr => {
      console.log(`- #${pr.number}: ${pr.title} (${pr.state})`);
    });

    // Example 5: Get blame information for a file
    console.log('\n👥 Getting blame information for README.md...');
    try {
      const blame = await provider.getBlame('README.md');
      console.log(`Found ${blame.length} blame ranges`);
      if (blame.length > 0) {
        const firstBlame = blame[0];
        console.log(`- First commit: ${firstBlame.commit.sha.substring(0, 7)}`);
        console.log(`- Author: ${firstBlame.commit.author.name}`);
        console.log(`- Message: ${firstBlame.commit.message.split('\n')[0]}`);
      }
    } catch (error) {
      console.log('Note: Blame requires GraphQL API access');
    }

    // Example 6: Create a branch
    console.log('\n🌿 Creating a new branch...');
    const branchName = `demo/test-${Date.now()}`;
    const branch = await provider.createBranch(branchName, 'main');
    console.log(`Branch created: ${branch.ref}`);
    console.log(`- SHA: ${branch.object.sha}`);

  } catch (error) {
    console.error('\n❌ Error occurred:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🚀 GitHub Provider Example');
  console.log('=' .repeat(50));

  // Check for required environment variables
  if (!process.env.GITHUB_TOKEN && !process.env.GIT_TOKEN) {
    console.error('\n❌ Error: GITHUB_TOKEN or GIT_TOKEN environment variable is required');
    console.error('Please set it in your .env or .dev.vars file');
    process.exit(1);
  }

  main()
    .then(() => {
      console.log('\n✅ Example completed successfully!');
    })
    .catch((error) => {
      console.error('\n❌ Example failed:', error);
      process.exit(1);
    });
}

export { main };