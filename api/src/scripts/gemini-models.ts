import { listGeminiModels } from '../ai/gemini-client.js';

/** Lists the Gemini models this key can call (to pick GEMINI_MODEL_FAST / GEMINI_MODEL_SMART). */
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
console.log((await listGeminiModels(apiKey)).join('\n'));
