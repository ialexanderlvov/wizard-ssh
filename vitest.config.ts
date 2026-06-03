import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // Exclude the entry point + pure re-export barrels (search/index.ts is
      // real logic and stays included).
      exclude: [
        'src/cli.ts',
        'src/commands/index.ts',
        'src/ssh/index.ts',
        'src/ssh-config/index.ts',
        'src/ui/index.ts',
        // declaration-only files (no runtime code to cover)
        'src/core/types.ts',
        'src/ssh-config/types.ts',
      ],
    },
  },
});
