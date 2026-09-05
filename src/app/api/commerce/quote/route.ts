import { NextRequest, NextResponse } from 'next/server';
import { getProductById } from '@/data/products';
import { calculateProductQuote } from '@/services/pricing/calculator';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { productId, quantity = 1, discountCode } = await req.json();

    if (!productId) {
      return NextResponse.json({ success: false, error: 'productId is required' }, { status: 400 });
    }

    const product = getProductById(productId);
    if (!product) {
      return NextResponse.json({ success: false, error: `Product ${productId} not found` }, { status: 404 });
    }

    const quote = calculateProductQuote(product, Number(quantity), discountCode);

    return NextResponse.json({
      success: true,
      quote,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
