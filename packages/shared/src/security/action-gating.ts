/**
 * Action gating for autonomous agent command execution.
 *
 * Provides a security gate that checks proposed shell commands or tool
 * invocations against a configurable blocklist of dangerous patterns.
 * When the autonomous agent proposes executing a command, the action
 * gating layer determines whether to allow or block it.
 *
 * Design decisions:
 * - Uses case-insensitive **substring** matching (NOT regex) to eliminate
 *   ReDoS risk and simplify auditing.
 * - Whitespace is normalized before matching to prevent bypass via extra spaces.
 * - Shell metacharacter patterns prevent common bypass techniques where
 *   attackers pipe commands to a shell interpreter.
 * - Reason messages do NOT reveal which pattern matched, preventing attackers
 *   from probing the blocklist.
 *
 * @module
 */

/**
 * Default blocked command patterns.
 *
 * Each pattern is matched as a case-insensitive substring against the
 * normalized command string. Substring matching is intentional -- it is
 * better to over-block than under-block for destructive commands.
 *
 * Categories:
 * - Destructive filesystem operations (rm -rf, mkfs, dd, format)
 * - System control commands (shutdown, reboot, halt, poweroff, init)
 * - Process killing (kill -9 1, killall, pkill)
 * - Dangerous permissions (chmod -R 777, chown -R)
 * - Device/filesystem manipulation (> /dev/sda, mv /)
 * - Remote code execution (wget/curl piped to sh/bash)
 * - Shell metacharacter bypass-prevention patterns (| sh, | bash, | eval, base64 -d |, $()
 * - Fork bomb pattern
 */
export const DEFAULT_BLOCKED_COMMANDS: readonly string[] = [
  'rm -rf /',
  'rm -rf ~',
  'rm -rf *',
  'rm -fr /',           // alternate flag order
  'rm -fr ~',
  'rm -fr *',
  'mkfs',
  'dd if=',
  'format c:',
  ':(){:|:&};:',        // fork bomb
  'chmod -r 777 /',
  'chown -r',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init 0',
  'init 6',
  'kill -9 1',
  'killall',
  'pkill -9',
  'pkill -kill',
  '> /dev/sda',
  'mv / ',
  'wget | sh',
  'curl | sh',
  'curl | bash',
  'wget | bash',
  // Shell metacharacter bypass-prevention patterns
  '| sh',
  '| bash',
  '| eval',
  '| /bin/sh',          // full path shell pipes
  '| /bin/bash',
  '| /usr/bin/sh',
  '| /usr/bin/bash',
  '| /usr/bin/env sh',
  '| /usr/bin/env bash',
  'base64 -d |',
  '$(',                 // command substitution
  '${',                 // shell variable expansion
  '| python',           // piped to interpreters
  '| perl',
  '| ruby',
  '| node',
] as const;

/**
 * Options for configuring the action gate.
 */
export interface ActionGateOptions {
  /** Additional patterns appended to DEFAULT_BLOCKED_COMMANDS */
  extraPatterns?: readonly string[];
  /** Replace defaults entirely (use with caution). Default: false */
  replaceDefaults?: boolean;
}

/**
 * Result of evaluating an action against the security gate.
 */
export interface ActionEvaluation {
  /** Whether the action is allowed to proceed */
  allowed: boolean;
  /** Reason for blocking (only present when allowed is false) */
  reason?: string;
}

/**
 * Security reason message for blocked commands.
 * Generic message that does NOT reveal which pattern matched,
 * preventing attackers from probing the blocklist.
 */
const BLOCKED_REASON = 'Command blocked by security policy';

/**
 * Evaluate a proposed command against the security gate.
 *
 * The function:
 * 1. Normalizes whitespace (trim, lowercase, collapse multiple spaces)
 * 2. Checks the command against blocked patterns using case-insensitive substring matching
 * 3. Checks for backtick command execution
 *
 * This function never throws. It returns `{ allowed: false, reason }` for
 * blocked commands and `{ allowed: true }` for allowed commands.
 *
 * @param command - The command string to evaluate
 * @param options - Optional configuration for additional/replacement patterns
 * @returns ActionEvaluation indicating whether the command is allowed
 */
export function evaluateAction(
  command: string,
  options?: ActionGateOptions,
): ActionEvaluation {
  try {
    const patterns = options?.replaceDefaults === true
      ? (options.extraPatterns ?? [])
      : [...DEFAULT_BLOCKED_COMMANDS, ...(options?.extraPatterns ?? [])];

    // Normalize before matching:
    // 1. Trim leading/trailing whitespace
    // 2. Convert to lowercase for case-insensitive matching
    // 3. Strip backslashes (prevents evasion via r\m, c\url, etc.)
    // 4. Strip empty quote pairs (prevents evasion via r""m, r''m, etc.)
    // 5. Collapse multiple spaces into single space
    const normalized = command
      .trim()
      .toLowerCase()
      .replace(/\\/g, '')
      .replace(/""/g, '')
      .replace(/''/g, '')
      .replace(/\s+/g, ' ');

    for (const pattern of patterns) {
      if (normalized.includes(pattern.toLowerCase())) {
        return {
          allowed: false,
          // Security: do NOT reveal which pattern matched
          reason: BLOCKED_REASON,
        };
      }
    }

    // Check for backtick execution (not in DEFAULT_BLOCKED_COMMANDS
    // because backtick is a single character, not a meaningful substring pattern)
    if (normalized.includes('`')) {
      return {
        allowed: false,
        reason: BLOCKED_REASON,
      };
    }

    return { allowed: true };
  } catch {
    // Never throw -- if something goes wrong during evaluation,
    // block the command as a safety measure
    return {
      allowed: false,
      reason: BLOCKED_REASON,
    };
  }
}
