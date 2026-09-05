/**
 * Circle Developer-Controlled Wallets SDK Integration
 *
 * Creates and manages wallets for AI agents to autonomously
 * pay for content via x402 micropayments on Arc blockchain.
 */

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env.local') });

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

if (!apiKey || !entitySecret) {
  throw new Error('Missing Circle credentials: CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET required');
}

// Initialize Circle client
export const circleClient = initiateDeveloperControlledWalletsClient({
  apiKey,
  entitySecret,
});

/**
 * Create a new wallet on Arc blockchain
 */
export async function createAgentWallet() {
  // Step 1: Create wallet set
  let walletSetId: string;

  try {
    const walletSetResponse = await circleClient.createWalletSet({
      name: `arc-walletset`,
    });

    if (!walletSetResponse.data?.walletSet?.id) {
      throw new Error('Failed to create wallet set');
    }

    walletSetId = walletSetResponse.data.walletSet.id;
    console.log(`Created wallet set: ${walletSetId}`);
  } catch (error: any) {
    throw new Error(`Failed to create wallet set: ${error.message}`);
  }

  // Step 2: Create wallet in the set
  const response = await circleClient.createWallets({
    accountType: 'EOA', // Externally Owned Account (no deployment needed)
    blockchains: ['ARC-TESTNET'],
    count: 1,
    walletSetId,
  });

  if (!response.data?.wallets?.[0]) {
    throw new Error('Failed to create wallet');
  }

  const wallet = response.data.wallets[0];

  console.log(`✅ Created wallet: ${wallet.address}`);

  return {
    id: wallet.id,
    address: wallet.address as `0x${string}`,
    blockchain: wallet.blockchain,
  };
}

/**
 * Get wallet balance
 */
export async function getWalletBalance(walletId: string) {
  const response = await circleClient.getWalletTokenBalance({
    id: walletId,
  });

  return response.data?.tokenBalances || [];
}

/**
 * Sign an EIP-3009 authorization for x402 payment
 *
 * This allows the AI agent to authorize USDC transfers
 * without holding the private key directly.
 */
export async function signPaymentAuthorization(
  walletId: string,
  from: `0x${string}`,
  to: `0x${string}`,
  value: bigint,
  validAfter: bigint,
  validBefore: bigint,
  nonce: `0x${string}`,
  usdcContract: `0x${string}`,
) {
  // Build EIP-712 typed data for TransferWithAuthorization
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    domain: {
      name: 'USDC',
      version: '2',
      chainId: 5042002, // Arc testnet
      verifyingContract: usdcContract,
    },
    message: {
      from,
      to,
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    },
  };

  // Sign via Circle SDK
  try {
    const response = await circleClient.signTypedData({
      walletId,
      data: JSON.stringify(typedData),
    });

    if (!response.data?.signature) {
      throw new Error('Failed to sign payment authorization');
    }

    return response.data.signature as `0x${string}`;
  } catch (error: any) {
    console.error('Circle signTypedData error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error;
  }
}

/**
 * List all wallets for debugging
 */
export async function listWallets() {
  const response = await circleClient.listWallets({});
  return response.data?.wallets || [];
}

/**
 * Get a specific wallet by ID
 */
export async function getWallet(walletId: string) {
  const response = await circleClient.getWallet({ id: walletId });
  return response.data?.wallet;
}

/**
 * Request testnet tokens (USDC, EURC, native) from the faucet
 */
export async function requestTestnetTokens(
  address: string,
  options: { usdc?: boolean; eurc?: boolean; native?: boolean } = { usdc: true }
) {
  const response = await circleClient.requestTestnetTokens({
    address,
    blockchain: 'ARC-TESTNET',
    usdc: options.usdc ?? true,
    eurc: options.eurc ?? false,
    native: options.native ?? false,
  });
  return response;
}

/**
 * Transfer USDC to another address on Arc
 */
export async function transferUSDC(
  walletAddress: string,
  destinationAddress: string,
  amount: string // Human-readable amount like "1.50"
) {
  const response = await circleClient.createTransaction({
    blockchain: 'ARC-TESTNET' as const,
    walletAddress,
    tokenAddress: '0x3600000000000000000000000000000000000000', // Arc USDC (native precompile)
    amount: [amount],
    destinationAddress,
    fee: {
      type: 'level' as const,
      config: {
        feeLevel: 'MEDIUM' as const,
      },
    },
  });
  return response.data;
}

/**
 * Get the merchant wallet for receiving x402 payments
 *
 * Retrieves an existing Circle wallet. Does NOT create one.
 * If no merchant wallet exists, throws an error.
 *
 * Sorts wallets by ID to ensure deterministic selection.
 */
export async function getMerchantWallet(): Promise<{ id: string; address: `0x${string}` }> {
  const wallets = await listWallets();

  // Filter to Arc testnet EOA wallets and sort by ID for deterministic selection
  const arcWallets = wallets
    .filter((w: any) => w.blockchain === 'ARC-TESTNET' && w.accountType === 'EOA')
    .sort((a: any, b: any) => a.id.localeCompare(b.id));

  if (arcWallets.length < 2) {
    throw new Error('Need at least 2 wallets (agent + merchant). Create more using arc_create_wallet MCP tool.');
  }

  // Use the SECOND wallet as merchant (first is used by agent for payments)
  const merchant = arcWallets[1];
  console.log(`Merchant wallet: ${merchant.address} (ID: ${merchant.id})`);

  return {
    id: merchant.id,
    address: merchant.address as `0x${string}`,
  };
}

/**
 * Poll for Circle transaction completion
 */
export async function waitForCircleTransaction(
  transactionId: string,
  maxAttempts = 60,
  intervalMs = 1000
): Promise<{ txHash: string; state: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await circleClient.getTransaction({ id: transactionId });
    const tx = response.data?.transaction;

    if (!tx) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    console.log(`   Polling tx ${transactionId}: ${tx.state} (attempt ${i + 1}/${maxAttempts})`);

    switch (tx.state) {
      case 'COMPLETE':
        if (!tx.txHash) {
          throw new Error('Transaction complete but no txHash');
        }
        return { txHash: tx.txHash, state: tx.state };

      case 'FAILED':
        throw new Error(`Transaction failed: ${tx.errorReason || 'Unknown error'}`);

      case 'CANCELLED':
        throw new Error('Transaction was cancelled');

      case 'DENIED':
        throw new Error('Transaction was denied');

      default:
        // Still processing (INITIATED, QUEUED, SENT, CONFIRMED) - keep polling
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`Transaction ${transactionId} timed out after ${maxAttempts} attempts`);
}

/**
 * Execute a smart contract function via Circle wallet
 * Used by the facilitator to submit settlement transactions
 */
export async function executeContractCall(
  walletId: string,
  contractAddress: string,
  abiFunctionSignature: string,
  abiParameters: (string | number | boolean)[]
): Promise<{ txHash: string; transactionId: string }> {
  console.log(`   📝 Circle executeContract: ${abiFunctionSignature} on ${contractAddress}`);

  const response = await circleClient.createContractExecutionTransaction({
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    fee: {
      type: 'level',
      config: {
        feeLevel: 'MEDIUM',
      },
    },
  });

  if (!response.data?.id) {
    throw new Error('Failed to create contract execution transaction');
  }

  const transactionId = response.data.id;
  console.log(`   ⏳ Transaction submitted: ${transactionId}`);

  const result = await waitForCircleTransaction(transactionId);
  console.log(`   ✅ Transaction confirmed: ${result.txHash}`);

  return { txHash: result.txHash, transactionId };
}

/**
 * Send raw transaction data via Circle wallet
 */
export async function sendRawTransaction(
  walletId: string,
  toAddress: string,
  callData: `0x${string}`
): Promise<{ txHash: string; transactionId: string }> {
  console.log(`   📝 Circle sendTransaction to ${toAddress}`);

  const response = await circleClient.createContractExecutionTransaction({
    walletId,
    contractAddress: toAddress,
    callData,
    fee: {
      type: 'level',
      config: {
        feeLevel: 'MEDIUM',
      },
    },
  });

  if (!response.data?.id) {
    throw new Error('Failed to create transaction');
  }

  const transactionId = response.data.id;
  console.log(`   ⏳ Transaction submitted: ${transactionId}`);

  const result = await waitForCircleTransaction(transactionId);
  console.log(`   ✅ Transaction confirmed: ${result.txHash}`);

  return { txHash: result.txHash, transactionId };
}
