/**
 * Default permission sets for each agent type
 * @module @tamma/gates/permissions/defaults
 */

import type {
  AgentType,
  AgentPermissionSet,
  ToolPermissions,
  FilePermissions,
  CommandPermissions,
  APIPermissions,
  GitPermissions,
  ResourceLimits,
} from './types.js';

// ============================================
// Shared Constants
// ============================================

/**
 * Read-only tools that don't modify anything
 */
export const READ_ONLY_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
] as const;

/**
 * All available tools
 */
export const ALL_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Write',
  'Edit',
  'Bash',
  'WebFetch',
  'WebSearch',
  'Task',
  'NotebookEdit',
] as const;

/**
 * Security-sensitive file patterns that should never be accessed
 */
export const BLOCKED_FILE_PATTERNS = [
  '**/.env',
  '**/.env.*',
  '**/secrets/**',
  '**/*.pem',
  '**/*.key',
  '**/credentials*',
  '**/.ssh/**',
  '**/node_modules/**',
  '**/.git/objects/**',
] as const;

/**
 * Dangerous commands that should always be denied
 */
export const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'sudo',
  'su',
  'curl * | bash',
  'curl * | sh',
  'wget * | bash',
  'wget * | sh',
  'chmod 777',
  ':(){ :|:& };:',
  'mkfs',
  'dd if=/dev',
  '> /dev/sda',
  'mv /* /dev/null',
] as const;

/**
 * Protected branches that require special permission
 */
export const PROTECTED_BRANCHES = ['main', 'master', 'release/*', 'prod/*'] as const;

// ============================================
// Default Permission Components
// ============================================

function createReadOnlyToolPermissions(): ToolPermissions {
  return {
    allowed: [...READ_ONLY_TOOLS],
    denied: ['Write', 'Edit', 'Bash', 'NotebookEdit'],
    requireApproval: [],
  };
}

function createFullToolPermissions(): ToolPermissions {
  return {
    allowed: [...ALL_TOOLS],
    denied: [],
    requireApproval: [],
  };
}

function createReadOnlyFilePermissions(): FilePermissions {
  return {
    read: {
      allowed: ['**/*'],
      denied: [...BLOCKED_FILE_PATTERNS],
    },
    write: {
      allowed: [],
      denied: ['**/*'],
    },
  };
}

function createImplementerFilePermissions(): FilePermissions {
  return {
    read: {
      allowed: ['**/*'],
      denied: [...BLOCKED_FILE_PATTERNS],
    },
    write: {
      allowed: [
        'src/**/*',
        'lib/**/*',
        'tests/**/*',
        '__tests__/**/*',
        '*.test.ts',
        '*.spec.ts',
        'packages/**/*.ts',
        'packages/**/*.tsx',
        'packages/**/*.js',
        'packages/**/*.jsx',
        'packages/**/*.json',
      ],
      denied: [
        ...BLOCKED_FILE_PATTERNS,
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        '.github/workflows/**',
      ],
    },
  };
}

function createDocWriterFilePermissions(): FilePermissions {
  return {
    read: {
      allowed: ['**/*'],
      denied: [...BLOCKED_FILE_PATTERNS],
    },
    write: {
      allowed: [
        'docs/**/*',
        '*.md',
        '**/README.md',
        '**/CHANGELOG.md',
        '**/CONTRIBUTING.md',
        '**/*.mdx',
      ],
      denied: [...BLOCKED_FILE_PATTERNS],
    },
  };
}

function createTesterFilePermissions(): FilePermissions {
  return {
    read: {
      allowed: ['**/*'],
      denied: [...BLOCKED_FILE_PATTERNS],
    },
    write: {
      allowed: [
        'tests/**/*',
        '__tests__/**/*',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.test.tsx',
        '**/*.spec.tsx',
        '**/test/**/*',
        'coverage/**/*',
      ],
      denied: [...BLOCKED_FILE_PATTERNS],
    },
  };
}

function createNoCommandPermissions(): CommandPermissions {
  return {
    allowed: [],
    denied: [...BLOCKED_COMMANDS, '*'],
    patterns: {
      allow: [],
      deny: ['.*'],
    },
  };
}

function createImplementerCommandPermissions(): CommandPermissions {
  return {
    allowed: [
      'npm install',
      'npm test',
      'npm run *',
      'pnpm install',
      'pnpm test',
      'pnpm run *',
      'pnpm *',
      'yarn install',
      'yarn test',
      'yarn run *',
      'git status',
      'git diff',
      'git add *',
      'git commit *',
      'git push *',
      'git checkout *',
      'git branch *',
      'git log *',
      'git fetch *',
      'git pull *',
      'tsc *',
      'eslint *',
      'prettier *',
      'vitest *',
      'jest *',
    ],
    denied: [...BLOCKED_COMMANDS],
    patterns: {
      allow: [
        '^npm\\s+(install|test|run|ci|audit|outdated|ls|list)',
        '^pnpm\\s+(install|test|run|add|remove|update|audit|outdated|ls|list|exec|dlx)',
        '^yarn\\s+(install|test|run|add|remove|upgrade)',
        '^git\\s+(status|diff|add|commit|push|pull|fetch|checkout|branch|log|stash|merge|rebase)',
        '^tsc\\b',
        '^eslint\\b',
        '^prettier\\b',
        '^vitest\\b',
        '^jest\\b',
        '^node\\b',
        '^npx\\s+',
      ],
      deny: [
        '^rm\\s+-rf\\s+/',
        '^sudo\\b',
        '^su\\b',
        'curl.*\\|\\s*(bash|sh)',
        'wget.*\\|\\s*(bash|sh)',
        '^chmod\\s+777',
        '^mkfs',
        '^dd\\s+if=',
      ],
    },
  };
}

function createTesterCommandPermissions(): CommandPermissions {
  return {
    allowed: [
      'npm test',
      'npm run test*',
      'pnpm test',
      'pnpm run test*',
      'vitest *',
      'jest *',
      'playwright *',
    ],
    denied: [...BLOCKED_COMMANDS, 'npm install*', 'npm uninstall*', 'pnpm add*', 'pnpm remove*'],
    patterns: {
      allow: [
        '^npm\\s+test',
        '^npm\\s+run\\s+test',
        '^pnpm\\s+test',
        '^pnpm\\s+run\\s+test',
        '^vitest\\b',
        '^jest\\b',
        '^playwright\\b',
      ],
      deny: ['^npm\\s+(install|uninstall)', '^pnpm\\s+(add|remove|install)'],
    },
  };
}

function createDefaultAPIPermissions(): APIPermissions {
  return {
    allowed: ['https://api.github.com/**', 'https://registry.npmjs.org/**'],
    denied: ['*://localhost/**', '*://localhost:*/**', '*://127.0.0.1/**', '*://127.0.0.1:*/**', '*://0.0.0.0/**', '*://0.0.0.0:*/**'],
    requireApproval: [],
  };
}

function createNoGitPermissions(): GitPermissions {
  return {
    canCommit: false,
    canPush: false,
    canCreateBranch: false,
    canMerge: false,
    canDeleteBranch: false,
    canRebase: false,
    canForcePush: false,
    protectedBranches: [...PROTECTED_BRANCHES],
  };
}

function createImplementerGitPermissions(): GitPermissions {
  return {
    canCommit: true,
    canPush: true,
    canCreateBranch: true,
    canMerge: false,
    canDeleteBranch: false,
    canRebase: false,
    canForcePush: false,
    protectedBranches: [...PROTECTED_BRANCHES],
  };
}

function createDefaultResourceLimits(): ResourceLimits {
  return {
    maxTokensPerTask: 100000,
    maxBudgetPerTask: 5.0,
    maxDurationMinutes: 60,
    maxFilesModified: 20,
    maxLinesChanged: 2000,
    maxConcurrentTasks: 1,
  };
}

function createImplementerResourceLimits(): ResourceLimits {
  return {
    maxTokensPerTask: 200000,
    maxBudgetPerTask: 15.0,
    maxDurationMinutes: 120,
    maxFilesModified: 50,
    maxLinesChanged: 5000,
    maxConcurrentTasks: 1,
  };
}

// ============================================
// Agent Type Default Permission Sets
// ============================================

function createScrumMasterDefaults(): AgentPermissionSet {
  return {
    agentType: 'scrum_master',
    scope: 'global',
    tools: createReadOnlyToolPermissions(),
    files: createReadOnlyFilePermissions(),
    commands: createNoCommandPermissions(),
    apis: createDefaultAPIPermissions(),
    git: createNoGitPermissions(),
    resources: createDefaultResourceLimits(),
  };
}

function createArchitectDefaults(): AgentPermissionSet {
  return {
    agentType: 'architect',
    scope: 'global',
    tools: {
      ...createReadOnlyToolPermissions(),
      allowed: [...READ_ONLY_TOOLS, 'Write', 'Edit'],
      denied: ['Bash', 'NotebookEdit'],
    },
    files: {
      read: {
        allowed: ['**/*'],
        denied: [...BLOCKED_FILE_PATTERNS],
      },
      write: {
        allowed: ['docs/**/*', '*.md', 'architecture/**/*', 'design/**/*'],
        denied: [...BLOCKED_FILE_PATTERNS, 'src/**/*', 'lib/**/*'],
      },
    },
    commands: createNoCommandPermissions(),
    apis: createDefaultAPIPermissions(),
    git: createNoGitPermissions(),
    resources: createDefaultResourceLimits(),
  };
}

function createResearcherDefaults(): AgentPermissionSet {
  return {
    agentType: 'researcher',
    scope: 'global',
    tools: createReadOnlyToolPermissions(),
    files: createReadOnlyFilePermissions(),
    commands: createNoCommandPermissions(),
    apis: {
      allowed: ['https://*'],
      denied: ['*://localhost/*', '*://127.0.0.1/*', '*://0.0.0.0/*'],
      requireApproval: [],
    },
    git: createNoGitPermissions(),
    resources: createDefaultResourceLimits(),
  };
}

function createAnalystDefaults(): AgentPermissionSet {
  return {
    agentType: 'analyst',
    scope: 'global',
    tools: createReadOnlyToolPermissions(),
    files: createReadOnlyFilePermissions(),
    commands: createNoCommandPermissions(),
    apis: createDefaultAPIPermissions(),
    git: createNoGitPermissions(),
    resources: createDefaultResourceLimits(),
  };
}

function createPlannerDefaults(): AgentPermissionSet {
  return {
    agentType: 'planner',
    scope: 'global',
    tools: createReadOnlyToolPermissions(),
    files: createReadOnlyFilePermissions(),
    commands: createNoCommandPermissions(),
    apis: createDefaultAPIPermissions(),
    git: createNoGitPermissions(),
    resources: createDefaultResourceLimits(),
  };
}

function createImplementerDefaults(): AgentPermissionSet {
  return {
    agentType: 'implementer',
    scope: 'global',
    tools: createFullToolPermissions(),
    files: createImplementerFilePermissions(),
    commands: createImplementerCommandPermissions(),
    apis: createDefaultAPIPermissions(),
    git: createImplementerGitPermissions(),
    resources: createImplementerResourceLimits(),
  };
}

function createReviewerDefaults(): AgentPermissionSet {
  return {
    agentType: 'reviewer',
    scope: 'global',
    tools: createReadOnlyToolPermissions(),
    files: createReadOnlyFilePermissions(),
    commands: createNoCommandPermissions(),
    apis: createDefaultAPIPermissions(),
    git: createNoGitPermissions(),
    resources: createDefaultResourceLimits(),
  };
}

function createTesterDefaults(): AgentPermissionSet {
  return {
    agentType: 'tester',
    scope: 'global',
    tools: {
      allowed: [...READ_ONLY_TOOLS, 'Write', 'Edit', 'Bash'],
      denied: ['NotebookEdit'],
      requireApproval: [],
    },
    files: createTesterFilePermissions(),
    commands: createTesterCommandPermissions(),
    apis: createDefaultAPIPermissions(),
    git: createNoGitPermissions(),
    resources: createDefaultResourceLimits(),
  };
}

function createDocumenterDefaults(): AgentPermissionSet {
  return {
    agentType: 'documenter',
    scope: 'global',
    tools: {
      ...createReadOnlyToolPermissions(),
      allowed: [...READ_ONLY_TOOLS, 'Write', 'Edit'],
      denied: ['Bash', 'NotebookEdit'],
    },
    files: createDocWriterFilePermissions(),
    commands: createNoCommandPermissions(),
    apis: createDefaultAPIPermissions(),
    git: createNoGitPermissions(),
    resources: createDefaultResourceLimits(),
  };
}

// ============================================
// Default Permissions Map
// ============================================

const DEFAULT_PERMISSIONS: Record<AgentType, () => AgentPermissionSet> = {
  scrum_master: createScrumMasterDefaults,
  architect: createArchitectDefaults,
  researcher: createResearcherDefaults,
  analyst: createAnalystDefaults,
  planner: createPlannerDefaults,
  implementer: createImplementerDefaults,
  reviewer: createReviewerDefaults,
  tester: createTesterDefaults,
  documenter: createDocumenterDefaults,
};

/**
 * Get the default permission set for an agent type
 */
export function getDefaultPermissions(agentType: AgentType): AgentPermissionSet {
  const factory = DEFAULT_PERMISSIONS[agentType];
  if (!factory) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }
  return factory();
}

/**
 * Get all default permissions for all agent types
 */
export function getAllDefaultPermissions(): Map<AgentType, AgentPermissionSet> {
  const map = new Map<AgentType, AgentPermissionSet>();
  for (const agentType of Object.keys(DEFAULT_PERMISSIONS) as AgentType[]) {
    map.set(agentType, getDefaultPermissions(agentType));
  }
  return map;
}

/**
 * Get list of all agent types
 */
export function getAllAgentTypes(): AgentType[] {
  return Object.keys(DEFAULT_PERMISSIONS) as AgentType[];
}
