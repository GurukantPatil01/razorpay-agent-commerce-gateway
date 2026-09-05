/**
 * Arc x402 Facilitator Server
 *
 * Based on x402 example: x402/examples/typescript/facilitator
 * Verifies and settles x402 payments on Arc testnet.
 */

import { x402Facilitator } from "@x402/core/facilitator";
import {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import dotenv from "dotenv";
import express from "express";
import { createPublicClient, http, Abi } from "viem";
import { arcTestnet } from "../lib/arc";
import {
  getWallet,
  executeContractCall,
  sendRawTransaction,
} from "../lib/circle-wallet";

dotenv.config({ path: ".env.local" });

const PORT = process.env.PORT || "4022";
const ARC_NETWORK = "eip155:5042002";

if (!process.env.CIRCLE_FACILITATOR_WALLET_ID) {
  console.error("❌ CIRCLE_FACILITATOR_WALLET_ID environment variable is required");
  console.error("   Create a wallet using the MCP tool and set its ID here");
  process.exit(1);
}

const facilitatorWalletId = process.env.CIRCLE_FACILITATOR_WALLET_ID;

// Get facilitator wallet address from Circle
async function getFacilitatorAddress(): Promise<`0x${string}`> {
  const wallet = await getWallet(facilitatorWalletId);
  if (!wallet?.address) {
    throw new Error("Failed to get facilitator wallet address");
  }
  return wallet.address as `0x${string}`;
}

// Create viem public client (read-only, no wallet needed)
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

// Format ABI function signature for Circle SDK
function formatAbiFunctionSignature(
  functionName: string,
  abi: readonly unknown[]
): string {
  const abiTyped = abi as Abi;
  const func = abiTyped.find(
    (item): item is Extract<typeof item, { type: "function" }> =>
      item.type === "function" && item.name === functionName
  );

  if (!func) {
    throw new Error(`Function ${functionName} not found in ABI`);
  }

  const params = func.inputs.map((input) => input.type).join(",");
  return `${functionName}(${params})`;
}

// Create Circle-based EVM signer
async function createCircleEvmSigner() {
  const facilitatorAddress = await getFacilitatorAddress();
  console.log(`🔐 Facilitator wallet (Circle): ${facilitatorAddress}`);

  return toFacilitatorEvmSigner({
    address: facilitatorAddress,

    // Read-only operations use viem public client
    getCode: (args: { address: `0x${string}` }) => publicClient.getCode(args),

    readContract: (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    }) =>
      publicClient.readContract({
        ...args,
        args: args.args || [],
      } as any),

    verifyTypedData: (args: {
      address: `0x${string}`;
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
      signature: `0x${string}`;
    }) => publicClient.verifyTypedData(args as any),

    // Write operations use Circle SDK
    writeContract: async (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args: readonly unknown[];
    }): Promise<`0x${string}`> => {
      const abiFunctionSignature = formatAbiFunctionSignature(args.functionName, args.abi);

      // Convert args to Circle-compatible format (strings)
      const abiParameters = args.args.map((arg) =>
        typeof arg === "bigint" ? arg.toString() : arg
      ) as (string | number | boolean)[];

      const result = await executeContractCall(
        facilitatorWalletId,
        args.address,
        abiFunctionSignature,
        abiParameters
      );

      return result.txHash as `0x${string}`;
    },

    sendTransaction: async (args: {
      to: `0x${string}`;
      data: `0x${string}`;
    }): Promise<`0x${string}`> => {
      const result = await sendRawTransaction(
        facilitatorWalletId,
        args.to,
        args.data
      );

      return result.txHash as `0x${string}`;
    },

    waitForTransactionReceipt: async (args: { hash: `0x${string}` }) => {
      // Transaction is already confirmed by Circle polling, just fetch receipt
      return publicClient.waitForTransactionReceipt(args);
    },
  });
}

// Initialize facilitator with hooks
const facilitator = new x402Facilitator()
  .onBeforeVerify(async (context) => {
    console.log("📝 Verifying payment...", context);
  })
  .onAfterVerify(async (context) => {
    console.log("✅ Verified", context);
  })
  .onVerifyFailure(async (context) => {
    console.log("❌ Verify failed", context);
  })
  .onBeforeSettle(async (context) => {
    console.log("💸 Settling...", context);
  })
  .onAfterSettle(async (context) => {
    console.log("✅ Settled", context);
  })
  .onSettleFailure(async (context) => {
    console.log("❌ Settle failed", context);
  });


// Express app
const app = express();
app.use(express.json());

// POST /verify
app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response: VerifyResponse = await facilitator.verify(
      paymentPayload,
      paymentRequirements
    );
    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// POST /settle
app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response: SettleResponse = await facilitator.settle(
      paymentPayload as PaymentPayload,
      paymentRequirements as PaymentRequirements
    );
    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);

    if (error instanceof Error && error.message.includes("Settlement aborted:")) {
      return res.json({
        success: false,
        errorReason: error.message.replace("Settlement aborted: ", ""),
        network: req.body?.paymentPayload?.network || "unknown",
      } as SettleResponse);
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /supported
app.get("/supported", async (req, res) => {
  try {
    const response = facilitator.getSupported();
    res.json(response);
  } catch (error) {
    console.error("Supported error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Health check
app.get("/health", async (_req, res) => {
  try {
    const address = await getFacilitatorAddress();
    res.json({ status: "ok", network: ARC_NETWORK, wallet: address, type: "circle" });
  } catch (error) {
    res.status(500).json({ status: "error", error: String(error) });
  }
});

// Start server
async function main() {
  try {
    // Create Circle-based signer
    const evmSigner = await createCircleEvmSigner();

    // Register Arc network with Circle signer
    registerExactEvmScheme(facilitator, {
      signer: evmSigner,
      networks: ARC_NETWORK,
      deployERC4337WithEIP6492: false,
    });

    console.log(`📡 Registered network: ${ARC_NETWORK}`);

    const address = await getFacilitatorAddress();

    app.listen(parseInt(PORT), () => {
      console.log(`\n🚀 Arc x402 Facilitator (Circle SDK) running on http://localhost:${PORT}`);
      console.log(`   Network: ${ARC_NETWORK} (Arc Testnet)`);
      console.log(`   Wallet: ${address} (Circle-managed)`);
      console.log(`   Endpoints: POST /verify, POST /settle, GET /supported, GET /health\n`);
    });
  } catch (error) {
    console.error("Failed to start facilitator:", error);
    process.exit(1);
  }
}

main();
