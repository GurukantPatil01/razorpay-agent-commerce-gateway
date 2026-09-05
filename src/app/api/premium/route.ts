/**
 * Premium API endpoint protected by x402 payment
 *
 * Requires 0.01 USDC payment on Arc to access.
 */

import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { server, getPayToAddress, ARC_NETWORK } from "@/lib/x402";
import { ARC_CONTRACTS } from "@/lib/arc";

// The actual handler that returns premium content
async function premiumHandler(request: NextRequest) {
  // Get the payer address from the verified payment (added by x402 middleware)
  const payerAddress = request.headers.get("x-payer-address") || "unknown";

  // Generate some "premium" insight
  const insights = [
    "Arc settles transactions in under 1 second with deterministic finality.",
    "USDC as native gas eliminates ETH price exposure for transaction costs.",
    "x402 enables micropayments as small as $0.001 with minimal overhead.",
    "Circle's Gateway provides unified USDC balance across all supported chains.",
    "Arc's EVM compatibility means existing Solidity contracts deploy unchanged.",
  ];

  const randomInsight = insights[Math.floor(Math.random() * insights.length)];

  return NextResponse.json({
    success: true,
    payer: payerAddress,
    insight: randomInsight,
    timestamp: new Date().toISOString(),
    message: "Thanks for your payment! Here's your premium insight.",
  });
}

// Dynamic x402 wrapper - fetches merchant address from Circle on each request
export async function GET(req: NextRequest) {
  const payToAddress = await getPayToAddress();

  const wrappedHandler = withX402(
    premiumHandler,
    {
      accepts: [
        {
          scheme: "exact" as const,
          network: ARC_NETWORK,
          payTo: payToAddress,
          price: "$0.01",
          extra: {
            name: "USDC",
            version: "2",
            asset: ARC_CONTRACTS.USDC,
          },
        },
      ],
      description: "Premium AI insight about Arc blockchain",
      mimeType: "application/json",
    },
    server,
  );

  return wrappedHandler(req);
}
