import { NextRequest, NextResponse } from 'next/server';
import { CommerceStore } from '@/lib/commerce-store';
import { razorpayAdapter } from '@/services/razorpay/adapter';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { transactionId, paymentId, signature, paymentMethod = 'card' } = await req.json();

    if (!transactionId || !paymentId) {
      return NextResponse.json(
        { success: false, error: 'transactionId and paymentId are required' },
        { status: 400 }
      );
    }

    const tx = CommerceStore.getTransaction(transactionId);
    if (!tx) {
      return NextResponse.json({ success: false, error: `Transaction ${transactionId} not found` }, { status: 404 });
    }

    if (!tx.razorpayOrderId) {
      return NextResponse.json({ success: false, error: 'Transaction has no associated Razorpay Order' }, { status: 400 });
    }

    // Deterministic signature check
    const verification = razorpayAdapter.verifyPaymentSignature({
      orderId: tx.razorpayOrderId,
      paymentId,
      signature: signature || '',
    });

    if (!verification.isValid) {
      CommerceStore.recordPaymentAttempt({
        transactionId,
        paymentId,
        method: paymentMethod,
        status: 'FAILED',
        errorDescription: verification.error || 'Payment signature mismatch',
      });

      return NextResponse.json(
        {
          success: false,
          verified: false,
          state: 'PAYMENT_FAILED',
          error: 'Deterministic Razorpay signature verification failed. Merchant fulfillment aborted.',
        },
        { status: 400 }
      );
    }

    // Payment successfully verified
    CommerceStore.recordPaymentAttempt({
      transactionId,
      paymentId,
      method: paymentMethod,
      status: 'SUCCESS',
      signature,
    });

    // Execute Merchant Fulfillment
    const fulfilledTx = CommerceStore.fulfillTransaction(transactionId);

    return NextResponse.json({
      success: true,
      verified: true,
      mode: verification.mode,
      transactionId,
      razorpayOrderId: tx.razorpayOrderId,
      razorpayPaymentId: paymentId,
      state: fulfilledTx.state,
      fulfillmentTrackingNumber: fulfilledTx.fulfillmentTrackingNumber,
      message: 'Payment verified and merchant fulfillment completed.',
    });
  } catch (err: any) {
    console.error('Payment verification error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
