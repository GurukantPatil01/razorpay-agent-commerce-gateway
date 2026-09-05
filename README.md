# RazorPay Agent Commerce Gateway

[![Razorpay Test Mode](https://img.shields.io/badge/Razorpay-Test%20Mode%20Verified-blue.svg)](https://razorpay.com)
[![Next.js](https://img.shields.io/badge/Next.js-16%20(Turbopack)-black.svg)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org)
[![Audit Status](https://img.shields.io/badge/Adversarial%20Audit-59%2F59%20Passed-emerald.svg)](scripts/audit-adversarial.ts)

**An institutional transaction and settlement gateway making merchants natively transactable by AI buyers — with Razorpay acting as the payment, authorization, verification, and recovery infrastructure.**

Built for the **Razorpay AI Buildathon — AI Growth & Agentic Commerce Track**.

---

## 🎯 Core Thesis

> ### **AI proposes. Backend validates. Razorpay executes.**
> *(Autonomous commerce without autonomous financial risk.)*

Most AI shopping demos are fragile chat interfaces that hallucinate prices, lack financial guardrails, or hand autonomous agents direct access to credit cards. 

**RazorPay Agent Commerce Gateway** solves this by establishing strict, non-bypassable boundaries:
* **The AI reasons and discovers.** It evaluates constraints, searches merchants, and ranks products.
* **The backend validates.** It derives deterministic paise pricing, enforces buyer spending policy, and generates an immutable quote hash.
* **The human authorizes.** An itemized approval card requires explicit user confirmation.
* **Razorpay executes.** Orders are created on Razorpay's infrastructure, verified with cryptographic HMAC-SHA256 signatures, reconciled during network timeouts, and fulfilled exactly once.

---

## 🏗️ Architecture & Pipeline

```text
               USER INTENT
  "Wireless keyboard under ₹3,000, 3-day delivery, 7-day returns"
                    │
                    ▼
       AI BUYER DISCOVERY ENGINE
  Query merchants via /.well-known/agent-commerce
  Exclude non-agent & non-Razorpay merchants
  Deterministic scoring (0–100 Component-Wise)
                    │
                    ▼
       DETERMINISTIC PRICING & QUOTE HASH
  Paise-level subtotal + Shipping + 18% GST = ₹2,949
  Canonical SHA-256 Quote Hash generated
  Purchase policy limits & categories checked
                    │
                    ▼
         AUTHORITATIVE APPROVAL GATE
  Itemized Review Card presented to user
  AI CANNOT execute payments autonomously
  Requires explicit human authorization
                    │
                    ▼
       LAST-MOMENT PRICE VERIFICATION
  Quote Hash verified against active catalog
  (If price mutated → PLAN_INVALIDATED, 0 Razorpay API calls)
                    │
                    ▼
         RAZORPAY EXECUTION LAYER
  Server-side order creation: orders.create({ amount: 294900, currency: "INR" })
  Razorpay Checkout Modal / Client Flow
  Server-side HMAC-SHA256 signature verification (timingSafeEqual)
                    │
                    ▼
        RELIABILITY & RECOVERY ENGINE
  Network timeout? → PAYMENT_UNKNOWN → Reconcile with Razorpay API
  Captured? → Safe to fulfill (0 duplicate charges)
  Failed? → Safe to retry via alternative authorized method (Max 3 attempts)
                    │
                    ▼
        MERCHANT FULFILLMENT & AUDIT LOG
  Exactly-once courier dispatch (AWB tracking assigned)
  Immutable financial event trail recorded
```

---

## ⚡ Key Features & Engineering Safeguards

### 1. Machine-Readable Merchant Discovery (`/.well-known/agent-commerce`)
* Merchants expose machine-readable capability manifests declaring payment providers, delivery SLAs, return policies, and autonomous checkout support.
* Strict hard filtering removes non-agent merchants (e.g. *Legacy Mart*) and non-Razorpay providers (e.g. *Global Goods*) before ranking.

### 2. Zero-Hallucination Pricing & Canonical Quote Hashing
* LLMs are strictly forbidden from calculating totals. All financial arithmetic is derived by the backend in integer **paise**.
* An immutable SHA-256 canonical quote hash is calculated over:
  ```text
  quoteHash = SHA256(productId:quantity:baseAmountPaise:shippingPaise:taxPaise:discountPaise:totalPaise)
  ```
* **Price Freeze Guard**: If a merchant increases catalog prices between approval and checkout, the gateway catches the hash mismatch, triggers `PRICE_CHANGE_DETECTED`, and halts execution before any Razorpay API calls are made.

### 3. Authoritative Human Authorization Gate
* The agent cannot directly charge payment methods. It creates a structured `PurchaseRequest` that halts at the human approval gate.
* Any client attempt to bypass approval or send `approved = true` is rejected by the server.

### 4. Real Razorpay Test Mode Verification
* Live Razorpay Test Mode orders (`order_...`) are created with official credentials.
* Payment signatures (`order_id|payment_id`) are verified server-side using constant-time cryptographic comparisons (`crypto.timingSafeEqual`).
* **Secret Zero-Exposure**: Server secrets (`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) never leave the server and are isolated from client bundles.

### 5. Automated Reconciliation & Failure Recovery
* **Network Ambiguity (PAYMENT_UNKNOWN)**: When a transaction experiences an ambiguous timeout after submission, it enters `PAYMENT_UNKNOWN` rather than guessing or retrying blindly.
* **Razorpay Reconcile**: Queries Razorpay's API (`/orders/:id/payments`) to determine actual bank status:
  * **Captured**: Safely marks fulfilled and strictly prohibits retrying.
  * **Not Captured**: Declares safe to retry with an alternative payment method under a strictly budgeted 3-attempt ceiling.
* **Webhook Deduplication**: Webhooks are authenticated with HMAC signatures and tracked by event ID; duplicate deliveries return HTTP 200 `IGNORED_DUPLICATE` to prevent double-fulfillment.

---

## 🎬 4 One-Click Demo Scenarios

The gateway includes four reproducible scenarios accessible from the top control bar:

| Scenario | What It Tests | Expected Outcome |
| :--- | :--- | :--- |
| **Purchase** | Multi-constraint intent search, scoring, human approval, and real Razorpay order placement | Order created (`order_...`), HMAC verified, AWB tracking assigned |
| **Payment failure** | Real recovery engine execution after a declined card attempt | Attempt #1 fails → State reconciled → Re-routes via alternative method with **0 duplicate charges** |
| **Unknown payment** | Simulates network drop/timeout after payment submission | State enters `PAYMENT_UNKNOWN` → Reconciles with Razorpay API → Determines safe retry status |
| **Price change** | Merchant increases price (₹2,499 → ₹2,699) between approval and checkout | Gateway detects quote hash mismatch → Plan invalidated → **0 Razorpay orders placed** |

---

## 🧪 Comprehensive Verification & Test Suites

The project is protected by automated adversarial suites covering financial correctness, tampering prevention, and real Razorpay Test Mode behavior:

```bash
# 1. Typecheck
npm run typecheck

# 2. Core deterministic pricing, policy checks, and approval gate
npm run test:commerce

# 3. Webhook idempotency, payment reconciliation, retry limits, and refunds
npm run test:reliability

# 4. Agentic scoring, heterogeneous merchant protocol, and anti-hallucination guards
npm run test:agent-commerce

# 5. Primary acceptance test flow (Wireless keyboard under ₹3,000)
npm run test:acceptance

# 6. Real Razorpay Test Mode order creation & signature verification
npm run verify:razorpay

# 7. Complete 20-dimension adversarial security & tampering audit
npm run audit:adversarial
```

### Audit Results:
* `npm run test:commerce`: **30 / 30 Passed (100%)**
* `npm run test:reliability`: **35 / 35 Passed (100%)**
* `npm run test:agent-commerce`: **45 / 45 Passed (100%)**
* `npm run test:acceptance`: **Verified 100% Spec Compliant**
* `npm run verify:razorpay`: **Real Razorpay Test Order Created & Verified**
* `npm run audit:adversarial`: **59 / 59 Passed (100%)**

---

## 🚀 Getting Started Locally

### 1. Clone Repository & Install Dependencies
```bash
git clone https://github.com/GurukantPatil01/razorpay-agent-commerce-gateway.git
cd razorpay-agent-commerce-gateway
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Configure your Razorpay Test Mode credentials in `.env.local`:
```env
# Razorpay Test Mode Credentials
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Optional: Google Gemini API Key (starts with AIzaSy) for natural language reasoning
# If left blank, the deterministic autonomous commerce engine executes seamlessly offline.
GEMINI_API_KEY=
```

### 3. Run the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📁 Repository Architecture

```text
src/
├── app/
│   ├── .well-known/agent-commerce/route.ts  # Machine-readable merchant protocol
│   ├── api/chat/route.ts                    # AI intent reasoning & UI message streaming
│   ├── api/commerce/                        # Authoritative commerce endpoints
│   │   ├── approve/route.ts                 # Cryptographic approval gate
│   │   ├── checkout/route.ts                # Last-moment quote hash & Razorpay order
│   │   ├── reconcile/route.ts               # Authoritative payment reconciliation
│   │   ├── refund/route.ts                  # Controlled refund engine
│   │   ├── retry/route.ts                   # Budgeted payment retry engine
│   │   └── webhooks/razorpay/route.ts       # Constant-time signature & idempotency
│   └── page.tsx                             # Minimal fintech UI (Stripe/Linear aesthetic)
├── data/
│   ├── merchants.ts                         # Heterogeneous merchant catalog & capabilities
│   └── products.ts                          # Catalog products with price, GST, SLAs, inventory
├── lib/
│   └── commerce-store.ts                    # In-memory transaction state machine & ledger
├── services/
│   ├── intent/parser.ts                     # Zod-validated natural language parser
│   ├── pricing/calculator.ts                # Deterministic paise arithmetic & tax engine
│   ├── pricing/purchase-plan.ts             # Canonical SHA-256 quote hash engine
│   ├── ranking/scoring-engine.ts            # Reproducible 0–100 component scoring
│   ├── razorpay/adapter.ts                  # Server-side Razorpay SDK & HMAC verification
│   └── transactions/state-machine.ts        # Non-bypassable transaction states
└── scripts/
    ├── audit-adversarial.ts                 # 20-dimension adversarial vulnerability audit
    ├── test-acceptance-flow.ts              # Primary end-to-end acceptance flow
    ├── test-phase1-commerce.ts              # Phase 1 commerce suite
    ├── test-phase2-reliability.ts           # Phase 2 reliability & webhook suite
    ├── test-phase3-agent-commerce.ts        # Phase 3 agentic scoring & protocol suite
    └── verify-real-razorpay-testmode.ts     # Real Razorpay Test Mode verification script
```

---

## 🔒 Security Model

1. **Server-Side Secret Isolation**: `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are never referenced in client components, API JSON responses, or browser bundles.
2. **Client Tampering Immune**: Amounts are never accepted from client requests; transaction pricing is strictly derived from server-side purchase plans.
3. **Double-Spend & Replay Protection**: Webhook deliveries and purchase requests require unique idempotency keys. Repeated calls return existing transaction records.
4. **Controlled Refunds**: Refunds are permitted only on fulfilled transactions and cannot exceed captured paise amounts.

---

## ⚖️ License

MIT License. Developed for the Razorpay AI Buildathon 2026.
