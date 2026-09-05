import { NextRequest, NextResponse } from 'next/server';
import { getProductById } from '@/data/products';
import { calculateProductQuote } from '@/services/pricing/calculator';
import { validatePurchasePolicy, DEFAULT_PURCHASE_POLICY, PurchasePolicy } from '@/services/policy/engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { productId, quantity = 1, policy } = await req.json();

    const product = getProductById(productId);
    if (!product) {
      return NextResponse.json({ success: false, error: `Product ${productId} not found` }, { status: 404 });
    }

    const quote = calculateProductQuote(product, Number(quantity));
    const activePolicy: PurchasePolicy = policy ? { ...DEFAULT_PURCHASE_POLICY, ...policy } : DEFAULT_PURCHASE_POLICY;
    const policyResult = validatePurchasePolicy(quote, activePolicy);

    return NextResponse.json({
      success: true,
      allowed: policyResult.allowed,
      policyResult,
      quote,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
