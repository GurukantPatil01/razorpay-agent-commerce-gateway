/**
 * Vercel AI SDK Adapter
 *
 * Converts core tool definitions to Vercel AI SDK format.
 * Works with any Vercel AI SDK compatible model (Gemini, OpenAI, Anthropic, etc.)
 *
 * Usage:
 *   import { vercelTools } from './adapters/vercel';
 *   import { google } from '@ai-sdk/google';
 *   generateText({ model: google('gemini-2.0-flash'), tools: vercelTools, ... });
 */

import { tool } from 'ai';
import { allTools, arcTools, commerceTools } from '../core';

// Convert all core tools (both commerce and legacy arc tools) to Vercel AI SDK format
export const vercelTools = Object.fromEntries(
  Object.entries(allTools).map(([key, t]) => [
    key,
    tool({
      description: t.description,
      inputSchema: t.inputSchema,
      execute: t.execute,
    }),
  ])
);

// Re-export for convenience
export { allTools, arcTools, commerceTools } from '../core';

