import { NextRequest, NextResponse } from 'next/server';
import { CommerceStore } from '@/lib/commerce-store';

export const dynamic = 'force-dynamic';

/**
 * Payment Failure Recovery & Retry Endpoint
 *
 * Enforces retry limit (MAX_ATTEMPTS = 3).
 * Reuses existing Razorpay Order with zero duplicate charges.
 */
export async function POST(req: NextRequest) {
  try {
    const { transactionId, paymentMethod = 'card' } = await req.json();

    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: 'transactionId is required' },
        { status: 400 }
      );
    }

    const tx = CommerceStore.retryPayment(transactionId, paymentMethod);

    return NextResponse.json({
      success: true,
      transactionId: tx.transactionId,
      state: tx.state,
      paymentMethod,
      attemptNumber: tx.paymentAttempts.length + 1,
      message: 'Retry approved. Reusing existing order with zero duplicate charge.',
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
