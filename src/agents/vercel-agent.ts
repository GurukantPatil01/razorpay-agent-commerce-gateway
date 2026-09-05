/**
 * Arc Payment Agent
 *
 * AI agent with autonomous payment capabilities using Circle
 * Developer-Controlled Wallets on Arc blockchain.
 *
 * Built with Vercel AI SDK - works with any compatible model.
 *
 * Usage:
 *   import { runAgent } from './arc-payment-agent';
 *   const result = await runAgent("Create a wallet and check its balance");
 *
 *   // Or with a different model:
 *   import { openai } from '@ai-sdk/openai';
 *   const result = await runAgent("...", { model: openai('gpt-4o') });
 */

import { generateText, streamText, stepCountIs, ToolLoopAgent, InferAgentUIMessage, type LanguageModel } from 'ai';
import { google } from '@ai-sdk/google';
import { vercelTools } from '../tools/adapters/vercel';

// Agent configuration
export interface AgentConfig {
  model?: LanguageModel;
  maxSteps?: number;
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are an AI agent with autonomous payment capabilities on the Arc blockchain.

You can:
- Create and manage Circle Developer-Controlled Wallets
- Check wallet balances (USDC, EURC)
- Request testnet tokens from the faucet
- Transfer USDC to other addresses
- Pay for paywalled content using the x402 protocol

When asked to pay for content, use arc_pay_for_content with the wallet_id and URL.
Always confirm payment amounts before executing transfers.`;

/**
 * Run the Arc Payment Agent
 *
 * @param prompt - User message/instruction
 * @param config - Optional agent configuration
 * @returns Agent response text and tool results
 */
export async function runAgent(prompt: string, config: AgentConfig = {}) {
  const {
    model = google('gemini-2.5-flash'),
    maxSteps = 10,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
  } = config;

  const result = await generateText({
    model,
    tools: vercelTools,
    stopWhen: stepCountIs(maxSteps),
    system: systemPrompt,
    prompt,
  });

  return {
    text: result.text,
    toolResults: result.toolResults,
    steps: result.steps,
    usage: result.usage,
  };
}

/**
 * Stream the Arc Payment Agent response
 *
 * @param prompt - User message/instruction
 * @param config - Optional agent configuration
 */
export async function streamAgent(prompt: string, config: AgentConfig = {}) {
  const {
    model = google('gemini-2.5-flash'),
    maxSteps = 10,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
  } = config;

  return streamText({
    model,
    tools: vercelTools,
    stopWhen: stepCountIs(maxSteps),
    system: systemPrompt,
    prompt,
  });
}

// Export tools for custom agent implementations
export { vercelTools };

// Re-export core tools for direct access
export { arcTools } from '../tools/core';

/**
 * Arc Payment Agent (ToolLoopAgent)
 *
 * For use with createAgentUIStreamResponse and useChat
 */
export const arcAgent = new ToolLoopAgent({
  model: google('gemini-2.0-flash'),
  instructions: DEFAULT_SYSTEM_PROMPT,
  tools: vercelTools,
});

export type ArcAgentUIMessage = InferAgentUIMessage<typeof arcAgent>;
