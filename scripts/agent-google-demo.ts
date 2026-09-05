#!/usr/bin/env tsx
/**
 * Google GenAI Agent CLI
 *
 * Interactive chat with the Arc Payment Agent using Google GenAI SDK.
 * Supports multi-turn conversation with tool calling.
 *
 * Usage:
 *   npm run agent:google
 *   npm run agent:google "Check balance"
 *   pnpm tsx scripts/agent-google-demo.ts
 */

import { runGoogleAgent } from '../src/agents/google-agent.js';
import dotenv from 'dotenv';
import * as readline from 'node:readline/promises';

dotenv.config({ path: '.env.local' });

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Track conversation history for context
const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

async function main() {
  console.log('🤖 Arc Payment Agent (Google GenAI SDK)\n');
  console.log('Type your message and press Enter. Type "exit" to quit.\n');
  console.log('─'.repeat(50) + '\n');

  // Check for initial prompt from command line args
  const initialPrompt = process.argv.slice(2).join(' ');

  while (true) {
    let userInput: string;

    if (initialPrompt && conversationHistory.length === 0) {
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

    conversationHistory.push({ role: 'user', content: userInput });

    try {
      // Build context from conversation history
      const contextPrompt = conversationHistory
        .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n\n');

      const result = await runGoogleAgent(contextPrompt);

      console.log('\nAgent:', result.text);
      console.log('');

      conversationHistory.push({ role: 'assistant', content: result.text });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Agent failed';
      console.error('\n❌ Error:', message);
      console.log('');
    }
  }
}

main().catch(console.error);
