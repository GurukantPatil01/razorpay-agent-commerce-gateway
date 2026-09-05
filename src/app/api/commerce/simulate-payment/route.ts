import { NextRequest, NextResponse } from 'next/server';
import { CommerceStore } from '@/lib/commerce-store';
import { razorpayAdapter } from '@/services/razorpay/adapter';

export const dynamic = 'force-dynamic';

/**
 * Endpoint for testing payment capture or simulating payment failure in local development / demo mode.
 * When real Razorpay keys are configured, Razorpay Checkout calls /api/commerce/verify directly.
 * When in simulator mode, this creates the simulated payment and signature.
 */
export async function POST(req: NextRequest) {
  try {
    const { transactionId, simulateFailure = false, paymentMethod = 'upi' } = await req.json();

    const tx = CommerceStore.getTransaction(transactionId);
    if (!tx) {
      return NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 });
    }

    if (!tx.razorpayOrderId) {
      return NextResponse.json({ success: false, error: 'Transaction has no Razorpay Order ID' }, { status: 400 });
    }

    const timestamp = Math.floor(Date.now() / 1000);

    if (simulateFailure) {
      // Record payment failure in store
      const failPaymentId = `sim_pay_fail_${timestamp}`;
      CommerceStore.recordPaymentAttempt({
        transactionId,
        paymentId: failPaymentId,
        method: paymentMethod,
        status: 'FAILED',
        errorDescription: 'Payment authorization declined by issuing bank (Simulated failure demo)',
      });

      return NextResponse.json({
        success: false,
        simulated: true,
        paymentId: failPaymentId,
        state: 'PAYMENT_FAILED',
        error: 'Bank authorization declined. Payment failed. Merchant order remains pending.',
      });
    }

    // Success simulation
    const simPaymentId = `sim_pay_${timestamp}_${Math.floor(1000 + Math.random() * 9000)}`;
    const simSignature = razorpayAdapter.generateSimulatedSignature(tx.razorpayOrderId, simPaymentId);

    // Call verify endpoint logic
    const verification = razorpayAdapter.verifyPaymentSignature({
      orderId: tx.razorpayOrderId,
      paymentId: simPaymentId,
      signature: simSignature,
    });

    if (!verification.isValid) {
      return NextResponse.json({ success: false, error: 'Simulated verification failed' }, { status: 400 });
    }

    CommerceStore.recordPaymentAttempt({
      transactionId,
      paymentId: simPaymentId,
      method: paymentMethod,
      status: 'SUCCESS',
      signature: simSignature,
    });

    const fulfilledTx = CommerceStore.fulfillTransaction(transactionId);

    return NextResponse.json({
      success: true,
      simulated: true,
      paymentId: simPaymentId,
      signature: simSignature,
      state: fulfilledTx.state,
      fulfillmentTrackingNumber: fulfilledTx.fulfillmentTrackingNumber,
      message: 'Simulated payment succeeded and order fulfilled.',
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
