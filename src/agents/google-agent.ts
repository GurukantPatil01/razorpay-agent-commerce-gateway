/**
 * Google GenAI Agent
 *
 * Uses Google's official @google/genai SDK with Automatic Function Calling (AFC).
 * The SDK handles the tool loop automatically - no manual looping needed.
 */

import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import { arcCallableTool } from '../tools/adapters/google-genai';

// Initialize client (uses GEMINI_API_KEY env var)
const ai = new GoogleGenAI({});

export interface GoogleAgentConfig {
  model?: string;
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are an AI agent with autonomous payment capabilities on the Arc blockchain.

You can:
- Create and manage Circle Developer-Controlled Wallets
- Check wallet balances (USDC, EURC)
- Request testnet tokens from the faucet
- Transfer USDC to other addresses
- Pay for paywalled content using the x402 protocol

When asked to pay for content, use arc_pay_for_content with the wallet_id and URL.`;

/**
 * Run agent using SDK's Automatic Function Calling (AFC)
 *
 * The SDK handles the tool loop automatically when using AUTO mode.
 */
export async function runGoogleAgent(
  prompt: string,
  config: GoogleAgentConfig = {}
) {
  const {
    model = 'gemini-3-flash-preview',
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
  } = config;

  // Track tool calls for reporting
  const toolResults: Array<{ name: string; result: unknown }> = [];

  // Wrap the callable tool to track calls
  const trackedTool = {
    ...arcCallableTool,
    callTool: async (calls: any) => {
      const results = await arcCallableTool.callTool(calls);
      // Track each call
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const result = results[i];
        console.log(`🔧 Calling: ${call.name}`);
        toolResults.push({
          name: call.name,
          result: result.functionResponse?.response,
        });
      }
      return results;
    },
  };

  // Use generateContent with AUTO mode - SDK handles the loop
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: systemPrompt,
      tools: [trackedTool],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.AUTO,
        },
      },
    },
  });

  return {
    text: response.text || '',
    toolResults,
    model,
  };
}
