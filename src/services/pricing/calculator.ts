/**
 * Deterministic Server-Side Pricing Calculator
 *
 * CRITICAL FINANCIAL SAFETY RULE:
 * The LLM must NEVER determine or modify the final payment amount.
 * All financial amounts are calculated and validated strictly in INTEGER PAISE.
 *
 * Formula:
 * Final Total (paise) = (Base Price * Qty) + Shipping + GST Tax - Discount
 */

import { Product, getProductById } from '@/data/products';

export interface CartItemInput {
  productId: string;
  quantity: number;
}

export interface LineItemQuote {
  productId: string;
  name: string;
  quantity: number;
  unitBasePricePaise: number;
  totalBasePricePaise: number;
  gstRate: number;
  taxPaise: number;
  shippingFeePaise: number;
  discountPaise: number;
  subtotalPaise: number;
}

export interface PricingQuote {
  merchantId: string;
  currency: 'INR';
  lineItems: LineItemQuote[];
  baseSubtotalPaise: number;
  shippingTotalPaise: number;
  taxTotalPaise: number;
  discountTotalPaise: number;
  finalTotalPaise: number;
  finalTotalINR: number;        // in rupees for human display e.g. 2949
  formattedBreakdown: {
    basePriceFormatted: string;
    shippingFormatted: string;
    taxFormatted: string;
    discountFormatted: string;
    totalFormatted: string;
  };
  calculatedAt: number;
  quoteHash: string;            // Deterministic fingerprint of price parameters
}
export type ProductQuote = PricingQuote;

/**
 * Format integer paise into Indian Rupee string (e.g. ₹2,949.00)
 */
export function formatINR(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Compute deterministic quote for a single product
 */
export function calculateProductQuote(
  product: Product,
  quantity = 1,
  discountCode?: string
): PricingQuote {
  if (quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error(`Invalid quantity: ${quantity}. Must be positive integer.`);
  }

  const unitBasePricePaise = product.basePricePaise;
  const totalBasePricePaise = unitBasePricePaise * quantity;
  const shippingFeePaise = product.shippingFeePaise;
  const taxPaise = product.taxPaise * quantity;

  let discountPaise = product.discountPaise * quantity;
  if (discountCode?.toUpperCase() === 'RAZORPAY100') {
    discountPaise += 10000; // ₹100 discount coupon
  }

  const finalTotalPaise = Math.max(0, totalBasePricePaise + shippingFeePaise + taxPaise - discountPaise);
  const finalTotalINR = finalTotalPaise / 100;

  const quoteHash = `${product.id}:${quantity}:${totalBasePricePaise}:${shippingFeePaise}:${taxPaise}:${discountPaise}:${finalTotalPaise}`;

  return {
    merchantId: product.merchantId,
    currency: 'INR',
    lineItems: [
      {
        productId: product.id,
        name: product.name,
        quantity,
        unitBasePricePaise,
        totalBasePricePaise,
        gstRate: product.gstRate,
        taxPaise,
        shippingFeePaise,
        discountPaise,
        subtotalPaise: finalTotalPaise,
      },
    ],
    baseSubtotalPaise: totalBasePricePaise,
    shippingTotalPaise: shippingFeePaise,
    taxTotalPaise: taxPaise,
    discountTotalPaise: discountPaise,
    finalTotalPaise,
    finalTotalINR,
    formattedBreakdown: {
      basePriceFormatted: formatINR(totalBasePricePaise),
      shippingFormatted: shippingFeePaise === 0 ? 'FREE' : formatINR(shippingFeePaise),
      taxFormatted: formatINR(taxPaise),
      discountFormatted: discountPaise > 0 ? `-${formatINR(discountPaise)}` : '₹0',
      totalFormatted: formatINR(finalTotalPaise),
    },
    calculatedAt: Date.now(),
    quoteHash,
  };
}

/**
 * Compute deterministic quote from a list of cart items
 */
export function calculateCartQuote(
  items: CartItemInput[],
  discountCode?: string
): PricingQuote {
  if (!items || items.length === 0) {
    throw new Error('Cart is empty. Cannot compute pricing quote.');
  }

  let merchantId = '';
  let baseSubtotalPaise = 0;
  let shippingTotalPaise = 0;
  let taxTotalPaise = 0;
  let discountTotalPaise = 0;

  const lineItems: LineItemQuote[] = [];

  for (const item of items) {
    const product = getProductById(item.productId);
    if (!product) {
      throw new Error(`Product not found: ${item.productId}`);
    }

    if (!merchantId) {
      merchantId = product.merchantId;
    } else if (merchantId !== product.merchantId) {
      throw new Error('Multi-merchant carts not supported in single checkout. All items must belong to the same merchant.');
    }

    const singleQuote = calculateProductQuote(product, item.quantity, discountCode);
    const lineItem = singleQuote.lineItems[0];
    lineItems.push(lineItem);

    baseSubtotalPaise += lineItem.totalBasePricePaise;
    shippingTotalPaise += lineItem.shippingFeePaise;
    taxTotalPaise += lineItem.taxPaise;
    discountTotalPaise += lineItem.discountPaise;
  }

  const finalTotalPaise = Math.max(
    0,
    baseSubtotalPaise + shippingTotalPaise + taxTotalPaise - discountTotalPaise
  );
  const finalTotalINR = finalTotalPaise / 100;

  const quoteHash = `${merchantId}:${items.map((i) => `${i.productId}x${i.quantity}`).join(',')}:${finalTotalPaise}`;

  return {
    merchantId,
    currency: 'INR',
    lineItems,
    baseSubtotalPaise,
    shippingTotalPaise,
    taxTotalPaise,
    discountTotalPaise,
    finalTotalPaise,
    finalTotalINR,
    formattedBreakdown: {
      basePriceFormatted: formatINR(baseSubtotalPaise),
      shippingFormatted: shippingTotalPaise === 0 ? 'FREE' : formatINR(shippingTotalPaise),
      taxFormatted: formatINR(taxTotalPaise),
      discountFormatted: discountTotalPaise > 0 ? `-${formatINR(discountTotalPaise)}` : '₹0',
      totalFormatted: formatINR(finalTotalPaise),
    },
    calculatedAt: Date.now(),
    quoteHash,
  };
}
