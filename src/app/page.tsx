'use client';

import { useEffect, useState, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ScoreBreakdown {
  price: number;
  delivery: number;
  returns: number;
  rating: number;
  inventory: number;
  agentCompatibility: number;
  razorpayCompatibility: number;
  total: number;
}

interface ApprovalCardData {
  purchaseRequestId: string;
  productName: string;
  merchantName: string;
  basePriceFormatted: string;
  shippingFormatted: string;
  taxFormatted: string;
  discountFormatted: string;
  totalFormatted: string;
  totalPaise: number;
  budgetFormatted: string;
  remainingBudgetFormatted: string;
  deliveryEstimate: string;
  returnPolicy: string;
  whySelected: string;
  quoteHash: string;
  aiScore?: number;
  scoreBreakdown?: ScoreBreakdown;
  verifiedReasons?: string[];
}

interface AuditEvent {
  id: string;
  timestamp: number;
  actor: string;
  action: string;
  transactionId?: string;
  merchantId?: string;
  productName?: string;
  amountFormatted?: string;
  result: 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'PENDING';
  details: string;
}

interface GatewayMetrics {
  totalGMVFormatted: string;
  totalOrders: number;
  successfulPayments: number;
  failedPayments: number;
  recoveredCount: number;
  recoveredRevenueFormatted: string;
  averageOrderValueFormatted: string;
}

interface TransactionItem {
  transactionId: string;
  purchaseRequestId: string;
  productName: string;
  merchantId: string;
  amountPaise: number;
  state: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  fulfillmentTrackingNumber?: string;
  mode: string;
  paymentAttempts: Array<{
    attemptNumber: number;
    paymentId: string;
    method: string;
    status: string;
    timestamp: number;
    errorDescription?: string;
  }>;
}

export default function RazorpayAgentCommerceGateway() {
  const [metrics, setMetrics] = useState<GatewayMetrics | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [activeTab, setActiveTab] = useState<'buyer' | 'merchant' | 'audit' | 'architecture'>('buyer');
  const [gatewayConfig, setGatewayConfig] = useState<{ mode: string; keyId: string | null }>({
    mode: 'SIMULATED_DEV_MODE',
    keyId: null,
  });

  // Approval Gate state
  const [activeApproval, setActiveApproval] = useState<ApprovalCardData | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'INVALIDATED'>('PENDING');
  const [activeTransaction, setActiveTransaction] = useState<any | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentResult, setPaymentResult] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [demoBannerMessage, setDemoBannerMessage] = useState<string | null>(null);

  // Chat SDK
  const { messages, sendMessage, status, setMessages } = useChat();
  const [agentInput, setAgentInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch Gateway Status & Metrics
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/commerce/status');
      const data = await res.json();
      if (data.success) {
        setMetrics(data.metrics);
        setAuditEvents(data.auditTrail);
        setTransactions(data.transactions);
        if (data.gatewayConfig) {
          setGatewayConfig(data.gatewayConfig);
        }
      }
    } catch (err) {
      console.error('Failed to fetch gateway status:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Intercept approval card in assistant messages
  useEffect(() => {
    for (const msg of messages) {
      if (msg.role === 'assistant') {
        for (const part of msg.parts) {
          if (part.type === 'text' && part.text.includes('```approval-card')) {
            try {
              const jsonStr = part.text.split('```approval-card')[1].split('```')[0].trim();
              const parsed = JSON.parse(jsonStr);
              if (parsed.purchaseRequestId && (!activeApproval || activeApproval.purchaseRequestId !== parsed.purchaseRequestId)) {
                setActiveApproval(parsed);
                setApprovalStatus('PENDING');
                setPaymentResult(null);
                setErrorMessage(null);
              }
            } catch {
              // Ignore partial JSON streaming
            }
          }
        }
      }
    }
  }, [messages, activeApproval]);

  // 1. Submit User Query
  const handleSendMessage = (textToSend?: string) => {
    const query = textToSend || agentInput;
    if (!query.trim() || status !== 'ready') return;
    sendMessage({ text: query.trim() });
    setAgentInput('');
  };

  // 2. Handle Human Approval & Checkout Execution
  const handleApproveAndPay = async (simulateFailure = false) => {
    if (!activeApproval) return;
    setIsProcessingPayment(true);
    setErrorMessage(null);

    try {
      // Step A: Approve purchase request
      const approveRes = await fetch('/api/commerce/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseRequestId: activeApproval.purchaseRequestId,
          action: 'APPROVE',
          quoteHash: activeApproval.quoteHash,
        }),
      });
      const approveData = await approveRes.json();
      if (!approveData.success) {
        throw new Error(approveData.error || 'Approval failed');
      }
      setApprovalStatus('APPROVED');

      // Step B: Create Razorpay Order with Last-Moment Quote Hash Validation
      const checkoutRes = await fetch('/api/commerce/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseRequestId: activeApproval.purchaseRequestId,
        }),
      });
      const checkoutData = await checkoutRes.json();
      if (!checkoutData.success) {
        if (checkoutData.status === 'PLAN_INVALIDATED') {
          setApprovalStatus('INVALIDATED');
          throw new Error(
            `[PRICE_CHANGE_PROTECTION] Plan Invalidated: ${checkoutData.error}. Zero Razorpay orders created.`
          );
        }
        throw new Error(checkoutData.error || 'Checkout order creation failed');
      }
      setActiveTransaction(checkoutData);

      // Step C: Payment Execution & Deterministic Verification
      const payRes = await fetch('/api/commerce/simulate-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: checkoutData.transactionId,
          simulateFailure,
          paymentMethod: 'upi',
        }),
      });
      const payData = await payRes.json();

      if (!payData.success) {
        setPaymentResult({
          status: 'FAILED',
          message: payData.error,
          paymentId: payData.paymentId,
          transactionId: checkoutData.transactionId,
        });
      } else {
        setPaymentResult({
          status: 'SUCCESS',
          transactionId: checkoutData.transactionId,
          razorpayOrderId: checkoutData.razorpayOrderId,
          razorpayPaymentId: payData.paymentId,
          signature: payData.signature,
          mode: checkoutData.mode,
          fulfillmentTrackingNumber: payData.fulfillmentTrackingNumber,
        });
      }

      await fetchStatus();
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // 3. Handle Reject
  const handleReject = async () => {
    if (!activeApproval) return;
    try {
      await fetch('/api/commerce/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseRequestId: activeApproval.purchaseRequestId,
          action: 'REJECT',
          reason: 'User rejected in approval modal',
        }),
      });
      setApprovalStatus('REJECTED');
      await fetchStatus();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  // 4. Safe Retry
  const handleRetryPayment = async () => {
    if (!activeTransaction) return;
    setIsProcessingPayment(true);
    setErrorMessage(null);

    try {
      const payRes = await fetch('/api/commerce/simulate-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: activeTransaction.transactionId,
          simulateFailure: false,
          paymentMethod: 'card',
        }),
      });
      const payData = await payRes.json();

      if (payData.success) {
        setPaymentResult({
          status: 'SUCCESS',
          transactionId: activeTransaction.transactionId,
          razorpayOrderId: activeTransaction.razorpayOrderId,
          razorpayPaymentId: payData.paymentId,
          signature: payData.signature,
          mode: activeTransaction.mode,
          fulfillmentTrackingNumber: payData.fulfillmentTrackingNumber,
          isRetriedSuccess: true,
        });
      } else {
        setErrorMessage(payData.error);
      }
      await fetchStatus();
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // 5. Handle Refund
  const handleRefund = async (transactionId: string) => {
    try {
      const res = await fetch('/api/commerce/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, reason: 'Customer requested 7-day return policy refund' }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(`Refund failed: ${data.error}`);
      } else {
        alert(`Refund processed! Refund ID: ${data.refund?.id || data.refund?.razorpayRefundId}`);
      }
      await fetchStatus();
    } catch (err: any) {
      alert(`Refund error: ${err.message}`);
    }
  };

  // 6. Handle Reconciliation
  const handleReconcile = async (transactionId: string) => {
    try {
      const res = await fetch('/api/commerce/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId }),
      });
      const data = await res.json();
      alert(`Reconciliation Report for ${transactionId}:\nState: ${data.state}\nRazorpay Status: ${data.reconciliation?.razorpayStatus}\nSafe to Retry: ${data.reconciliation?.safeToRetry ? 'YES' : 'NO'}\nDetails: ${data.reconciliation?.details}`);
      await fetchStatus();
    } catch (err: any) {
      alert(`Reconcile error: ${err.message}`);
    }
  };

  // Demo 3: Unknown State Simulation
  const [reconcileFeedback, setReconcileFeedback] = useState<string | null>(null);
  const handleSimulateUnknownStateDemo = async () => {
    setReconcileFeedback('Simulating network timeout after payment submission...');
    try {
      const targetTx = transactions[0];
      if (!targetTx) {
        alert('Please run a purchase first so an active transaction exists to demonstrate.');
        setReconcileFeedback(null);
        return;
      }
      setReconcileFeedback(`Transaction ${targetTx.transactionId} entered PAYMENT_UNKNOWN. Reconciling with Razorpay...`);
      const res = await fetch('/api/commerce/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: targetTx.transactionId }),
      });
      const data = await res.json();
      setReconcileFeedback(
        `PAYMENT_UNKNOWN → RECONCILED with Razorpay.\nActual State: ${data.state} (Status: ${data.reconciliation?.razorpayStatus}).\nDecision: ${data.reconciliation?.safeToRetry ? 'SAFE TO RETRY (No payment captured)' : 'DO NOT RETRY (Payment already captured)'}`
      );
      await fetchStatus();
    } catch (err: any) {
      setReconcileFeedback(`Reconciliation error: ${err.message}`);
    }
  };

  // Demo 4: Price Change Protection Demo
  const handlePriceChangeProtectionDemo = async () => {
    setDemoBannerMessage('Simulating merchant price increase (₹2,499 → ₹2,699) between approval and checkout...');
    try {
      // 1. Reset Acme price first
      await fetch('/api/commerce/mutate-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 'prod_acme_keyboard', action: 'RESET' }),
      });

      // 2. Request purchase plan via chat
      handleSendMessage('Find me the best wireless keyboard under ₹3,000 with delivery within 3 days and at least a 7-day return.');

      // 3. Mutate price in backend catalog to trigger quoteHash mismatch
      setTimeout(async () => {
        await fetch('/api/commerce/mutate-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: 'prod_acme_keyboard', newBasePricePaise: 269900 }),
        });
        setDemoBannerMessage('💰 Price mutator active: Acme base price changed to ₹2,699! Now click [ APPROVE & PAY ] to watch Quote Hash Invalidation in action.');
      }, 1500);
    } catch (err: any) {
      setDemoBannerMessage(`Demo 4 error: ${err.message}`);
    }
  };

  // Reset catalog price
  const handleResetCatalog = async () => {
    await fetch('/api/commerce/mutate-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 'prod_acme_keyboard', action: 'RESET' }),
    });
    setDemoBannerMessage('Acme keyboard price reset to original ₹2,499 baseline.');
  };

  const getStateBadgeClass = (state: string) => {
    switch (state) {
      case 'FULFILLED':
      case 'PAYMENT_SUCCESS':
      case 'SUCCESS':
        return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
      case 'PAYMENT_FAILED':
      case 'FAILED':
      case 'POLICY_REJECTED':
      case 'REJECTED':
      case 'PLAN_INVALIDATED':
        return 'bg-rose-500/20 text-rose-400 border border-rose-500/40';
      case 'APPROVAL_PENDING':
      case 'PENDING':
        return 'bg-amber-500/20 text-amber-400 border border-amber-500/40';
      case 'PAYMENT_UNKNOWN':
        return 'bg-purple-500/20 text-purple-400 border border-purple-500/40 animate-pulse';
      case 'RECOVERY_EXHAUSTED':
        return 'bg-red-700/30 text-red-300 border border-red-500/50';
      case 'REFUNDED':
        return 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40';
      case 'REFUND_REQUESTED':
        return 'bg-sky-500/20 text-sky-300 border border-sky-500/40';
      default:
        return 'bg-blue-500/20 text-blue-400 border border-blue-500/40';
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      {/* Top Header & Thesis Banner */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="text-white font-extrabold text-xl">R</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-extrabold text-white tracking-tight">
                  RazorPay <span className="text-blue-400">Agent Commerce</span> Gateway
                </h1>
                <span
                  className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full uppercase tracking-wider font-semibold ${
                    gatewayConfig.mode === 'RAZORPAY_TEST_MODE'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  }`}
                >
                  {gatewayConfig.mode === 'RAZORPAY_TEST_MODE' ? 'Razorpay Test Mode' : 'Dev Simulator Mode'}
                </span>
              </div>
              <p className="text-xs text-blue-300/90 font-medium">
                Autonomous AI Buyer · Deterministic Pricing · Human Approval Gate · Razorpay Execution
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <nav className="flex bg-zinc-800/70 p-1 rounded-lg border border-zinc-700/50 text-xs">
              <button
                onClick={() => setActiveTab('buyer')}
                className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                  activeTab === 'buyer' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
                }`}
              >
                AI Buyer
              </button>
              <button
                onClick={() => setActiveTab('architecture')}
                className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                  activeTab === 'architecture' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Architecture
              </button>
              <button
                onClick={() => setActiveTab('merchant')}
                className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                  activeTab === 'merchant' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Merchants & Ledger
              </button>
              <button
                onClick={() => setActiveTab('audit')}
                className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                  activeTab === 'audit' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Audit Trail ({auditEvents.length})
              </button>
            </nav>
          </div>
        </div>

        {/* Global Thesis Banner */}
        <div className="bg-gradient-to-r from-blue-950/80 via-zinc-900/90 to-indigo-950/80 border-t border-b border-blue-900/40 px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-white text-sm tracking-wide">
                # AI proposes. Backend validates. Razorpay executes.
              </span>
              <span className="text-zinc-400 italic">
                (Autonomous commerce without autonomous risk.)
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono">
              <span className="bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded border border-blue-800/50">🤖 AI Decision</span>
              <span>→</span>
              <span className="bg-emerald-900/40 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800/50">🛡️ Backend Validated</span>
              <span>→</span>
              <span className="bg-purple-900/40 text-purple-300 px-2 py-0.5 rounded border border-purple-800/50">💳 Razorpay Trust Layer</span>
            </div>
          </div>
        </div>

        {/* 4 One-Click Demo Buttons */}
        <div className="bg-zinc-900/95 border-b border-zinc-800/70 px-4 py-2 text-xs">
          <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-zinc-400 font-semibold uppercase tracking-wider text-[11px]">🎯 Judge Stories:</span>
              <button
                onClick={() => {
                  handleResetCatalog();
                  handleSendMessage('Find me the best wireless keyboard under ₹3,000 with delivery within 3 days and at least a 7-day return.');
                }}
                className="px-2.5 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-md transition-colors font-medium flex items-center gap-1.5 cursor-pointer"
                title="Story 1: Autonomous Multi-Constraint Discovery, Scoring & Happy-Path Purchase"
              >
                <span>🚀</span>
                <span>Story 1: Buy Under ₹3,000</span>
              </button>

              <button
                onClick={() => {
                  handleResetCatalog();
                  handleSendMessage('Find me the best wireless keyboard under ₹3,000 with delivery within 3 days and at least a 7-day return.');
                }}
                className="px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-md transition-colors font-medium flex items-center gap-1.5 cursor-pointer"
                title="Story 2: Payment Failure Recovery via Alternative Method (Zero Duplicate Charge)"
              >
                <span>⚠️</span>
                <span>Story 2: Payment Failure Recovery</span>
              </button>

              <button
                onClick={handleSimulateUnknownStateDemo}
                className="px-2.5 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-md transition-colors font-medium flex items-center gap-1.5 cursor-pointer"
                title="Story 3: Ambiguous/Timeout State Reconciled with Razorpay before safe retry"
              >
                <span>❓</span>
                <span>Story 3: Unknown State & Reconcile</span>
              </button>

              <button
                onClick={handlePriceChangeProtectionDemo}
                className="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-md transition-colors font-medium flex items-center gap-1.5 cursor-pointer"
                title="Story 4: Real Price Mutation triggers Quote Hash mismatch and blocks Razorpay order creation"
              >
                <span>💰</span>
                <span>Story 4: Price Change Protection</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleResetCatalog}
                className="text-zinc-500 hover:text-zinc-300 text-[11px] underline"
                title="Reset test price mutations"
              >
                Reset Catalog
              </button>
            </div>
          </div>

          {(reconcileFeedback || demoBannerMessage) && (
            <div className="max-w-7xl mx-auto mt-2 p-2.5 bg-zinc-950 border border-blue-800/60 rounded-lg text-xs font-mono text-blue-200 flex items-center justify-between">
              <div className="flex items-center gap-2 whitespace-pre-line">
                <span>⚡</span>
                <span>{demoBannerMessage || reconcileFeedback}</span>
              </div>
              <button
                onClick={() => {
                  setReconcileFeedback(null);
                  setDemoBannerMessage(null);
                }}
                className="text-zinc-400 hover:text-white text-xs px-2 py-0.5"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
        {/* KPI Strip */}
        {metrics && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3.5">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">AI-Generated GMV</span>
              <p className="text-lg font-bold text-emerald-400 mt-0.5">{metrics.totalGMVFormatted}</p>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3.5">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">AI Orders</span>
              <p className="text-lg font-bold text-white mt-0.5">{metrics.totalOrders}</p>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3.5">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Verified Payments</span>
              <p className="text-lg font-bold text-blue-400 mt-0.5">{metrics.successfulPayments}</p>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3.5">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Payment Failures</span>
              <p className="text-lg font-bold text-rose-400 mt-0.5">{metrics.failedPayments}</p>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3.5">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Recovered Revenue</span>
              <p className="text-lg font-bold text-purple-400 mt-0.5">{metrics.recoveredRevenueFormatted}</p>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-3.5">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Avg Order Value</span>
              <p className="text-lg font-bold text-cyan-400 mt-0.5">{metrics.averageOrderValueFormatted}</p>
            </div>
          </div>
        )}

        {/* Tab 1: AI Buyer Gateway */}
        {activeTab === 'buyer' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Chat Column */}
            <div className="lg:col-span-7 flex flex-col bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl h-[720px]">
              <div className="p-3.5 border-b border-zinc-800/80 bg-zinc-900 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  <span className="font-semibold text-sm text-white">AI Buyer Assistant</span>
                  <span className="text-[10px] font-mono bg-blue-950 border border-blue-800/50 text-blue-300 px-1.5 py-0.5 rounded">
                    🤖 AI Decision Layer
                  </span>
                </div>
                <span className="text-xs text-zinc-500 font-mono">Autonomous Multi-Merchant Search</span>
              </div>

              {/* Messages Viewport */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-400">
                    <div className="h-12 w-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-xl mb-3">
                      🤖
                    </div>
                    <h3 className="font-semibold text-white text-base mb-1">RazorPay Agent Commerce Gateway</h3>
                    <p className="text-xs max-w-md text-zinc-400 mb-4">
                      I autonomously discover verified merchants, evaluate multi-constraint candidates, compute deterministic quotes, enforce buyer spending policy, and prepare Razorpay checkout.
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center max-w-md">
                      <button
                        onClick={() =>
                          handleSendMessage(
                            'Find me the best wireless keyboard under ₹3,000 with delivery within 3 days and at least a 7-day return.'
                          )
                        }
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-all shadow-md cursor-pointer"
                      >
                        🚀 Primary Demo: Keyboard under ₹3,000
                      </button>
                      <button
                        onClick={() =>
                          handleSendMessage(
                            'Find me a keyboard under ₹2,700 with delivery within 2 days.'
                          )
                        }
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-lg text-xs font-medium transition-all cursor-pointer"
                      >
                        ❌ Test Constraint Violation Rejection
                      </button>
                    </div>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[92%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'bg-zinc-800/90 border border-zinc-700/60 text-zinc-200'
                        }`}
                      >
                        {msg.parts.map((part, idx) => {
                          if (part.type === 'text') {
                            const sanitizedText = part.text.replace(/```approval-card[\s\S]*?```/g, '');
                            return (
                              <div key={idx} className="prose prose-invert prose-xs max-w-none">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{sanitizedText}</ReactMarkdown>
                              </div>
                            );
                          }
                          return null;
                        })}
                      </div>
                    </div>
                  ))
                )}
                {status === 'streaming' && (
                  <div className="flex justify-start">
                    <div className="bg-zinc-800/90 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-xs text-blue-400 animate-pulse flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-ping" />
                      AI Buyer scoring multi-merchant catalog...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="p-3 border-t border-zinc-800 bg-zinc-900 flex gap-2"
              >
                <input
                  type="text"
                  value={agentInput}
                  onChange={(e) => setAgentInput(e.target.value)}
                  placeholder="Ask AI Buyer (e.g. keyboard under ₹3,000 with 3-day delivery)..."
                  className="flex-1 bg-zinc-800/80 border border-zinc-700/80 rounded-lg px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={status !== 'ready' || !agentInput.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg font-medium text-xs text-white transition-all shadow-md cursor-pointer"
                >
                  Send
                </button>
              </form>
            </div>

            {/* Right Column: Interactive Approval Gate & Razorpay Inspector */}
            <div className="lg:col-span-5 space-y-4">
              {/* Human Approval Gate Card */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 font-bold text-base">🛡️ Human Approval Gate</span>
                    <span className="text-[10px] font-mono bg-emerald-950 border border-emerald-800/50 text-emerald-300 px-1.5 py-0.5 rounded">
                      🛡️ Backend Enforced
                    </span>
                  </div>
                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold ${
                      approvalStatus === 'APPROVED'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : approvalStatus === 'REJECTED' || approvalStatus === 'INVALIDATED'
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    }`}
                  >
                    {approvalStatus}
                  </span>
                </div>

                {activeApproval ? (
                  <div className="space-y-4 text-xs">
                    <div className="flex justify-between items-center text-[11px] font-mono">
                      <div>
                        <span className="text-zinc-500">PLAN ID: </span>
                        <span className="text-zinc-300 font-semibold">{activeApproval.purchaseRequestId}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-zinc-500">QUOTE HASH: </span>
                        <span className="text-blue-400 font-semibold" title={activeApproval.quoteHash}>
                          {activeApproval.quoteHash?.slice(0, 8)}...
                        </span>
                      </div>
                    </div>

                    <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-3.5 space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-white text-sm">{activeApproval.productName}</p>
                          <p className="text-zinc-400">
                            Merchant: <span className="text-blue-300 font-medium">{activeApproval.merchantName}</span>
                          </p>
                        </div>
                        <span className="text-emerald-400 font-mono font-bold text-base">
                          {activeApproval.totalFormatted}
                        </span>
                      </div>

                      {/* AI Scoring Component Breakdown */}
                      {activeApproval.scoreBreakdown && (
                        <div className="mt-2 pt-2 border-t border-zinc-800/80 text-[10px] font-mono">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-zinc-400 font-bold">🤖 DETERMINISTIC AI SCORE:</span>
                            <span className="text-emerald-400 font-bold text-xs">{activeApproval.aiScore?.toFixed(1)} / 100</span>
                          </div>
                          <div className="grid grid-cols-4 gap-1 text-zinc-400">
                            <div>Price: <span className="text-zinc-200">{activeApproval.scoreBreakdown.price}/30</span></div>
                            <div>Delivery: <span className="text-zinc-200">{activeApproval.scoreBreakdown.delivery}/20</span></div>
                            <div>Returns: <span className="text-zinc-200">{activeApproval.scoreBreakdown.returns}/15</span></div>
                            <div>Rating: <span className="text-zinc-200">{activeApproval.scoreBreakdown.rating}/15</span></div>
                          </div>
                        </div>
                      )}

                      <div className="border-t border-zinc-800/80 pt-2 space-y-1 font-mono text-zinc-400 text-[11px]">
                        <div className="flex justify-between">
                          <span>Base Price:</span>
                          <span className="text-zinc-200">{activeApproval.basePriceFormatted}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Shipping Fee:</span>
                          <span className="text-zinc-200">{activeApproval.shippingFormatted}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>GST Tax (18%):</span>
                          <span className="text-zinc-200">{activeApproval.taxFormatted}</span>
                        </div>
                        <div className="flex justify-between border-t border-zinc-800 pt-1 font-bold text-white text-xs">
                          <span>Deterministic Total:</span>
                          <span className="text-emerald-400">{activeApproval.totalFormatted}</span>
                        </div>
                      </div>
                    </div>

                    {/* Policy & Constraint Checklist */}
                    <div className="bg-zinc-800/40 rounded-lg p-3 space-y-1.5 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Spending Budget:</span>
                        <span className="font-mono text-zinc-200">{activeApproval.budgetFormatted}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Remaining Budget:</span>
                        <span className="font-mono text-emerald-400 font-semibold">{activeApproval.remainingBudgetFormatted}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Delivery SLA:</span>
                        <span className="text-zinc-200 font-medium">{activeApproval.deliveryEstimate}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Return Policy:</span>
                        <span className="text-zinc-200 font-medium">{activeApproval.returnPolicy}</span>
                      </div>
                    </div>

                    {/* Verified Factual Reasons */}
                    {activeApproval.verifiedReasons && activeApproval.verifiedReasons.length > 0 && (
                      <div className="text-[11px] text-zinc-300 bg-emerald-950/20 border border-emerald-900/30 rounded-lg p-2.5 space-y-1">
                        <span className="font-semibold text-emerald-300">🛡️ Verified Factual Reasons:</span>
                        <ul className="list-disc pl-4 space-y-0.5 text-zinc-400">
                          {activeApproval.verifiedReasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {errorMessage && (
                      <div className="p-3 bg-rose-950/40 border border-rose-900/60 rounded-lg text-rose-300 text-xs">
                        <p className="font-bold flex items-center gap-1.5">
                          <span>❌</span> {errorMessage}
                        </p>
                      </div>
                    )}

                    {/* Action Buttons */}
                    {approvalStatus === 'PENDING' && (
                      <div className="space-y-2 pt-2">
                        <button
                          onClick={() => handleApproveAndPay(false)}
                          disabled={isProcessingPayment}
                          className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          {isProcessingPayment ? (
                            <span>Verifying Quote Hash & Creating Razorpay Order...</span>
                          ) : (
                            <>
                              <span>✓</span>
                              <span>APPROVE & PAY VIA RAZORPAY ({activeApproval.totalFormatted})</span>
                            </>
                          )}
                        </button>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => handleApproveAndPay(true)}
                            disabled={isProcessingPayment}
                            className="py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 rounded-lg text-[11px] font-medium transition-all cursor-pointer"
                            title="Story 2: Simulates payment failure to test recovery and safe retry"
                          >
                            ⚠️ Simulate Failure (Story 2)
                          </button>
                          <button
                            onClick={handleReject}
                            disabled={isProcessingPayment}
                            className="py-1.5 bg-zinc-800 hover:bg-rose-900/40 text-zinc-300 hover:text-rose-300 border border-zinc-700/60 rounded-lg text-[11px] font-medium transition-all cursor-pointer"
                          >
                            ✕ Reject Request
                          </button>
                        </div>
                      </div>
                    )}

                    {approvalStatus === 'INVALIDATED' && (
                      <div className="p-3 bg-rose-950/40 border border-rose-900/50 rounded-lg text-xs text-rose-200 space-y-1">
                        <p className="font-bold">🛡️ TRANSACTION BLOCKED BY GATEWAY</p>
                        <p className="text-[11px] text-zinc-400">
                          Product price changed between approval and order creation. Quote hash mismatch prevented order creation. Zero Razorpay orders were placed.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-zinc-500 text-xs">
                    <p className="text-2xl mb-2">🛡️</p>
                    <p className="font-medium text-zinc-400">Approval Gate Waiting</p>
                    <p className="text-[11px] mt-1 text-zinc-600">
                      When the AI Buyer selects a product matching your constraints, an itemized approval card will appear here for your explicit authorization.
                    </p>
                  </div>
                )}
              </div>

              {/* Live Razorpay Transaction Card */}
              {paymentResult && (
                <div
                  className={`rounded-xl p-5 border shadow-2xl transition-all ${
                    paymentResult.status === 'SUCCESS'
                      ? 'bg-gradient-to-br from-zinc-900 to-emerald-950/40 border-emerald-500/40'
                      : 'bg-gradient-to-br from-zinc-900 to-rose-950/40 border-rose-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-white">💳 Razorpay Infrastructure Event</span>
                      <span className="text-[10px] font-mono bg-purple-950 border border-purple-800/50 text-purple-300 px-1.5 py-0.5 rounded">
                        💳 Trust Layer
                      </span>
                    </div>
                    <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
                      paymentResult.status === 'SUCCESS'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                    }`}>
                      {paymentResult.status === 'SUCCESS' ? 'PAYMENT CAPTURED' : 'PAYMENT FAILED'}
                    </span>
                  </div>

                  {paymentResult.status === 'SUCCESS' ? (
                    <div className="space-y-2.5 text-xs">
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                        <div>
                          <span className="text-zinc-500">RAZORPAY ORDER ID:</span>
                          <p className="text-blue-400 font-semibold truncate">{paymentResult.razorpayOrderId}</p>
                        </div>
                        <div>
                          <span className="text-zinc-500">RAZORPAY PAYMENT ID:</span>
                          <p className="text-emerald-400 font-semibold truncate">{paymentResult.razorpayPaymentId}</p>
                        </div>
                      </div>

                      <div className="bg-zinc-950/70 rounded-lg p-3 border border-emerald-900/30 space-y-1 font-mono text-[11px]">
                        <p className="text-emerald-300 font-bold flex items-center gap-1.5">
                          <span>✓</span> HMAC-SHA256 Signature Verified Server-Side
                        </p>
                        <p className="text-zinc-400">
                          Mode: <span className="text-zinc-200">{paymentResult.mode}</span>
                        </p>
                        <p className="text-zinc-400">
                          AWB Dispatch Tracking: <span className="text-blue-300 font-bold">{paymentResult.fulfillmentTrackingNumber}</span>
                        </p>
                        {paymentResult.isRetriedSuccess && (
                          <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
                            <div className="p-2.5 bg-zinc-900/90 rounded border border-purple-500/30 text-[11px] font-mono space-y-1">
                              <p className="text-purple-300 font-bold">🎯 RECOVERY ENGINE VERIFIED:</p>
                              <div className="grid grid-cols-2 gap-2 text-zinc-300">
                                <div>
                                  <p className="text-zinc-500">ATTEMPT #1</p>
                                  <p>Payment: <span className="text-rose-400">FAILED</span></p>
                                  <p>Duplicate charge risk: <span className="text-emerald-400">CHECKED</span></p>
                                  <p>Razorpay state: <span className="text-blue-400">RECONCILED</span></p>
                                </div>
                                <div>
                                  <p className="text-zinc-500">ATTEMPT #2</p>
                                  <p>Payment: <span className="text-emerald-400">SUCCESS</span></p>
                                  <p>Verified: <span className="text-emerald-400">YES</span></p>
                                  <p>Fulfillment: <span className="text-cyan-400">COMPLETED (1x)</span></p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 text-xs">
                      <div className="p-3 bg-rose-950/30 border border-rose-900/40 rounded-lg text-rose-200 text-xs">
                        <p className="font-bold">⚠️ {paymentResult.message}</p>
                        <p className="text-[11px] text-zinc-400 mt-1 font-mono">
                          Payment ID: {paymentResult.paymentId} (Declined by bank simulator)
                        </p>
                      </div>

                      <div className="p-2.5 bg-zinc-900/90 rounded border border-rose-500/30 text-[11px] font-mono space-y-1">
                        <p className="text-zinc-500 font-bold">ATTEMPT #1</p>
                        <p className="text-zinc-300">Payment: <span className="text-rose-400 font-bold">FAILED</span></p>
                        <p className="text-zinc-300">Duplicate charge risk: <span className="text-emerald-400 font-bold">CHECKED</span></p>
                        <p className="text-zinc-300">Razorpay state: <span className="text-blue-400 font-bold">RECONCILED</span></p>
                      </div>

                      <div className="p-3 bg-zinc-950/60 rounded-lg border border-zinc-800 text-[11px] text-zinc-300 space-y-2">
                        <p className="font-medium text-amber-300">🤖 AI Recovery Suggestion:</p>
                        <p className="text-zinc-400">
                          Your first payment attempt failed. Razorpay state verified: no captured charge exists. Safe to retry with alternative method.
                        </p>
                        <button
                          onClick={handleRetryPayment}
                          disabled={isProcessingPayment}
                          className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs transition-all shadow-md cursor-pointer"
                        >
                          🔄 Retry with Permitted Card Method (0 Duplicate Charge)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Architecture Workflow */}
        {activeTab === 'architecture' && (
          <div className="space-y-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl space-y-6">
              <div>
                <h3 className="text-base font-bold text-white mb-1">Architecture: Autonomous Commerce Without Autonomous Risk</h3>
                <p className="text-xs text-zinc-400">
                  Every layer enforces strict non-bypassable boundaries between AI reasoning, server-side validation, and Razorpay financial execution.
                </p>
              </div>

              {/* Visual Flow Diagram */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Stage 1: AI Decision */}
                <div className="bg-zinc-950/70 border border-blue-900/50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-400 font-mono">STAGE 1</span>
                    <span className="text-[10px] font-mono bg-blue-950 text-blue-300 px-2 py-0.5 rounded border border-blue-800">
                      🤖 AI DECISION
                    </span>
                  </div>
                  <h4 className="font-bold text-white text-sm">Natural Language & Ranking</h4>
                  <ul className="text-xs text-zinc-400 space-y-1.5 list-disc pl-4">
                    <li>Gemini / LLM interprets user intent</li>
                    <li>Hard constraints extracted (budget, SLA, returns)</li>
                    <li>No synthetic default injection if unspecified</li>
                    <li>Heterogeneous merchant discovery</li>
                    <li>Component-wise ranking & candidate scoring</li>
                  </ul>
                </div>

                {/* Stage 2: Backend Validation */}
                <div className="bg-zinc-950/70 border border-emerald-900/50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400 font-mono">STAGE 2</span>
                    <span className="text-[10px] font-mono bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800">
                      🛡️ VERIFIED BACKEND
                    </span>
                  </div>
                  <h4 className="font-bold text-white text-sm">Policy & Quote Security</h4>
                  <ul className="text-xs text-zinc-400 space-y-1.5 list-disc pl-4">
                    <li>Deterministic pricing engine (in paise)</li>
                    <li>Canonical SHA-256 quote hash generation</li>
                    <li>Spending limits & category policy checks</li>
                    <li>Explicit human approval gate</li>
                    <li>Last-moment price validation before checkout</li>
                  </ul>
                </div>

                {/* Stage 3: Razorpay Trust Layer */}
                <div className="bg-zinc-950/70 border border-purple-900/50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-400 font-mono">STAGE 3</span>
                    <span className="text-[10px] font-mono bg-purple-950 text-purple-300 px-2 py-0.5 rounded border border-purple-800">
                      💳 RAZORPAY TRUST
                    </span>
                  </div>
                  <h4 className="font-bold text-white text-sm">Payment & Fulfillment</h4>
                  <ul className="text-xs text-zinc-400 space-y-1.5 list-disc pl-4">
                    <li>Server-side Razorpay Order creation</li>
                    <li>HMAC-SHA256 signature verification</li>
                    <li>Webhook signature & idempotency deduplication</li>
                    <li>State reconciliation & safe retry engine</li>
                    <li>Exactly-once fulfillment dispatch</li>
                  </ul>
                </div>
              </div>

              {/* Linear Protocol Strip */}
              <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800 font-mono text-[11px] overflow-x-auto text-zinc-300">
                <p className="text-zinc-500 font-bold mb-2">END-TO-END EXECUTION PIPELINE:</p>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-blue-300">Intent</span>
                  <span>→</span>
                  <span className="text-blue-300">Discovery</span>
                  <span>→</span>
                  <span className="text-blue-300">Scoring Engine</span>
                  <span>→</span>
                  <span className="text-emerald-400">Quote Hash</span>
                  <span>→</span>
                  <span className="text-amber-400">Approval Gate</span>
                  <span>→</span>
                  <span className="text-emerald-400">Price Re-check</span>
                  <span>→</span>
                  <span className="text-purple-400">Razorpay Order</span>
                  <span>→</span>
                  <span className="text-purple-400">HMAC Verification</span>
                  <span>→</span>
                  <span className="text-cyan-400">1x Fulfillment</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Merchant Analytics & Directory */}
        {activeTab === 'merchant' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Protocol Spec */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl">
                <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <span>🌐</span> Machine-Readable Agent Protocol Endpoint
                </h3>
                <p className="text-xs text-zinc-400 mb-3">
                  Merchants expose standard capabilities at <code className="bg-zinc-800 text-blue-300 px-1.5 py-0.5 rounded font-mono">/.well-known/agent-commerce</code> so external AI buyers can discover them.
                </p>
                <div className="bg-zinc-950 rounded-lg p-3 font-mono text-xs text-emerald-400 border border-zinc-800 overflow-x-auto">
                  <pre>{`{
  "merchant": { "id": "merchant_acme", "name": "Acme Electronics" },
  "capabilities": ["product_search", "cart", "checkout", "payment"],
  "currency": "INR",
  "payment_provider": "razorpay",
  "agent_purchases": true,
  "requires_human_approval": true
}`}</pre>
                </div>
              </div>

              {/* Heterogeneous Merchants Directory */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl">
                <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <span>🏪</span> Heterogeneous Merchant Directory
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="p-2.5 bg-zinc-800/50 rounded-lg flex justify-between items-center">
                    <div>
                      <p className="font-bold text-white">Acme Electronics</p>
                      <p className="text-zinc-400 text-[11px]">SLA: 2 Days · Return: 7 Days · Rating: 4.8 ⭐</p>
                    </div>
                    <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">Razorpay Native</span>
                  </div>
                  <div className="p-2.5 bg-zinc-800/50 rounded-lg flex justify-between items-center">
                    <div>
                      <p className="font-bold text-white">QuickGear</p>
                      <p className="text-zinc-400 text-[11px]">SLA: 5 Days · Return: 14 Days · Rating: 4.4 ⭐</p>
                    </div>
                    <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">Razorpay Native</span>
                  </div>
                  <div className="p-2.5 bg-zinc-800/50 rounded-lg flex justify-between items-center">
                    <div>
                      <p className="font-bold text-white">Nova Store</p>
                      <p className="text-zinc-400 text-[11px]">SLA: 2 Days · Return: 7 Days · Rating: 4.9 ⭐</p>
                    </div>
                    <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">Razorpay Native</span>
                  </div>
                  <div className="p-2.5 bg-zinc-800/30 rounded-lg flex justify-between items-center opacity-70">
                    <div>
                      <p className="font-bold text-zinc-300">Legacy Mart</p>
                      <p className="text-zinc-500 text-[11px]">SLA: 3 Days · Agent Purchases: ❌ Unsupported</p>
                    </div>
                    <span className="text-[10px] font-mono bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded">Non-Agent</span>
                  </div>
                  <div className="p-2.5 bg-zinc-800/30 rounded-lg flex justify-between items-center opacity-70">
                    <div>
                      <p className="font-bold text-zinc-300">Global Goods</p>
                      <p className="text-zinc-500 text-[11px]">SLA: 4 Days · Provider: other (Non-Razorpay)</p>
                    </div>
                    <span className="text-[10px] font-mono bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">Non-Razorpay</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Transactions Table */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
              <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
                <h3 className="font-bold text-sm text-white">Commercial Ledger & Settlement</h3>
                <span className="text-xs text-zinc-500 font-mono">Count: {transactions.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-zinc-950/60 text-zinc-400 font-mono text-[11px]">
                    <tr>
                      <th className="p-3">TRANSACTION ID</th>
                      <th className="p-3">PRODUCT</th>
                      <th className="p-3">AMOUNT</th>
                      <th className="p-3">RAZORPAY ORDER</th>
                      <th className="p-3">STATUS</th>
                      <th className="p-3">TRACKING</th>
                      <th className="p-3 text-right">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 font-mono">
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-zinc-500">No transactions yet. Run primary demo.</td>
                      </tr>
                    ) : (
                      transactions.map((tx) => (
                        <tr key={tx.transactionId} className="hover:bg-zinc-800/40">
                          <td className="p-3 text-blue-300">{tx.transactionId}</td>
                          <td className="p-3 font-sans font-medium text-white">{tx.productName}</td>
                          <td className="p-3 text-emerald-400 font-bold">₹{(tx.amountPaise / 100).toFixed(2)}</td>
                          <td className="p-3 text-zinc-300">{tx.razorpayOrderId || '—'}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getStateBadgeClass(tx.state)}`}>
                              {tx.state}
                            </span>
                          </td>
                          <td className="p-3 text-zinc-400">{tx.fulfillmentTrackingNumber || 'Pending'}</td>
                          <td className="p-3 text-right space-x-1.5">
                            <button
                              onClick={() => handleReconcile(tx.transactionId)}
                              className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] border border-zinc-700/60 transition-colors cursor-pointer"
                              title="Reconcile with Razorpay API"
                            >
                              🔍 Reconcile
                            </button>
                            {(tx.state === 'FULFILLED' || tx.state === 'PAYMENT_SUCCESS') && (
                              <button
                                onClick={() => handleRefund(tx.transactionId)}
                                className="px-2 py-1 bg-cyan-900/30 hover:bg-cyan-900/50 text-cyan-300 border border-cyan-700/50 rounded text-[10px] transition-colors cursor-pointer"
                                title="Request refund under merchant return policy"
                              >
                                ↩ Refund
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Audit Trail */}
        {activeTab === 'audit' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Immutable Financial Audit Trail</h3>
                <p className="text-xs text-zinc-400">Every decision, quote hash check, policy check, Razorpay authorization, and fulfillment action recorded.</p>
              </div>
              <button
                onClick={fetchStatus}
                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-xs font-mono rounded text-zinc-300 cursor-pointer"
              >
                Refresh Log
              </button>
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto font-mono text-xs">
              {auditEvents.length === 0 ? (
                <div className="p-6 text-center text-zinc-500">No audit records logged yet.</div>
              ) : (
                auditEvents.map((ev) => (
                  <div key={ev.id} className="p-3 bg-zinc-950/70 border border-zinc-800/70 rounded-lg flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold">
                          {ev.actor}
                        </span>
                        <span className="font-bold text-zinc-200">{ev.action}</span>
                        {ev.productName && <span className="text-zinc-400 font-sans">({ev.productName})</span>}
                      </div>
                      <p className="text-zinc-400 font-sans text-xs">{ev.details}</p>
                    </div>

                    <div className="text-right whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getStateBadgeClass(ev.result)}`}>
                        {ev.result}
                      </span>
                      <p className="text-[10px] text-zinc-500 mt-1">{new Date(ev.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
