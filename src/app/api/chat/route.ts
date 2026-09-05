import { streamText, convertToModelMessages, UIMessage, stepCountIs, createUIMessageStream, createUIMessageStreamResponse } from "ai";
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

  // Extract prompt from latest user message across various UI message structures
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  let prompt = "";
  if (lastUserMsg) {
    if (Array.isArray(lastUserMsg.parts)) {
      prompt = lastUserMsg.parts
        .map((p: any) => (p.type === "text" ? p.text : typeof p === "string" ? p : ""))
        .filter(Boolean)
        .join(" ");
    }
    if (!prompt && (lastUserMsg as any).content) {
      prompt = typeof (lastUserMsg as any).content === "string"
        ? (lastUserMsg as any).content
        : JSON.stringify((lastUserMsg as any).content);
    }
  }

  // Only invoke Google Gemini if a genuine AI Studio API key (starts with AIzaSy) is configured
  if (apiKey && apiKey.startsWith("AIzaSy")) {
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

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "text-start", id: "agent_response_0" });
      writer.write({ type: "text-delta", id: "agent_response_0", delta: streamContent });
      writer.write({ type: "text-end", id: "agent_response_0" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
