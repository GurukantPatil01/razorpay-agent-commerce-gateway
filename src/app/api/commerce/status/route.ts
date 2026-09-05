import { NextResponse } from 'next/server';
import { CommerceStore } from '@/lib/commerce-store';
import { razorpayAdapter } from '@/services/razorpay/adapter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const metrics = CommerceStore.getMetrics();
  const recentAudit = CommerceStore.getAuditEvents(30);
  const allTransactions = CommerceStore.getAllTransactions();
  const publicConfig = razorpayAdapter.getPublicConfig();

  return NextResponse.json({
    success: true,
    metrics,
    auditTrail: recentAudit,
    transactions: allTransactions,
    gatewayConfig: publicConfig,
  });
}
