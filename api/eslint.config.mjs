import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const ban = (patterns, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: patterns, message }] }],
});

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/domain/**'],
    rules: ban(
      ['**/db/**', '**/repositories/**', '**/services/**', '**/ai/**', '**/integrations/**', '**/routes/**', 'fastify', 'drizzle-orm*', 'postgres', '@anthropic-ai/*'],
      'domain/ must be pure: no I/O, db, AI or framework imports.',
    ),
  },
  {
    files: ['src/routes/**'],
    rules: ban(['**/db/**', '**/repositories/**', 'drizzle-orm*', 'postgres'], 'routes/ call services; they never touch the db.'),
  },
  {
    files: ['src/ai/**'],
    ignores: ['src/ai/llm-client.ts'],
    rules: ban(['@anthropic-ai/*'], 'Only ai/llm-client.ts may import the Anthropic SDK.'),
  },
  {
    files: ['src/**'],
    ignores: ['src/repositories/**', 'src/db/**', 'src/app.ts', 'src/server.ts', 'src/worker.ts'],
    rules: ban(['drizzle-orm*'], 'Only repositories/ (and db/) may touch Drizzle.'),
  },
);
