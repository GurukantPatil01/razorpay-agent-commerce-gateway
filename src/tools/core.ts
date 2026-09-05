/**
 * Framework-Agnostic Arc Payment Tools
 *
 * Core tool definitions with Zod schemas and pure execute functions.
 * No framework dependencies - adapters convert these to specific formats.
 */

import { z } from 'zod';
import { toHex } from 'viem';
import {
  createAgentWallet,
  getWalletBalance,
  listWallets,
  getWallet,
  requestTestnetTokens,
  transferUSDC,
  signPaymentAuthorization,
  circleClient,
} from '../lib/circle-wallet';
import { ARC_CONTRACTS } from '../lib/arc';

// Tool schemas
const createWalletSchema = z.object({});

const getBalanceSchema = z.object({
  wallet_id: z.string().describe('Circle wallet ID (returned from arc_create_wallet)'),
});

const listWalletsSchema = z.object({});

const getWalletSchema = z.object({
  wallet_id: z.string().describe('Circle wallet ID'),
});

const requestTokensSchema = z.object({
  address: z.string().describe('Wallet address to fund (0x...)'),
  usdc: z.boolean().default(true).describe('Request USDC tokens (default: true)'),
  eurc: z.boolean().default(false).describe('Request EURC tokens (default: false)'),
  native: z.boolean().default(false).describe('Request native tokens (default: false)'),
});

const transferSchema = z.object({
  from_address: z.string().describe('Sender wallet address (0x...)'),
  to_address: z.string().describe('Recipient address (0x...)'),
  amount: z.string().describe('Amount to send in USDC (e.g., "1.50")'),
});

const getTransactionSchema = z.object({
  tx_hash: z.string().describe('Transaction hash (0x...)'),
});

const payForContentSchema = z.object({
  wallet_id: z.string().describe('Circle wallet ID to pay from'),
  url: z.string().describe('URL of the paywalled resource'),
  max_price: z.string().default('1.00').describe('Maximum price willing to pay in USDC (e.g., "0.01")'),
});

// Tool type - using any for execute to avoid complex generic constraints
export interface CoreTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (input: any) => Promise<any>;
}

// All 8 Arc payment tools
export const arcTools: Record<string, CoreTool> = {
  arc_create_wallet: {
    name: 'arc_create_wallet',
    description:
      'Create a new Circle Developer-Controlled Wallet on Arc blockchain. Returns wallet ID and address. Use arc_list_wallets first to check if a wallet already exists.',
    inputSchema: createWalletSchema,
    execute: async () => {
      const wallet = await createAgentWallet();
      return {
        success: true,
        wallet_id: wallet.id,
        address: wallet.address,
        blockchain: wallet.blockchain,
      };
    },
  },

  arc_get_balance: {
    name: 'arc_get_balance',
    description: 'Get USDC and EURC token balances for a Circle wallet on Arc blockchain.',
    inputSchema: getBalanceSchema,
    execute: async ({ wallet_id }: z.infer<typeof getBalanceSchema>) => {
      const balances = await getWalletBalance(wallet_id);
      const formatted = balances.map((b: any) => ({
        token: b.token?.symbol || 'Unknown',
        amount: b.amount || '0',
      }));
      return {
        success: true,
        wallet_id,
        balances: formatted,
      };
    },
  },

  arc_list_wallets: {
    name: 'arc_list_wallets',
    description:
      'List all Circle wallets. Shows wallet IDs, addresses, and blockchains for all wallets in your account.',
    inputSchema: listWalletsSchema,
    execute: async () => {
      const wallets = await listWallets();
      return {
        success: true,
        count: wallets.length,
        wallets: wallets.map((w: any) => ({
          id: w.id,
          address: w.address,
          blockchain: w.blockchain,
          state: w.state,
          accountType: w.accountType,
        })),
      };
    },
  },

  arc_get_wallet: {
    name: 'arc_get_wallet',
    description: 'Get details for a specific Circle wallet by ID.',
    inputSchema: getWalletSchema,
    execute: async ({ wallet_id }: z.infer<typeof getWalletSchema>) => {
      const wallet = await getWallet(wallet_id);
      if (!wallet) {
        return { success: false, error: `Wallet ${wallet_id} not found` };
      }
      return {
        success: true,
        wallet: {
          id: wallet.id,
          address: wallet.address,
          blockchain: wallet.blockchain,
          state: wallet.state,
          createDate: wallet.createDate,
        },
      };
    },
  },

  arc_request_testnet_tokens: {
    name: 'arc_request_testnet_tokens',
    description:
      'Request testnet tokens (USDC, EURC, native) from Circle faucet. Funds your wallet directly without leaving Claude Code.',
    inputSchema: requestTokensSchema,
    execute: async ({ address, usdc, eurc, native }: z.infer<typeof requestTokensSchema>) => {
      await requestTestnetTokens(address, {
        usdc: usdc ?? true,
        eurc: eurc ?? false,
        native: native ?? false,
      });
      const tokensRequested = [];
      if (usdc ?? true) tokensRequested.push('USDC');
      if (eurc) tokensRequested.push('EURC');
      if (native) tokensRequested.push('native');
      return {
        success: true,
        address,
        tokens_requested: tokensRequested,
        message: `Testnet tokens requested for ${address}. May take a moment to arrive.`,
      };
    },
  },

  arc_transfer: {
    name: 'arc_transfer',
    description:
      'Transfer USDC to another address on Arc blockchain. This is a direct on-chain transfer (not x402 payment).',
    inputSchema: transferSchema,
    execute: async ({ from_address, to_address, amount }: z.infer<typeof transferSchema>) => {
      const result = await transferUSDC(from_address, to_address, amount);
      return {
        success: true,
        from: from_address,
        to: to_address,
        amount: `${amount} USDC`,
        transaction_id: result?.id,
        state: result?.state,
        message: `Transfer initiated. Transaction ID: ${result?.id}`,
      };
    },
  },

  arc_get_transaction: {
    name: 'arc_get_transaction',
    description: 'Get transaction details and explorer link for an Arc blockchain transaction.',
    inputSchema: getTransactionSchema,
    execute: async ({ tx_hash }: z.infer<typeof getTransactionSchema>) => {
      return {
        success: true,
        transaction: tx_hash,
        explorer_url: `https://testnet.arcscan.app/tx/${tx_hash}`,
        message: 'View transaction details on Arc Explorer',
      };
    },
  },

  arc_pay_for_content: {
    name: 'arc_pay_for_content',
    description:
      'Autonomously pay for paywalled content using x402 protocol. Handles the full payment flow: request content, receive 402 Payment Required, sign payment via Circle SDK, retry with payment signature, return content. Returns both the content and transaction hash.',
    inputSchema: payForContentSchema,
    execute: async ({ wallet_id, url, max_price }: z.infer<typeof payForContentSchema>) => {
      const maxPriceUSDC = parseFloat(max_price || '1.00');

      // Step 1: Get wallet info
      const walletsResponse = await circleClient.listWallets({});
      const wallet = walletsResponse.data?.wallets?.find((w: any) => w.id === wallet_id);

      if (!wallet) {
        return { success: false, error: `Wallet ${wallet_id} not found` };
      }

      // Step 2: Initial request (expect 402)
      const initialRes = await fetch(url);

      if (initialRes.status !== 402) {
        const content = await initialRes.text();
        return {
          success: true,
          paid: false,
          content,
          message: 'Resource was not paywalled - no payment needed',
        };
      }

      // Step 3: Extract payment requirements
      const paymentRequiredHeader = initialRes.headers.get('payment-required');
      if (!paymentRequiredHeader) {
        return { success: false, error: 'Missing payment-required header' };
      }

      const paymentRequired = JSON.parse(Buffer.from(paymentRequiredHeader, 'base64').toString());
      const accepts = paymentRequired.accepts;
      if (!accepts || accepts.length === 0) {
        return { success: false, error: 'No payment options available' };
      }

      const requirements = accepts[0];

      // Step 4: Calculate amount
      let amount: bigint;
      if (requirements.amount) {
        amount = BigInt(requirements.amount);
      } else {
        const priceStr = requirements.maxAmountRequired || requirements.price || '$0.01';
        const priceNum = parseFloat(priceStr.replace('$', ''));

        if (priceNum > maxPriceUSDC) {
          return {
            success: false,
            error: `Price ${priceNum} USDC exceeds max_price ${maxPriceUSDC} USDC`,
          };
        }

        amount = BigInt(Math.floor(priceNum * 1_000_000));
      }

      // Step 5: Prepare authorization
      const now = Math.floor(Date.now() / 1000);
      const validAfter = BigInt(0);
      const validBefore = BigInt(now + 3600);
      const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const usdcContract = (requirements.asset || ARC_CONTRACTS.USDC) as `0x${string}`;

      // Step 6: Sign via Circle SDK
      const signature = await signPaymentAuthorization(
        wallet_id,
        wallet.address as `0x${string}`,
        requirements.payTo as `0x${string}`,
        amount,
        validAfter,
        validBefore,
        nonce,
        usdcContract
      );

      // Step 7: Build payment payload
      const paymentPayload = {
        x402Version: 2,
        resource: paymentRequired.resource,
        accepted: requirements,
        payload: {
          signature,
          authorization: {
            from: wallet.address,
            to: requirements.payTo,
            value: amount.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce,
          },
        },
      };

      // Step 8: Retry with payment
      const paidRes = await fetch(url, {
        headers: {
          'payment-signature': Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
        },
      });

      // Step 9: Extract transaction hash
      const paymentResponseHeader = paidRes.headers.get('payment-response');
      let txHash: string | null = null;

      if (paymentResponseHeader) {
        const paymentResponse = JSON.parse(Buffer.from(paymentResponseHeader, 'base64').toString());
        txHash = paymentResponse.transaction;
      }

      if (!paidRes.ok) {
        const errorText = await paidRes.text();
        return { success: false, error: `Payment failed: ${paidRes.status} - ${errorText}` };
      }

      // Step 10: Return content and transaction details
      const content = await paidRes.text();
      const priceUSDC = Number(amount) / 1_000_000;

      return {
        success: true,
        paid: true,
        price_usdc: priceUSDC,
        transaction: txHash,
        explorer_url: txHash ? `https://testnet.arcscan.app/tx/${txHash}` : null,
        content: content.substring(0, 1000) + (content.length > 1000 ? '...' : ''),
        full_content_length: content.length,
      };
    },
  },
};

// Type helpers
export type ArcToolName = keyof typeof arcTools;
