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

// ─── Commerce & Razorpay Agent Tools ───
// ─── Commerce & Razorpay Agent Tools ───
import { getAllMerchants, getMerchantById, getMerchantCapabilityDocument } from '../data/merchants';
import { searchProducts as findProducts, getProductById, products as allProducts } from '../data/products';
import { calculateProductQuote, formatINR } from '../services/pricing/calculator';
import { validatePurchasePolicy, DEFAULT_PURCHASE_POLICY, PurchasePolicy } from '../services/policy/engine';
import { razorpayAdapter } from '../services/razorpay/adapter';
import { CommerceStore } from '../lib/commerce-store';
import { rankCandidates, scoreProduct } from '../services/ranking/scoring-engine';
import { createPurchasePlan } from '../services/pricing/purchase-plan';
import { PurchaseIntent } from '../services/intent/parser';

export const commerceTools: Record<string, CoreTool> = {
  discover_merchants: {
    name: 'discover_merchants',
    description: 'Discover verified merchants on the Razorpay Agent Commerce Gateway with capability filtering (agent-checkout and Razorpay support).',
    inputSchema: z.object({
      query: z.string().optional().describe('Optional name or keyword filter'),
      requires_agent_checkout: z.boolean().default(true).describe('Filter for merchants supporting autonomous agent checkout'),
      requires_razorpay: z.boolean().default(true).describe('Filter for merchants with native Razorpay payment capability'),
    }),
    execute: async ({ query, requires_agent_checkout = true, requires_razorpay = true }: any) => {
      let list = getAllMerchants();

      // Apply hard compatibility filters
      if (requires_agent_checkout) {
        list = list.filter((m) => m.agentPurchasesSupported);
      }
      if (requires_razorpay) {
        list = list.filter((m) => m.paymentProvider === 'razorpay');
      }

      if (query) {
        const q = query.toLowerCase();
        list = list.filter((m) => m.name.toLowerCase().includes(q) || m.tagline.toLowerCase().includes(q));
      }

      return {
        success: true,
        count: list.length,
        merchants: list.map((m) => getMerchantCapabilityDocument(m.id)),
      };
    },
  },

  search_merchants: {
    name: 'search_merchants',
    description: 'Legacy alias for discover_merchants to maintain backwards compatibility.',
    inputSchema: z.object({
      query: z.string().optional().describe('Optional name or specialty keyword to filter merchants'),
    }),
    execute: async ({ query }: { query?: string }) => {
      let list = getAllMerchants().filter((m) => m.agentPurchasesSupported && m.paymentProvider === 'razorpay');
      if (query) {
        const q = query.toLowerCase();
        list = list.filter((m) => m.name.toLowerCase().includes(q) || m.tagline.toLowerCase().includes(q));
      }
      return {
        success: true,
        count: list.length,
        merchants: list.map((m) => ({
          ...m,
          capabilityDoc: getMerchantCapabilityDocument(m.id),
        })),
      };
    },
  },

  search_products: {
    name: 'search_products',
    description: 'Search structured product catalog across compatible merchants with optional hard constraints (budget, max delivery days, min return days).',
    inputSchema: z.object({
      query: z.string().describe('Search query e.g. "wireless keyboard"'),
      category: z.string().optional().describe('Optional category filter e.g. "electronics"'),
      max_price_paise: z.number().optional().describe('Optional max price in paise (e.g. 300000 = ₹3,000)'),
      max_delivery_days: z.number().optional().describe('Optional max delivery days'),
      min_return_days: z.number().optional().describe('Optional minimum return policy days'),
    }),
    execute: async ({ query, category, max_price_paise, max_delivery_days, min_return_days }: any) => {
      let results = findProducts(query, category);

      // Hard filter: only products from agent-compatible and Razorpay-supported merchants
      results = results.filter((p) => {
        const m = getMerchantById(p.merchantId);
        return m && m.agentPurchasesSupported && m.paymentProvider === 'razorpay';
      });

      // Optional constraint filtering (only when specified)
      if (max_price_paise !== undefined && max_price_paise !== null) {
        results = results.filter((p) => (p.basePricePaise + p.taxPaise + p.shippingFeePaise) <= max_price_paise);
      }
      if (max_delivery_days !== undefined && max_delivery_days !== null) {
        results = results.filter((p) => p.deliveryDays <= max_delivery_days);
      }
      if (min_return_days !== undefined && min_return_days !== null) {
        results = results.filter((p) => p.returnDays >= min_return_days);
      }

      return {
        success: true,
        count: results.length,
        products: results.map((p) => {
          const merchant = getMerchantById(p.merchantId);
          return {
            id: p.id,
            name: p.name,
            merchantId: p.merchantId,
            merchantName: merchant?.name || p.merchantId,
            category: p.category,
            basePricePaise: p.basePricePaise,
            basePriceFormatted: formatINR(p.basePricePaise),
            taxPaise: p.taxPaise,
            shippingFeePaise: p.shippingFeePaise,
            deliveryDays: p.deliveryDays,
            returnDays: p.returnDays,
            rating: p.rating,
            inStock: p.inStock,
            specifications: p.specifications,
          };
        }),
      };
    },
  },

  get_product: {
    name: 'get_product',
    description: 'Get detailed product specifications, pricing breakdown, stock, and return policy for a specific product ID.',
    inputSchema: z.object({
      product_id: z.string().describe('Unique product ID e.g. "prod_acme_keyboard"'),
    }),
    execute: async ({ product_id }: { product_id: string }) => {
      const product = getProductById(product_id);
      if (!product) return { success: false, error: `Product ${product_id} not found` };
      const merchant = getMerchantById(product.merchantId);
      return {
        success: true,
        product: {
          ...product,
          merchantName: merchant?.name,
          basePriceFormatted: formatINR(product.basePricePaise),
        },
      };
    },
  },

  compare_products: {
    name: 'compare_products',
    description: 'Compare candidate products deterministically using the multi-factor scoring engine (price 30%, delivery 20%, returns 15%, rating 15%, inventory 10%, agent 5%, Razorpay 5%).',
    inputSchema: z.object({
      product_ids: z.array(z.string()).describe('List of product IDs to compare'),
      budget_paise: z.number().optional().describe('Max budget in paise (e.g. 300000 = ₹3,000)'),
      max_delivery_days: z.number().optional().describe('Max permitted delivery days'),
      min_return_days: z.number().optional().describe('Min permitted return days'),
    }),
    execute: async ({ product_ids, budget_paise, max_delivery_days, min_return_days }: any) => {
      const candidates = product_ids
        .map((id: string) => getProductById(id))
        .filter((p: any): p is NonNullable<typeof p> => Boolean(p));

      const intent: PurchaseIntent = {
        query: 'comparison',
        category: 'electronics',
        maxAmountPaise: budget_paise ?? null,
        currency: 'INR',
        maxDeliveryDays: max_delivery_days ?? null,
        minimumReturnDays: min_return_days ?? null,
        requiresAgentCheckout: true,
        requiresRazorpay: true,
      };

      const ranking = rankCandidates(candidates, intent);

      const candidateDetails = ranking.candidates.map((c) => ({
        productId: c.product.id,
        productName: c.product.name,
        merchantId: c.merchant.id,
        merchantName: c.merchant.name,
        basePricePaise: c.quote.baseSubtotalPaise,
        shippingPaise: c.quote.shippingTotalPaise,
        taxPaise: c.quote.taxTotalPaise,
        finalTotalPaise: c.quote.finalTotalPaise,
        finalTotalFormatted: c.quote.formattedBreakdown.totalFormatted,
        totalPaise: c.quote.finalTotalPaise,
        totalFormatted: c.quote.formattedBreakdown.totalFormatted,
        deliveryDays: c.product.deliveryDays,
        returnDays: c.product.returnDays,
        rating: c.product.rating,
        score: c.score,
        breakdown: c.breakdown,
        reasons: c.reasons,
        qualifies: c.qualifies,
        satisfiesAllConstraints: c.qualifies,
        failureReasons: c.hardFilterViolations,
      }));

      return {
        success: true,
        status: ranking.status,
        summary: ranking.summary,
        recommendationSummary: ranking.summary,
        recommendedProductId: ranking.winner?.product.id || null,
        recommendedProductName: ranking.winner?.product.name || null,
        recommendedMerchantName: ranking.winner?.merchant.name || null,
        winnerScore: ranking.winner?.score || null,
        winnerBreakdown: ranking.winner?.breakdown || null,
        winnerReasons: ranking.winner?.reasons || [],
        candidates: candidateDetails,
        comparisons: candidateDetails,
        nearMatches: ranking.nearMatches.map((c) => ({
          productId: c.product.id,
          productName: c.product.name,
          merchantName: c.merchant.name,
          totalFormatted: c.quote.formattedBreakdown.totalFormatted,
          violations: c.hardFilterViolations,
        })),
      };
    },
  },

  calculate_total: {
    name: 'calculate_total',
    description: 'Compute exact deterministic quote server-side in paise (Base Price + Shipping + GST - Discounts). LLM must never calculate amounts directly.',
    inputSchema: z.object({
      product_id: z.string().describe('Product ID'),
      quantity: z.number().default(1).describe('Quantity to purchase'),
      discount_code: z.string().optional().describe('Optional discount code'),
    }),
    execute: async ({ product_id, quantity, discount_code }: any) => {
      const product = getProductById(product_id);
      if (!product) return { success: false, error: `Product ${product_id} not found` };
      const quote = calculateProductQuote(product, quantity, discount_code);
      return {
        success: true,
        quote,
      };
    },
  },

  check_purchase_policy: {
    name: 'check_purchase_policy',
    description: 'Verify if a product purchase complies with the buyer spending policy (max amount, permitted categories, merchant checks, delivery & return thresholds).',
    inputSchema: z.object({
      product_id: z.string().describe('Product ID'),
      quantity: z.number().default(1).describe('Quantity'),
    }),
    execute: async ({ product_id, quantity }: any) => {
      const product = getProductById(product_id);
      if (!product) return { success: false, error: `Product ${product_id} not found` };
      const quote = calculateProductQuote(product, quantity);
      const policyResult = validatePurchasePolicy(quote, DEFAULT_PURCHASE_POLICY);
      return {
        success: true,
        policyResult,
        quote,
      };
    },
  },

  create_purchase_request: {
    name: 'create_purchase_request',
    description: 'Generate an immutable AI purchase plan and human approval card for the selected product. Mandatory before any Razorpay order can be created.',
    inputSchema: z.object({
      product_id: z.string().describe('Product ID'),
      quantity: z.number().default(1).describe('Quantity'),
      selection_reason: z.string().describe('Explanation of why this product was chosen over alternatives based on constraints'),
    }),
    execute: async ({ product_id, quantity = 1, selection_reason }: any) => {
      const product = getProductById(product_id);
      if (!product) return { success: false, error: `Product ${product_id} not found` };
      const merchant = getMerchantById(product.merchantId);
      if (!merchant) return { success: false, error: `Merchant ${product.merchantId} not found` };

      const quote = calculateProductQuote(product, quantity);
      const policyResult = validatePurchasePolicy(quote, DEFAULT_PURCHASE_POLICY);

      if (!policyResult.allowed) {
        return {
          success: false,
          error: `Purchase blocked by policy: ${policyResult.violations.join('; ')}`,
          violations: policyResult.violations,
        };
      }

      // Compute deterministic score and component breakdown
      const scored = scoreProduct(product, merchant, quote, {
        query: product.name,
        category: product.category,
        maxAmountPaise: DEFAULT_PURCHASE_POLICY.max_amount,
        currency: 'INR',
        maxDeliveryDays: 3,
        minimumReturnDays: 7,
        requiresAgentCheckout: true,
        requiresRazorpay: true,
      });

      // Create frozen purchase plan
      const plan = createPurchasePlan({
        product,
        merchant,
        quantity,
        score: scored.score,
        reasons: scored.reasons,
      });

      const purchaseRequest = CommerceStore.createPurchaseRequest({
        merchantId: product.merchantId,
        productId: product.id,
        quantity,
        quote,
        policyResult,
        selectionReason: selection_reason,
      });

      return {
        success: true,
        purchaseRequestId: purchaseRequest.id,
        purchasePlanId: plan.id,
        approvalRequired: policyResult.requiresApproval,
        approvalCard: {
          purchaseRequestId: purchaseRequest.id,
          purchasePlanId: plan.id,
          productName: product.name,
          merchantName: merchant.name,
          basePriceFormatted: quote.formattedBreakdown.basePriceFormatted,
          shippingFormatted: quote.formattedBreakdown.shippingFormatted,
          taxFormatted: quote.formattedBreakdown.taxFormatted,
          discountFormatted: quote.formattedBreakdown.discountFormatted,
          totalFormatted: quote.formattedBreakdown.totalFormatted,
          totalPaise: quote.finalTotalPaise,
          budgetFormatted: formatINR(DEFAULT_PURCHASE_POLICY.max_amount),
          remainingBudgetFormatted: formatINR(DEFAULT_PURCHASE_POLICY.max_amount - quote.finalTotalPaise),
          deliveryEstimate: `${product.deliveryDays} Days`,
          returnPolicy: `${product.returnDays} Days Return Policy`,
          aiScore: scored.score,
          scoreBreakdown: scored.breakdown,
          verifiedReasons: scored.reasons,
          whySelected: selection_reason,
          quoteHash: quote.quoteHash,
        },
      };
    },
  },

  create_razorpay_order: {
    name: 'create_razorpay_order',
    description: 'Create a Razorpay Order for an approved purchase request. Requires explicit human approval first.',
    inputSchema: z.object({
      purchase_request_id: z.string().describe('Purchase request ID (e.g. req_...)'),
    }),
    execute: async ({ purchase_request_id }: { purchase_request_id: string }) => {
      const request = CommerceStore.getPurchaseRequest(purchase_request_id);
      if (!request) return { success: false, error: `Request ${purchase_request_id} not found` };
      if (request.approvalStatus !== 'APPROVED') {
        return {
          success: false,
          error: `Cannot create Razorpay Order: Approval status is '${request.approvalStatus}'. Human approval is required first.`,
        };
      }

      // Create transaction
      const transaction = CommerceStore.createTransaction({
        purchaseRequestId: request.id,
      });

      // Call Razorpay Adapter to create order
      const razorpayOrder = await razorpayAdapter.createOrder({
        amountPaise: transaction.amountPaise,
        currency: 'INR',
        receipt: transaction.transactionId,
        notes: {
          transactionId: transaction.transactionId,
          productId: transaction.productId,
          merchantId: transaction.merchantId,
        },
      });

      // Attach Razorpay Order to transaction
      CommerceStore.attachRazorpayOrder(transaction.transactionId, razorpayOrder.id, razorpayOrder.mode);

      return {
        success: true,
        transactionId: transaction.transactionId,
        razorpayOrderId: razorpayOrder.id,
        amountPaise: razorpayOrder.amount,
        amountFormatted: formatINR(razorpayOrder.amount),
        mode: razorpayOrder.mode,
        status: razorpayOrder.status,
      };
    },
  },

  verify_payment: {
    name: 'verify_payment',
    description: 'Deterministically verify Razorpay payment signature and fulfill merchant order. Agent is not allowed to declare payment success without this check.',
    inputSchema: z.object({
      transaction_id: z.string().describe('Transaction ID (tx_...)'),
      payment_id: z.string().describe('Razorpay payment ID (pay_... or sim_pay_...)'),
      signature: z.string().describe('Razorpay payment signature'),
      payment_method: z.string().default('card').describe('Payment method used e.g. card, upi'),
    }),
    execute: async ({ transaction_id, payment_id, signature, payment_method }: any) => {
      const tx = CommerceStore.getTransaction(transaction_id);
      if (!tx) return { success: false, error: `Transaction ${transaction_id} not found` };
      if (!tx.razorpayOrderId) return { success: false, error: 'Transaction has no associated Razorpay Order' };

      // Deterministic signature check via Razorpay Adapter
      const verification = razorpayAdapter.verifyPaymentSignature({
        orderId: tx.razorpayOrderId,
        paymentId: payment_id,
        signature,
      });

      if (!verification.isValid) {
        CommerceStore.recordPaymentAttempt({
          transactionId: transaction_id,
          paymentId: payment_id,
          method: payment_method,
          status: 'FAILED',
          errorDescription: verification.error || 'Payment signature mismatch',
        });
        return {
          success: false,
          verified: false,
          error: 'Razorpay payment signature verification failed. Fulfillment aborted.',
        };
      }

      // Record successful payment
      CommerceStore.recordPaymentAttempt({
        transactionId: transaction_id,
        paymentId: payment_id,
        method: payment_method,
        status: 'SUCCESS',
        signature,
      });

      // Execute fulfillment
      const fulfilledTx = CommerceStore.fulfillTransaction(transaction_id);

      return {
        success: true,
        verified: true,
        mode: verification.mode,
        transactionId: transaction_id,
        razorpayOrderId: tx.razorpayOrderId,
        razorpayPaymentId: payment_id,
        state: fulfilledTx.state,
        fulfillmentTrackingNumber: fulfilledTx.fulfillmentTrackingNumber,
        message: 'Payment verified and merchant order fulfilled successfully.',
      };
    },
  },

  get_order_status: {
    name: 'get_order_status',
    description: 'Fetch real-time transaction state, Razorpay identifiers, and fulfillment status for a given transaction.',
    inputSchema: z.object({
      transaction_id: z.string().describe('Transaction ID'),
    }),
    execute: async ({ transaction_id }: { transaction_id: string }) => {
      const tx = CommerceStore.getTransaction(transaction_id);
      if (!tx) return { success: false, error: `Transaction ${transaction_id} not found` };
      return {
        success: true,
        transaction: tx,
      };
    },
  },

  reconcile_payment: {
    name: 'reconcile_payment',
    description: 'Authoritatively reconcile payment status against Razorpay servers. Use when network drops or state is unknown before deciding to retry or fulfill.',
    inputSchema: z.object({
      transaction_id: z.string().describe('Internal Transaction ID'),
    }),
    execute: async ({ transaction_id }: { transaction_id: string }) => {
      const result = await CommerceStore.reconcilePayment(transaction_id);
      return result;
    },
  },

  retry_payment: {
    name: 'retry_payment',
    description: 'Safely retry a failed payment with another payment method. Enforces max retry limit (3) and prevents duplicate charges.',
    inputSchema: z.object({
      transaction_id: z.string().describe('Transaction ID'),
      payment_method: z.string().default('card').describe('Alternative payment method e.g. card, upi, netbanking'),
    }),
    execute: async ({ transaction_id, payment_method }: { transaction_id: string; payment_method: string }) => {
      try {
        const tx = CommerceStore.retryPayment(transaction_id, payment_method);
        return {
          success: true,
          transactionId: tx.transactionId,
          state: tx.state,
          paymentMethod: payment_method,
          attemptNumber: tx.paymentAttempts.length + 1,
          message: 'Retry approved. Reusing existing order with zero duplicate charge.',
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },

  request_refund: {
    name: 'request_refund',
    description: 'Process a controlled refund for a completed purchase. Checks merchant return policy and creates Razorpay refund.',
    inputSchema: z.object({
      transaction_id: z.string().describe('Transaction ID to refund'),
      reason: z.string().optional().describe('Reason for refund request'),
      amount_paise: z.number().optional().describe('Optional partial refund amount in paise'),
    }),
    execute: async ({ transaction_id, reason, amount_paise }: any) => {
      try {
        const result = await CommerceStore.requestRefund({
          transactionId: transaction_id,
          amountPaise: amount_paise,
          reason,
        });
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },

  get_audit_trail: {
    name: 'get_audit_trail',
    description: 'Retrieve immutable financial audit trail of transactions, approvals, Razorpay orders, and fulfillment events.',
    inputSchema: z.object({
      limit: z.number().default(20).describe('Max events to retrieve'),
    }),
    execute: async ({ limit }: { limit: number }) => {
      const events = CommerceStore.getAuditEvents(limit);
      return {
        success: true,
        count: events.length,
        events,
      };
    },
  },
};

// All tools combined
export const allTools: Record<string, CoreTool> = {
  ...arcTools,
  ...commerceTools,
};

// Type helpers
export type ArcToolName = keyof typeof arcTools;
export type CommerceToolName = keyof typeof commerceTools;
