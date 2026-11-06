import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Layer boundaries. Flat config *replaces* a rule's options when several blocks match a file,
 * so each layer gets exactly one `no-restricted-imports` block with all of its bans combined.
 */
const DRIZZLE = { group: ['drizzle-orm*'], message: 'Only repositories/ (and db/) may touch Drizzle.' };
const SDK = { group: ['@anthropic-ai/*'], message: 'Only ai/llm-client.ts may import the Anthropic SDK.' };
const GEMINI = { group: ['@google/genai*'], message: 'Only ai/gemini-client.ts may import the Google Gen AI SDK.' };

const ban = (...patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**'],
    ignores: ['src/repositories/**', 'src/db/**', 'src/app.ts', 'src/server.ts', 'src/worker.ts', 'src/ai/llm-client.ts', 'src/ai/gemini-client.ts'],
    rules: ban(DRIZZLE, SDK, GEMINI),
  },
  {
    files: ['src/domain/**'],
    rules: ban({
      group: ['**/db/**', '**/repositories/**', '**/services/**', '**/ai/**', '**/integrations/**', '**/routes/**', '**/jobs/**', 'fastify', 'drizzle-orm*', 'postgres', '@anthropic-ai/*', '@google/genai*'],
      message: 'domain/ must be pure: no I/O, db, AI or framework imports.',
    }),
  },
  {
    files: ['src/routes/**'],
    rules: ban(DRIZZLE, SDK, GEMINI, { group: ['**/db/**', '**/repositories/**', 'postgres'], message: 'routes/ call services; they never touch the db.' }),
  },
  {
    // The agent reaches data only through the CoachDataPort it is handed (read methods + create_proposal).
    files: ['src/ai/**'],
    ignores: ['src/ai/llm-client.ts', 'src/ai/gemini-client.ts'],
    rules: ban(DRIZZLE, SDK, GEMINI, {
      group: ['**/db/**', '**/repositories/**', '**/services/**', '**/routes/**', '**/jobs/**', 'postgres'],
      message: 'ai/ gets data only through ai/ports.ts; it cannot import repositories or services (no path to plan writes).',
    }),
  },
  {
    files: ['src/ai/llm-client.ts'],
    rules: ban(DRIZZLE, GEMINI, { group: ['**/db/**', '**/repositories/**', '**/services/**'], message: 'llm-client.ts is a thin SDK adapter.' }),
  },
  {
    files: ['src/ai/gemini-client.ts'],
    rules: ban(DRIZZLE, SDK, { group: ['**/db/**', '**/repositories/**', '**/services/**'], message: 'gemini-client.ts is a thin SDK adapter.' }),
  },
);
