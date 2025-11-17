# Quick Start: Testing Guide

A quick reference for running tests and using the enhanced testing infrastructure.

## Quick Commands

### Database

```bash
# Seed local database with test data
pnpm db:seed

# Reset database (migrate + seed)
pnpm db:reset

# Seed production database (⚠️ USE WITH CAUTION)
pnpm db:seed:remote
```

### E2E Tests

```bash
# Run all E2E tests
pnpm test:e2e

# Interactive UI mode
pnpm test:e2e:ui

# Watch browser (headed mode)
pnpm test:e2e:headed

# Debug mode (step through tests)
pnpm test:e2e:debug

# Run specific browser
pnpm test:e2e:chromium
pnpm test:e2e:firefox
pnpm test:e2e:webkit

# View HTML report
pnpm test:e2e:report
```

### Visual Regression

```bash
# Run tests (creates baselines on first run)
pnpm test:e2e

# Update screenshot baselines
pnpm test:e2e:update-snapshots
```

### Performance (Lighthouse)

```bash
# Install Lighthouse CLI
pnpm lighthouse:install

# Run Lighthouse audit (requires running server)
pnpm build && pnpm preview  # Terminal 1
pnpm lighthouse              # Terminal 2
```

### Unit Tests

```bash
# Run unit tests
pnpm test:run

# Watch mode
pnpm test

# Coverage report
pnpm test:coverage

# Coverage with UI
pnpm test:coverage:ui
```

## First-Time Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Install Playwright browsers
pnpm playwright:install

# 3. Setup and seed database
pnpm db:reset

# 4. Build application
pnpm build

# 5. Start development server
pnpm dev

# 6. Run tests (in another terminal)
pnpm test:e2e
```

## Test Data

After running `pnpm db:seed`, you'll have:

### Sample Users
- **admin@tamma.dev** (Admin)
- **editor@tamma.dev** (Editor)
- **reviewer@tamma.dev** (Reviewer)
- **viewer@tamma.dev** (Viewer)

### Sample Documents
- `docs/architecture.md` - System Architecture
- `docs/PRD.md` - Product Requirements
- `docs/epics.md` - Epic Breakdown
- `docs/stories/1-0-ai-provider-strategy-research.md`
- `docs/stories/1-1-ai-provider-interface-definition.md`

### Other Data
- 4 Comments (with threading)
- 2 Suggestions (1 pending, 1 accepted)
- 2 Discussions (with messages)
- 2 Review Sessions
- 3 Activity Log entries

## CI/CD

Tests run automatically in GitHub Actions:

- **Unit Tests**: On every push to main
- **E2E Tests**: On every push to main
- **Lighthouse**: On PRs and pushes to main

## Common Issues

### "Database not seeded"
```bash
pnpm db:reset
```

### "Playwright browsers not installed"
```bash
pnpm playwright:install
```

### "Server not starting"
```bash
# Check if port is in use
lsof -i :8788

# Kill process
kill -9 <PID>
```

### "Visual regression failures"
```bash
# View report to see differences
pnpm test:e2e:report

# Update baselines if changes are intentional
pnpm test:e2e:update-snapshots
```

### "Lighthouse failures"
```bash
# Make sure server is running
pnpm build && pnpm preview

# Check Lighthouse reports in .lighthouseci/
```

## More Information

For detailed documentation, see:
- **TESTING.md** - Comprehensive testing guide
- **ENHANCEMENTS_SUMMARY.md** - Complete list of enhancements
