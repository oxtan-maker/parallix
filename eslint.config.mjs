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
];

export default [
  // Top-level ignores for directories only (no per-dir *.js globs)
  {
    ignores: [
      'dist/',
      'node_modules/',
      'graphify-out/',
      '.forgejo-local/',
    ],
  },
  // Lint all .ts source files while excluding generated distribution output.
  {
    files: ['**/*.ts'],
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
        __filename: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
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
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Lint TypeScript JSX files (.tsx) with the TypeScript parser and JSX support.
  {
    files: ['**/*.tsx'],
    ignores: generatedOutputIgnores,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __filename: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
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
      '@typescript-eslint/no-require-imports': 'off',
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
        __filename: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
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
