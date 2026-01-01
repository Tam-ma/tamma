# Code Style and Conventions

## TypeScript Configuration
- **Target**: ES2023
- **Module**: ESNext with bundler resolution
- **Strict mode**: Enabled with all strict checks

### Key Strictness Rules
- `noImplicitAny`: true
- `strictNullChecks`: true
- `noUnusedLocals`: true
- `noUnusedParameters`: true
- `noImplicitReturns`: true
- `noUncheckedIndexedAccess`: true
- `exactOptionalPropertyTypes`: true

## Prettier Configuration
- **Semicolons**: Always
- **Quotes**: Single quotes
- **Print width**: 100 characters
- **Tab width**: 2 spaces (no tabs)
- **Trailing commas**: ES5 style
- **Arrow parens**: Always
- **End of line**: LF

## ESLint Rules

### TypeScript-Specific
- Explicit function return types required (expressions and typed function expressions allowed)
- No `any` type (strict)
- Unused vars must be prefixed with `_`
- No floating promises
- Async functions must be properly awaited
- Strict boolean expressions (no truthy/falsy)

### General
- No console.log (warn/error allowed)
- Prefer const
- No var
- Always use strict equality (`===`)
- Always use curly braces

### Test Files (relaxed)
- `any` type allowed
- Non-null assertions allowed

## Naming Conventions
- **Files**: kebab-case (e.g., `ai-provider.ts`)
- **Classes**: PascalCase
- **Functions/Methods**: camelCase
- **Constants**: UPPER_SNAKE_CASE or camelCase
- **Interfaces/Types**: PascalCase
- **Unused parameters**: Prefix with `_`

## Module System
- ES Modules (`"type": "module"` in package.json)
- Use `import`/`export` syntax
