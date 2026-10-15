import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

const ignorePattern = '^_';
const argsIgnorePattern = '^_|^name$';
const caughtErrorsIgnorePattern = '^_';
const varsIgnorePattern = '^_';

const generatedOutputIgnores = [
  // Distribution output from the TypeScript build.
  'dist/',
  'node_modules/',
  'graphify-out/',
  '.forgejo-local/',
  // Third-party skill-marketplace caches dropped under .workflow/ (gitignored);
  // never project source, must not fail the repo lint.
  '.workflow/',
];

const sourceFiles = ['src/**/*.{ts,tsx}', 'web/**/*.{ts,tsx}'];

const sourceRules = {
  'no-undef': 'error',
  // Core no-unused-vars cannot see type-only positions (type alias parameter
  // names, imported types used only in annotations), so it reports false
  // positives on TypeScript sources. The type-aware rule owns this for .ts/.tsx.
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern, varsIgnorePattern, caughtErrorsIgnorePattern }],
  'valid-typeof': 'error',
  'no-unreachable': 'error',
  'no-async-promise-executor': 'error',
  'eqeqeq': 'error',
  'curly': 'error',
  'no-var': 'error',
  '@typescript-eslint/no-require-imports': 'off',
  // Promise handling is enforced as an error.
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  // Type safety is enforced as an error; the gate also rejects warnings.
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'error',
  complexity: ['error', 15],
  'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: true }],
};

export default [
  // Top-level ignores for directories only (no per-dir *.js globs)
  {
    ignores: [
      'dist/',
      'node_modules/',
      'graphify-out/',
      '.forgejo-local/',
      '.workflow/',
    ],
  },
  // Type-aware rules apply only to production source. projectService discovers
  // the owning tsconfig without pulling test files into the type-aware program.
  {
    files: sourceFiles,
    ignores: generatedOutputIgnores,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        projectService: true,
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        BufferEncoding: 'readonly',
        NodeJS: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        fetch: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    linterOptions: { noInlineConfig: true },
    rules: sourceRules,
  },
  // Browser globals and callback-shape declarations belong to the web adapter.
  // TypeScript owns unused declarations there; the core ESLint rule does not
  // understand its type-only positions.
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        queueMicrotask: 'readonly',
        requestAnimationFrame: 'readonly',
        React: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
  // Lint remaining JavaScript while excluding generated distribution output.
  {
    files: ['**/*.js'],
    ignores: generatedOutputIgnores,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        BufferEncoding: 'readonly',
        NodeJS: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        fetch: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern, varsIgnorePattern, caughtErrorsIgnorePattern }],
      'valid-typeof': 'error',
      'no-unreachable': 'error',
      'no-async-promise-executor': 'error',
      'eqeqeq': 'error',
      'curly': 'error',
      'no-var': 'error',
    },
  },
];
