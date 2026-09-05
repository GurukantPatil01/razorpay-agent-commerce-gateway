/**
 * Automated Test Suite for RazorPay Agent Commerce Gateway (Phase 2: Reliability & Recovery)
 *
 * Verifies:
 * 1. Razorpay Webhook Signature Verification (constant-time, tampered rejection)
 * 2. Durable Webhook Deduplication (event A processed, event A again safely ignored)
 * 3. Authoritative Payment State Reconciliation (reconcilePayment, unknown payment safety)
 * 4. Payment Failure Recovery Engine & Retry Exhaustion (MAX_PAYMENT_ATTEMPTS = 3 -> RECOVERY_EXHAUSTED)
 * 5. Idempotent Purchase Execution & Exactly-Once Fulfillment (0 double shipping)
 * 6. Deterministic Refund Engine (paise validation, return policy, duplicate refund prevention)
 * 7. Security Isolation (secrets never exposed to browser)
 */

import { CommerceStore } from '../src/lib/commerce-store';
import { razorpayAdapter } from '../src/services/razorpay/adapter';
import { getProductById } from '../src/data/products';
import { calculateProductQuote } from '../src/services/pricing/calculator';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
  }
}

async function runPhase2Tests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🛡️ RAZORPAY AGENT COMMERCE GATEWAY — PHASE 2 RELIABILITY SUITE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── TEST SUITE 1: WEBHOOK SIGNATURE VERIFICATION ──
  console.log('🔐 1. RAZORPAY WEBHOOK SIGNATURE & SECURITY TESTS');

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_whsec_test_agent_gateway_2026';
  const testPayload = JSON.stringify({
    entity: 'event',
    account_id: 'acc_agent_gateway',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: 'pay_test_webhook_123',
          order_id: 'order_test_webhook_123',
          amount: 294900,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  });

  const validSignature = razorpayAdapter.generateWebhookSignature(testPayload, webhookSecret);
  const isValid = razorpayAdapter.verifyWebhookSignature(testPayload, validSignature);
  assert(isValid === true, 'Constant-time verification accepts authentic Razorpay webhook signature');

  const tamperedPayload = testPayload.replace('294900', '100000');
  const isTamperedValid = razorpayAdapter.verifyWebhookSignature(tamperedPayload, validSignature);
  assert(isTamperedValid === false, 'Tampered payload with modified amount is rejected');

  const forgedSignature = '0000000000000000000000000000000000000000000000000000000000000000';
  const isForgedValid = razorpayAdapter.verifyWebhookSignature(testPayload, forgedSignature);
  assert(isForgedValid === false, 'Forged webhook signature is rejected');

  // Secret isolation test
  const publicConfig = razorpayAdapter.getPublicConfig();
  assert(
    !(publicConfig as any).keySecret && !(publicConfig as any).webhookSecret,
    'Razorpay Key Secret and Webhook Secret are strictly server-side and never exposed in public config'
  );

  // ── TEST SUITE 2: WEBHOOK DEDUPLICATION & IDEMPOTENCY ──
  console.log('\n🔁 2. DURABLE WEBHOOK IDEMPOTENCY & DEDUPLICATION TESTS');

  const eventId = `evt_dedup_${Date.now()}`;
  const webhookEventObj = {
    id: eventId,
    event: 'payment.captured',
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: `pay_${Date.now()}`,
          order_id: `order_${Date.now()}`,
          amount: 294900,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
  };

  const rawBody = JSON.stringify(webhookEventObj);
  const sig = razorpayAdapter.generateWebhookSignature(rawBody, webhookSecret);

  // First ingestion
  const firstProcessing = CommerceStore.processWebhookEvent(webhookEventObj, rawBody, sig);
  assert(firstProcessing.success === true, 'First webhook delivery is processed successfully');
  assert(firstProcessing.status === 'PROCESSED', 'Status of first event is PROCESSED');

  // Duplicate replay
  const secondProcessing = CommerceStore.processWebhookEvent(webhookEventObj, rawBody, sig);
  assert(secondProcessing.success === true, 'Duplicate webhook replay returns HTTP 200/success');
  assert(
    secondProcessing.status === 'IGNORED_DUPLICATE',
    'Duplicate event is safely identified as IGNORED_DUPLICATE and skipped'
  );

  // ── TEST SUITE 3: AUTHORITATIVE RECONCILIATION & UNKNOWN STATE ──
  console.log('\n🔍 3. AUTHORITATIVE PAYMENT RECONCILIATION TESTS');

  const product = getProductById('prod_acme_keyboard')!;
  const quote = calculateProductQuote(product, 1);
  const purchaseReq = CommerceStore.createPurchaseRequest({
    productId: product.id,
    merchantId: product.merchantId,
    productName: product.name,
    quantity: 1,
    quote,
  });

  CommerceStore.approvePurchaseRequest(purchaseReq.id, quote.quoteHash);
  const checkout = CommerceStore.createTransaction({ purchaseRequestId: purchaseReq.id });
  const rzpOrder = await razorpayAdapter.createOrder({
    amountPaise: checkout.amountPaise,
    currency: 'INR',
    receipt: checkout.transactionId,
  });
  CommerceStore.attachRazorpayOrder(checkout.transactionId, rzpOrder.id, rzpOrder.mode);

  // Simulate network timeout -> PAYMENT_UNKNOWN
  CommerceStore.updateTransactionState(checkout.transactionId, 'PAYMENT_UNKNOWN', {
    reason: 'Simulated network timeout during payment gateway confirmation',
  });

  const txBeforeReconcile = CommerceStore.getTransaction(checkout.transactionId)!;
  assert(txBeforeReconcile.state === 'PAYMENT_UNKNOWN', 'Transaction entered PAYMENT_UNKNOWN on timeout');

  // Reconcile with Razorpay
  const reconcileReport = await CommerceStore.reconcilePayment(checkout.transactionId);
  assert(reconcileReport.success === true, 'Payment reconciliation executed successfully');
  assert(
    reconcileReport.reconciliation.safeToRetry === true,
    'Reconciler correctly identifies NO payment was captured, making retry safe'
  );

  // ── TEST SUITE 4: RECOVERY ENGINE & RETRY EXHAUSTION ──
  console.log('\n🔄 4. PAYMENT FAILURE RECOVERY & RETRY LIMIT TESTS');

  // Attempt 1: Record payment failure
  CommerceStore.recordPaymentAttempt({
    transactionId: checkout.transactionId,
    paymentId: `pay_fail_${Date.now()}_1`,
    method: 'upi',
    status: 'FAILED',
    errorDescription: 'Bank decline / UPI failure simulation',
  });

  // Attempt 2: Retry with Card
  const retry1Tx = CommerceStore.retryPayment(checkout.transactionId, 'card');
  assert(retry1Tx.state === 'PAYMENT_PENDING', 'Attempt 2 retry is permitted and state reset to PAYMENT_PENDING');
  assert(retry1Tx.paymentAttempts.length === 1, 'Transaction records 1 failed attempt in history');

  // Simulate second failure
  CommerceStore.recordPaymentAttempt({
    transactionId: checkout.transactionId,
    paymentId: `pay_fail_${Date.now()}_2`,
    method: 'card',
    status: 'FAILED',
    errorDescription: 'Second bank decline',
  });

  // Attempt 3: Retry with NetBanking
  const retry2Tx = CommerceStore.retryPayment(checkout.transactionId, 'netbanking');
  assert(retry2Tx.state === 'PAYMENT_PENDING', 'Attempt 3 retry is permitted');
  assert(retry2Tx.paymentAttempts.length === 2, 'Transaction records 2 failed attempts in history');

  // Simulate third failure
  CommerceStore.recordPaymentAttempt({
    transactionId: checkout.transactionId,
    paymentId: `pay_fail_${Date.now()}_3`,
    method: 'netbanking',
    status: 'FAILED',
    errorDescription: 'Third bank decline',
  });
  assert(retry2Tx.paymentAttempts.length === 3, 'Transaction records 3 failed attempts in history');

  // Attempt 4: Should EXHAUST retries (MAX_PAYMENT_ATTEMPTS = 3)
  let retryExhaustedCaught = false;
  try {
    CommerceStore.retryPayment(checkout.transactionId, 'upi');
  } catch (err: any) {
    retryExhaustedCaught = true;
    assert(err.message.includes('exhausted'), 'Clear error message indicating retry limit reached');
  }
  assert(retryExhaustedCaught === true, 'Attempt 4 is blocked by safety engine');

  const txExhausted = CommerceStore.getTransaction(checkout.transactionId)!;
  assert(txExhausted.state === 'RECOVERY_EXHAUSTED', 'State transitioned to RECOVERY_EXHAUSTED');

  // ── TEST SUITE 5: EXACTLY-ONCE FULFILLMENT ──
  console.log('\n📦 5. EXACTLY-ONCE FULFILLMENT TESTS');

  // Create a successful transaction
  const purchaseReq2 = CommerceStore.createPurchaseRequest({
    productId: product.id,
    merchantId: product.merchantId,
    productName: product.name,
    quantity: 1,
    quote,
  });
  CommerceStore.approvePurchaseRequest(purchaseReq2.id, quote.quoteHash);
  const checkout2 = CommerceStore.createTransaction({ purchaseRequestId: purchaseReq2.id });
  const rzpOrder2 = await razorpayAdapter.createOrder({
    amountPaise: checkout2.amountPaise,
    currency: 'INR',
    receipt: checkout2.transactionId,
  });
  CommerceStore.attachRazorpayOrder(checkout2.transactionId, rzpOrder2.id, rzpOrder2.mode);

  // Mark payment success
  CommerceStore.recordPaymentAttempt({
    transactionId: checkout2.transactionId,
    paymentId: `sim_pay_success_${Date.now()}`,
    method: 'upi',
    status: 'SUCCESS',
  });

  // First fulfillment call
  const fulfill1 = CommerceStore.fulfillTransaction(checkout2.transactionId);
  assert(fulfill1.state === 'FULFILLED', 'First fulfillment call succeeds with state FULFILLED');
  assert(!!fulfill1.fulfillmentTrackingNumber, 'AWB dispatch tracking number is generated');
  assert(!fulfill1.alreadyFulfilled, 'First fulfillment is not flagged as duplicate');

  // Duplicate fulfillment call
  const fulfill2 = CommerceStore.fulfillTransaction(checkout2.transactionId);
  assert(fulfill2.alreadyFulfilled === true, 'Second fulfillment is identified as alreadyFulfilled');
  assert(
    fulfill2.fulfillmentTrackingNumber === fulfill1.fulfillmentTrackingNumber,
    'Tracking number remains identical without double shipping'
  );

  // ── TEST SUITE 6: DETERMINISTIC REFUND ENGINE ──
  console.log('\n↩️ 6. DETERMINISTIC REFUND ENGINE TESTS');

  // Invalid refund: Amount exceeds original paid total
  let invalidRefundCaught = false;
  try {
    await CommerceStore.requestRefund({
      transactionId: checkout2.transactionId,
      amountPaise: 9999999, // Exceeds ₹2,949
      reason: 'Fraudulent excessive amount',
    });
  } catch (err: any) {
    invalidRefundCaught = true;
    assert(err.message.includes('exceed'), 'Deterministic error on excessive refund amount');
  }
  assert(invalidRefundCaught === true, 'Refund exceeding transaction total is rejected');

  // Valid refund within merchant return policy (Acme has 7-day return)
  const validRefund = await CommerceStore.requestRefund({
    transactionId: checkout2.transactionId,
    reason: 'Customer requested return within 7-day window',
  });
  assert(validRefund.success === true, 'Valid refund is accepted and processed');
  assert(validRefund.state === 'REFUNDED', 'Refund state is REFUNDED');
  assert(
    validRefund.amountPaise === quote.finalTotalPaise,
    'Refund amount exactly matches server-side paise total'
  );

  // Duplicate refund attempt
  let duplicateRefundCaught = false;
  try {
    await CommerceStore.requestRefund({
      transactionId: checkout2.transactionId,
      reason: 'Second refund attempt for same transaction',
    });
  } catch (err: any) {
    duplicateRefundCaught = true;
    assert(err.message.includes('already been refunded'), 'Deterministic guard prevents double refunding');
  }
  assert(duplicateRefundCaught === true, 'Duplicate refund is rejected');

  // ── TEST SUITE 7: AUDIT TRAIL INTEGRITY ──
  console.log('\n📜 7. FINANCIAL AUDIT TRAIL RECONSTRUCTION TESTS');

  const auditEvents = CommerceStore.getAuditEvents();
  assert(auditEvents.length >= 10, `Audit log contains comprehensive history (${auditEvents.length} events)`);

  const actors = new Set(auditEvents.map((e) => e.actor));
  assert(actors.has('RAZORPAY_WEBHOOK'), 'Audit trail logs RAZORPAY_WEBHOOK actor');
  assert(actors.has('SYSTEM'), 'Audit trail logs SYSTEM actor');
  assert(actors.has('USER'), 'Audit trail logs USER actor');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`🏁 RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (passedTests === totalTests) {
    console.log('🎉 ALL PHASE 2 RELIABILITY & RECOVERY CRITERIA VERIFIED!');
    process.exit(0);
  } else {
    console.error('❌ SOME PHASE 2 TESTS FAILED.');
    process.exit(1);
  }
}

runPhase2Tests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
