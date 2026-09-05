import { NextRequest, NextResponse } from 'next/server';
import { CommerceStore } from '@/lib/commerce-store';
import { razorpayAdapter } from '@/services/razorpay/adapter';
import { formatINR } from '@/services/pricing/calculator';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { purchaseRequestId, idempotencyKey } = await req.json();

    if (!purchaseRequestId) {
      return NextResponse.json({ success: false, error: 'purchaseRequestId is required' }, { status: 400 });
    }

    const request = CommerceStore.getPurchaseRequest(purchaseRequestId);
    if (!request) {
      return NextResponse.json({ success: false, error: `Purchase request ${purchaseRequestId} not found` }, { status: 404 });
    }

    if (request.approvalStatus !== 'APPROVED') {
      return NextResponse.json(
        {
          success: false,
          error: `Checkout blocked: Approval status is '${request.approvalStatus}'. Human approval is strictly required before payment.`,
        },
        { status: 403 }
      );
    }

    // 1. Idempotent Transaction Creation
    const transaction = CommerceStore.createTransaction({
      purchaseRequestId: request.id,
      idempotencyKey,
    });

    // If transaction already has a Razorpay Order attached (idempotency hit), return it
    if (transaction.razorpayOrderId) {
      return NextResponse.json({
        success: true,
        idempotentReused: true,
        transactionId: transaction.transactionId,
        razorpayOrderId: transaction.razorpayOrderId,
        amountPaise: transaction.amountPaise,
        amountFormatted: formatINR(transaction.amountPaise),
        currency: transaction.currency,
        mode: transaction.mode,
        publicConfig: razorpayAdapter.getPublicConfig(),
        productName: transaction.productName,
      });
    }

    // 2. Create Razorpay Order using trusted server-side amount
    const orderResult = await razorpayAdapter.createOrder({
      amountPaise: transaction.amountPaise,
      currency: transaction.currency,
      receipt: transaction.transactionId,
      notes: {
        transactionId: transaction.transactionId,
        productId: transaction.productId,
        merchantId: transaction.merchantId,
        purchaseRequestId: request.id,
      },
    });

    // 3. Attach order to transaction and advance state machine
    CommerceStore.attachRazorpayOrder(transaction.transactionId, orderResult.id, orderResult.mode);

    return NextResponse.json({
      success: true,
      transactionId: transaction.transactionId,
      razorpayOrderId: orderResult.id,
      amountPaise: orderResult.amount,
      amountFormatted: formatINR(orderResult.amount),
      currency: orderResult.currency,
      mode: orderResult.mode,
      publicConfig: razorpayAdapter.getPublicConfig(),
      productName: transaction.productName,
      state: transaction.state,
    });
  } catch (err: any) {
    console.error('Checkout error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
