/**
 * Stats API endpoint for merchant dashboard
 *
 * Returns payment statistics for the dashboard to display.
 * Includes actual on-chain balance from Circle SDK.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getStats, shouldRefreshBalance, getCachedBalance, setCachedBalance, getCachedWallet, updatePaymentTxHash } from '@/lib/stats'
import { getMerchantWallet, getWalletBalance } from '@/lib/circle-wallet'

export const dynamic = 'force-dynamic'

export async function GET() {
  const stats = getStats()

  // Use cached values
  let merchantWallet = getCachedWallet();
  let onChainBalance = getCachedBalance();

  // Only hit Circle API when we need to refresh
  if (shouldRefreshBalance()) {
    try {
      console.log(`📊 Refreshing from Circle API...`);
      const wallet = await getMerchantWallet();
      const balances = await getWalletBalance(wallet.id);

      // Token can be 'USDC' or 'USDC-TESTNET' depending on network
      const usdcBalance = balances.find((b: any) =>
        b.token?.symbol?.includes('USDC') || b.token?.includes('USDC')
      );
      onChainBalance = usdcBalance?.amount || '0';

      // Store both wallet and balance
      setCachedBalance(onChainBalance, wallet.id, wallet.address);
      merchantWallet = { id: wallet.id, address: wallet.address };
      console.log(`📊 Balance updated: $${onChainBalance}`);
    } catch (error) {
      console.error('Failed to get merchant wallet:', error);
    }
  }

  return NextResponse.json({
    ...stats,
    merchantWallet,
    onChainBalance,
  })
}

/**
 * POST /api/stats - Update payment with transaction hash
 *
 * Called by MCP client after settlement to record the txHash.
 */
export async function POST(req: NextRequest) {
  try {
    const { slug, payer, txHash } = await req.json()

    if (!slug || !payer || !txHash) {
      return NextResponse.json(
        { error: 'Missing required fields: slug, payer, txHash' },
        { status: 400 }
      )
    }

    const updated = updatePaymentTxHash(slug, payer, txHash)

    if (updated) {
      console.log(`📊 Updated txHash for ${slug}: ${txHash}`)
      return NextResponse.json({ success: true, txHash })
    } else {
      return NextResponse.json(
        { error: 'No matching payment found to update' },
        { status: 404 }
      )
    }
  } catch (error) {
    console.error('Failed to update txHash:', error)
    return NextResponse.json(
      { error: 'Failed to update transaction hash' },
      { status: 500 }
    )
  }
}
