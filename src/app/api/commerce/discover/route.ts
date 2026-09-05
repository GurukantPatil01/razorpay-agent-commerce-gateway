import { NextRequest, NextResponse } from 'next/server';
import { searchProducts } from '@/data/products';
import { getMerchantById } from '@/data/merchants';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const query = searchParams.get('q') || '';
  const category = searchParams.get('category') || undefined;

  const results = searchProducts(query, category);

  const enriched = results.map((p) => {
    const merchant = getMerchantById(p.merchantId);
    return {
      ...p,
      merchantName: merchant?.name,
      merchantRating: merchant?.rating,
      returnPolicyDays: p.returnDays,
      deliveryDays: p.deliveryDays,
    };
  });

  return NextResponse.json({
    success: true,
    count: enriched.length,
    products: enriched,
  });
}
