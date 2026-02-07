/**
 * Git Hook Installer
 *
 * Installs and uninstalls git hooks (post-commit, post-merge) that
 * trigger incremental re-indexing of the codebase.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Git hook configuration
 */
export interface GitHookConfig {
  /** Path to the project root (must contain .git directory) */
  projectRoot: string;
  /** Command to run on hook trigger (default: node-based re-index script) */
  triggerCommand?: string;
  /** Hooks to install (default: ['post-commit', 'post-merge']) */
  hooks?: string[];
}

/**
 * Result of a hook install/uninstall operation
 */
export interface GitHookResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Hooks that were modified */
  installedHooks: string[];
  /** Errors encountered */
  errors: string[];
}

/**
 * Marker used to identify Tamma-managed hook content
 */
const TAMMA_HOOK_MARKER = '# TAMMA_INDEXER_HOOK';

/**
 * Pattern for safe trigger commands.
 * Allows word characters, spaces, dots, hyphens, forward slashes, and
 * a limited set of shell-safe characters (=, >, for redirection to /dev/null).
 * Rejects dangerous shell metacharacters: ; | & $ ` ( ) { } < \n
 */
const SHELL_METACHAR_PATTERN = /[;|&$`(){}<\n]/;

/**
 * Validate that a trigger command does not contain shell metacharacters
 * that could lead to command injection.
 *
 * @param command - The trigger command to validate
 * @throws Error if the command contains dangerous shell metacharacters
 */
export function validateTriggerCommand(command: string): void {
  if (SHELL_METACHAR_PATTERN.test(command)) {
    throw new Error(
      `Unsafe trigger command rejected: command contains shell metacharacters. ` +
      `Disallowed characters: ; | & $ \` ( ) { } < and newlines. ` +
      `Received: ${command}`,
    );
  }
}

/**
 * Default hook content template
 */
function getDefaultHookScript(triggerCommand: string): string {
  return `#!/bin/sh
${TAMMA_HOOK_MARKER}
# Auto-installed by @tamma/intelligence codebase indexer
# This hook triggers incremental re-indexing after git operations.
# To remove, run: tamma indexer uninstall-hooks

${triggerCommand}
`;
}

/**
 * Git hook installer for triggering re-indexing
 */
export class GitHookInstaller {
  private projectRoot: string;
  private triggerCommand: string;
  private hooks: string[];

  constructor(config: GitHookConfig) {
    this.projectRoot = path.resolve(config.projectRoot);
    this.triggerCommand = config.triggerCommand ??
      'npx tamma-reindex --incremental 2>/dev/null || true';

    // Validate user-supplied trigger commands to prevent shell injection.
    // Only validate when a custom command is provided; the default is trusted.
    if (config.triggerCommand !== undefined) {
      validateTriggerCommand(config.triggerCommand);
    }

    this.hooks = config.hooks ?? ['post-commit', 'post-merge'];
  }

  /**
   * Get the path to the .git/hooks directory
   */
  private getHooksDir(): string {
    return path.join(this.projectRoot, '.git', 'hooks');
  }

  /**
   * Check if the project has a .git directory
   */
  isGitRepo(): boolean {
    try {
      fs.accessSync(path.join(this.projectRoot, '.git'), fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Install git hooks for triggering re-indexing
   *
   * If a hook file already exists and is not managed by Tamma,
   * the trigger command is appended to the existing hook.
   *
   * @returns Result of the installation
   */
  async install(): Promise<GitHookResult> {
    const result: GitHookResult = {
      success: true,
      installedHooks: [],
      errors: [],
    };

    if (!this.isGitRepo()) {
      result.success = false;
      result.errors.push('Not a git repository');
      return result;
    }

    const hooksDir = this.getHooksDir();

    // Ensure hooks directory exists
    try {
      await fs.promises.mkdir(hooksDir, { recursive: true });
    } catch (error) {
      result.success = false;
      result.errors.push(`Failed to create hooks directory: ${(error as Error).message}`);
      return result;
    }

    for (const hookName of this.hooks) {
      const hookPath = path.join(hooksDir, hookName);

      try {
        let existingContent = '';
        let fileExists = false;

        try {
          existingContent = await fs.promises.readFile(hookPath, 'utf-8');
          fileExists = true;
        } catch {
          // File doesn't exist, which is fine
        }

        // Skip if already installed
        if (existingContent.includes(TAMMA_HOOK_MARKER)) {
          result.installedHooks.push(hookName);
          continue;
        }

        let newContent: string;

        if (fileExists && existingContent.trim().length > 0) {
          // Append to existing hook
          newContent = existingContent.trimEnd() + '\n\n' +
            `${TAMMA_HOOK_MARKER}\n` +
            `# Added by @tamma/intelligence codebase indexer\n` +
            `${this.triggerCommand}\n`;
        } else {
          // Create new hook
          newContent = getDefaultHookScript(this.triggerCommand);
        }

        await fs.promises.writeFile(hookPath, newContent, { mode: 0o755 });
        result.installedHooks.push(hookName);
      } catch (error) {
        result.success = false;
        result.errors.push(`Failed to install ${hookName} hook: ${(error as Error).message}`);
      }
    }

    return result;
  }

  /**
   * Uninstall git hooks managed by Tamma
   *
   * If the hook was created entirely by Tamma, the file is removed.
   * If the hook existed before Tamma, only the Tamma section is removed.
   *
   * @returns Result of the uninstallation
   */
  async uninstall(): Promise<GitHookResult> {
    const result: GitHookResult = {
      success: true,
      installedHooks: [],
      errors: [],
    };

    if (!this.isGitRepo()) {
      result.success = false;
      result.errors.push('Not a git repository');
      return result;
    }

    const hooksDir = this.getHooksDir();

    for (const hookName of this.hooks) {
      const hookPath = path.join(hooksDir, hookName);

      try {
        let content: string;
        try {
          content = await fs.promises.readFile(hookPath, 'utf-8');
        } catch {
          // Hook doesn't exist, nothing to uninstall
          continue;
        }

        if (!content.includes(TAMMA_HOOK_MARKER)) {
          // Not managed by Tamma
          continue;
        }

        // Check if the entire hook is Tamma-managed
        const lines = content.split('\n');
        const tammaLineIndex = lines.findIndex((line) => line.includes(TAMMA_HOOK_MARKER));

        if (tammaLineIndex <= 1) {
          // Tamma marker is at the start (after shebang) - remove entire file
          await fs.promises.unlink(hookPath);
        } else {
          // Remove only the Tamma section (from marker to end or next section)
          const cleanedLines: string[] = [];
          let inTammaSection = false;

          for (const line of lines) {
            if (line.includes(TAMMA_HOOK_MARKER)) {
              inTammaSection = true;
              continue;
            }

            if (inTammaSection) {
              // Skip lines that are part of the Tamma section
              // (comments starting with # Added by @tamma or the trigger command)
              if (line.startsWith('# Added by @tamma') || line === this.triggerCommand) {
                continue;
              }
              // End of Tamma section
              inTammaSection = false;
            }

            cleanedLines.push(line);
          }

          const cleanedContent = cleanedLines.join('\n').trimEnd() + '\n';
          await fs.promises.writeFile(hookPath, cleanedContent, { mode: 0o755 });
        }

        result.installedHooks.push(hookName);
      } catch (error) {
        result.success = false;
        result.errors.push(`Failed to uninstall ${hookName} hook: ${(error as Error).message}`);
      }
    }

    return result;
  }

  /**
   * Check which hooks are currently installed
   *
   * @returns Array of hook names that have Tamma triggers installed
   */
  async getInstalledHooks(): Promise<string[]> {
    const installed: string[] = [];
    const hooksDir = this.getHooksDir();

    for (const hookName of this.hooks) {
      const hookPath = path.join(hooksDir, hookName);
      try {
        const content = await fs.promises.readFile(hookPath, 'utf-8');
        if (content.includes(TAMMA_HOOK_MARKER)) {
          installed.push(hookName);
        }
      } catch {
        // Hook doesn't exist
      }
    }

    return installed;
  }
}

/**
 * Create a git hook installer instance
 *
 * @param config - Hook configuration
 * @returns GitHookInstaller instance
 */
export function createGitHookInstaller(config: GitHookConfig): GitHookInstaller {
  return new GitHookInstaller(config);
}
