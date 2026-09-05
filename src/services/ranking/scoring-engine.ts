/**
 * Deterministic Product Scoring & Ranking Engine
 *
 * Requirements:
 * 1. Hard constraint pre-filtering (agent compatibility, Razorpay, budget, delivery, returns, stock)
 * 2. Reproducible component-wise scoring: score(A) === score(A) on every execution
 * 3. Exact component scores: price (30%), delivery (20%), returns (15%), rating (15%), inventory (10%), agent (5%), razorpay (5%)
 * 4. Human-readable explanations derived strictly from verified backend facts
 * 5. NO_QUALIFYING_PRODUCT detection when hard constraints fail
 */

import { Product, getProductById, searchProducts, products as allProducts } from '../../data/products';
import { Merchant, getMerchantById } from '../../data/merchants';
import { calculateProductQuote, ProductQuote, formatINR } from '../pricing/calculator';
import { PurchaseIntent } from '../intent/parser';

export interface ScoreBreakdown {
  price: number;
  delivery: number;
  returns: number;
  rating: number;
  inventory: number;
  agentCompatibility: number;
  razorpayCompatibility: number;
  total: number;
}

export interface ScoredCandidate {
  product: Product;
  merchant: Merchant;
  quote: ProductQuote;
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  qualifies: boolean;
  hardFilterViolations: string[];
}

export interface RankingResult {
  status: 'QUALIFIED_MATCH' | 'NO_QUALIFYING_PRODUCT';
  winner?: ScoredCandidate;
  candidates: ScoredCandidate[];
  nearMatches: ScoredCandidate[];
  totalEvaluated: number;
  summary: string;
}

/**
 * Deterministically evaluates a single candidate product against an intent.
 */
export function scoreProduct(
  product: Product,
  merchant: Merchant,
  quote: ProductQuote,
  intent: PurchaseIntent
): ScoredCandidate {
  const violations: string[] = [];

  // 1. HARD FILTERS
  if (intent.requiresAgentCheckout && !merchant.agentPurchasesSupported) {
    violations.push(`Merchant '${merchant.name}' does not support autonomous agent checkout`);
  }

  if (intent.requiresRazorpay && merchant.paymentProvider !== 'razorpay') {
    violations.push(`Merchant '${merchant.name}' uses provider '${merchant.paymentProvider}', Razorpay required`);
  }

  if (intent.maxAmountPaise !== null && quote.finalTotalPaise > intent.maxAmountPaise) {
    violations.push(
      `Exceeds budget: ${quote.formattedBreakdown.totalFormatted} > ${formatINR(intent.maxAmountPaise)}`
    );
  }

  if (intent.maxDeliveryDays !== null && product.deliveryDays > intent.maxDeliveryDays) {
    violations.push(
      `Delivery too slow: ${product.deliveryDays} days > max ${intent.maxDeliveryDays} days`
    );
  }

  if (intent.minimumReturnDays !== null && product.returnDays < intent.minimumReturnDays) {
    violations.push(
      `Return window too short: ${product.returnDays} days < min ${intent.minimumReturnDays} days`
    );
  }

  if (!product.inStock || product.inventory <= 0) {
    violations.push('Product is currently out of stock');
  }

  const qualifies = violations.length === 0;

  // 2. DETERMINISTIC COMPONENT SCORING (Max 100 points)
  // A. Price Score (Max 30 pts): Proportional savings under budget or value ratio
  let priceScore = 0;
  if (intent.maxAmountPaise !== null) {
    const savingsPaise = Math.max(0, intent.maxAmountPaise - quote.finalTotalPaise);
    const savingsRatio = savingsPaise / intent.maxAmountPaise;
    priceScore = Math.min(30, Math.round((20 + savingsRatio * 10) * 10) / 10);
  } else {
    // Default baseline score for reasonable pricing under ₹3,500
    priceScore = Math.min(30, Math.max(10, Math.round((35 - quote.finalTotalPaise / 10000) * 10) / 10));
  }

  // B. Delivery Score (Max 20 pts): Faster delivery gets higher points
  // 1 day = 20 pts, 2 days = 18 pts, 3 days = 15 pts, 4 days = 12 pts, 5+ days = 8 pts
  let deliveryScore = 8;
  if (product.deliveryDays <= 1) deliveryScore = 20;
  else if (product.deliveryDays <= 2) deliveryScore = 18;
  else if (product.deliveryDays <= 3) deliveryScore = 15;
  else if (product.deliveryDays <= 4) deliveryScore = 12;

  // C. Returns Score (Max 15 pts): Longer return policy gets more points
  // >=14 days = 15 pts, >=10 days = 13 pts, >=7 days = 10 pts, <7 days = 5 pts
  let returnScore = 5;
  if (product.returnDays >= 14) returnScore = 15;
  else if (product.returnDays >= 10) returnScore = 13;
  else if (product.returnDays >= 7) returnScore = 10;

  // D. Rating Score (Max 15 pts): Based on merchant and product review rating (0 - 5.0)
  const avgRating = (product.rating + merchant.rating) / 2;
  const ratingScore = Math.round((avgRating / 5.0) * 15 * 10) / 10;

  // E. Inventory Score (Max 10 pts): Depth of stock
  let inventoryScore = 5;
  if (product.inventory >= 50) inventoryScore = 10;
  else if (product.inventory >= 20) inventoryScore = 8;
  else if (product.inventory >= 1) inventoryScore = 6;

  // F. Agent Compatibility Score (5 pts)
  const agentScore = merchant.agentPurchasesSupported ? 5 : 0;

  // G. Razorpay Compatibility Score (5 pts)
  const razorpayScore = merchant.paymentProvider === 'razorpay' ? 5 : 0;

  const totalScore = Math.round(
    (priceScore + deliveryScore + returnScore + ratingScore + inventoryScore + agentScore + razorpayScore) * 10
  ) / 10;

  const breakdown: ScoreBreakdown = {
    price: priceScore,
    delivery: deliveryScore,
    returns: returnScore,
    rating: ratingScore,
    inventory: inventoryScore,
    agentCompatibility: agentScore,
    razorpayCompatibility: razorpayScore,
    total: totalScore,
  };

  // 3. HUMAN-READABLE FACTUAL REASONS (Derived strictly from verified backend facts)
  const reasons: string[] = [];
  if (intent.maxAmountPaise !== null) {
    const diff = intent.maxAmountPaise - quote.finalTotalPaise;
    if (diff > 0) {
      reasons.push(`${formatINR(diff)} below budget`);
    } else if (diff === 0) {
      reasons.push('Exactly matches target budget');
    }
  }
  reasons.push(`${product.deliveryDays}-day delivery`);
  reasons.push(`${product.returnDays}-day return policy`);
  if (merchant.agentPurchasesSupported) {
    reasons.push('agent checkout supported');
  }
  if (merchant.paymentProvider === 'razorpay') {
    reasons.push('Razorpay payment supported');
  }
  if (product.rating >= 4.5) {
    reasons.push(`Top-rated (${product.rating} ★)`);
  }

  return {
    product,
    merchant,
    quote,
    score: totalScore,
    breakdown,
    reasons,
    qualifies,
    hardFilterViolations: violations,
  };
}

/**
 * Evaluates and ranks candidates for a given purchase intent.
 * Supports:
 *   rankCandidates(intent: PurchaseIntent) -> searches matching catalog products automatically
 *   rankCandidates(productsToRank: Product[], intent: PurchaseIntent)
 */
export function rankCandidates(
  firstArg: Product[] | PurchaseIntent,
  secondArg?: PurchaseIntent
): RankingResult {
  let productsToRank: Product[];
  let intent: PurchaseIntent;

  if (Array.isArray(firstArg)) {
    productsToRank = firstArg;
    intent = secondArg!;
  } else {
    intent = firstArg;
    productsToRank = searchProducts(intent.query, intent.category);
    // If search query didn't find products, evaluate all electronics products in catalog
    if (productsToRank.length === 0) {
      productsToRank = allProducts.filter((p) => p.category === intent.category || intent.category === 'electronics');
    }
  }

  const scored: ScoredCandidate[] = [];

  for (const prod of productsToRank) {
    const merchant = getMerchantById(prod.merchantId);
    if (!merchant) continue;

    const quote = calculateProductQuote(prod, 1);
    const scoreResult = scoreProduct(prod, merchant, quote, intent);
    scored.push(scoreResult);
  }

  // Separate qualified vs near matches
  const qualified = scored.filter((c) => c.qualifies);
  const nearMatches = scored.filter((c) => !c.qualifies);

  // Sort qualified candidates deterministically by total score descending, then price ascending
  qualified.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.quote.finalTotalPaise - b.quote.finalTotalPaise;
  });

  // Sort near matches by fewest violations, then score
  nearMatches.sort((a, b) => {
    if (a.hardFilterViolations.length !== b.hardFilterViolations.length) {
      return a.hardFilterViolations.length - b.hardFilterViolations.length;
    }
    return b.score - a.score;
  });

  if (qualified.length === 0) {
    return {
      status: 'NO_QUALIFYING_PRODUCT',
      candidates: scored,
      nearMatches,
      totalEvaluated: scored.length,
      summary: `I couldn't find a product satisfying all of your requirements. Evaluated ${scored.length} products; ${nearMatches.length} near matches found with constraint violations.`,
    };
  }

  const winner = qualified[0];
  return {
    status: 'QUALIFIED_MATCH',
    winner,
    candidates: [...qualified, ...nearMatches],
    nearMatches,
    totalEvaluated: scored.length,
    summary: `Found ${qualified.length} qualifying products across merchants. Top recommendation: ${winner.merchant.name} — ${winner.product.name} (Score: ${winner.score}/100, Total: ${winner.quote.formattedBreakdown.totalFormatted}).`,
  };
}
