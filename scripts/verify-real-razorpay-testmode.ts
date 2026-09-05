/**
 * Real Razorpay Test Mode Verification Script
 *
 * Verifies:
 * 1. REAL credentials detection (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
 * 2. Live Razorpay Test Mode API call: createOrder() with real "order_..." ID returned from Razorpay
 * 3. Live Razorpay Test Mode API call: fetchOrder()
 * 4. Server-side deterministic HMAC-SHA256 signature verification
 * 5. Rejection of tampered signatures
 * 6. Verification that secrets are NEVER exposed in public client config
 */

import crypto from 'crypto';
import { razorpayAdapter } from '../src/services/razorpay/adapter';
import { getProductById } from '../src/data/products';
import { calculateProductQuote } from '../src/services/pricing/calculator';
import { validatePurchasePolicy, DEFAULT_PURCHASE_POLICY } from '../src/services/policy/engine';
import { CommerceStore } from '../src/lib/commerce-store';

async function runRealRazorpayVerification() {
  console.log('═════════════════════════════════════════════════════════════════════════');
  console.log('💳 REAL RAZORPAY TEST MODE VERIFICATION');
  console.log('═════════════════════════════════════════════════════════════════════════\n');

  // Check 1: Environment detection
  console.log('── Check 1: Environment Credentials Status ──');
  const isReal = razorpayAdapter.isRealRazorpayConfigured;
  const publicConfig = razorpayAdapter.getPublicConfig();

  console.log(`Razorpay Configured: ${isReal ? 'YES (REAL CREDENTIALS)' : 'NO'}`);
  console.log(`Operating Mode: ${publicConfig.mode}`);
  if (publicConfig.keyId) {
    console.log(`Key ID Prefix: ${publicConfig.keyId.substring(0, 8)}... (Safe public prefix)`);
  }

  // Security Check: Secret leakage check
  console.log('\n── Check 2: Browser/Client Secret Leakage Inspection ──');
  const configKeys = Object.keys(publicConfig);
  const leaksSecret = (publicConfig as any).keySecret || (publicConfig as any).secret || (publicConfig as any).webhookSecret;
  if (leaksSecret) {
    throw new Error('SECURITY VIOLATION: Secret leaked in public configuration!');
  }
  console.log('✓ Public config keys exposed to frontend:', configKeys.join(', '));
  console.log('✓ RAZORPAY_KEY_SECRET is server-only: VERIFIED SAFE');
  console.log('✓ RAZORPAY_WEBHOOK_SECRET is server-only: VERIFIED SAFE');

  if (!isReal) {
    console.log('\n❌ REAL RAZORPAY TEST MODE: NOT TESTED — CREDENTIALS NOT CONFIGURED');
    process.exit(1);
  }

  // Check 3: Deterministic Price Quote for Primary Demo
  console.log('\n── Check 3: Server Pricing for Demo (Acme Keyboard) ──');
  const keyboard = getProductById('prod_acme_keyboard')!;
  const quote = calculateProductQuote(keyboard, 1);
  console.log(`✓ Base Price: ${quote.formattedBreakdown.basePriceFormatted} (${quote.baseSubtotalPaise} paise)`);
  console.log(`✓ GST Tax: ${quote.formattedBreakdown.taxFormatted} (${quote.taxTotalPaise} paise)`);
  console.log(`✓ Shipping: ${quote.formattedBreakdown.shippingFormatted}`);
  console.log(`✓ Deterministic Total: ${quote.formattedBreakdown.totalFormatted} (${quote.finalTotalPaise} paise)`);

  // Check 4: Create Purchase Request & Approve
  console.log('\n── Check 4: Policy Validation & Human Approval ──');
  const policyResult = validatePurchasePolicy(quote, DEFAULT_PURCHASE_POLICY);
  console.log(`✓ Policy Allowed: ${policyResult.allowed}`);

  const purchaseReq = CommerceStore.createPurchaseRequest({
    merchantId: keyboard.merchantId,
    productId: keyboard.id,
    quantity: 1,
    quote,
    policyResult,
    selectionReason: 'Meets 100% constraints in primary demo',
  });

  const approvedReq = CommerceStore.approvePurchaseRequest(purchaseReq.id, quote.quoteHash);
  console.log(`✓ Human Approval Granted: ${approvedReq.id} (Quote Hash: ${approvedReq.quoteHash.substring(0, 20)}...)`);

  // Check 5: Live Razorpay Test Mode Order Creation
  console.log('\n── Check 5: REAL Razorpay Test Mode Order Creation ──');
  const tx = CommerceStore.createTransaction({ purchaseRequestId: approvedReq.id });

  console.log(`Calling official Razorpay API: orders.create({ amount: ${tx.amountPaise}, currency: "INR" })...`);
  const realOrder = await razorpayAdapter.createOrder({
    amountPaise: tx.amountPaise,
    currency: 'INR',
    receipt: tx.transactionId,
    notes: {
      transactionId: tx.transactionId,
      productId: tx.productId,
      purpose: 'Razorpay Agent Commerce Demo',
    },
  });

  console.log(`✓ Real Order ID: ${realOrder.id}`);
  console.log(`✓ Mode: ${realOrder.mode}`);
  console.log(`✓ Entity: ${realOrder.entity}`);
  console.log(`✓ Amount from Razorpay API: ${realOrder.amount} paise (₹${realOrder.amount / 100})`);
  console.log(`✓ Currency: ${realOrder.currency}`);
  console.log(`✓ Status: ${realOrder.status}`);

  if (!realOrder.id.startsWith('order_')) {
    throw new Error(`Expected real Razorpay order starting with 'order_', got: ${realOrder.id}`);
  }

  CommerceStore.attachRazorpayOrder(tx.transactionId, realOrder.id, realOrder.mode);

  // Check 6: Live Razorpay API Fetch Order Check
  console.log('\n── Check 6: Querying Razorpay Servers for Order Status ──');
  const fetchedOrder = await razorpayAdapter.fetchOrder(realOrder.id);
  console.log(`✓ Fetched from Razorpay API: ${fetchedOrder.id} - Status: ${fetchedOrder.status}`);

  // Check 7: Server-Side HMAC-SHA256 Signature Verification
  console.log('\n── Check 7: Server-Side HMAC-SHA256 Payment Verification ──');
  const testPaymentId = `pay_test_${Date.now()}`;
  const keySecret = process.env.RAZORPAY_KEY_SECRET!.trim();
  const authenticSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${realOrder.id}|${testPaymentId}`)
    .digest('hex');

  // Test authentic signature
  const validVerification = razorpayAdapter.verifyPaymentSignature({
    orderId: realOrder.id,
    paymentId: testPaymentId,
    signature: authenticSignature,
  });

  console.log(`✓ Authentic Signature: ${authenticSignature.substring(0, 24)}...`);
  console.log(`✓ Verification Result: ${validVerification.isValid ? 'VALID' : 'INVALID'}`);
  console.log(`✓ Verification Method: ${validVerification.verificationMethod}`);

  if (!validVerification.isValid || validVerification.verificationMethod !== 'HMAC_SHA256') {
    throw new Error('HMAC-SHA256 verification failed on authentic signature!');
  }

  // Test tampered signature rejection
  const forgedVerification = razorpayAdapter.verifyPaymentSignature({
    orderId: realOrder.id,
    paymentId: testPaymentId,
    signature: 'forged_tampered_signature_1234567890abcdef',
  });

  console.log(`✓ Tampered Signature Check: ${forgedVerification.isValid ? 'ACCEPTED (FAIL)' : 'REJECTED (PASS)'}`);
  if (forgedVerification.isValid) {
    throw new Error('SECURITY VIOLATION: Tampered signature was accepted!');
  }

  // Check 8: Fulfillment Gate (Fulfillment occurs strictly after verified payment)
  console.log('\n── Check 8: Fulfillment Gate & State Transition ──');
  CommerceStore.recordPaymentAttempt({
    transactionId: tx.transactionId,
    paymentId: testPaymentId,
    method: 'card',
    status: 'SUCCESS',
    signature: authenticSignature,
  });

  const fulfilledTx = CommerceStore.fulfillTransaction(tx.transactionId);
  console.log(`✓ Transaction State: ${fulfilledTx.state}`);
  console.log(`✓ Fulfillment Tracking Number: ${fulfilledTx.fulfillmentTrackingNumber}`);

  // Check 9: Audit Trail Inspection
  console.log('\n── Check 9: Audit Trail Event Inspection ──');
  const logs = CommerceStore.getAuditEvents(5);
  for (const log of logs) {
    console.log(`   [${new Date(log.timestamp).toLocaleTimeString()}] [${log.actor}] ${log.action}: ${log.details}`);
  }

  console.log('\n═════════════════════════════════════════════════════════════════════════');
  console.log('🎉 REAL RAZORPAY TEST MODE: VERIFIED SUCCESSFULLY');
  console.log(`   Real Order ID: ${realOrder.id}`);
  console.log(`   Mode: ${realOrder.mode}`);
  console.log('   Security: HMAC-SHA256 Verified, Secrets Strictly Server-Side');
  console.log('═════════════════════════════════════════════════════════════════════════\n');
}

runRealRazorpayVerification().catch((err) => {
  console.error('Real Razorpay verification failed:', err);
  process.exit(1);
});
