# Task Completion Checklist

When completing a development task, run these commands to ensure quality:

## 1. Type Checking
```bash
pnpm typecheck
```
Ensures all TypeScript types are correct.

## 2. Linting
```bash
pnpm lint
```
Check for code style violations. Fix with `pnpm lint:fix`.

## 3. Formatting
```bash
pnpm format:check
```
Verify code is properly formatted. Fix with `pnpm format`.

## 4. Testing
```bash
pnpm test
```
Run the full test suite. All tests must pass.

## 5. Build
```bash
pnpm build
```
Ensure the project builds successfully.

## Full Validation Command
```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

## Before Committing
1. Ensure all checks pass
2. Write meaningful commit messages
3. Reference issue numbers where applicable
4. Follow conventional commit format if applicable
