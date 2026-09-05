import { NextResponse } from 'next/server';
import { mutateProductPrice, resetProductPrice, getProductById } from '@/data/products';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productId, newBasePricePaise, action } = body;

    if (!productId) {
      return NextResponse.json({ success: false, error: 'productId is required' }, { status: 400 });
    }

    if (action === 'RESET') {
      const resetProd = resetProductPrice(productId);
      return NextResponse.json({
        success: true,
        action: 'RESET',
        product: resetProd,
      });
    }

    if (typeof newBasePricePaise !== 'number') {
      return NextResponse.json(
        { success: false, error: 'newBasePricePaise must be a number' },
        { status: 400 }
      );
    }

    const mutatedProd = mutateProductPrice(productId, newBasePricePaise);

    return NextResponse.json({
      success: true,
      action: 'MUTATE',
      product: mutatedProd,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
