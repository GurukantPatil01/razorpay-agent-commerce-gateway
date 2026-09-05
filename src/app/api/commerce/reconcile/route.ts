import { NextRequest, NextResponse } from 'next/server';
import { CommerceStore } from '@/lib/commerce-store';

export const dynamic = 'force-dynamic';

/**
 * Payment State Reconciliation Endpoint
 *
 * Checks Razorpay server authoritative state for ambiguous / unknown transactions.
 * Prevents double charging when network drops after payment execution.
 */
export async function POST(req: NextRequest) {
  try {
    const { transactionId } = await req.json();

    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: 'transactionId is required' },
        { status: 400 }
      );
    }

    const result = await CommerceStore.reconcilePayment(transactionId);

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
