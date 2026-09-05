/**
 * x402 Configuration for Arc Network
 */

import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ARC_CONTRACTS } from "./arc";
import { getMerchantWallet } from "./circle-wallet";

// Arc network identifier
export const ARC_NETWORK = "eip155:5042002";

// Facilitator URL (our facilitator server)
const facilitatorUrl = process.env.FACILITATOR_URL || "http://localhost:4022";

// Create facilitator client and resource server
const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
export const server = new x402ResourceServer(facilitatorClient);

// Create EVM scheme with custom money parser for Arc
const evmScheme = new ExactEvmScheme();

// Register Arc's USDC as the default stablecoin for Arc network
evmScheme.registerMoneyParser(async (amount: number, network: string) => {
  if (network === ARC_NETWORK) {
    // Convert decimal amount to 6 decimal USDC
    const tokenAmount = Math.floor(amount * 1_000_000).toString();
    return {
      amount: tokenAmount,
      asset: ARC_CONTRACTS.USDC,
      extra: {
        name: "USDC",
        version: "2",
      },
    };
  }
  return null; // Fall through to default for other networks
});

// Register scheme for Arc network
server.register(ARC_NETWORK, evmScheme);

/**
 * Get merchant wallet address from Circle SDK
 */
export async function getPayToAddress(): Promise<`0x${string}`> {
  const merchant = await getMerchantWallet();
  return merchant.address;
}

/**
 * Create payment config for an endpoint
 */
export async function createPaymentConfig(priceUsd: string, description: string) {
  const payToAddress = await getPayToAddress();

  return {
    accepts: [
      {
        scheme: "exact" as const,
        price: priceUsd,
        network: ARC_NETWORK,
        payTo: payToAddress,
        extra: {
          name: "USDC",
          version: "2",
          asset: ARC_CONTRACTS.USDC,
        },
      },
    ],
    description,
    mimeType: "application/json",
  };
}

