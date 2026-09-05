#!/usr/bin/env tsx
/**
 * Arc Payment Agent CLI
 *
 * Interactive chat with the Arc Payment Agent using Vercel AI SDK.
 * Supports multi-turn conversation with tool calling.
 *
 * Usage:
 *   npm run agent:vercel
 *   pnpm tsx scripts/agent-vercel-demo.ts
 */

import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { google } from '@ai-sdk/google';
import { vercelTools } from '../src/tools/adapters/vercel.js';
import dotenv from 'dotenv';
import * as readline from 'node:readline/promises';

dotenv.config({ path: '.env.local' });

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const messages: ModelMessage[] = [];

const systemPrompt = `You are an AI agent with autonomous payment capabilities on the Arc blockchain.

You can:
- Create and manage Circle Developer-Controlled Wallets
- Check wallet balances (USDC, EURC)
- Request testnet tokens from the faucet
- Transfer USDC to other addresses
- Pay for paywalled content using the x402 protocol

When asked to pay for content, use arc_pay_for_content with the wallet_id and URL.
Always confirm payment amounts before executing transfers.`;

async function main() {
  console.log('🤖 Arc Payment Agent (Vercel AI SDK)\n');
  console.log('Type your message and press Enter. Type "exit" to quit.\n');
  console.log('─'.repeat(50) + '\n');

  // Check for initial prompt from command line args
  const initialPrompt = process.argv.slice(2).join(' ');

  while (true) {
    let userInput: string;

    if (initialPrompt && messages.length === 0) {
      // Use command line arg as first message
      userInput = initialPrompt;
      console.log(`You: ${userInput}`);
    } else {
      userInput = await terminal.question('You: ');
    }

    if (userInput.toLowerCase() === 'exit') {
      console.log('\nGoodbye!');
      terminal.close();
      break;
    }

    if (!userInput.trim()) continue;

    messages.push({ role: 'user', content: userInput });

    const result = streamText({
      model: google('gemini-2.0-flash'),
      system: systemPrompt,
      messages,
      tools: vercelTools,
      stopWhen: stepCountIs(10),
      onStepFinish: async ({ toolResults }) => {
        if (toolResults.length) {
          for (const tool of toolResults) {
            console.log(`\n🔧 ${tool.toolName}:`);
            console.log(JSON.stringify(tool.output, null, 2));
          }
        }
      },
    });

    let fullResponse = '';
    process.stdout.write('\nAgent: ');
    for await (const delta of result.textStream) {
      fullResponse += delta;
      process.stdout.write(delta);
    }
    process.stdout.write('\n\n');

    messages.push({ role: 'assistant', content: fullResponse });
  }
}

main().catch(console.error);
