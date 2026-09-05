import { NextRequest, NextResponse } from 'next/server';
import { razorpayAdapter } from '@/services/razorpay/adapter';
import { CommerceStore } from '@/lib/commerce-store';

export const dynamic = 'force-dynamic';

/**
 * Production-style Razorpay Webhook Endpoint
 *
 * Requirements:
 * - Reads raw request body.
 * - Deterministically verifies x-razorpay-signature header with RAZORPAY_WEBHOOK_SECRET.
 * - Constant-time HMAC comparison.
 * - Event deduplication (replaying same event safely ignored).
 * - Supported events: payment.captured, payment.failed, order.paid, refund.created, refund.processed.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature') || '';

    if (!signature) {
      return NextResponse.json(
        { success: false, error: 'Missing x-razorpay-signature header' },
        { status: 400 }
      );
    }

    // Constant-time HMAC verification
    const isValidSignature = razorpayAdapter.verifyWebhookSignature(rawBody, signature);
    if (!isValidSignature) {
      CommerceStore.recordAuditEvent({
        actor: 'RAZORPAY_WEBHOOK',
        action: 'WEBHOOK_SIGNATURE_REJECTED',
        result: 'BLOCKED',
        details: 'Incoming webhook failed cryptographic HMAC signature check. Request rejected.',
      });

      return NextResponse.json(
        { success: false, error: 'Invalid webhook signature' },
        { status: 400 }
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    // Process event with durable deduplication
    const processResult = CommerceStore.processWebhookEvent(payload, rawBody, signature);

    return NextResponse.json(processResult, {
      status: processResult.success ? 200 : 400,
    });
  } catch (err: any) {
    console.error('Webhook processing error:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
