/**
 * Article data for x402 paywall demo
 */

export interface Article {
  slug: string
  title: string
  description: string
  priceUsd: number
  author: string
  publishedAt: string
  content: string
  tags: string[]
}

export const articles: Article[] = [
  {
    slug: 'arc-blockchain-guide',
    title: 'The Complete Guide to Arc Blockchain',
    description: 'Everything you need to know about Circle\'s Arc L1 blockchain',
    priceUsd: 0.01,
    author: 'Arc Research Team',
    publishedAt: '2026-01-15',
    tags: ['arc', 'blockchain', 'circle'],
    content: `# The Complete Guide to Arc Blockchain

Arc is Circle's purpose-built L1 blockchain with USDC as the native gas token.

## Key Features
- EVM compatible
- Sub-second finality
- USDC-native gas fees
- Built for stablecoin finance

## Getting Started
Connect to Arc Testnet using chain ID 5042002 and RPC endpoint https://rpc.testnet.arc.network
`,
  },
  {
    slug: 'x402-micropayments',
    title: 'x402: The Future of Web Micropayments',
    description: 'How x402 enables seamless micropayments for AI agents',
    priceUsd: 0.01,
    author: 'x402 Protocol Team',
    publishedAt: '2026-01-16',
    tags: ['x402', 'payments', 'web3'],
    content: `# x402: The Future of Web Micropayments

x402 revives HTTP 402 Payment Required for the AI agent era.

## How It Works
1. Client requests resource
2. Server returns 402 with payment requirements
3. Client signs payment authorization
4. Server verifies and settles on-chain
5. Content delivered

## Why It Matters
AI agents can now autonomously pay for APIs, data, and content without human approval.
`,
  },
  {
    slug: 'circle-gateway-guide',
    title: 'Circle Gateway: Unified USDC Across Chains',
    description: 'Instant cross-chain USDC transfers with Circle Gateway',
    priceUsd: 0.01,
    author: 'Circle Developer Relations',
    publishedAt: '2026-01-17',
    tags: ['circle', 'gateway', 'usdc'],
    content: `# Circle Gateway: Unified USDC Across Chains

Gateway provides a single USDC balance accessible across multiple blockchains.

## Benefits
- No bridging required
- Instant settlement
- Chain-abstracted balance
- Lower fees than traditional bridges

## Supported Chains
Ethereum, Base, Arbitrum, Polygon, Solana, and Arc.
`,
  },
]

export function getArticleBySlug(slug: string): Article | undefined {
  return articles.find(article => article.slug === slug)
}

export function getAllArticles(): Article[] {
  return articles
}
