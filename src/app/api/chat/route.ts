import { streamText, convertToModelMessages, UIMessage, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import { vercelTools } from "@/tools/adapters/vercel";
import { commerceTools } from "@/tools/core";
import { parsePurchaseIntent } from "@/services/intent/parser";
import { rankCandidates } from "@/services/ranking/scoring-engine";
import { formatINR } from "@/services/pricing/calculator";

export const maxDuration = 60;

const systemPrompt = `You are the AI Buyer Agent for RazorPay Agent Commerce Gateway.
THESIS: AI proposes. Backend validates. Razorpay executes. Autonomous commerce without autonomous risk.

Core Transaction Workflow:
1. Natural language intent -> Extract constraints without inventing missing requirements.
2. Search verified merchants and products on the gateway.
3. Compare candidates deterministically using the backend scoring engine.
4. If no product satisfies hard constraints, reject with NO_QUALIFYING_PRODUCT and show near-matches.
5. If qualified match found, generate deterministic server-side quote and validate purchase policy.
6. Present the concise approval card:
   - Discovered merchants count
   - Best match
   - Itemized total
   - Delivery / returns
   - AI Score
   - Verified reasons
   - Approval requirement

FINANCIAL SAFETY & ANTI-HALLUCINATION RULES:
- NEVER calculate, alter, or invent prices. All totals and quotes must come from backend tools.
- NEVER fabricate Razorpay order IDs or claim payment success.
- NEVER override backend policy rejection or validation failure.`;

export async function POST(request: Request) {
  const { messages }: { messages: UIMessage[] } = await request.json();

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (apiKey) {
    try {
      const result = streamText({
        model: google("gemini-2.0-flash"),
        system: systemPrompt,
        messages: await convertToModelMessages(messages),
        tools: vercelTools,
        stopWhen: stepCountIs(10),
      });

      return result.toUIMessageStreamResponse();
    } catch (err) {
      console.warn("Gemini stream error, falling back to deterministic agent engine:", err);
    }
  }

  // Fallback Deterministic Agent Engine for offline/demo reliability
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const prompt = lastUserMsg?.parts?.map((p: any) => (p.type === "text" ? p.text : "")).join(" ") || "";

  return handleDeterministicAgentFlow(prompt);
}

/**
 * Deterministic agent execution when external LLM API key is pending or for offline reliability.
 * Integrates Zod intent parsing, scoring engine, and structured approval cards.
 */
async function handleDeterministicAgentFlow(prompt: string): Promise<Response> {
  const intentResult = parsePurchaseIntent(prompt);
  let streamContent = "";

  if (intentResult.success && intentResult.intent) {
    const intent = intentResult.intent;
    const rankingResult = rankCandidates(intent);

    if (rankingResult.status === 'NO_QUALIFYING_PRODUCT') {
      streamContent = `### ❌ No Qualifying Product Found

The autonomous gateway evaluated **${rankingResult.totalEvaluated} candidates** across all registered merchants, but **0 products** met 100% of your constraints.

**Your Intent Constraints:**
* Query: **${intent.query}**
* Max Budget: **${intent.maxAmountPaise ? formatINR(intent.maxAmountPaise) : 'No limit'}**
* Max Delivery: **${intent.maxDeliveryDays ? `${intent.maxDeliveryDays} days` : 'No constraint'}**
* Min Returns: **${intent.minimumReturnDays ? `${intent.minimumReturnDays} days` : 'No constraint'}**
* Requires Agent Checkout: **${intent.requiresAgentCheckout ? 'Yes' : 'No'}**
* Requires Razorpay: **${intent.requiresRazorpay ? 'Yes' : 'No'}**

---

### ⚠️ Near-Matches Evaluated:
${rankingResult.candidates.map((c) => `* **${c.merchant.name} - ${c.product.name}**: ${c.quote.formattedBreakdown.totalFormatted} | ${c.product.deliveryDays}d delivery | ${c.product.returnDays}d returns
  * *Reason for exclusion*: ${c.hardFilterViolations.join('; ')}`).join('\n')}

> *Autonomous Safety Rule*: The agent will never force a purchase or violate user constraints. Please relax your delivery, budget, or return requirements to proceed.`;
    } else if (rankingResult.winner) {
      const winner = rankingResult.winner;
      // Generate purchase request
      const purchaseReqRes = await commerceTools.create_purchase_request.execute({
        product_id: winner.product.id,
        quantity: 1,
        selection_reason: winner.reasons.join('; '),
      });

      const card = purchaseReqRes.approvalCard;

      streamContent = `### 🤖 Agentic Commerce Evaluation Summary

* **Discovered Merchants**: **${rankingResult.totalEvaluated}** verified merchants evaluated
* **Best Match**: **${winner.product.name}** via **${winner.merchant.name}**
* **Deterministic Total**: **${card.totalFormatted}** (Base: ${card.basePriceFormatted} + Shipping: ${card.shippingFormatted} + GST: ${card.taxFormatted})
* **Delivery & Returns**: **${winner.product.deliveryDays} Days** delivery SLA | **${winner.product.returnDays} Days** refund policy
* **AI Score**: **${winner.score.toFixed(1)} / 100** (Price: ${winner.breakdown.price} | Delivery: ${winner.breakdown.delivery} | Returns: ${winner.breakdown.returns} | Rating: ${winner.breakdown.rating} | Inventory: ${winner.breakdown.inventory} | Agent: ${winner.breakdown.agentCompatibility} | Razorpay: ${winner.breakdown.razorpayCompatibility})

---

### 🛡️ Verified Factual Reasons
${winner.reasons.map((r) => `* ✅ ${r}`).join('\n')}

---

### ⚖️ Multi-Merchant Comparison
| Merchant | Product | Price | Delivery | Return | Score | Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${rankingResult.candidates.map((c) => `| **${c.merchant.name}** | ${c.product.name} | ${c.quote.formattedBreakdown.totalFormatted} | ${c.product.deliveryDays}d | ${c.product.returnDays}d | **${c.score.toFixed(1)}** | ${c.qualifies ? '🏆 Selected' : `❌ ${c.hardFilterViolations[0] || 'Lower Score'}`} |`).join('\n')}

---

### 📋 Step 4: Human Approval Required
I have generated Purchase Request **\`${card.purchaseRequestId}\`**. To proceed with Razorpay checkout, please review the approval card below and click **[ APPROVE & PAY ]**.

\`\`\`approval-card
${JSON.stringify(card, null, 2)}
\`\`\`
`;
    }
  } else {
    streamContent = `I am your **RazorPay Agent Commerce Gateway** AI Buyer.
THESIS: *AI proposes. Backend validates. Razorpay executes.*

Try searching with constraints:
> **"Find me the best wireless keyboard under ₹3,000 with delivery within 3 days and at least a 7-day return."**

Or test safety & failure recovery:
* Try budget ₹2,700 (triggers **NO_QUALIFYING_PRODUCT** protection)
* Test **Payment Failure Recovery** demo
* Test **Unknown State Reconciliation** demo
* Test **Price Mutation Invalidation** protection`;
  }

  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`0:${JSON.stringify(streamContent)}\n`));
      controller.close();
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Vercel-AI-Data-Stream": "v1",
    },
  });
}
