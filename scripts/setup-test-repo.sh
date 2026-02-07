#!/usr/bin/env bash
set -euo pipefail

# Bootstrap the Tam-ma/tamma-test repository with a minimal TypeScript project
# and labeled issues for E2E testing.
#
# Prerequisites:
#   - gh CLI authenticated with access to Tam-ma/tamma-test
#   - Git configured with push access
#
# Usage:
#   ./scripts/setup-test-repo.sh

OWNER="Tam-ma"
REPO="tamma-test"
REMOTE="https://github.com/${OWNER}/${REPO}.git"
TMPDIR=$(mktemp -d)
LABEL="tamma"

cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

echo "==> Cloning ${OWNER}/${REPO} into ${TMPDIR}..."
git clone "$REMOTE" "$TMPDIR/repo"
cd "$TMPDIR/repo"

# Ensure the tamma label exists
echo "==> Ensuring '${LABEL}' label exists..."
gh label create "$LABEL" --description "Tamma managed issue" --color "0075ca" --repo "${OWNER}/${REPO}" 2>/dev/null || true
gh label create "bug" --description "Bug report" --color "d73a4a" --repo "${OWNER}/${REPO}" 2>/dev/null || true

# Create project files
echo "==> Creating project files..."

cat > package.json << 'PKGJSON'
{
  "name": "tamma-test",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "~5.7.2",
    "vitest": "^3.0.0"
  }
}
PKGJSON

cat > tsconfig.json << 'TSCONFIG'
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
TSCONFIG

mkdir -p src

cat > src/greeting.ts << 'GREETING'
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
GREETING

cat > src/greeting.test.ts << 'GREETTEST'
import { describe, it, expect } from 'vitest';
import { greet } from './greeting.js';

describe('greet', () => {
  it('should greet by name', () => {
    expect(greet('World')).toBe('Hello, World!');
  });

  it('should handle empty name', () => {
    expect(greet('')).toBe('Hello, !');
  });
});
GREETTEST

mkdir -p .github/workflows

cat > .github/workflows/ci.yml << 'CIFILE'
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install
      - run: npx vitest run
      - run: npx tsc --noEmit
CIFILE

# Commit and push
echo "==> Committing and pushing..."
git add -A
git commit -m "chore: bootstrap test project for E2E testing"
git push origin main

# Create test issues
echo "==> Creating test issues..."

gh issue create \
  --repo "${OWNER}/${REPO}" \
  --title "Add farewell function" \
  --body "Add a \`farewell(name: string): string\` function to \`src/greeting.ts\` that returns \`Goodbye, {name}!\`. Include tests in \`src/greeting.test.ts\`." \
  --label "$LABEL"

gh issue create \
  --repo "${OWNER}/${REPO}" \
  --title "Add uppercase greeting option" \
  --body "Update \`greet()\` in \`src/greeting.ts\` to accept an optional \`uppercase: boolean\` parameter. When true, return the greeting in UPPERCASE. Add tests." \
  --label "$LABEL"

gh issue create \
  --repo "${OWNER}/${REPO}" \
  --title "Fix typo in greeting" \
  --body "The greeting function works but there is no exclamation mark validation. Add a test that verifies the greeting ends with '!' and ensure the function always includes it." \
  --label "$LABEL" \
  --label "bug"

echo "==> Done! Test repo bootstrapped at ${OWNER}/${REPO}"
echo "    Issues created: #1, #2, #3"
