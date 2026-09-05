import { NextRequest, NextResponse } from 'next/server';
import { CommerceStore } from '@/lib/commerce-store';

export const dynamic = 'force-dynamic';

/**
 * Controlled Refund Endpoint
 *
 * Validates transaction state, eligibility, return policy, and executes refund via Razorpay SDK.
 * Prevents duplicate refunds.
 */
export async function POST(req: NextRequest) {
  try {
    const { transactionId, amountPaise, reason } = await req.json();

    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: 'transactionId is required' },
        { status: 400 }
      );
    }

    const result = await CommerceStore.requestRefund({
      transactionId,
      amountPaise,
      reason,
    });

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
