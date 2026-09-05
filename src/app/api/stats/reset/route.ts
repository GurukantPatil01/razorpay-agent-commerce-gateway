/**
 * Reset stats API endpoint
 *
 * GET /api/stats/reset - Clears all payment statistics
 */

import { NextResponse } from 'next/server'
import { resetStats } from '@/lib/stats'

export const dynamic = 'force-dynamic'

export async function GET() {
  resetStats()
  return NextResponse.json({ success: true, message: 'Stats reset' })
}
