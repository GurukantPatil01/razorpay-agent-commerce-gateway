/**
 * AI Buyer Policy Engine
 *
 * Enforces spending, safety, delivery, and merchant rules for autonomous AI commerce.
 * If policy validation fails, no Razorpay order can be created.
 */

import { PricingQuote } from '@/services/pricing/calculator';
import { getMerchantById } from '@/data/merchants';
import { getProductById } from '@/data/products';

export interface PurchasePolicy {
  max_amount: number;             // in integer paise (e.g. 300000 = ₹3,000)
  currency: 'INR';
  require_approval: boolean;
  allowed_categories: string[];   // empty means all permitted
  allowed_merchants: string[];    // empty means all permitted
  blocked_merchants: string[];    // explicitly forbidden merchants
  min_return_days: number;        // e.g. 7
  max_delivery_days: number;      // e.g. 3
}

export const DEFAULT_PURCHASE_POLICY: PurchasePolicy = {
  max_amount: 300000,             // ₹3,000.00
  currency: 'INR',
  require_approval: true,
  allowed_categories: ['electronics', 'peripherals', 'office'],
  allowed_merchants: [],
  blocked_merchants: [],
  min_return_days: 7,
  max_delivery_days: 3,
};

export interface PolicyValidationResult {
  allowed: boolean;
  requiresApproval: boolean;
  violations: string[];
  evaluations: {
    budgetCheck: { passed: boolean; maxAllowedPaise: number; requestedPaise: number; remainingBudgetPaise: number };
    currencyCheck: { passed: boolean; expected: string; actual: string };
    merchantCheck: { passed: boolean; merchantId: string; reason?: string };
    categoryCheck: { passed: boolean; categories: string[] };
    deliveryCheck: { passed: boolean; maxDaysAllowed: number; actualDays: number };
    returnPolicyCheck: { passed: boolean; minDaysRequired: number; actualDays: number };
  };
  validatedAt: number;
}

/**
 * Validates a pricing quote against the active purchase policy
 */
export function validatePurchasePolicy(
  quote: PricingQuote,
  policy: PurchasePolicy = DEFAULT_PURCHASE_POLICY
): PolicyValidationResult {
  const violations: string[] = [];

  // 1. Currency Check
  const currencyPassed = quote.currency === policy.currency;
  if (!currencyPassed) {
    violations.push(`Currency mismatch: Policy requires ${policy.currency}, but quote is in ${quote.currency}.`);
  }

  // 2. Budget Check
  const budgetPassed = quote.finalTotalPaise <= policy.max_amount;
  const remainingBudgetPaise = policy.max_amount - quote.finalTotalPaise;
  if (!budgetPassed) {
    violations.push(
      `Budget exceeded: Total ₹${(quote.finalTotalPaise / 100).toFixed(2)} exceeds maximum permitted budget of ₹${(policy.max_amount / 100).toFixed(2)}.`
    );
  }

  // 3. Merchant Check
  const merchant = getMerchantById(quote.merchantId);
  let merchantPassed = true;
  let merchantReason: string | undefined;

  if (!merchant) {
    merchantPassed = false;
    merchantReason = `Unknown merchant: ${quote.merchantId}`;
    violations.push(merchantReason);
  } else if (policy.blocked_merchants.includes(merchant.id)) {
    merchantPassed = false;
    merchantReason = `Merchant ${merchant.name} is on the blocked list.`;
    violations.push(merchantReason);
  } else if (policy.allowed_merchants.length > 0 && !policy.allowed_merchants.includes(merchant.id)) {
    merchantPassed = false;
    merchantReason = `Merchant ${merchant.name} is not on the approved merchants whitelist.`;
    violations.push(merchantReason);
  }

  // 4. Category Check
  const itemCategories = quote.lineItems.map((item) => {
    const prod = getProductById(item.productId);
    return prod?.category.toLowerCase() || 'unknown';
  });

  let categoryPassed = true;
  if (policy.allowed_categories.length > 0) {
    const invalidCategory = itemCategories.find(
      (cat) => !policy.allowed_categories.map((c) => c.toLowerCase()).includes(cat)
    );
    if (invalidCategory) {
      categoryPassed = false;
      violations.push(`Category '${invalidCategory}' is not permitted by spending policy.`);
    }
  }

  // 5. Delivery Window Check
  let maxDeliveryDaysFound = 0;
  for (const item of quote.lineItems) {
    const prod = getProductById(item.productId);
    const itemDelivery = prod?.deliveryDays ?? merchant?.standardDeliveryDays ?? 99;
    if (itemDelivery > maxDeliveryDaysFound) {
      maxDeliveryDaysFound = itemDelivery;
    }
  }

  const deliveryPassed = maxDeliveryDaysFound <= policy.max_delivery_days;
  if (!deliveryPassed) {
    violations.push(
      `Delivery SLA violated: Estimated ${maxDeliveryDaysFound} days exceeds policy maximum of ${policy.max_delivery_days} days.`
    );
  }

  // 6. Return Policy Check
  let minReturnDaysFound = 999;
  for (const item of quote.lineItems) {
    const prod = getProductById(item.productId);
    const itemReturn = prod?.returnDays ?? merchant?.returnPolicyDays ?? 0;
    if (itemReturn < minReturnDaysFound) {
      minReturnDaysFound = itemReturn;
    }
  }

  const returnPolicyPassed = minReturnDaysFound >= policy.min_return_days;
  if (!returnPolicyPassed) {
    violations.push(
      `Return window violated: Merchant offers ${minReturnDaysFound} days, but policy mandates at least ${policy.min_return_days} days.`
    );
  }

  const allowed = violations.length === 0;

  return {
    allowed,
    requiresApproval: policy.require_approval,
    violations,
    evaluations: {
      budgetCheck: {
        passed: budgetPassed,
        maxAllowedPaise: policy.max_amount,
        requestedPaise: quote.finalTotalPaise,
        remainingBudgetPaise,
      },
      currencyCheck: {
        passed: currencyPassed,
        expected: policy.currency,
        actual: quote.currency,
      },
      merchantCheck: {
        passed: merchantPassed,
        merchantId: quote.merchantId,
        reason: merchantReason,
      },
      categoryCheck: {
        passed: categoryPassed,
        categories: itemCategories,
      },
      deliveryCheck: {
        passed: deliveryPassed,
        maxDaysAllowed: policy.max_delivery_days,
        actualDays: maxDeliveryDaysFound,
      },
      returnPolicyCheck: {
        passed: returnPolicyPassed,
        minDaysRequired: policy.min_return_days,
        actualDays: minReturnDaysFound,
      },
    },
    validatedAt: Date.now(),
  };
}
