/**
 * Types for RazorPay Server Adapter
 */

export interface CreateOrderParams {
  amountPaise: number;       // Must be in paise (e.g. 294900 = ₹2,949.00)
  currency?: 'INR';
  receipt: string;           // Internal unique transaction / purchase reference
  notes?: Record<string, string>;
}

export interface RazorpayOrderResult {
  id: string;                // Real "order_xxx" or simulated "sim_order_xxx"
  entity: 'order';
  amount: number;            // In paise
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: 'created' | 'attempted' | 'paid';
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
  mode: 'RAZORPAY_TEST_MODE' | 'SIMULATED_DEV_MODE';
}

export interface RazorpayPaymentResult {
  id: string;                // Real "pay_xxx" or simulated "sim_pay_xxx"
  entity: 'payment';
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  order_id: string;
  method: string;            // 'card' | 'upi' | 'netbanking'
  captured: boolean;
  description?: string;
  card_id?: string;
  bank?: string;
  wallet?: string;
  vpa?: string;
  email?: string;
  contact?: string;
  fee?: number;
  tax?: number;
  error_code?: string;
  error_description?: string;
  created_at: number;
  mode: 'RAZORPAY_TEST_MODE' | 'SIMULATED_DEV_MODE';
}

export interface VerifySignatureParams {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface VerificationResult {
  isValid: boolean;
  orderId: string;
  paymentId: string;
  verifiedAt: number;
  verificationMethod: 'HMAC_SHA256' | 'SIMULATED_VERIFIER';
  mode: 'RAZORPAY_TEST_MODE' | 'SIMULATED_DEV_MODE';
  error?: string;
}

export interface CreateRefundParams {
  paymentId: string;
  amountPaise?: number;      // If not provided, full refund
  notes?: Record<string, string>;
  receipt?: string;
}

export interface RazorpayRefundResult {
  id: string;                // Real "rfnd_xxx" or simulated "sim_rfnd_xxx"
  entity: 'refund';
  amount: number;
  currency: string;
  payment_id: string;
  status: 'pending' | 'processed' | 'failed';
  receipt?: string;
  created_at: number;
  mode: 'RAZORPAY_TEST_MODE' | 'SIMULATED_DEV_MODE';
}
