// Flat ESLint configuration for TypeScript + Jest in a CDK project
// See: https://eslint.org/docs/latest/use/configure/configuration-files-new
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Resolve root directory for type-aware linting
const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default [
  // Ignore generated / dependency directories
  {
    ignores: ['cdk.out', 'node_modules', '**/*.d.ts'],
  },
  // Base recommended JS rules
  js.configs.recommended,
  // TypeScript strict + stylistic configs (scoped to TS files only)
  ...[...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked].map((c) => ({
    ...c,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  // Project specific TypeScript overrides
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir,
      },
    },
    rules: {
      // Prefer explicit type-only imports
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Common safety rules for async code
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Allow unused underscore-prefixed variables (often in callbacks)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // CDK patterns frequently use classes / decorators; adjust strictness as needed
      '@typescript-eslint/explicit-member-accessibility': ['off'],
      // disable quote enforcement (handled by Prettier)
      quotes: ['off'],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
        },
      ],
    },
  },
  // Test files: provide Jest globals (plugin removed for ESLint v9 compatibility)
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: {
        jest: true,
        expect: true,
        beforeAll: true,
        afterAll: true,
        beforeEach: true,
        afterEach: true,
        describe: true,
        it: true,
      },
    },
    rules: {},
  },
  // Jest config file (CommonJS) - define Node/CommonJS globals
  {
    files: ['jest.config.js'],
    languageOptions: {
      globals: {
        module: true,
        exports: true,
        require: true,
        __dirname: true,
        process: true,
      },
      sourceType: 'commonjs',
    },
    rules: {},
  },
  // Integrate Prettier: disable formatting rules conflicting with Prettier
  prettierRecommended,
];
