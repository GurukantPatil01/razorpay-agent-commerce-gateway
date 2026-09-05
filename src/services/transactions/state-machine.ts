/**
 * Transaction State Machine for RazorPay Agent Commerce Gateway
 *
 * Enforces valid transition paths across the complete commercial transaction lifecycle.
 * Prevents illegal state transitions and duplicate charges.
 */

export type TransactionState =
  | 'DISCOVERED'
  | 'SELECTED'
  | 'CART_CREATED'
  | 'POLICY_VALIDATED'
  | 'APPROVAL_PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'RAZORPAY_ORDER_CREATED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_PROCESSING'
  | 'PAYMENT_UNKNOWN'
  | 'PAYMENT_SUCCESS'
  | 'FULFILLMENT_PENDING'
  | 'FULFILLED'
  | 'POLICY_REJECTED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_EXPIRED'
  | 'RECOVERY_EXHAUSTED'
  | 'MERCHANT_UNAVAILABLE'
  | 'FULFILLMENT_FAILED'
  | 'REFUND_REQUESTED'
  | 'REFUNDED';

// Permitted transition map
const VALID_TRANSITIONS: Record<TransactionState, TransactionState[]> = {
  DISCOVERED: ['SELECTED', 'MERCHANT_UNAVAILABLE'],
  SELECTED: ['CART_CREATED', 'MERCHANT_UNAVAILABLE'],
  CART_CREATED: ['POLICY_VALIDATED', 'POLICY_REJECTED'],
  POLICY_VALIDATED: ['APPROVAL_PENDING', 'RAZORPAY_ORDER_CREATED', 'POLICY_REJECTED'],
  APPROVAL_PENDING: ['APPROVED', 'REJECTED', 'POLICY_REJECTED'],
  APPROVED: ['RAZORPAY_ORDER_CREATED', 'POLICY_REJECTED', 'PAYMENT_EXPIRED'],
  REJECTED: [], // Terminal
  RAZORPAY_ORDER_CREATED: ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED'],
  PAYMENT_PENDING: ['PAYMENT_PROCESSING', 'PAYMENT_UNKNOWN', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED'],
  PAYMENT_PROCESSING: ['PAYMENT_UNKNOWN', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED'],
  PAYMENT_UNKNOWN: ['PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_PENDING'],
  PAYMENT_SUCCESS: ['FULFILLMENT_PENDING', 'REFUND_REQUESTED'],
  FULFILLMENT_PENDING: ['FULFILLED', 'FULFILLMENT_FAILED'],
  FULFILLED: ['REFUND_REQUESTED'],
  POLICY_REJECTED: ['POLICY_VALIDATED'], // Can re-validate if cart / parameters change
  PAYMENT_FAILED: ['PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'PAYMENT_SUCCESS', 'RECOVERY_EXHAUSTED', 'APPROVAL_PENDING'],
  RECOVERY_EXHAUSTED: ['APPROVAL_PENDING'],
  PAYMENT_EXPIRED: ['APPROVAL_PENDING'],
  MERCHANT_UNAVAILABLE: ['DISCOVERED'],
  FULFILLMENT_FAILED: ['REFUND_REQUESTED'],
  REFUND_REQUESTED: ['REFUNDED'],
  REFUNDED: [], // Terminal
};

export interface StateTransitionRecord {
  fromState: TransactionState;
  toState: TransactionState;
  timestamp: number;
  reason?: string;
  metadata?: Record<string, any>;
}

export class TransactionStateMachine {
  public static canTransition(current: TransactionState, next: TransactionState): boolean {
    const allowed = VALID_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  public static validateTransition(current: TransactionState, next: TransactionState): void {
    if (!this.canTransition(current, next)) {
      throw new Error(
        `Illegal Transaction State Transition: Cannot move from '${current}' to '${next}'. Allowed next states: [${(
          VALID_TRANSITIONS[current] || []
        ).join(', ')}]`
      );
    }
  }
}
