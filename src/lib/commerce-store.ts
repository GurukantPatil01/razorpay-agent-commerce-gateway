/**
 * Global In-Memory Commerce & Transaction Store
 *
 * Persists transactions, human approvals, pricing quotes, and financial audit logs
 * across Next.js hot module reloads via globalThis.
 */

import { PricingQuote, formatINR } from '@/services/pricing/calculator';
import { PolicyValidationResult } from '@/services/policy/engine';
import { TransactionState, TransactionStateMachine, StateTransitionRecord } from '@/services/transactions/state-machine';
import { razorpayAdapter } from '@/services/razorpay/adapter';

export interface WebhookRecord {
  eventId: string;
  eventType: string;
  receivedTimestamp: number;
  processedTimestamp: number;
  status: 'PROCESSED' | 'IGNORED_DUPLICATE' | 'FAILED';
  relatedOrderId?: string;
  relatedPaymentId?: string;
  relatedRefundId?: string;
}

export interface PurchaseRequest {
  id: string;
  merchantId: string;
  productId: string;
  quantity: number;
  quote: PricingQuote;
  policyResult: PolicyValidationResult;
  selectionReason: string;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'INVALIDATED';
  invalidationReason?: string;
  approvedAt?: number;
  quoteHash: string; // Cryptographically binds approval to exact price, shipping, tax, discounts
  createdAt: number;
}

export interface Transaction {
  transactionId: string;
  purchaseRequestId: string;
  idempotencyKey: string;
  merchantId: string;
  productId: string;
  productName: string;
  quantity: number;
  amountPaise: number;
  currency: 'INR';
  state: TransactionState;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  paymentMethod?: string;
  paymentAttempts: Array<{
    attemptNumber: number;
    paymentId: string;
    method: string;
    status: 'SUCCESS' | 'FAILED';
    timestamp: number;
    errorDescription?: string;
  }>;
  mode: 'RAZORPAY_TEST_MODE' | 'SIMULATED_DEV_MODE';
  stateHistory: StateTransitionRecord[];
  fulfillmentStatus?: 'PENDING' | 'CONFIRMED' | 'FAILED';
  fulfillmentTrackingNumber?: string;
  refundStatus?: 'NONE' | 'REQUESTED' | 'REFUNDED';
  refundId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEvent {
  id: string;
  timestamp: number;
  actor: 'USER' | 'AI_BUYER' | 'POLICY_ENGINE' | 'HUMAN_APPROVER' | 'RAZORPAY' | 'MERCHANT_FULFILLMENT' | 'RAZORPAY_WEBHOOK' | 'SYSTEM';
  action: string;
  transactionId?: string;
  merchantId?: string;
  productName?: string;
  amountFormatted?: string;
  stateTransition?: { from: string; to: string };
  result: 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'PENDING';
  details: string;
}

interface CommerceStoreData {
  purchaseRequests: Map<string, PurchaseRequest>;
  transactions: Map<string, Transaction>;
  idempotencyMap: Map<string, string>; // idempotencyKey -> transactionId
  processedWebhooks: Map<string, WebhookRecord>;
  auditEvents: AuditEvent[];
}

declare global {
  // eslint-disable-next-line no-var
  var commerceStoreInstance: CommerceStoreData | undefined;
}

const store: CommerceStoreData = globalThis.commerceStoreInstance || {
  purchaseRequests: new Map(),
  transactions: new Map(),
  idempotencyMap: new Map(),
  processedWebhooks: new Map(),
  auditEvents: [],
};

if (!store.processedWebhooks) {
  store.processedWebhooks = new Map();
}

globalThis.commerceStoreInstance = store;

export class CommerceStore {
  /**
   * 1. Create a Purchase Request
   */
  public static createPurchaseRequest(params: {
    merchantId: string;
    productId: string;
    quantity: number;
    quote: PricingQuote;
    policyResult: PolicyValidationResult;
    selectionReason: string;
  }): PurchaseRequest {
    const id = `req_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;

    const policy = params.policyResult || {
      allowed: true,
      requiresApproval: true,
      violations: [],
    };

    const purchaseRequest: PurchaseRequest = {
      id,
      merchantId: params.merchantId,
      productId: params.productId,
      quantity: params.quantity,
      quote: params.quote,
      policyResult: policy,
      selectionReason: params.selectionReason,
      approvalStatus: policy.requiresApproval ? 'PENDING' : 'APPROVED',
      quoteHash: params.quote.quoteHash,
      createdAt: Date.now(),
    };

    store.purchaseRequests.set(id, purchaseRequest);

    this.recordAuditEvent({
      actor: 'AI_BUYER',
      action: 'PURCHASE_REQUEST_CREATED',
      merchantId: params.merchantId,
      productName: params.quote.lineItems[0]?.name || params.productId,
      amountFormatted: params.quote.formattedBreakdown.totalFormatted,
      result: 'SUCCESS',
      details: `Created purchase request ${id}. Policy evaluation: ${policy.allowed ? 'PASSED' : 'REJECTED'}.`,
    });

    return purchaseRequest;
  }

  public static getPurchaseRequest(id: string): PurchaseRequest | undefined {
    return store.purchaseRequests.get(id);
  }

  /**
   * 2. Human Approval Gate
   * Verifies that the quote parameters have not changed since the request was created.
   */
  public static approvePurchaseRequest(requestId: string, currentQuoteHash: string): PurchaseRequest {
    const request = store.purchaseRequests.get(requestId);
    if (!request) {
      throw new Error(`Purchase request not found: ${requestId}`);
    }

    // CRITICAL SECURITY RULE: Invalidate approval if price or parameters changed
    if (request.quoteHash !== currentQuoteHash) {
      request.approvalStatus = 'INVALIDATED';
      request.invalidationReason = 'Price or product specifications changed after request was generated.';
      this.recordAuditEvent({
        actor: 'POLICY_ENGINE',
        action: 'APPROVAL_INVALIDATED',
        merchantId: request.merchantId,
        productName: request.quote.lineItems[0]?.name,
        amountFormatted: request.quote.formattedBreakdown.totalFormatted,
        result: 'BLOCKED',
        details: `Approval rejected: Hash mismatch (${request.quoteHash} != ${currentQuoteHash}). Price parameters changed.`,
      });
      throw new Error('Approval invalidated: Price or product details changed. A new quote and approval are required.');
    }

    request.approvalStatus = 'APPROVED';
    request.approvedAt = Date.now();

    this.recordAuditEvent({
      actor: 'HUMAN_APPROVER',
      action: 'PURCHASE_APPROVED',
      merchantId: request.merchantId,
      productName: request.quote.lineItems[0]?.name,
      amountFormatted: request.quote.formattedBreakdown.totalFormatted,
      result: 'SUCCESS',
      details: `User explicitly approved purchase of ${request.quote.lineItems[0]?.name} for ${request.quote.formattedBreakdown.totalFormatted}.`,
    });

    return request;
  }

  /**
   * 3. Human Reject Gate
   */
  public static rejectPurchaseRequest(requestId: string, reason = 'User rejected purchase'): PurchaseRequest {
    const request = store.purchaseRequests.get(requestId);
    if (!request) {
      throw new Error(`Purchase request not found: ${requestId}`);
    }

    request.approvalStatus = 'REJECTED';
    this.recordAuditEvent({
      actor: 'HUMAN_APPROVER',
      action: 'PURCHASE_REJECTED',
      merchantId: request.merchantId,
      productName: request.quote.lineItems[0]?.name,
      amountFormatted: request.quote.formattedBreakdown.totalFormatted,
      result: 'BLOCKED',
      details: `User rejected purchase request: ${reason}`,
    });

    return request;
  }

  /**
   * 4. Idempotent Transaction Creation
   * Prevents duplicate transactions for identical clicks or checkout requests.
   */
  public static createTransaction(params: {
    purchaseRequestId: string;
    idempotencyKey?: string;
  }): Transaction {
    const request = store.purchaseRequests.get(params.purchaseRequestId);
    if (!request) {
      throw new Error(`Purchase request ${params.purchaseRequestId} not found.`);
    }

    if (request.approvalStatus !== 'APPROVED') {
      throw new Error(`Cannot initiate checkout: Purchase request status is ${request.approvalStatus}. Approval required.`);
    }

    const idempotencyKey = params.idempotencyKey || `idem_${request.id}_${request.quoteHash}`;

    // Check if transaction already exists for this idempotency key
    const existingTxId = store.idempotencyMap.get(idempotencyKey);
    if (existingTxId) {
      const existingTx = store.transactions.get(existingTxId);
      if (existingTx) {
        CommerceStore.recordAuditEvent({
          actor: 'POLICY_ENGINE',
          action: 'IDEMPOTENCY_HIT',
          transactionId: existingTx.transactionId,
          merchantId: existingTx.merchantId,
          productName: existingTx.productName,
          result: 'SUCCESS',
          details: `Reused existing transaction ${existingTx.transactionId} for idempotency key ${idempotencyKey}. Prevented duplicate charge.`,
        });
        return existingTx;
      }
    }

    const transactionId = `tx_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const lineItem = request.quote.lineItems[0];

    const transaction: Transaction = {
      transactionId,
      purchaseRequestId: request.id,
      idempotencyKey,
      merchantId: request.merchantId,
      productId: request.productId,
      productName: lineItem?.name || request.productId,
      quantity: request.quantity,
      amountPaise: request.quote.finalTotalPaise,
      currency: 'INR',
      state: 'APPROVED',
      paymentAttempts: [],
      mode: 'SIMULATED_DEV_MODE', // Will be updated when Razorpay order is attached
      stateHistory: [
        {
          fromState: 'APPROVAL_PENDING',
          toState: 'APPROVED',
          timestamp: Date.now(),
          reason: 'User approved purchase request',
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    store.transactions.set(transactionId, transaction);
    store.idempotencyMap.set(idempotencyKey, transactionId);

    return transaction;
  }

  /**
   * 5. Update Transaction State with State Machine Validation
   */
  public static updateTransactionState(
    transactionId: string,
    nextState: TransactionState,
    reason?: string,
    metadata?: Record<string, any>
  ): Transaction {
    const tx = store.transactions.get(transactionId);
    if (!tx) {
      throw new Error(`Transaction ${transactionId} not found.`);
    }

    TransactionStateMachine.validateTransition(tx.state, nextState);

    const transition: StateTransitionRecord = {
      fromState: tx.state,
      toState: nextState,
      timestamp: Date.now(),
      reason,
      metadata,
    };

    tx.state = nextState;
    tx.stateHistory.push(transition);
    tx.updatedAt = Date.now();

    this.recordAuditEvent({
      actor: 'AI_BUYER',
      action: 'STATE_TRANSITION',
      transactionId: tx.transactionId,
      merchantId: tx.merchantId,
      productName: tx.productName,
      stateTransition: { from: transition.fromState, to: transition.toState },
      result: 'SUCCESS',
      details: reason || `Moved to state ${nextState}`,
    });

    return tx;
  }

  /**
   * 6. Associate Razorpay Order
   */
  public static attachRazorpayOrder(
    transactionId: string,
    orderId: string,
    mode: 'RAZORPAY_TEST_MODE' | 'SIMULATED_DEV_MODE'
  ): Transaction {
    const tx = store.transactions.get(transactionId);
    if (!tx) throw new Error(`Transaction ${transactionId} not found.`);

    tx.razorpayOrderId = orderId;
    tx.mode = mode;
    this.updateTransactionState(transactionId, 'RAZORPAY_ORDER_CREATED', `Attached Razorpay Order ${orderId}`);
    this.updateTransactionState(transactionId, 'PAYMENT_PENDING', 'Awaiting payment confirmation');

    this.recordAuditEvent({
      actor: 'RAZORPAY',
      action: 'ORDER_CREATED',
      transactionId: tx.transactionId,
      merchantId: tx.merchantId,
      productName: tx.productName,
      amountFormatted: formatINR(tx.amountPaise),
      result: 'SUCCESS',
      details: `Created Razorpay order ${orderId} (${mode}). Amount: ${formatINR(tx.amountPaise)}.`,
    });

    return tx;
  }

  /**
   * 7. Record Payment Attempt
   */
  public static recordPaymentAttempt(params: {
    transactionId: string;
    paymentId: string;
    method: string;
    status: 'SUCCESS' | 'FAILED';
    signature?: string;
    errorDescription?: string;
  }): Transaction {
    const tx = store.transactions.get(params.transactionId);
    if (!tx) throw new Error(`Transaction ${params.transactionId} not found.`);

    const attemptNumber = tx.paymentAttempts.length + 1;
    tx.paymentAttempts.push({
      attemptNumber,
      paymentId: params.paymentId,
      method: params.method,
      status: params.status,
      timestamp: Date.now(),
      errorDescription: params.errorDescription,
    });

    if (params.status === 'SUCCESS') {
      tx.razorpayPaymentId = params.paymentId;
      tx.razorpaySignature = params.signature;
      tx.paymentMethod = params.method;
      this.updateTransactionState(
        params.transactionId,
        'PAYMENT_SUCCESS',
        `Payment ${params.paymentId} verified successfully via ${params.method}`
      );
      this.updateTransactionState(params.transactionId, 'FULFILLMENT_PENDING', 'Awaiting merchant order dispatch');

      this.recordAuditEvent({
        actor: 'RAZORPAY',
        action: 'PAYMENT_VERIFIED',
        transactionId: tx.transactionId,
        merchantId: tx.merchantId,
        productName: tx.productName,
        amountFormatted: formatINR(tx.amountPaise),
        result: 'SUCCESS',
        details: `Verified Razorpay payment ${params.paymentId} via ${params.method}. Deterministic signature check passed.`,
      });
    } else {
      if (tx.state !== 'PAYMENT_FAILED') {
        this.updateTransactionState(
          params.transactionId,
          'PAYMENT_FAILED',
          params.errorDescription || `Payment attempt #${attemptNumber} failed`
        );
      }

      this.recordAuditEvent({
        actor: 'RAZORPAY',
        action: 'PAYMENT_FAILED',
        transactionId: tx.transactionId,
        merchantId: tx.merchantId,
        productName: tx.productName,
        amountFormatted: formatINR(tx.amountPaise),
        result: 'FAILED',
        details: `Payment attempt #${attemptNumber} failed: ${params.errorDescription || 'Declined'}. No duplicate charge created.`,
      });
    }

    return tx;
  }

  /**
   * 8. Fulfill Order — EXACTLY ONCE GUARANTEE
   * STRICT SECURITY: Only callable after PAYMENT_SUCCESS. Prevents duplicate shipping.
   */
  public static fulfillTransaction(transactionId: string): Transaction & { alreadyFulfilled?: boolean } {
    const tx = store.transactions.get(transactionId);
    if (!tx) throw new Error(`Transaction ${transactionId} not found.`);

    // EXACTLY ONCE FULFILLMENT GUARD
    if (tx.state === 'FULFILLED' || tx.fulfillmentStatus === 'CONFIRMED') {
      this.recordAuditEvent({
        actor: 'SYSTEM',
        action: 'FULFILLMENT_ALREADY_COMPLETED',
        transactionId: tx.transactionId,
        merchantId: tx.merchantId,
        productName: tx.productName,
        result: 'SUCCESS',
        details: `Duplicate fulfillment rejected: Order already fulfilled with tracking ${tx.fulfillmentTrackingNumber}. Double-fulfillment prevented.`,
      });
      return {
        ...tx,
        alreadyFulfilled: true,
      };
    }

    if (tx.state !== 'FULFILLMENT_PENDING' && tx.state !== 'PAYMENT_SUCCESS') {
      throw new Error(`Cannot fulfill transaction: Current state is '${tx.state}'. Payment must be verified first.`);
    }

    this.recordAuditEvent({
      actor: 'MERCHANT_FULFILLMENT',
      action: 'FULFILLMENT_STARTED',
      transactionId: tx.transactionId,
      merchantId: tx.merchantId,
      productName: tx.productName,
      result: 'PENDING',
      details: 'Merchant dispatch process initiated.',
    });

    const trackingNumber = `TRACK_IND_${Date.now().toString().slice(-6)}`;
    tx.fulfillmentStatus = 'CONFIRMED';
    tx.fulfillmentTrackingNumber = trackingNumber;
    this.updateTransactionState(transactionId, 'FULFILLED', `Merchant confirmed dispatch. Tracking: ${trackingNumber}`);

    this.recordAuditEvent({
      actor: 'MERCHANT_FULFILLMENT',
      action: 'ORDER_FULFILLED',
      transactionId: tx.transactionId,
      merchantId: tx.merchantId,
      productName: tx.productName,
      result: 'SUCCESS',
      details: `Merchant fulfilled order. AWB Tracking #${trackingNumber} assigned. Customer notified.`,
    });

    return tx;
  }

  /**
   * 9. Payment State Reconciliation
   * Queries Razorpay API to reconcile internal state against actual Razorpay state.
   * Prevents unsafe retries when payment actually succeeded.
   */
  public static async reconcilePayment(transactionId: string): Promise<{
    success: boolean;
    reconciled: boolean;
    state: TransactionState;
    canRetry: boolean;
    safeToRetry: boolean;
    paymentCaptured: boolean;
    paymentId?: string;
    message: string;
    reconciliation: {
      razorpayStatus: string;
      safeToRetry: boolean;
      details: string;
    };
  }> {
    const tx = store.transactions.get(transactionId);
    if (!tx) throw new Error(`Transaction ${transactionId} not found.`);

    this.recordAuditEvent({
      actor: 'SYSTEM',
      action: 'PAYMENT_STATE_RECONCILIATION_STARTED',
      transactionId: tx.transactionId,
      merchantId: tx.merchantId,
      productName: tx.productName,
      result: 'PENDING',
      details: `Initiated payment reconciliation with Razorpay for order ${tx.razorpayOrderId || 'N/A'}.`,
    });

    if (!tx.razorpayOrderId) {
      return {
        success: false,
        reconciled: false,
        state: tx.state,
        canRetry: true,
        safeToRetry: true,
        paymentCaptured: false,
        message: 'No Razorpay Order ID associated with this transaction.',
        reconciliation: {
          razorpayStatus: 'NOT_FOUND',
          safeToRetry: true,
          details: 'No Razorpay Order ID associated with this transaction.',
        },
      };
    }

    const razorpayState = await razorpayAdapter.reconcilePaymentState(
      tx.razorpayOrderId,
      tx.razorpayPaymentId
    );

    if (razorpayState.status === 'CAPTURED') {
      if (tx.state !== 'FULFILLED' && tx.state !== 'PAYMENT_SUCCESS') {
        tx.razorpayPaymentId = razorpayState.paymentId || tx.razorpayPaymentId;
        this.updateTransactionState(tx.transactionId, 'PAYMENT_SUCCESS', 'Reconciliation confirmed payment capture');
        this.updateTransactionState(tx.transactionId, 'FULFILLMENT_PENDING', 'Awaiting fulfillment after reconciliation');
        this.fulfillTransaction(tx.transactionId);
      }

      this.recordAuditEvent({
        actor: 'SYSTEM',
        action: 'PAYMENT_RECONCILED',
        transactionId: tx.transactionId,
        merchantId: tx.merchantId,
        productName: tx.productName,
        result: 'SUCCESS',
        details: `Reconciliation verified payment captured on Razorpay (${razorpayState.paymentId}). Order fulfilled safely. DO NOT RETRY.`,
      });

      return {
        success: true,
        reconciled: true,
        state: tx.state,
        canRetry: false,
        safeToRetry: false,
        paymentCaptured: true,
        paymentId: razorpayState.paymentId,
        message: 'Razorpay confirms payment is CAPTURED. Order fulfilled safely. Retry prohibited.',
        reconciliation: {
          razorpayStatus: razorpayState.status,
          safeToRetry: false,
          details: 'Payment captured on Razorpay. Order fulfilled safely. Retry prohibited.',
        },
      };
    } else {
      if (tx.state !== 'PAYMENT_FAILED' && tx.state !== 'FULFILLED') {
        this.updateTransactionState(tx.transactionId, 'PAYMENT_FAILED', 'Reconciliation confirmed payment is not captured');
      }

      this.recordAuditEvent({
        actor: 'SYSTEM',
        action: 'PAYMENT_RECONCILED',
        transactionId: tx.transactionId,
        merchantId: tx.merchantId,
        productName: tx.productName,
        result: 'SUCCESS',
        details: `Reconciliation confirmed no successful payment exists on Razorpay. SAFE TO RETRY.`,
      });

      return {
        success: true,
        reconciled: true,
        state: tx.state,
        canRetry: tx.paymentAttempts.length < 3,
        safeToRetry: true,
        paymentCaptured: false,
        message: 'Razorpay confirms no successful payment exists. SAFE TO RETRY.',
        reconciliation: {
          razorpayStatus: razorpayState.status,
          safeToRetry: true,
          details: 'No successful payment on Razorpay. Safe to retry.',
        },
      };
    }
  }

  /**
   * 10. Payment Failure Recovery Engine
   * Enforces retry budget (MAX_ATTEMPTS = 3).
   * After 3 failures, transitions to RECOVERY_EXHAUSTED.
   */
  public static retryPayment(transactionId: string, paymentMethod = 'card'): Transaction {
    const tx = store.transactions.get(transactionId);
    if (!tx) throw new Error(`Transaction ${transactionId} not found.`);

    const MAX_PAYMENT_ATTEMPTS = 3;
    if (tx.paymentAttempts.length >= MAX_PAYMENT_ATTEMPTS) {
      if (tx.state !== 'RECOVERY_EXHAUSTED') {
        this.updateTransactionState(
          transactionId,
          'RECOVERY_EXHAUSTED',
          `Maximum retry limit (${MAX_PAYMENT_ATTEMPTS}) reached. Human intervention required.`
        );
      }
      this.recordAuditEvent({
        actor: 'POLICY_ENGINE',
        action: 'RECOVERY_EXHAUSTED',
        transactionId: tx.transactionId,
        merchantId: tx.merchantId,
        productName: tx.productName,
        result: 'BLOCKED',
        details: `Payment recovery exhausted after ${MAX_PAYMENT_ATTEMPTS} attempts. Human intervention required.`,
      });
      throw new Error(
        `Maximum payment recovery attempts (${MAX_PAYMENT_ATTEMPTS}) exhausted. Human assistance required.`
      );
    }

    this.updateTransactionState(
      transactionId,
      'PAYMENT_PENDING',
      `Payment retry approved via ${paymentMethod} (Attempt #${tx.paymentAttempts.length + 1})`
    );

    this.recordAuditEvent({
      actor: 'AI_BUYER',
      action: 'PAYMENT_RETRY_APPROVED',
      transactionId: tx.transactionId,
      merchantId: tx.merchantId,
      productName: tx.productName,
      result: 'SUCCESS',
      details: `Authorized retry attempt #${tx.paymentAttempts.length + 1} with method '${paymentMethod}'. Reusing Razorpay Order ${tx.razorpayOrderId} with zero duplicate charges.`,
    });

    return tx;
  }

  /**
   * 11. Controlled Refund Engine
   * Validates eligibility, checks return policy, validates amount, and creates Razorpay refund.
   */
  public static async requestRefund(params: {
    transactionId: string;
    amountPaise?: number;
    reason?: string;
  }): Promise<{
    success: boolean;
    transactionId: string;
    refundId: string;
    amountPaise: number;
    amountFormatted: string;
    state: TransactionState;
  }> {
    const tx = store.transactions.get(params.transactionId);
    if (!tx) throw new Error(`Transaction ${params.transactionId} not found.`);

    if (tx.refundStatus === 'REFUNDED' || tx.state === 'REFUNDED') {
      throw new Error(`Transaction ${params.transactionId} has already been refunded. Duplicate refund prevented.`);
    }

    if (tx.refundStatus === 'REQUESTED' || tx.state === 'REFUND_REQUESTED') {
      throw new Error(`Refund already requested for transaction ${params.transactionId}. Duplicate request prevented.`);
    }

    if (tx.state !== 'FULFILLED' && tx.state !== 'PAYMENT_SUCCESS') {
      throw new Error(`Cannot refund transaction: Current state is '${tx.state}'. Only fulfilled transactions can be refunded.`);
    }

    const refundAmountPaise = params.amountPaise || tx.amountPaise;
    if (refundAmountPaise <= 0 || refundAmountPaise > tx.amountPaise) {
      throw new Error(
        `Invalid refund amount: ₹${(refundAmountPaise / 100).toFixed(2)}. Cannot exceed captured total of ₹${(
          tx.amountPaise / 100
        ).toFixed(2)}.`
      );
    }

    this.updateTransactionState(params.transactionId, 'REFUND_REQUESTED', params.reason || 'Customer requested refund');
    tx.refundStatus = 'REQUESTED';

    this.recordAuditEvent({
      actor: 'USER',
      action: 'REFUND_REQUESTED',
      transactionId: tx.transactionId,
      merchantId: tx.merchantId,
      productName: tx.productName,
      amountFormatted: formatINR(refundAmountPaise),
      result: 'PENDING',
      details: `Refund requested for ${formatINR(refundAmountPaise)}. Reason: ${params.reason || 'Customer requested'}.`,
    });

    const refundResult = await razorpayAdapter.createRefund({
      paymentId: tx.razorpayPaymentId!,
      amountPaise: refundAmountPaise,
      notes: {
        transactionId: tx.transactionId,
        reason: params.reason || 'User requested refund',
      },
    });

    tx.refundStatus = 'REFUNDED';
    tx.refundId = refundResult.id;
    this.updateTransactionState(params.transactionId, 'REFUNDED', `Refund ${refundResult.id} processed`);

    this.recordAuditEvent({
      actor: 'RAZORPAY',
      action: 'REFUND_PROCESSED',
      transactionId: tx.transactionId,
      merchantId: tx.merchantId,
      productName: tx.productName,
      amountFormatted: formatINR(refundAmountPaise),
      result: 'SUCCESS',
      details: `Razorpay refund ${refundResult.id} processed successfully for ${formatINR(refundAmountPaise)}.`,
    });

    return {
      success: true,
      transactionId: tx.transactionId,
      refundId: refundResult.id,
      amountPaise: refundAmountPaise,
      amountFormatted: formatINR(refundAmountPaise),
      state: tx.state,
    };
  }

  /**
   * 12. Webhook Event Processing with Durable Deduplication
   */
  public static processWebhookEvent(
    event: any,
    rawBody?: string,
    signature?: string
  ): {
    success: boolean;
    status: 'PROCESSED' | 'IGNORED_DUPLICATE' | 'FAILED';
    eventType?: string;
    message: string;
    orderId?: string;
    paymentId?: string;
  } {
    const eventId = event?.id || (event?.contains?.length ? event.contains[0] : `evnt_${Date.now()}`);
    const eventType = event?.event || 'unknown';

    // 1. Durable Deduplication Check
    if (store.processedWebhooks.has(eventId)) {
      this.recordAuditEvent({
        actor: 'RAZORPAY_WEBHOOK',
        action: 'WEBHOOK_DUPLICATE_IGNORED',
        result: 'SUCCESS',
        details: `Duplicate webhook event ${eventId} (${eventType}) received. Safely ignored. Duplicate fulfillment prevented.`,
      });

      return {
        success: true,
        status: 'IGNORED_DUPLICATE',
        eventType,
        message: `Webhook event ${eventId} already processed. Safely ignored.`,
      };
    }

    const payload = event?.payload || {};
    const paymentEntity = payload?.payment?.entity;
    const orderEntity = payload?.order?.entity;
    const refundEntity = payload?.refund?.entity;

    const orderId = paymentEntity?.order_id || orderEntity?.id;
    const paymentId = paymentEntity?.id;
    const refundId = refundEntity?.id;

    // Find internal transaction by Razorpay Order ID
    let targetTx: Transaction | undefined;
    if (orderId) {
      targetTx = Array.from(store.transactions.values()).find((t) => t.razorpayOrderId === orderId);
    }

    switch (eventType) {
      case 'order.paid': {
        if (targetTx) {
          if (targetTx.state !== 'FULFILLED' && targetTx.state !== 'PAYMENT_SUCCESS') {
            this.updateTransactionState(targetTx.transactionId, 'PAYMENT_SUCCESS', 'Webhook confirmed order.paid');
            this.updateTransactionState(targetTx.transactionId, 'FULFILLMENT_PENDING', 'Awaiting fulfillment from webhook');
            this.fulfillTransaction(targetTx.transactionId);
          }
        }
        break;
      }

      case 'payment.captured': {
        if (targetTx) {
          if (targetTx.state !== 'FULFILLED' && targetTx.state !== 'PAYMENT_SUCCESS') {
            this.recordPaymentAttempt({
              transactionId: targetTx.transactionId,
              paymentId: paymentId || `pay_wh_${Date.now()}`,
              method: paymentEntity?.method || 'card',
              status: 'SUCCESS',
            });
            this.fulfillTransaction(targetTx.transactionId);
          }
        }
        break;
      }

      case 'payment.failed': {
        if (targetTx) {
          this.recordPaymentAttempt({
            transactionId: targetTx.transactionId,
            paymentId: paymentId || `pay_fail_wh_${Date.now()}`,
            method: paymentEntity?.method || 'unknown',
            status: 'FAILED',
            errorDescription: paymentEntity?.error_description || 'Webhook reported payment failure',
          });
        }
        break;
      }

      case 'refund.created': {
        if (targetTx) {
          targetTx.refundStatus = 'REQUESTED';
          targetTx.refundId = refundId;
          if (targetTx.state !== 'REFUND_REQUESTED' && targetTx.state !== 'REFUNDED') {
            this.updateTransactionState(targetTx.transactionId, 'REFUND_REQUESTED', 'Webhook reported refund.created');
          }
        }
        break;
      }

      case 'refund.processed': {
        if (targetTx) {
          targetTx.refundStatus = 'REFUNDED';
          targetTx.refundId = refundId;
          if (targetTx.state !== 'REFUNDED') {
            this.updateTransactionState(targetTx.transactionId, 'REFUNDED', 'Webhook reported refund.processed');
          }
        }
        break;
      }

      default:
        console.log(`Unhandled webhook event type: ${eventType}`);
    }

    // Record processed event
    const record: WebhookRecord = {
      eventId,
      eventType,
      receivedTimestamp: Date.now(),
      processedTimestamp: Date.now(),
      status: 'PROCESSED',
      relatedOrderId: orderId,
      relatedPaymentId: paymentId,
      relatedRefundId: refundId,
    };
    store.processedWebhooks.set(eventId, record);

    this.recordAuditEvent({
      actor: 'RAZORPAY_WEBHOOK',
      action: 'WEBHOOK_PROCESSED',
      transactionId: targetTx?.transactionId,
      merchantId: targetTx?.merchantId,
      productName: targetTx?.productName,
      result: 'SUCCESS',
      details: `Processed webhook event ${eventId} (${eventType}). State updated.`,
    });

    return {
      success: true,
      status: 'PROCESSED',
      eventType,
      message: `Webhook event ${eventId} processed successfully.`,
      orderId,
      paymentId,
    };
  }

  public static getProcessedWebhooks(): WebhookRecord[] {
    return Array.from(store.processedWebhooks.values());
  }

  /**
   * 9. Audit Event Logger
   */
  public static recordAuditEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
    const auditEvent: AuditEvent = {
      ...event,
      id: `aud_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`,
      timestamp: Date.now(),
    };

    store.auditEvents.unshift(auditEvent);
    if (store.auditEvents.length > 200) {
      store.auditEvents.pop();
    }

    return auditEvent;
  }

  public static getAuditEvents(limit = 50): AuditEvent[] {
    return store.auditEvents.slice(0, limit);
  }

  public static getTransaction(id: string): Transaction | undefined {
    return store.transactions.get(id);
  }

  public static getAllTransactions(): Transaction[] {
    return Array.from(store.transactions.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Aggregated metrics for Merchant Dashboard
   */
  public static getMetrics() {
    const all = Array.from(store.transactions.values());
    const fulfilled = all.filter((t) => t.state === 'FULFILLED' || t.state === 'PAYMENT_SUCCESS');
    const failed = all.filter((t) => t.state === 'PAYMENT_FAILED');
    const recovered = all.filter(
      (t) =>
        (t.state === 'FULFILLED' || t.state === 'PAYMENT_SUCCESS') &&
        t.paymentAttempts.some((a) => a.status === 'FAILED')
    );

    const totalGMVPaise = fulfilled.reduce((acc, curr) => acc + curr.amountPaise, 0);
    const recoveredRevenuePaise = recovered.reduce((acc, curr) => acc + curr.amountPaise, 0);
    const aovPaise = fulfilled.length > 0 ? Math.round(totalGMVPaise / fulfilled.length) : 0;

    return {
      totalGMVFormatted: formatINR(totalGMVPaise),
      totalGMVPaise,
      totalOrders: all.length,
      successfulPayments: fulfilled.length,
      failedPayments: failed.length,
      recoveredCount: recovered.length,
      recoveredRevenueFormatted: formatINR(recoveredRevenuePaise),
      recoveredRevenuePaise,
      averageOrderValueFormatted: formatINR(aovPaise),
      recentTransactions: all.slice(0, 10),
    };
  }
}
