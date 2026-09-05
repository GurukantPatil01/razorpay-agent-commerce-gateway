#!/usr/bin/env tsx
/**
 * Wallet CLI
 *
 * Manage Circle wallets without AI.
 *
 * Usage:
 *   npm run wallet create          Create a new wallet
 *   npm run wallet list            List all wallets
 *   npm run wallet balance <id>    Get wallet balance
 *   npm run wallet fund <address>  Request testnet tokens
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { arcTools } from '../src/tools/core.js';

const [command, arg] = process.argv.slice(2);

async function main() {
  switch (command) {
    case 'create': {
      console.log('Creating wallet...\n');
      const result = await arcTools.arc_create_wallet.execute({});
      if (!result.success) {
        console.error('Failed:', result.error);
        process.exit(1);
      }
      console.log('Wallet created:');
      console.log(`  ID:      ${result.wallet_id}`);
      console.log(`  Address: ${result.address}`);
      console.log(`  Chain:   ${result.blockchain}`);
      console.log(`\nTo use as facilitator, add to .env.local:`);
      console.log(`  CIRCLE_FACILITATOR_WALLET_ID=${result.wallet_id}`);
      break;
    }

    case 'list': {
      const result = await arcTools.arc_list_wallets.execute({});
      if (!result.success) {
        console.error('Failed:', result.error);
        process.exit(1);
      }
      if (result.count === 0) {
        console.log('No wallets found. Create one with: npm run wallet create');
      } else {
        console.log(`Found ${result.count} wallet(s):\n`);
        for (const w of result.wallets) {
          console.log(`${w.id}`);
          console.log(`  Address: ${w.address}`);
          console.log(`  Chain:   ${w.blockchain}`);
          console.log(`  State:   ${w.state}`);
          console.log('');
        }
      }
      break;
    }

    case 'balance': {
      if (!arg) {
        console.error('Usage: npm run wallet balance <wallet-id>');
        process.exit(1);
      }
      const result = await arcTools.arc_get_balance.execute({ wallet_id: arg });
      if (!result.success) {
        console.error('Failed:', result.error);
        process.exit(1);
      }
      console.log(`Balance for ${arg}:\n`);
      if (result.balances.length === 0) {
        console.log('  No tokens found');
      } else {
        for (const b of result.balances) {
          console.log(`  ${b.token}: ${b.amount}`);
        }
      }
      break;
    }

    case 'fund': {
      if (!arg) {
        console.error('Usage: npm run wallet fund <address>');
        process.exit(1);
      }
      console.log(`Requesting testnet tokens for ${arg}...\n`);
      const result = await arcTools.arc_request_testnet_tokens.execute({
        address: arg,
        usdc: true,
        eurc: false,
        native: true,
      });
      if (!result.success) {
        console.error('Failed:', result.error);
        process.exit(1);
      }
      console.log(`Requested: ${result.tokens_requested.join(', ')}`);
      console.log('Tokens may take a moment to arrive.');
      break;
    }

    default:
      console.log('Wallet CLI\n');
      console.log('Usage:');
      console.log('  npm run wallet create          Create a new wallet');
      console.log('  npm run wallet list            List all wallets');
      console.log('  npm run wallet balance <id>    Get wallet balance');
      console.log('  npm run wallet fund <address>  Request testnet tokens');
      if (command) {
        console.error(`\nUnknown command: ${command}`);
        process.exit(1);
      }
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
