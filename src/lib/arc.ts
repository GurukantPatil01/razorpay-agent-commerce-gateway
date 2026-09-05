import { defineChain } from 'viem'

// Arc Testnet configuration
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    decimals: 18,  // Native USDC gas uses 18 decimals
    name: 'USDC',
    symbol: 'USDC',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.testnet.arc.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arc Explorer',
      url: 'https://explorer.testnet.arc.network',
    },
  },
})

// Contract addresses on Arc Testnet
export const ARC_CONTRACTS = {
  // USDC ERC-20 interface (6 decimals) - for transfers, approvals, x402
  USDC: '0x3600000000000000000000000000000000000000' as const,
  USDC_DECIMALS: 6,
  // Euro stablecoin (6 decimals)
  EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const,
  EURC_DECIMALS: 6,
  // Permit2 for signature-based approvals
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const,
  // StableFX escrow for FX swaps
  FX_ESCROW: '0x1f91886C7028986aD885ffCee0e40b75C9cd5aC1' as const,
}

// ERC20 ABI for balance/transfer
export const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const
