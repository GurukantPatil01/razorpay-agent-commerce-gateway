import { NextRequest, NextResponse } from 'next/server';
import { getAllMerchants, getMerchantCapabilityDocument } from '@/data/merchants';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const merchantId = searchParams.get('merchantId') || searchParams.get('merchant');

  if (merchantId) {
    const doc = getMerchantCapabilityDocument(merchantId);
    if (!doc) {
      return NextResponse.json({ error: `Merchant '${merchantId}' not found.` }, { status: 404 });
    }
    return NextResponse.json(doc);
  }

  const merchants = getAllMerchants();

  return NextResponse.json({
    gateway: {
      name: 'RazorPay Agent Commerce Gateway',
      version: '1.0.0',
      description: 'Standard machine-readable discovery and execution protocol for AI buyers',
    },
    thesis: 'AI proposes. Backend validates. Razorpay executes.',
    payment_provider: 'razorpay',
    currency: 'INR',
    smallest_unit: 'paise',
    requires_human_approval: true,
    deterministic_pricing_enforced: true,
    capabilities: [
      'product_search',
      'candidate_comparison',
      'deterministic_quote',
      'purchase_policy_validation',
      'human_approval_gate',
      'razorpay_order_creation',
      'signature_verification',
      'idempotent_fulfillment',
      'failure_recovery',
      'immutable_audit_log',
      'agent_purchase',
    ],
    merchants: merchants.map((m) => getMerchantCapabilityDocument(m.id)),
  });
}
