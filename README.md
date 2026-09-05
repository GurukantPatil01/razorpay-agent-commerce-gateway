# Arc Merchant

**A full end-to-end demo of agentic commerce on Arc blockchain.**

An AI agent discovers paywalled content, pays 0.01 USDC via x402, and receives it — autonomously, on-chain, no human approval. The merchant dashboard updates in real time as payments land.

🏆 2nd Place — Agentic Commerce on Arc Hackathon (January 2026)
🌐 Live demo: https://arc-merchant-production.up.railway.app
📋 Roadmap: [ROADMAP.md](ROADMAP.md)

---

## What This Is

## What This Is

```
┌─────────────────────────────────────────────────────────────┐
│              AI Agent (e.g., Claude Code)                   │
│              with Circle wallet + MCP tools                 │
└─────────────────────────────┬───────────────────────────────┘
                              │ x402 payment ($0.01 USDC)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Arc Merchant                           │
│  ┌─────────────────────┐    ┌────────────────────────────┐  │
│  │  x402 Paywall API   │───▶│   Merchant Dashboard       │  │
│  │  /api/article/:slug │    │   - Real-time payments     │  │
│  └─────────────────────┘    │   - Revenue tracking       │  │
│                             │   - On-chain balance       │  │
│                             └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Arc Blockchain                         │
│              USDC settlement  •  Circle Wallets             │
└─────────────────────────────────────────────────────────────┘
```

**The buyer side** (your chosen autonomous AI agent framework) manages wallets and signs x402 payments.

**The seller side** (next.js) provides paywalled content endpoints and a real-time dashboard showing payments as they arrive.

---

## How It Works

1. **Content behind x402 paywall** — Articles at `/api/article/:slug` require payment
2. **AI agent requests content** — Gets HTTP 402 Payment Required with price
3. **Agent pays via Circle wallet** — Signs x402 payment, sends USDC
4. **Facilitator server settles on-chain** — Verifies signature, submits to Arc L1
5. **Content delivered** — Agent receives the article
6. **Dashboard updates** — Merchant sees payment in real-time, can track receipts, sales, autonomous treasury, etc

---

## Architecture: Buyer vs Seller

This project contains **both sides** of the x402 payment flow:

### Buyer Side (AI Agent Tools)

The `src/tools/` SDK lets AI agents manage wallets and pay for content:

```
src/tools/core.ts        → Tool definitions (Zod + execute functions)
src/tools/adapters/      → MCP, SDK adapters
src/servers/mcp.ts       → MCP server for Claude Code
```

### Seller Side (Facilitator + API)

The facilitator settles payments on-chain when agents pay for your content:

```
src/servers/facilitator.ts   → Receives signed payments, settles on Arc blockchain
src/app/api/article/         → x402-protected content endpoints
src/app/page.tsx             → Merchant dashboard
```

**Use this if:** You're a merchant accepting x402 payments for content.

**The facilitator is required** — it's what actually moves USDC on-chain. Think of it like your own payment processor. 

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.local.example` to `.env.local` and fill in:

```bash
# Circle API credentials (https://console.circle.com)
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=

# Facilitator wallet (create via arc_create_wallet, then add ID here)
CIRCLE_FACILITATOR_WALLET_ID=

# Google AI (for Vercel AI SDK with Gemini)
GOOGLE_GENERATIVE_AI_API_KEY=

# Google AI (for @google/genai SDK)
GEMINI_API_KEY=
```

### 3. Set up Circle Entity Secret (one-time)

```bash
npm run setup-circle
```

This generates and registers your Entity Secret with Circle (updates `CIRCLE_ENTITY_SECRET`).

### 4. Configure facilitator wallet

Create a Circle wallet to use as your facilitator (settles payments on-chain):

```bash
npm run wallet create
```

This outputs a wallet ID. Add it to `.env.local`:

```bash
CIRCLE_FACILITATOR_WALLET_ID=<your-wallet-id>
```

### 5. Run both servers

```bash
# Terminal 1: Facilitator (settles payments)
npm run facilitator

# Terminal 2: Next.js (dashboard + paywalled API server)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the merchant dashboard.

### 6. Test a payment

In Claude Code with the `arc-agent-payments` MCP server:

```
"Pay for http://localhost:3000/api/article/arc-blockchain-guide"
```

Watch the dashboard update in real-time.

---

## Project Structure

```
arc-merchant/
├── src/tools/                    # Framework-agnostic AI tools (SDK core)
│   ├── core.ts                   # Tool definitions (Zod schemas + execute)
│   └── adapters/
│       ├── mcp.ts                # MCP adapter (Claude Code)
│       ├── vercel.ts             # Vercel AI SDK adapter
│       └── google-genai.ts       # Google GenAI SDK adapter
├── src/app/
│   ├── page.tsx                  # Merchant dashboard
│   └── api/
│       ├── article/[slug]/       # x402-protected content
│       └── stats/                # Dashboard data
├── src/lib/
│   ├── arc.ts                    # Arc chain config
│   ├── circle-wallet.ts          # Circle SDK
│   ├── x402.ts                   # x402 facilitator
│   └── stats.ts                  # Payment tracking
├── src/servers/
│   ├── facilitator.ts            # Payment settlement server
│   └── mcp.ts                    # MCP server for AI agents
├── src/agents/
│   ├── vercel-agent.ts           # AI agent using Vercel AI SDK
│   └── google-agent.ts           # AI agent using Google GenAI SDK (Gemini 3)
└── scripts/
    ├── setup-circle-entity.ts    # Circle entity secret setup
    ├── wallet-cli.ts             # Wallet management CLI
    ├── agent-vercel-demo.ts      # Demo: Vercel AI SDK agent
    └── agent-google-demo.ts      # Demo: Google GenAI agent
```

---

## Wallet CLI

Manage Circle wallets without AI:

```bash
npm run wallet create          # Create a new wallet
npm run wallet list            # List all wallets
npm run wallet balance <id>    # Get wallet balance
npm run wallet fund <address>  # Request testnet tokens
```

---

## AI Payment Tools (SDK)

Framework-agnostic tools for AI agents to manage Circle wallets and pay for content via x402.

### Tools Available

| Tool | Description |
|------|-------------|
| `arc_list_wallets` | List all Circle wallets |
| `arc_get_wallet` | Get details for a specific wallet |
| `arc_create_wallet` | Create a new Circle wallet |
| `arc_get_balance` | Check USDC/EURC balances |
| `arc_pay_for_content` | Pay for x402 paywalled content |
| `arc_transfer` | Direct USDC transfer |
| `arc_request_testnet_tokens` | Fund wallet from Circle faucet |
| `arc_get_transaction` | Get transaction details |

### Usage with MCP (Claude Code)

```bash
claude mcp add arc-mcp-server -- npm run mcp
```

### Usage with Other Frameworks

The core tools are framework-agnostic. Import from `src/tools/core.ts` and create your own adapter:

```typescript
import { arcTools } from './src/tools/core';

// Each tool has: name, description, inputSchema (Zod), execute (async function)
const result = await arcTools.arc_list_wallets.execute({});
```

---

## Pre-built AI Agents

Two ready-to-use agents for autonomous payments:

### Google GenAI Agent (Gemini 3)

Uses Google's official `@google/genai` SDK with the latest `gemini-3-flash-preview` model:

```bash
npm run agent:google "Pay for http://localhost:3000/api/article/arc-blockchain-guide"
```

```typescript
import { runGoogleAgent } from './src/agents/google-agent';

const result = await runGoogleAgent("List my wallets and pay for the article");
console.log(result.text);
```

### Vercel AI Agent

Uses Vercel AI SDK (works with Gemini, OpenAI, Anthropic, etc.):

```bash
npm run agent:vercel "Check my wallet balance"
```

```typescript
import { runAgent } from './src/agents/vercel-agent';
import { openai } from '@ai-sdk/openai';

// Default: Gemini 2.5 Flash
const result = await runAgent("Pay for the article");

// Or use any Vercel AI SDK model
const result = await runAgent("Pay for the article", {
  model: openai('gpt-4o')
});
```

---

## Tech Stack

- **Arc** — Circle's L1 blockchain with native USDC gas
- **Circle Developer-Controlled Wallets** — Secure wallet infrastructure
- **x402** — Web-native micropayment protocol (HTTP 402)
- **Zod** — Schema validation (with native JSON Schema conversion for MCP)
- **Next.js** — Dashboard and API
- **Vercel AI SDK** — Model-agnostic (Gemini, OpenAI, Anthropic, etc.)
- **MCP** — Model Context Protocol for Claude Code integration
- **USDC** — Stablecoin payments

---

**Built for the Agentic Commerce on Arc Hackathon** (January 2026)
