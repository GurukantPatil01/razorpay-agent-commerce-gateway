import { NextResponse } from 'next/server';
import { getAllMerchants } from '@/data/merchants';

export const dynamic = 'force-dynamic';

export async function GET() {
  const merchants = getAllMerchants();

  return NextResponse.json({
    gateway: {
      name: 'RazorPay Agent Commerce Gateway',
      version: '1.0.0',
      description: 'Standard machine-readable discovery and execution protocol for AI buyers',
    },
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
    ],
    merchants: merchants.map((m) => ({
      id: m.id,
      name: m.name,
      rating: m.rating,
      standardDeliveryDays: m.standardDeliveryDays,
      returnPolicyDays: m.returnPolicyDays,
      supportedCurrencies: m.supportedCurrencies,
      paymentProvider: m.paymentProvider,
      agentPurchases: m.agentPurchasesSupported,
    })),
  });
}
