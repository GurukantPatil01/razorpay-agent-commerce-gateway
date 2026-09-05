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
  result: string;
  details: string;
}

interface GatewayMetrics {
  totalOrders: number;
  successfulPayments: number;
  failedPayments: number;
  recoveredRevenuePaise: number;
  totalGMVPaise: number;
  averageOrderValuePaise: number;
  totalGMVFormatted: string;
  recoveredRevenueFormatted: string;
  averageOrderValueFormatted: string;
}

interface TransactionItem {
  transactionId: string;
  purchaseRequestId: string;
  merchantId: string;
  productName: string;
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
  const [activeTab, setActiveTab] = useState<'purchase' | 'architecture' | 'ledger' | 'audit'>('purchase');
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
  const [activeScenario, setActiveScenario] = useState<string | null>(null);

  // Chat SDK
  const { messages, sendMessage, status, setMessages } = useChat();
  const [agentInput, setAgentInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastProcessedPlanIdRef = useRef<string | null>(null);

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

  // Intercept approval card in the latest assistant message
  useEffect(() => {
    const latestAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!latestAssistant) return;

    for (const part of latestAssistant.parts) {
      if (part.type === 'text' && part.text.includes('```approval-card')) {
        try {
          const jsonStr = part.text.split('```approval-card')[1].split('```')[0].trim();
          const parsed = JSON.parse(jsonStr);
          if (parsed.purchaseRequestId && parsed.purchaseRequestId !== lastProcessedPlanIdRef.current) {
            lastProcessedPlanIdRef.current = parsed.purchaseRequestId;
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
  }, [messages]);

  // 1. Submit User Query
  const handleSendMessage = (textToSend?: string) => {
    const query = textToSend || agentInput;
    if (!query.trim() || status === 'streaming') return;
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
            `Plan invalidated: ${checkoutData.error}. Zero Razorpay orders were placed.`
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
          reason: 'User declined purchase authorization',
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
        body: JSON.stringify({ transactionId, reason: 'Customer requested standard return policy refund' }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(`Refund failed: ${data.error}`);
      } else {
        alert(`Refund processed. ID: ${data.refund?.id || data.refund?.razorpayRefundId}`);
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
      alert(`Reconciliation error: ${err.message}`);
    }
  };

  // Demo 3: Unknown State Simulation
  const [reconcileFeedback, setReconcileFeedback] = useState<string | null>(null);
  const handleSimulateUnknownStateDemo = async () => {
    setActiveScenario('unknown');
    setReconcileFeedback('Simulating network timeout after payment submission...');
    try {
      const targetTx = transactions[0];
      if (!targetTx) {
        alert('Please complete a purchase first so an active transaction exists to reconcile.');
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
        `PAYMENT_UNKNOWN → Reconciled with Razorpay API.\nStatus: ${data.reconciliation?.razorpayStatus}.\nDecision: ${data.reconciliation?.safeToRetry ? 'Safe to retry (no captured payment found)' : 'Do not retry (payment already captured on Razorpay)'}`
      );
      await fetchStatus();
    } catch (err: any) {
      setReconcileFeedback(`Reconciliation error: ${err.message}`);
    }
  };

  // Demo 4: Price Change Protection Demo
  const handlePriceChangeProtectionDemo = async () => {
    setActiveScenario('price');
    setDemoBannerMessage('Simulating merchant price increase (₹2,499 → ₹2,699) between approval and checkout...');
    try {
      await fetch('/api/commerce/mutate-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 'prod_acme_keyboard', action: 'RESET' }),
      });

      handleSendMessage('Find me the best wireless keyboard under ₹3,000 with delivery within 3 days and at least a 7-day return.');

      setTimeout(async () => {
        await fetch('/api/commerce/mutate-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: 'prod_acme_keyboard', newBasePricePaise: 269900 }),
        });
        setDemoBannerMessage('Price increased to ₹2,699 in catalog. Click [ Approve & Pay ] below to test quote hash verification.');
      }, 1500);
    } catch (err: any) {
      setDemoBannerMessage(`Price change error: ${err.message}`);
    }
  };

  // Reset catalog price
  const handleResetCatalog = async () => {
    await fetch('/api/commerce/mutate-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 'prod_acme_keyboard', action: 'RESET' }),
    });
    setDemoBannerMessage(null);
    setReconcileFeedback(null);
    setActiveScenario(null);
  };

  const renderStatusBadge = (state: string) => {
    switch (state) {
      case 'FULFILLED':
      case 'PAYMENT_SUCCESS':
      case 'SUCCESS':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            Paid
          </span>
        );
      case 'PAYMENT_FAILED':
      case 'FAILED':
      case 'POLICY_REJECTED':
      case 'REJECTED':
      case 'PLAN_INVALIDATED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
            Failed
          </span>
        );
      case 'APPROVAL_PENDING':
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 text-zinc-700 border border-zinc-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Pending approval
          </span>
        );
      case 'PAYMENT_UNKNOWN':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
            Payment unknown
          </span>
        );
      case 'REFUNDED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 text-zinc-600 border border-zinc-200">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
            Refund processed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 text-zinc-700 border border-zinc-200">
            {state}
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] text-zinc-900 font-sans antialiased">
      {/* 1. Header (56px) */}
      <header className="h-14 border-b border-zinc-200 bg-white sticky top-0 z-40">
        <div className="max-w-6xl mx-auto h-full px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-zinc-900 text-sm tracking-tight">
              RazorPay Commerce Gateway
            </span>
            <span className="text-xs text-zinc-400 border-l border-zinc-200 pl-3 hidden sm:inline">
              Controlled agentic payments
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-zinc-100 text-zinc-700 border border-zinc-200">
              <span className={`h-1.5 w-1.5 rounded-full ${gatewayConfig.mode === 'RAZORPAY_TEST_MODE' ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
              {gatewayConfig.mode === 'RAZORPAY_TEST_MODE' ? 'Razorpay Test Mode' : 'Simulator Mode'}
            </span>

            <nav className="flex items-center gap-1 border-l border-zinc-200 pl-4">
              <button
                onClick={() => setActiveTab('purchase')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  activeTab === 'purchase'
                    ? 'text-zinc-900 bg-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                Purchase
              </button>
              <button
                onClick={() => setActiveTab('architecture')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  activeTab === 'architecture'
                    ? 'text-zinc-900 bg-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                Architecture
              </button>
              <button
                onClick={() => setActiveTab('ledger')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  activeTab === 'ledger'
                    ? 'text-zinc-900 bg-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                Ledger
              </button>
              <button
                onClick={() => setActiveTab('audit')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  activeTab === 'audit'
                    ? 'text-zinc-900 bg-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                Audit {auditEvents.length > 0 && `(${auditEvents.length})`}
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* 2. Demo Scenarios Control Bar */}
      <div className="border-b border-zinc-200 bg-white/70 px-4 py-2 text-xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 font-medium text-[11px] uppercase tracking-wider">
              Demo scenarios
            </span>
            <div className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5 text-xs">
              <button
                onClick={() => {
                  handleResetCatalog();
                  setActiveScenario('purchase');
                  handleSendMessage(
                    'Find me the best wireless keyboard under ₹3,000 with delivery within 3 days and at least a 7-day return.'
                  );
                }}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  activeScenario === 'purchase'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Purchase
              </button>
              <button
                onClick={() => {
                  handleResetCatalog();
                  setActiveScenario('recovery');
                  setDemoBannerMessage(
                    'Scenario loaded: Once the purchase plan appears, click [Simulate payment failure] to test recovery without duplicate charges.'
                  );
                  handleSendMessage(
                    'Find me the best wireless keyboard under ₹3,000 with delivery within 3 days and at least a 7-day return.'
                  );
                }}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  activeScenario === 'recovery'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Payment failure
              </button>
              <button
                onClick={handleSimulateUnknownStateDemo}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  activeScenario === 'unknown'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Unknown payment
              </button>
              <button
                onClick={handlePriceChangeProtectionDemo}
                className={`px-2.5 py-1 rounded transition-colors font-medium ${
                  activeScenario === 'price'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Price change
              </button>
            </div>
          </div>

          <button
            onClick={handleResetCatalog}
            className="text-zinc-400 hover:text-zinc-600 text-[11px] cursor-pointer"
          >
            Reset catalog
          </button>
        </div>
      </div>

      {/* 3. Main Workspace */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Scenario Guidance Banner (Neutral) */}
        {(demoBannerMessage || reconcileFeedback) && (
          <div className="mb-6 bg-white border border-zinc-200 rounded-lg p-3 text-xs text-zinc-700 flex items-start justify-between shadow-xs">
            <div className="space-y-0.5">
              <span className="font-semibold text-zinc-900">Scenario notice:</span>
              <p className="text-zinc-600 whitespace-pre-line">{demoBannerMessage || reconcileFeedback}</p>
            </div>
            <button
              onClick={() => {
                setDemoBannerMessage(null);
                setReconcileFeedback(null);
                setActiveScenario(null);
              }}
              className="text-zinc-400 hover:text-zinc-600 text-sm px-1.5 py-0.5"
            >
              ✕
            </button>
          </div>
        )}

        {/* TAB 1: PURCHASE FLOW */}
        {activeTab === 'purchase' && (
          <div className="space-y-8">
            {/* Search / Intent Input */}
            <div className="bg-white border border-zinc-200 rounded-lg p-5 shadow-xs space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Find something to buy
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={agentInput}
                  onChange={(e) => setAgentInput(e.target.value)}
                  placeholder="Find a wireless keyboard under ₹3,000 with 3-day delivery..."
                  className="flex-1 bg-white border border-zinc-300 rounded-md px-3.5 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900"
                />
                <button
                  type="submit"
                  disabled={status === 'streaming' || !agentInput.trim()}
                  className="px-5 py-2 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white rounded-md font-medium text-sm transition-colors cursor-pointer"
                >
                  {status === 'streaming' ? 'Searching...' : 'Search'}
                </button>
              </form>

              {/* Suggestions */}
              <div className="flex items-center gap-2 text-xs text-zinc-500 flex-wrap pt-1">
                <span className="text-zinc-400">Suggestions:</span>
                <button
                  type="button"
                  onClick={() =>
                    handleSendMessage(
                      'Find me the best wireless keyboard under ₹3,000 with delivery within 3 days and at least a 7-day return.'
                    )
                  }
                  className="text-zinc-600 hover:text-zinc-900 hover:underline cursor-pointer"
                >
                  Wireless keyboard under ₹3,000 (3-day delivery)
                </button>
                <span className="text-zinc-300">·</span>
                <button
                  type="button"
                  onClick={() =>
                    handleSendMessage('Find me a fast delivery wireless keyboard under ₹2,800 within 2 days.')
                  }
                  className="text-zinc-600 hover:text-zinc-900 hover:underline cursor-pointer"
                >
                  Fast delivery (&lt;2 days)
                </button>
                <span className="text-zinc-300">·</span>
                <button
                  type="button"
                  onClick={() =>
                    handleSendMessage('Show me keyboards under ₹3,500 with at least 10 days return policy.')
                  }
                  className="text-zinc-600 hover:text-zinc-900 hover:underline cursor-pointer"
                >
                  10-day return window
                </button>
                <span className="text-zinc-300">·</span>
                <button
                  type="button"
                  onClick={() =>
                    handleSendMessage('Find me a keyboard under ₹2,000 with 1 day delivery.')
                  }
                  className="text-zinc-600 hover:text-zinc-900 hover:underline cursor-pointer"
                >
                  Constraint rejection test
                </button>
              </div>
            </div>

            {/* Main Financial Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Recommendation & Comparison */}
              <div className="lg:col-span-7 space-y-6">
                {activeApproval ? (
                  <>
                    {/* Recommendation Card */}
                    <div className="bg-white border border-zinc-200 rounded-lg p-5 shadow-xs space-y-3">
                      <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Recommendation
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Recommended
                        </span>
                      </div>

                      <div className="flex justify-between items-start pt-1">
                        <div>
                          <h2 className="text-base font-semibold text-zinc-900">
                            {activeApproval.productName}
                          </h2>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            {activeApproval.merchantName}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-bold text-zinc-900">
                            {activeApproval.totalFormatted}
                          </span>
                          <p className="text-[11px] text-zinc-400">Total inclusive of tax</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3 pt-2 text-xs border-t border-zinc-100 text-zinc-600">
                        <div>
                          <span className="text-zinc-400 block text-[11px]">Delivery</span>
                          <span className="font-medium text-zinc-800">{activeApproval.deliveryEstimate}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[11px]">Return window</span>
                          <span className="font-medium text-zinc-800">{activeApproval.returnPolicy}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[11px]">Payment</span>
                          <span className="font-medium text-zinc-800">Razorpay Verified</span>
                        </div>
                      </div>

                      <div className="bg-zinc-50 rounded p-3 text-xs text-zinc-600 border border-zinc-100 mt-2">
                        <span className="font-medium text-zinc-700">Rationale: </span>
                        {activeApproval.whySelected || 'Lowest qualifying total meeting delivery, budget, and return requirements.'}
                      </div>
                    </div>

                    {/* Multi-Merchant Comparison Table */}
                    <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden shadow-xs">
                      <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Merchant comparison
                        </h3>
                        <span className="text-xs text-zinc-400">6 candidates evaluated</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-zinc-50 text-zinc-500 text-[11px] border-b border-zinc-200">
                            <tr>
                              <th className="px-4 py-2 font-medium">Merchant</th>
                              <th className="px-4 py-2 font-medium">Product</th>
                              <th className="px-4 py-2 font-medium">Total</th>
                              <th className="px-4 py-2 font-medium">Delivery</th>
                              <th className="px-4 py-2 font-medium">Returns</th>
                              <th className="px-4 py-2 font-medium text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 text-zinc-700">
                            <tr className="bg-emerald-50/40">
                              <td className="px-4 py-2.5 font-medium text-zinc-900">Acme Electronics</td>
                              <td className="px-4 py-2.5">Acme Pro Wireless Keyboard</td>
                              <td className="px-4 py-2.5 font-semibold text-zinc-900">₹2,949</td>
                              <td className="px-4 py-2.5">2 days</td>
                              <td className="px-4 py-2.5">7 days</td>
                              <td className="px-4 py-2.5 text-right">
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800">
                                  Recommended
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td className="px-4 py-2.5 font-medium text-zinc-900">QuickGear</td>
                              <td className="px-4 py-2.5">AirSlim Wireless Keyboard</td>
                              <td className="px-4 py-2.5">₹2,799</td>
                              <td className="px-4 py-2.5">5 days</td>
                              <td className="px-4 py-2.5">14 days</td>
                              <td className="px-4 py-2.5 text-right text-zinc-400 text-[11px]">
                                Delivery 5d &gt; 3d SLA
                              </td>
                            </tr>
                            <tr>
                              <td className="px-4 py-2.5 font-medium text-zinc-900">Nova Store</td>
                              <td className="px-4 py-2.5">Nova Apex RGB Keyboard</td>
                              <td className="px-4 py-2.5">₹3,099</td>
                              <td className="px-4 py-2.5">2 days</td>
                              <td className="px-4 py-2.5">7 days</td>
                              <td className="px-4 py-2.5 text-right text-zinc-400 text-[11px]">
                                Exceeds ₹3,000 budget
                              </td>
                            </tr>
                            <tr>
                              <td className="px-4 py-2.5 font-medium text-zinc-900">TechNest</td>
                              <td className="px-4 py-2.5">Waveform Ergonomic</td>
                              <td className="px-4 py-2.5">₹3,184</td>
                              <td className="px-4 py-2.5">3 days</td>
                              <td className="px-4 py-2.5">10 days</td>
                              <td className="px-4 py-2.5 text-right text-zinc-400 text-[11px]">
                                Exceeds ₹3,000 budget
                              </td>
                            </tr>
                            <tr className="text-zinc-400">
                              <td className="px-4 py-2.5 font-medium">Legacy Mart</td>
                              <td className="px-4 py-2.5">Standard Keyboard</td>
                              <td className="px-4 py-2.5">₹2,299</td>
                              <td className="px-4 py-2.5">2 days</td>
                              <td className="px-4 py-2.5">7 days</td>
                              <td className="px-4 py-2.5 text-right text-[11px]">
                                Non-agent merchant
                              </td>
                            </tr>
                            <tr className="text-zinc-400">
                              <td className="px-4 py-2.5 font-medium">Global Goods</td>
                              <td className="px-4 py-2.5">CyberKey Wireless</td>
                              <td className="px-4 py-2.5">₹2,199</td>
                              <td className="px-4 py-2.5">1 day</td>
                              <td className="px-4 py-2.5">14 days</td>
                              <td className="px-4 py-2.5 text-right text-[11px]">
                                Non-Razorpay provider
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Agent Conversation & Scoring Details (Collapsible) */}
                    <details className="bg-white border border-zinc-200 rounded-lg p-4 text-xs shadow-xs">
                      <summary className="font-medium text-zinc-700 cursor-pointer select-none">
                        View intent parsing & evaluation details
                      </summary>
                      <div className="mt-3 pt-3 border-t border-zinc-100 space-y-3">
                        {messages.map((msg) => (
                          <div key={msg.id} className="space-y-1">
                            <div className="font-semibold text-zinc-500 text-[11px] uppercase">
                              {msg.role === 'user' ? 'User Intent' : 'Commerce Agent'}
                            </div>
                            <div className="text-zinc-700 prose prose-xs max-w-none">
                              {msg.parts.map((p, idx) => {
                                if (p.type === 'text') {
                                  const text = p.text.replace(/```approval-card[\s\S]*?```/g, '');
                                  return (
                                    <ReactMarkdown key={idx} remarkPlugins={[remarkGfm]}>
                                      {text}
                                    </ReactMarkdown>
                                  );
                                }
                                return null;
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  </>
                ) : (
                  /* Clean Initial State */
                  <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center space-y-4 shadow-xs">
                    <div className="h-10 w-10 mx-auto rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 text-sm font-semibold">
                      ₹
                    </div>
                    <div className="space-y-1 max-w-md mx-auto">
                      <h3 className="text-sm font-semibold text-zinc-900">
                        Agent commerce gateway is ready
                      </h3>
                      <p className="text-xs text-zinc-500 leading-relaxed">
                        Enter purchase requirements above to discover verified merchants, evaluate policy constraints, generate a deterministic quote, and execute payment via Razorpay.
                      </p>
                    </div>
                    <div className="pt-2 flex justify-center gap-2 text-xs">
                      <button
                        onClick={() =>
                          handleSendMessage(
                            'Find me the best wireless keyboard under ₹3,000 with delivery within 3 days and at least a 7-day return.'
                          )
                        }
                        className="px-3.5 py-1.5 bg-zinc-900 text-white rounded-md font-medium hover:bg-zinc-800 transition-colors cursor-pointer"
                      >
                        Run primary keyboard search
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Purchase Plan & Payment */}
              <div className="lg:col-span-5 space-y-6">
                {/* 1. Review Purchase Card */}
                {activeApproval && (
                  <div className="bg-white border border-zinc-200 rounded-lg p-5 shadow-xs space-y-4">
                    <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-900">Review purchase</h3>
                        <p className="text-[11px] text-zinc-400 mt-0.5">Authorization required</p>
                      </div>
                      {renderStatusBadge(approvalStatus)}
                    </div>

                    <div>
                      <h4 className="font-semibold text-zinc-900 text-sm">{activeApproval.productName}</h4>
                      <p className="text-xs text-zinc-500">{activeApproval.merchantName}</p>
                    </div>

                    {/* Price Breakdown */}
                    <div className="space-y-2 text-xs border-t border-b border-zinc-100 py-3 text-zinc-600">
                      <div className="flex justify-between">
                        <span>Product subtotal</span>
                        <span className="text-zinc-900 font-medium">{activeApproval.basePriceFormatted}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Shipping</span>
                        <span className="text-zinc-900 font-medium">{activeApproval.shippingFormatted}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>GST tax</span>
                        <span className="text-zinc-900 font-medium">{activeApproval.taxFormatted}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-zinc-100 text-sm font-semibold text-zinc-900">
                        <span>Total amount</span>
                        <span>{activeApproval.totalFormatted}</span>
                      </div>
                    </div>

                    {/* Policy Checks */}
                    <div className="space-y-1.5 text-xs text-zinc-600">
                      <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                        Policy verification
                      </div>
                      <div className="flex items-center gap-2 text-emerald-700">
                        <span>✓</span>
                        <span>Within {activeApproval.budgetFormatted} budget ({activeApproval.remainingBudgetFormatted} remaining)</span>
                      </div>
                      <div className="flex items-center gap-2 text-emerald-700">
                        <span>✓</span>
                        <span>Delivery SLA verified ({activeApproval.deliveryEstimate})</span>
                      </div>
                      <div className="flex items-center gap-2 text-emerald-700">
                        <span>✓</span>
                        <span>Return policy verified ({activeApproval.returnPolicy})</span>
                      </div>
                      <div className="flex items-center gap-2 text-emerald-700">
                        <span>✓</span>
                        <span>Razorpay merchant settlement active</span>
                      </div>
                    </div>

                    {/* Actions */}
                    {approvalStatus === 'PENDING' && (
                      <div className="space-y-2 pt-2">
                        <button
                          onClick={() => handleApproveAndPay(false)}
                          disabled={isProcessingPayment}
                          className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white rounded-md font-medium text-sm transition-colors cursor-pointer"
                        >
                          {isProcessingPayment ? 'Creating order...' : `Approve & Pay ${activeApproval.totalFormatted}`}
                        </button>

                        <div className="flex gap-2">
                          <button
                            onClick={handleReject}
                            disabled={isProcessingPayment}
                            className="flex-1 py-1.5 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 rounded-md text-xs font-medium transition-colors cursor-pointer"
                          >
                            Reject
                          </button>
                          {activeScenario === 'recovery' && (
                            <button
                              onClick={() => handleApproveAndPay(true)}
                              disabled={isProcessingPayment}
                              className="flex-1 py-1.5 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 rounded-md text-xs font-medium transition-colors cursor-pointer"
                            >
                              Simulate payment failure
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {approvalStatus === 'INVALIDATED' && (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 space-y-1">
                        <p className="font-semibold">Transaction blocked by gateway</p>
                        <p className="text-zinc-600 text-[11px]">
                          Price change detected between plan approval and order execution. Quote hash mismatch prevented order placement. Zero charges were created.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Payment Operations Inspector */}
                {paymentResult && (
                  <div className="bg-white border border-zinc-200 rounded-lg p-5 shadow-xs space-y-4">
                    <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-900">Payment</h3>
                        <p className="text-[11px] text-zinc-400 mt-0.5">Razorpay settlement status</p>
                      </div>
                      {paymentResult.status === 'SUCCESS' ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                          Captured
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
                          Failed
                        </span>
                      )}
                    </div>

                    {paymentResult.status === 'SUCCESS' ? (
                      <div className="space-y-3 text-xs">
                        <div className="grid grid-cols-2 gap-3 text-[11px]">
                          <div>
                            <span className="text-zinc-400 block">Razorpay Order</span>
                            <span className="font-mono text-zinc-900 select-all">{paymentResult.razorpayOrderId}</span>
                          </div>
                          <div>
                            <span className="text-zinc-400 block">Payment ID</span>
                            <span className="font-mono text-zinc-900 select-all">{paymentResult.razorpayPaymentId}</span>
                          </div>
                        </div>

                        <div className="space-y-1.5 pt-2 border-t border-zinc-100 text-zinc-600">
                          <div className="flex items-center gap-2 text-emerald-700">
                            <span>✓</span>
                            <span>HMAC-SHA256 signature verified</span>
                          </div>
                          <div className="text-zinc-600">
                            <span className="text-zinc-400">Mode: </span>
                            <span>{paymentResult.mode}</span>
                          </div>
                          <div className="text-zinc-600">
                            <span className="text-zinc-400">Dispatch tracking: </span>
                            <span className="font-mono font-medium text-zinc-900">{paymentResult.fulfillmentTrackingNumber}</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="pt-2">
                          <button
                            onClick={() => handleRefund(paymentResult.transactionId)}
                            className="w-full py-1.5 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 rounded-md text-xs font-medium transition-colors cursor-pointer"
                          >
                            Request refund (7-day policy)
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 text-xs">
                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-rose-800 text-xs">
                          <p className="font-semibold">Payment attempt declined</p>
                          <p className="text-[11px] text-zinc-600 mt-0.5">
                            {paymentResult.message || 'Payment was declined by bank simulator'}
                          </p>
                        </div>

                        <div className="bg-zinc-50 rounded p-3 border border-zinc-200 text-zinc-600 space-y-2">
                          <p className="font-medium text-zinc-900">Recovery engine:</p>
                          <p className="text-[11px]">
                            Razorpay verified that no payment was captured. It is safe to retry via an alternative authorized payment method without double-charging.
                          </p>
                          <button
                            onClick={handleRetryPayment}
                            disabled={isProcessingPayment}
                            className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 text-white font-medium rounded-md text-xs transition-colors cursor-pointer"
                          >
                            Retry payment (0 duplicate charges)
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ARCHITECTURE */}
        {activeTab === 'architecture' && (
          <div className="space-y-6">
            <div className="bg-white border border-zinc-200 rounded-lg p-6 shadow-xs space-y-6">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">
                  Architecture: Controlled Agentic Payments
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Non-bypassable boundaries separating intent interpretation, deterministic server-side policy, and Razorpay financial execution.
                </p>
              </div>

              {/* Technical 3-Stage Diagram */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="border border-zinc-200 rounded-lg p-4 space-y-2 bg-zinc-50/50">
                  <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                    Stage 1: Intent & Discovery
                  </span>
                  <h4 className="font-semibold text-zinc-900 text-sm">Natural Language & Selection</h4>
                  <ul className="text-zinc-600 space-y-1 list-disc pl-4 text-xs">
                    <li>Extract user constraints (budget, delivery SLA, returns)</li>
                    <li>No synthetic default injection on unmentioned criteria</li>
                    <li>Evaluates verified merchants via standard protocol</li>
                    <li>Deterministic scoring (0–100) across components</li>
                  </ul>
                </div>

                <div className="border border-zinc-200 rounded-lg p-4 space-y-2 bg-zinc-50/50">
                  <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                    Stage 2: Validation & Guardrails
                  </span>
                  <h4 className="font-semibold text-zinc-900 text-sm">Pricing & Policy Engine</h4>
                  <ul className="text-zinc-600 space-y-1 list-disc pl-4 text-xs">
                    <li>Server-derived INR pricing in paise (0 hallucinated amounts)</li>
                    <li>Canonical SHA-256 quote hash validation</li>
                    <li>Spending limits & merchant compatibility enforcement</li>
                    <li>Authoritative human approval gate</li>
                  </ul>
                </div>

                <div className="border border-zinc-200 rounded-lg p-4 space-y-2 bg-zinc-50/50">
                  <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                    Stage 3: Trust & Settlement
                  </span>
                  <h4 className="font-semibold text-zinc-900 text-sm">Razorpay Infrastructure</h4>
                  <ul className="text-zinc-600 space-y-1 list-disc pl-4 text-xs">
                    <li>Server-side Razorpay Order generation</li>
                    <li>HMAC-SHA256 signature verification</li>
                    <li>Webhook deduplication & state reconciliation</li>
                    <li>Exactly-once merchant fulfillment dispatch</li>
                  </ul>
                </div>
              </div>

              {/* Pipeline Flow */}
              <div className="border border-zinc-200 rounded-lg p-4 bg-zinc-50/70 font-mono text-[11px] text-zinc-700 overflow-x-auto">
                <span className="text-zinc-400 uppercase text-[10px] font-bold block mb-2">Execution Pipeline:</span>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span>User Request</span>
                  <span className="text-zinc-400">→</span>
                  <span>Intent</span>
                  <span className="text-zinc-400">→</span>
                  <span>Merchant Discovery</span>
                  <span className="text-zinc-400">→</span>
                  <span>Product Scoring</span>
                  <span className="text-zinc-400">→</span>
                  <span>Policy Check</span>
                  <span className="text-zinc-400">→</span>
                  <span className="text-zinc-900 font-bold">Human Approval</span>
                  <span className="text-zinc-400">→</span>
                  <span>Price Re-check</span>
                  <span className="text-zinc-400">→</span>
                  <span className="text-zinc-900 font-bold">Razorpay Order</span>
                  <span className="text-zinc-400">→</span>
                  <span>Signature Verification</span>
                  <span className="text-zinc-400">→</span>
                  <span>Fulfillment</span>
                </div>
              </div>

              {/* Core Thesis Card */}
              <div className="p-4 bg-zinc-900 text-white rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold tracking-wide">
                    AI proposes → Backend validates → Razorpay executes
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Autonomous commerce without autonomous financial risk.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-zinc-400 border border-zinc-700 px-2 py-1 rounded self-start sm:self-auto">
                  Architectural Principle
                </span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: LEDGER & MERCHANTS */}
        {activeTab === 'ledger' && (
          <div className="space-y-6">
            {/* Commercial Transactions Ledger */}
            <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden shadow-xs">
              <div className="px-5 py-4 border-b border-zinc-200 flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900">Commercial Ledger</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Settlement history and order audit status</p>
                </div>
                <span className="text-xs text-zinc-500 font-mono">Count: {transactions.length}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-zinc-50 text-zinc-500 text-[11px] border-b border-zinc-200">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Transaction ID</th>
                      <th className="px-4 py-2.5 font-medium">Product</th>
                      <th className="px-4 py-2.5 font-medium">Amount</th>
                      <th className="px-4 py-2.5 font-medium">Razorpay Order</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Tracking</th>
                      <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 text-zinc-700">
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-zinc-400 text-xs">
                          No transactions recorded yet. Run a purchase scenario to view live settlements.
                        </td>
                      </tr>
                    ) : (
                      transactions.map((tx) => (
                        <tr key={tx.transactionId} className="hover:bg-zinc-50/50">
                          <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-600">{tx.transactionId}</td>
                          <td className="px-4 py-2.5 font-medium text-zinc-900">{tx.productName}</td>
                          <td className="px-4 py-2.5 font-semibold text-zinc-900">
                            ₹{(tx.amountPaise / 100).toFixed(2)}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-600">
                            {tx.razorpayOrderId || '—'}
                          </td>
                          <td className="px-4 py-2.5">{renderStatusBadge(tx.state)}</td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500">
                            {tx.fulfillmentTrackingNumber || 'Pending'}
                          </td>
                          <td className="px-4 py-2.5 text-right space-x-1.5">
                            <button
                              onClick={() => handleReconcile(tx.transactionId)}
                              className="px-2 py-1 bg-white hover:bg-zinc-50 border border-zinc-200 text-zinc-700 rounded text-[11px] cursor-pointer"
                            >
                              Reconcile
                            </button>
                            {(tx.state === 'FULFILLED' || tx.state === 'PAYMENT_SUCCESS') && (
                              <button
                                onClick={() => handleRefund(tx.transactionId)}
                                className="px-2 py-1 bg-white hover:bg-zinc-50 border border-zinc-200 text-zinc-700 rounded text-[11px] cursor-pointer"
                              >
                                Refund
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

            {/* Merchant Directory */}
            <div className="bg-white border border-zinc-200 rounded-lg p-5 shadow-xs space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">Verified Merchant Directory</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Protocol specifications exposed at <code className="text-zinc-800 bg-zinc-100 px-1 py-0.5 rounded font-mono">/.well-known/agent-commerce</code>
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="border border-zinc-200 rounded-md p-3 space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-zinc-900">Acme Electronics</span>
                    <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">Razorpay</span>
                  </div>
                  <p className="text-zinc-500 text-[11px]">SLA: 2 Days · Return: 7 Days · Rating: 4.8 ★</p>
                </div>

                <div className="border border-zinc-200 rounded-md p-3 space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-zinc-900">QuickGear</span>
                    <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">Razorpay</span>
                  </div>
                  <p className="text-zinc-500 text-[11px]">SLA: 5 Days · Return: 14 Days · Rating: 4.4 ★</p>
                </div>

                <div className="border border-zinc-200 rounded-md p-3 space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-zinc-900">Nova Store</span>
                    <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">Razorpay</span>
                  </div>
                  <p className="text-zinc-500 text-[11px]">SLA: 2 Days · Return: 7 Days · Rating: 4.9 ★</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: AUDIT */}
        {activeTab === 'audit' && (
          <div className="bg-white border border-zinc-200 rounded-lg p-5 shadow-xs space-y-4">
            <div className="flex justify-between items-center border-b border-zinc-200 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">Financial Audit Trail</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Immutable event log recording policy checks, quotes, human approvals, and payment signatures.
                </p>
              </div>
              <button
                onClick={fetchStatus}
                className="px-3 py-1 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 text-xs rounded transition-colors cursor-pointer"
              >
                Refresh
              </button>
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto text-xs">
              {auditEvents.length === 0 ? (
                <div className="py-8 text-center text-zinc-400 text-xs">
                  No audit events recorded yet.
                </div>
              ) : (
                auditEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3 bg-zinc-50/60 border border-zinc-200 rounded-md flex items-start justify-between gap-4"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-zinc-200/70 text-zinc-700">
                          {ev.actor}
                        </span>
                        <span className="font-semibold text-zinc-900">{ev.action}</span>
                        {ev.productName && <span className="text-zinc-500">({ev.productName})</span>}
                      </div>
                      <p className="text-zinc-600 text-xs">{ev.details}</p>
                    </div>

                    <div className="text-right whitespace-nowrap">
                      {renderStatusBadge(ev.result)}
                      <p className="text-[11px] text-zinc-400 mt-1 font-mono">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </p>
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
