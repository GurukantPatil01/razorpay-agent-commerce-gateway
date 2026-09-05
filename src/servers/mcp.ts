#!/usr/bin/env node
/**
 * Arc Agent Payments MCP Server
 *
 * Enables AI assistants to autonomously pay for content using Circle
 * Developer-Controlled Wallets on Arc blockchain.
 *
 * Tools provided:
 * - arc_create_wallet: Create or get Circle wallet for AI agent
 * - arc_get_balance: Check USDC/EURC balance
 * - arc_pay_for_content: Pay for paywalled resources via x402
 * - arc_get_transaction: View transaction details on Arc
 * - arc_list_wallets: List all Circle wallets
 * - arc_get_wallet: Get details for a specific wallet
 * - arc_request_testnet_tokens: Fund wallet from Circle faucet
 * - arc_transfer: Direct USDC transfer to another address
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { mcpTools, executeTool } from '../tools/adapters/mcp.js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// MCP Server
const server = new Server(
  {
    name: 'arc-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools - return the adapter's tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: mcpTools,
}));

// Call tool - delegate to the adapter
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return executeTool(name, args);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Arc Agent Payments MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
