import { NextRequest, NextResponse } from 'next/server';
import { CommerceStore } from '@/lib/commerce-store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { purchaseRequestId, action, quoteHash, reason } = await req.json();

    if (!purchaseRequestId) {
      return NextResponse.json({ success: false, error: 'purchaseRequestId is required' }, { status: 400 });
    }

    if (action === 'APPROVE') {
      if (!quoteHash) {
        return NextResponse.json({ success: false, error: 'quoteHash is required for cryptographic approval verification' }, { status: 400 });
      }

      const approvedRequest = CommerceStore.approvePurchaseRequest(purchaseRequestId, quoteHash);
      return NextResponse.json({
        success: true,
        action: 'APPROVED',
        purchaseRequest: approvedRequest,
        message: 'Purchase request approved successfully.',
      });
    } else if (action === 'REJECT') {
      const rejectedRequest = CommerceStore.rejectPurchaseRequest(purchaseRequestId, reason);
      return NextResponse.json({
        success: true,
        action: 'REJECTED',
        purchaseRequest: rejectedRequest,
        message: 'Purchase request rejected by user.',
      });
    } else {
      return NextResponse.json({ success: false, error: `Invalid action: ${action}. Expected APPROVE or REJECT.` }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
