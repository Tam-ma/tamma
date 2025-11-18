import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts', 'app/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', 'build', '.react-router'],
    globals: true,
    threads: false,
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
    setupFiles: ['./app/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'app/routes/api.*.{ts,tsx}',
        'app/lib/**/*.{ts,tsx}',
      ],
      exclude: [
        'app/**/*.test.{ts,tsx}',
        'app/**/*.spec.{ts,tsx}',
        'app/test/**',
        'app/**/*.d.ts',
        'app/**/types.ts',
        'app/**/schema.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 75,
        statements: 80,
      },
      all: true,
      clean: true,
    },
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './app'),
    },
  },
});
