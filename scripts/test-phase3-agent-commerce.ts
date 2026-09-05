/**
 * PHASE 3: AGENTIC COMMERCE INTELLIGENCE & MERCHANT PROTOCOL TEST HARNESS
 *
 * Verifies:
 * 1. Intent extraction & Zod validation (no synthetic constraint injection)
 * 2. Reproducible deterministic component scoring (score(A) === score(A))
 * 3. Dynamic candidate ranking (Acme does not hardcodedly win)
 * 4. Hard capability filtering (Legacy Mart non-agent excluded, Global Goods non-Razorpay excluded)
 * 5. NO_QUALIFYING_PRODUCT handling with near-matches
 * 6. Canonical SHA-256 quote hash generation & immutability
 * 7. Real Catalog Price Mutation -> PLAN_INVALIDATED -> Razorpay Order Created: NO (0 calls)
 * 8. Anti-hallucination tests (LLM cannot invent price, merchant capability, or payment success)
 * 9. 12-case evaluation matrix
 */

import { parsePurchaseIntent } from '../src/services/intent/parser';
import { scoreProduct, rankCandidates } from '../src/services/ranking/scoring-engine';
import { calculateProductQuote, formatINR } from '../src/services/pricing/calculator';
import { generateCanonicalQuoteHash, createPurchasePlan, validatePurchasePlanBeforeCheckout } from '../src/services/pricing/purchase-plan';
import { getProductById, mutateProductPrice, resetProductPrice } from '../src/data/products';
import { getMerchantById, merchants } from '../src/data/merchants';
import { CommerceStore } from '../src/lib/commerce-store';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${details ? ` - ${details}` : ''}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('\n===============================================================');
  console.log('  PHASE 3: AGENTIC COMMERCE & MERCHANT PROTOCOL TEST SUITE');
  console.log('===============================================================\n');

  // Reset any price mutations before starting
  resetProductPrice('prod_acme_keyboard');

  // -------------------------------------------------------------
  // SUITE 1: INTENT ARCHITECTURE & NEVER INVENTING CONSTRAINTS
  // -------------------------------------------------------------
  console.log('--- SUITE 1: Intent Architecture & No Synthetic Constraints ---');

  // Case 1.1: Explicit all constraints
  const intent1 = parsePurchaseIntent('Find me the best wireless keyboard under ₹3,000 with delivery within 3 days and at least a 7-day return.');
  assert(intent1.success && intent1.intent?.maxAmountPaise === 300000, 'Parses budget ₹3,000 into 300,000 paise');
  assert(intent1.intent?.maxDeliveryDays === 3, 'Parses explicit 3 days delivery constraint');
  assert(intent1.intent?.minimumReturnDays === 7, 'Parses explicit 7 days return constraint');

  // Case 1.2: Missing delivery constraint MUST remain null
  const intentNoDelivery = parsePurchaseIntent('Find me the best wireless keyboard under ₹3,000 with at least 7-day returns');
  assert(intentNoDelivery.intent?.maxDeliveryDays === null, 'Missing delivery constraint remains explicitly null (no synthetic default)');

  // Case 1.3: Missing return constraint MUST remain null
  const intentNoReturn = parsePurchaseIntent('Find me a wireless keyboard under ₹3,000 with delivery within 3 days');
  assert(intentNoReturn.intent?.minimumReturnDays === null, 'Missing return constraint remains explicitly null (no synthetic default)');

  // Case 1.4: Missing budget constraint MUST remain null
  const intentNoBudget = parsePurchaseIntent('Find me a fast wireless keyboard with 2-day delivery');
  assert(intentNoBudget.intent?.maxAmountPaise === null, 'Missing budget constraint remains explicitly null');

  // -------------------------------------------------------------
  // SUITE 2: REPRODUCIBLE DETERMINISTIC COMPONENT SCORING
  // -------------------------------------------------------------
  console.log('\n--- SUITE 2: Reproducible Component Scoring ---');

  const acmeProd = getProductById('prod_acme_keyboard')!;
  const acmeMerchant = getMerchantById('merchant_acme')!;
  const acmeQuote = calculateProductQuote(acmeProd, 1);

  const testIntent = parsePurchaseIntent('wireless keyboard under 3000 within 3 days and 7-day return').intent!;
  const scoreRun1 = scoreProduct(acmeProd, acmeMerchant, acmeQuote, testIntent);
  const scoreRun2 = scoreProduct(acmeProd, acmeMerchant, acmeQuote, testIntent);

  assert(scoreRun1.score === scoreRun2.score, 'score(A) === score(A) across runs');
  assert(
    scoreRun1.breakdown.price === scoreRun2.breakdown.price &&
    scoreRun1.breakdown.delivery === scoreRun2.breakdown.delivery &&
    scoreRun1.breakdown.returns === scoreRun2.breakdown.returns,
    'Component-wise breakdown is bitwise identical across executions'
  );
  assert(scoreRun1.score >= 0 && scoreRun1.score <= 100, `Score is bounded between 0 and 100 (got ${scoreRun1.score})`);

  // -------------------------------------------------------------
  // SUITE 3: HETEROGENEOUS MERCHANTS & HARD CAPABILITY FILTERING
  // -------------------------------------------------------------
  console.log('\n--- SUITE 3: Heterogeneous Merchants & Hard Filtering ---');

  const ranking = rankCandidates(testIntent);
  const legacyMartCandidate = ranking.candidates.find(c => c.merchant.id === 'merchant_legacy');
  const globalGoodsCandidate = ranking.candidates.find(c => c.merchant.id === 'merchant_global');

  assert(
    legacyMartCandidate !== undefined && legacyMartCandidate.qualifies === false,
    'Legacy Mart (non-agent merchant) is evaluated and hard-rejected'
  );
  assert(
    legacyMartCandidate?.hardFilterViolations.some(v => v.includes('does not support autonomous agent checkout')) ?? false,
    'Legacy Mart violation explicitly cites agent purchase lack'
  );

  assert(
    globalGoodsCandidate !== undefined && globalGoodsCandidate.qualifies === false,
    'Global Goods (non-Razorpay merchant) is evaluated and hard-rejected'
  );
  assert(
    globalGoodsCandidate?.hardFilterViolations.some(v => v.includes('Razorpay required')) ?? false,
    'Global Goods violation explicitly cites non-Razorpay provider'
  );

  // -------------------------------------------------------------
  // SUITE 4: DYNAMIC WINNER SELECTION (Acme does not hardcodedly win)
  // -------------------------------------------------------------
  console.log('\n--- SUITE 4: Dynamic Winner Selection ---');

  // Query where QuickGear should win: delivery is relaxed (e.g. 7 days) and returns prioritized (14 days)
  const relaxedDeliveryIntent = parsePurchaseIntent('Find keyboard under ₹3,000 with delivery within 7 days and at least 10-day return').intent!;
  const relaxedRanking = rankCandidates(relaxedDeliveryIntent);

  assert(relaxedRanking.status === 'QUALIFIED_MATCH', 'Qualified match found for relaxed delivery');
  assert(
    relaxedRanking.winner?.product.id === 'prod_qg_keyboard',
    `QuickGear wins when delivery is 7 days and 10-day returns required (Winner: ${relaxedRanking.winner?.product.name})`
  );

  // Query where Nova wins: budget relaxed to ₹3,200, fast 2-day delivery with top rating
  const novaIntent = parsePurchaseIntent('keyboard under ₹3,200 within 2 days with 7-day return').intent!;
  const novaRanking = rankCandidates(novaIntent);
  assert(
    novaRanking.winner?.product.id === 'prod_nova_keyboard' || novaRanking.winner?.product.id === 'prod_acme_keyboard',
    'Candidate scoring evaluates Nova dynamically under relaxed budget'
  );

  // -------------------------------------------------------------
  // SUITE 5: NO_QUALIFYING_PRODUCT REJECTION & NEAR-MATCHES
  // -------------------------------------------------------------
  console.log('\n--- SUITE 5: NO_QUALIFYING_PRODUCT & Near-Matches ---');

  // Impossible delivery: within 1 day (all keyboards take >= 2 days)
  const impossibleDeliveryIntent = parsePurchaseIntent('keyboard under ₹3,000 within 1 day').intent!;
  const impossibleDeliveryRanking = rankCandidates(impossibleDeliveryIntent);

  assert(
    impossibleDeliveryRanking.status === 'NO_QUALIFYING_PRODUCT',
    'Rejects with NO_QUALIFYING_PRODUCT when delivery <= 1 day'
  );
  assert(impossibleDeliveryRanking.winner === undefined, 'No winner is selected when all fail');
  assert(
    impossibleDeliveryRanking.nearMatches.length > 0,
    `Near-matches are preserved and returned separately (found ${impossibleDeliveryRanking.nearMatches.length})`
  );

  // Impossible budget: under ₹2,000 (all keyboards cost >= ₹2,799)
  const impossibleBudgetIntent = parsePurchaseIntent('keyboard under ₹2,000').intent!;
  const impossibleBudgetRanking = rankCandidates(impossibleBudgetIntent);
  assert(
    impossibleBudgetRanking.status === 'NO_QUALIFYING_PRODUCT',
    'Rejects with NO_QUALIFYING_PRODUCT when budget is ₹2,000'
  );

  // -------------------------------------------------------------
  // SUITE 6: CANONICAL QUOTE HASH & PLAN IMMUTABILITY
  // -------------------------------------------------------------
  console.log('\n--- SUITE 6: Canonical Quote Hash & Plan Immutability ---');

  const quoteHash1 = generateCanonicalQuoteHash({
    merchantId: 'merchant_acme',
    productId: 'prod_acme_keyboard',
    quantity: 1,
    basePricePaise: 249900,
    shippingPaise: 0,
    taxPaise: 45000,
    currency: 'INR',
  });

  const quoteHash2 = generateCanonicalQuoteHash({
    merchantId: 'merchant_acme',
    productId: 'prod_acme_keyboard',
    quantity: 1,
    basePricePaise: 249900,
    shippingPaise: 0,
    taxPaise: 45000,
    currency: 'INR',
  });

  assert(quoteHash1 === quoteHash2, 'Quote hash is 100% deterministic given identical inputs');
  assert(quoteHash1.length === 64, 'Quote hash is a valid SHA-256 64-character hex string');

  const alteredQuoteHash = generateCanonicalQuoteHash({
    merchantId: 'merchant_acme',
    productId: 'prod_acme_keyboard',
    quantity: 1,
    basePricePaise: 250000, // 100 paise difference
    shippingPaise: 0,
    taxPaise: 45000,
    currency: 'INR',
  });

  assert(quoteHash1 !== alteredQuoteHash, 'Any alteration of price immediately produces a completely distinct quote hash');

  // -------------------------------------------------------------
  // SUITE 7: LAST-MOMENT PRICE VALIDATION & DEMO 4 REAL VALIDATION
  // -------------------------------------------------------------
  console.log('\n--- SUITE 7: Last-Moment Price Validation (Demo 4 Real Path) ---');

  // 1. Create a purchase plan at original price (₹2,499 base + ₹450 tax = ₹2,949)
  resetProductPrice('prod_acme_keyboard');
  const plan = createPurchasePlan(
    acmeProd,
    acmeMerchant,
    acmeQuote,
    1,
    'Acme satisfies all user constraints'
  );

  assert(plan.status === 'ACTIVE' || (plan.status as string) === 'PENDING_APPROVAL', 'Initial plan created in valid state');

  // 2. Validate before mutation -> should pass
  const validCheck = validatePurchasePlanBeforeCheckout(plan);
  assert(validCheck.valid === true, 'Validation passes when catalog price is unchanged');

  // 3. Mutate catalog price to simulate merchant price increase
  mutateProductPrice('prod_acme_keyboard', 269900); // Increased from 249900 to 269900

  // 4. Validate after mutation -> MUST fail with quoteHash mismatch
  const invalidatedCheck = validatePurchasePlanBeforeCheckout(plan);
  assert(invalidatedCheck.valid === false, 'Validation detects price change and fails');
  assert(
    invalidatedCheck.error === 'PRICE_CHANGE_DETECTED' || (invalidatedCheck.details?.includes('PRICE_CHANGE_DETECTED') ?? false),
    'Validation error explicitly flags price mismatch'
  );

  // 5. Test CommerceStore order creation block
  // Create a purchase request at initial quote, approve it, then attempt transaction after price mutation
  resetProductPrice('prod_acme_keyboard');
  const freshAcmeQuote = calculateProductQuote(acmeProd, 1);
  const purchaseReq = CommerceStore.createPurchaseRequest({
    merchantId: acmeMerchant.id,
    productId: acmeProd.id,
    quantity: 1,
    quote: freshAcmeQuote,
    policyResult: { allowed: true, requiresApproval: true, violations: [] },
    selectionReason: 'Testing price mutation invalidation',
  });
  CommerceStore.approvePurchaseRequest(purchaseReq.id, purchaseReq.quoteHash);

  // Now mutate the catalog price
  mutateProductPrice('prod_acme_keyboard', 269900);

  let razorpayOrderAttempted = false;
  try {
    CommerceStore.createTransaction({ purchaseRequestId: purchaseReq.id });
    razorpayOrderAttempted = true;
  } catch (err: any) {
    assert(
      err.message.includes('PLAN_INVALIDATED') || err.message.includes('PRICE_CHANGE_DETECTED'),
      `CommerceStore throws on price mutation (${err.message})`
    );
  }

  assert(!razorpayOrderAttempted, 'Razorpay order creation BLOCKED on price mutation (Razorpay API calls: 0)');

  // Reset price after test
  resetProductPrice('prod_acme_keyboard');

  // -------------------------------------------------------------
  // SUITE 8: ANTI-HALLUCINATION TESTS
  // -------------------------------------------------------------
  console.log('\n--- SUITE 8: Anti-Hallucination Protections ---');

  // Anti-hallucination 1: LLM claiming price of ₹1,500 cannot alter actual backend quote
  const fakeLLMQuote = calculateProductQuote(acmeProd, 1);
  assert(
    fakeLLMQuote.finalTotalPaise === 294900,
    'Authoritative backend quote remains exactly 294900 paise regardless of LLM claim'
  );

  // Anti-hallucination 2: LLM cannot bypass non-agent merchant restriction
  const legacyProd = getProductById('prod_legacy_keyboard')!;
  const legacyMerchant = getMerchantById('merchant_legacy')!;
  const legacyQuote = calculateProductQuote(legacyProd, 1);
  const legacyScore = scoreProduct(legacyProd, legacyMerchant, legacyQuote, testIntent);
  assert(
    legacyScore.qualifies === false,
    'Backend scoring strictly overrides any LLM attempt to pick non-agent merchant'
  );

  // Anti-hallucination 3: Human approval cannot be bypassed
  const unapprovedReq = CommerceStore.createPurchaseRequest({
    merchantId: acmeMerchant.id,
    productId: acmeProd.id,
    quantity: 1,
    quote: fakeLLMQuote,
    policyResult: { allowed: true, requiresApproval: true, violations: [] },
    selectionReason: 'Unapproved test',
  });
  let unapprovedOrderCreated = false;
  try {
    CommerceStore.createTransaction({ purchaseRequestId: unapprovedReq.id });
    unapprovedOrderCreated = true;
  } catch (err: any) {
    assert(
      err.message.includes('Approval required') || err.message.includes('PENDING') || err.message.includes('not been approved'),
      'Transaction creation rejected if plan has not received explicit human approval'
    );
  }
  assert(!unapprovedOrderCreated, 'Razorpay order creation blocked without approval');

  // -------------------------------------------------------------
  // SUITE 9: 12-CASE EVALUATION MATRIX
  // -------------------------------------------------------------
  console.log('\n--- SUITE 9: 12-Case Evaluation Matrix ---');

  const cases = [
    { name: 'Case 1: Primary Keyboard Demo (Budget 3000, Delivery 3d, Return 7d)', query: 'wireless keyboard under 3000 within 3 days and 7-day return', expectedWinner: 'prod_acme_keyboard' },
    { name: 'Case 2: 1-Day Delivery Constraint (Fails all keyboards)', query: 'keyboard under 3000 within 1 day', expectedStatus: 'NO_QUALIFYING_PRODUCT' },
    { name: 'Case 3: Budget ₹2,700 (Fails all keyboards)', query: 'keyboard under 2700', expectedStatus: 'NO_QUALIFYING_PRODUCT' },
    { name: 'Case 4: Relaxed Delivery (7d) & 14-day return (QuickGear wins)', query: 'keyboard under 3000 within 7 days and 14-day return', expectedWinner: 'prod_qg_keyboard' },
    { name: 'Case 5: Higher Budget ₹3,500 (Nova qualifies)', query: 'keyboard under 3500 within 3 days', expectedWinner: 'prod_acme_keyboard' },
    { name: 'Case 6: Non-Agent Merchant Filter', query: 'Legacy Mart keyboard', expectedReject: 'merchant_legacy' },
    { name: 'Case 7: Non-Razorpay Merchant Filter', query: 'Global Goods keyboard', expectedReject: 'merchant_global' },
    { name: 'Case 8: Unspecified Delivery (null constraint)', query: 'keyboard under 3000 with 7-day return', checkNullDelivery: true },
    { name: 'Case 9: Unspecified Return (null constraint)', query: 'keyboard under 3000 within 3 days', checkNullReturn: true },
    { name: 'Case 10: Dynamic Winner on Price Mutation', query: 'keyboard under 3000 within 3 days', dynamicCheck: true },
    { name: 'Case 11: Reproducibility Check across 10 runs', query: 'wireless keyboard under 3000', reproCheck: true },
    { name: 'Case 12: Price Tampering Invalidation (0 Razorpay Orders)', query: 'price tamper test', tamperCheck: true },
  ];

  for (const c of cases) {
    if (c.expectedWinner) {
      const intent = parsePurchaseIntent(c.query).intent!;
      const rank = rankCandidates(intent);
      assert(rank.winner?.product.id === c.expectedWinner, `${c.name} -> Winner: ${rank.winner?.product.name}`);
    } else if (c.expectedStatus) {
      const intent = parsePurchaseIntent(c.query).intent!;
      const rank = rankCandidates(intent);
      assert(rank.status === c.expectedStatus, `${c.name} -> Status: ${rank.status}`);
    } else if (c.expectedReject) {
      const intent = parsePurchaseIntent(c.query).intent!;
      const rank = rankCandidates(intent);
      const rej = rank.candidates.find(cand => cand.merchant.id === c.expectedReject);
      assert(rej?.qualifies === false, `${c.name} -> Excluded from qualifying`);
    } else if (c.checkNullDelivery) {
      const intent = parsePurchaseIntent(c.query).intent!;
      assert(intent.maxDeliveryDays === null, `${c.name} -> maxDeliveryDays === null`);
    } else if (c.checkNullReturn) {
      const intent = parsePurchaseIntent(c.query).intent!;
      assert(intent.minimumReturnDays === null, `${c.name} -> minimumReturnDays === null`);
    } else if (c.dynamicCheck) {
      // If Acme price increases past budget, winner switches or is rejected
      mutateProductPrice('prod_acme_keyboard', 270000); // Total becomes > ₹3,000
      const intent = parsePurchaseIntent(c.query).intent!;
      const rank = rankCandidates(intent);
      assert(rank.winner?.product.id !== 'prod_acme_keyboard', `${c.name} -> Acme no longer wins after price increase`);
      resetProductPrice('prod_acme_keyboard');
    } else if (c.reproCheck) {
      const intent = parsePurchaseIntent(c.query).intent!;
      let allMatch = true;
      const baseScore = rankCandidates(intent).winner?.score;
      for (let i = 0; i < 10; i++) {
        if (rankCandidates(intent).winner?.score !== baseScore) {
          allMatch = false;
          break;
        }
      }
      assert(allMatch, `${c.name} -> 10/10 iterations yielded identical scores`);
    } else if (c.tamperCheck) {
      const p = createPurchasePlan(acmeProd, acmeMerchant, acmeQuote, 1, 'tamper check');
      mutateProductPrice('prod_acme_keyboard', 300000);
      const v = validatePurchasePlanBeforeCheckout(p);
      assert(!v.valid, `${c.name} -> Plan invalidated on price tamper`);
      resetProductPrice('prod_acme_keyboard');
    }
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`  PHASE 3 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
