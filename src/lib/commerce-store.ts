/**
 * Global In-Memory Commerce & Transaction Store
 *
 * Persists transactions, human approvals, pricing quotes, and financial audit logs
 * across Next.js hot module reloads via globalThis.
 */

import { PricingQuote, formatINR } from '@/services/pricing/calculator';
import { PolicyValidationResult } from '@/services/policy/engine';
import { TransactionState, TransactionStateMachine, StateTransitionRecord } from '@/services/transactions/state-machine';

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
  actor: 'USER' | 'AI_BUYER' | 'POLICY_ENGINE' | 'HUMAN_APPROVER' | 'RAZORPAY' | 'MERCHANT_FULFILLMENT';
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
  auditEvents: [],
};

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

    const purchaseRequest: PurchaseRequest = {
      id,
      merchantId: params.merchantId,
      productId: params.productId,
      quantity: params.quantity,
      quote: params.quote,
      policyResult: params.policyResult,
      selectionReason: params.selectionReason,
      approvalStatus: params.policyResult.requiresApproval ? 'PENDING' : 'APPROVED',
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
      details: `Created purchase request ${id}. Policy evaluation: ${params.policyResult.allowed ? 'PASSED' : 'REJECTED'}.`,
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
      this.updateTransactionState(
        params.transactionId,
        'PAYMENT_FAILED',
        params.errorDescription || `Payment attempt #${attemptNumber} failed`
      );

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
   * 8. Fulfill Order
   * STRICT SECURITY: Only callable after PAYMENT_SUCCESS.
   */
  public static fulfillTransaction(transactionId: string): Transaction {
    const tx = store.transactions.get(transactionId);
    if (!tx) throw new Error(`Transaction ${transactionId} not found.`);

    if (tx.state !== 'FULFILLMENT_PENDING') {
      throw new Error(`Cannot fulfill transaction: Current state is '${tx.state}'. Payment must be verified first.`);
    }

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
