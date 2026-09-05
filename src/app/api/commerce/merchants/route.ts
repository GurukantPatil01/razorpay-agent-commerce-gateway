import { NextResponse } from 'next/server';
import { getAllMerchants } from '@/data/merchants';

export const dynamic = 'force-dynamic';

export async function GET() {
  const merchants = getAllMerchants();
  return NextResponse.json({
    success: true,
    count: merchants.length,
    merchants,
  });
}
