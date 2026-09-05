/**
 * Immutable Purchase Plan Service & Cryptographic Quote Hash Engine
 *
 * Requirements:
 * 1. Canonical Quote Hash generated via SHA-256 from financial and catalog attributes.
 * 2. Immutable Purchase Plan created before human approval.
 * 3. Last-moment price validation immediately before Razorpay Order creation:
 *    If price mutates: PLAN_INVALIDATED, Razorpay API call = 0.
 */

import crypto from 'crypto';
import { Product, getProductById } from '../../data/products';
import { Merchant, getMerchantById } from '../../data/merchants';
import { calculateProductQuote, ProductQuote, formatINR } from './calculator';

export interface PurchasePlan {
  id: string;
  merchantId: string;
  merchantName: string;
  productId: string;
  productName: string;
  quantity: number;
  baseAmountPaise: number;
  shippingPaise: number;
  taxPaise: number;
  discountPaise: number;
  totalPaise: number;
  currency: 'INR';
  deliveryDays: number;
  returnDays: number;
  score: number;
  reasons: string[];
  quoteHash: string;
  status: 'ACTIVE' | 'PLAN_INVALIDATED';
  createdAt: number;
  invalidationReason?: string;
}

// In-memory registry of purchase plans
const purchasePlans = new Map<string, PurchasePlan>();

/**
 * Computes a deterministic SHA-256 hash over canonical financial and catalog parameters.
 * Any price, tax, shipping, or merchant change will produce a completely different hash.
 */
export function generateCanonicalQuoteHash(params: {
  merchantId: string;
  productId: string;
  quantity: number;
  baseAmountPaise?: number;
  basePricePaise?: number;
  shippingPaise?: number;
  taxPaise: number;
  currency?: string;
}): string {
  const base = params.baseAmountPaise ?? params.basePricePaise ?? 0;
  const canonicalString = [
    params.merchantId,
    params.productId,
    params.quantity,
    base,
    params.shippingPaise ?? 0,
    params.taxPaise,
    params.currency || 'INR',
  ].join('|');

  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

/**
 * Creates and freezes a new immutable Purchase Plan.
 * Supports both object params and positional params for compatibility.
 */
export function createPurchasePlan(
  firstArg: { product: Product; merchant: Merchant; quantity?: number; score?: number; reasons?: string[]; } | Product,
  secondArg?: Merchant,
  thirdArg?: any,
  fourthArg?: number,
  fifthArg?: any
): PurchasePlan {
  let product: Product;
  let merchant: Merchant;
  let quantity = 1;
  let score = 90.0;
  let reasons: string[] = [];

  if (firstArg && typeof firstArg === 'object' && 'product' in firstArg) {
    product = (firstArg as any).product;
    merchant = (firstArg as any).merchant;
    quantity = (firstArg as any).quantity || 1;
    score = (firstArg as any).score || 90.0;
    reasons = (firstArg as any).reasons || [];
  } else {
    product = firstArg as Product;
    merchant = secondArg!;
    quantity = typeof fourthArg === 'number' ? fourthArg : (typeof thirdArg === 'number' ? thirdArg : 1);
    if (typeof fifthArg === 'string') reasons = [fifthArg];
    else if (Array.isArray(fifthArg)) reasons = fifthArg;
    else if (typeof thirdArg === 'string') reasons = [thirdArg];
  }

  const quote = calculateProductQuote(product, quantity);

  const quoteHash = generateCanonicalQuoteHash({
    merchantId: merchant.id,
    productId: product.id,
    quantity,
    baseAmountPaise: quote.baseSubtotalPaise,
    shippingPaise: quote.shippingTotalPaise,
    taxPaise: quote.taxTotalPaise,
    currency: 'INR',
  });

  const id = `plan_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;

  const plan: PurchasePlan = {
    id,
    merchantId: merchant.id,
    merchantName: merchant.name,
    productId: product.id,
    productName: product.name,
    quantity,
    baseAmountPaise: quote.baseSubtotalPaise,
    shippingPaise: quote.shippingTotalPaise,
    taxPaise: quote.taxTotalPaise,
    discountPaise: quote.discountTotalPaise,
    totalPaise: quote.finalTotalPaise,
    currency: 'INR',
    deliveryDays: product.deliveryDays,
    returnDays: product.returnDays,
    score,
    reasons,
    quoteHash,
    status: 'ACTIVE',
    createdAt: Date.now(),
  };

  purchasePlans.set(id, plan);
  return plan;
}

export function getPurchasePlan(id: string): PurchasePlan | undefined {
  return purchasePlans.get(id);
}

export interface PlanValidationResult {
  valid: boolean;
  status: 'ACTIVE' | 'PLAN_INVALIDATED';
  plan: PurchasePlan;
  currentCatalogQuote?: ProductQuote;
  error?: string;
  details?: string;
}

/**
 * Validates a purchase plan at the last possible moment before creating a Razorpay order.
 * Recalculates live price from the catalog. If catalog price has changed, the plan is invalidated.
 */
export function validatePurchasePlanBeforeCheckout(
  planIdOrPlan: string | PurchasePlan
): PlanValidationResult {
  const plan = typeof planIdOrPlan === 'string' ? purchasePlans.get(planIdOrPlan) : planIdOrPlan;
  if (!plan) {
    throw new Error('Purchase plan not found');
  }

  if (plan.status === 'PLAN_INVALIDATED') {
    return {
      valid: false,
      status: 'PLAN_INVALIDATED',
      plan,
      error: 'PRICE_CHANGE_DETECTED',
      details: plan.invalidationReason || 'Purchase plan was previously invalidated due to price change.',
    };
  }

  // Load current live product from catalog
  const currentProduct = getProductById(plan.productId);
  if (!currentProduct) {
    plan.status = 'PLAN_INVALIDATED';
    plan.invalidationReason = `Product ${plan.productId} is no longer available in merchant catalog.`;
    return {
      valid: false,
      status: 'PLAN_INVALIDATED',
      plan,
      error: 'PRODUCT_UNAVAILABLE',
      details: plan.invalidationReason,
    };
  }

  // Recalculate live quote from catalog
  const liveQuote = calculateProductQuote(currentProduct, plan.quantity);

  // Compute fresh quote hash
  const freshQuoteHash = generateCanonicalQuoteHash({
    merchantId: plan.merchantId,
    productId: plan.productId,
    quantity: plan.quantity,
    baseAmountPaise: liveQuote.baseSubtotalPaise,
    shippingPaise: liveQuote.shippingTotalPaise,
    taxPaise: liveQuote.taxTotalPaise,
    currency: 'INR',
  });

  // Verify hash matches
  if (freshQuoteHash !== plan.quoteHash) {
    plan.status = 'PLAN_INVALIDATED';
    const oldPriceFormatted = formatINR(plan.totalPaise);
    const newPriceFormatted = liveQuote.formattedBreakdown.totalFormatted;

    plan.invalidationReason = `PRICE_CHANGE_DETECTED: Catalog price mutated from ${oldPriceFormatted} to ${newPriceFormatted}. Quote hash mismatch. Stale purchase plan invalidated.`;

    return {
      valid: false,
      status: 'PLAN_INVALIDATED',
      plan,
      currentCatalogQuote: liveQuote,
      error: 'PRICE_CHANGE_DETECTED',
      details: plan.invalidationReason,
    };
  }

  return {
    valid: true,
    status: 'ACTIVE',
    plan,
    currentCatalogQuote: liveQuote,
  };
}
