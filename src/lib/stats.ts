/**
 * In-memory stats tracking for merchant dashboard
 *
 * Tracks payments processed through x402 paywalled articles.
 * Stats persist while the server is running.
 */

export interface Payment {
  slug: string;
  amount: number; // in USDC
  txHash: string | null;
  payer: string;
  timestamp: number;
}

export interface ArticleStats {
  slug: string;
  title: string;
  views: number;
  revenue: number;
}

interface StatsStore {
  payments: Payment[];
  articleStats: Map<string, ArticleStats>;
  totalRevenue: number;
  totalPayments: number;
  // Balance + wallet cache (fetched together)
  cachedBalance: string | null;
  cachedWalletId: string | null;
  cachedWalletAddress: string | null;
  balanceCacheTime: number;
  balanceNeedsRefresh: boolean;
}

// Extend globalThis to persist store across Next.js hot reloads
declare global {
  // eslint-disable-next-line no-var
  var statsStore: StatsStore | undefined;
}

// Use globalThis to persist across module reloads in development
const store: StatsStore = globalThis.statsStore || {
  payments: [],
  articleStats: new Map(),
  totalRevenue: 0,
  totalPayments: 0,
  cachedBalance: null,
  cachedWalletId: null,
  cachedWalletAddress: null,
  balanceCacheTime: 0,
  balanceNeedsRefresh: true,
};

// Save reference to globalThis so it persists
globalThis.statsStore = store;

/**
 * Record a successful payment
 */
export function recordPayment(payment: Payment, articleTitle: string) {
  // Add to payments list (keep last 50)
  store.payments.unshift(payment);
  if (store.payments.length > 50) {
    store.payments.pop();
  }

  // Update totals
  store.totalPayments++;
  store.totalRevenue += payment.amount;

  // Update article stats
  const existing = store.articleStats.get(payment.slug);
  if (existing) {
    existing.views++;
    existing.revenue += payment.amount;
  } else {
    store.articleStats.set(payment.slug, {
      slug: payment.slug,
      title: articleTitle,
      views: 1,
      revenue: payment.amount,
    });
  }

  // Mark balance as needing refresh
  store.balanceNeedsRefresh = true;
}

/**
 * Get all stats for the dashboard
 */
export function getStats() {
  return {
    totalRevenue: store.totalRevenue,
    totalPayments: store.totalPayments,
    recentPayments: store.payments.slice(0, 10),
    articleStats: Array.from(store.articleStats.values()).sort(
      (a, b) => b.revenue - a.revenue
    ),
  };
}

/**
 * Reset stats (for testing)
 */
export function resetStats() {
  store.payments = [];
  store.articleStats.clear();
  store.totalRevenue = 0;
  store.totalPayments = 0;
  store.cachedBalance = null;
  store.cachedWalletId = null;
  store.cachedWalletAddress = null;
  store.balanceCacheTime = 0;
  store.balanceNeedsRefresh = true;
}

// Balance cache TTL: 30 seconds
const BALANCE_CACHE_TTL = 30 * 1000;

/**
 * Check if balance needs to be refreshed
 * Returns true if:
 * - A payment was just recorded (balanceNeedsRefresh flag)
 * - Cache is older than TTL
 * - No cached value
 */
export function shouldRefreshBalance(): boolean {
  if (store.balanceNeedsRefresh) return true;
  if (!store.cachedBalance) return true;
  if (Date.now() - store.balanceCacheTime > BALANCE_CACHE_TTL) return true;
  return false;
}

/**
 * Get cached balance (may be stale)
 */
export function getCachedBalance(): string | null {
  return store.cachedBalance;
}

/**
 * Update the cached balance and wallet
 */
export function setCachedBalance(balance: string, walletId: string, walletAddress: string) {
  store.cachedBalance = balance;
  store.cachedWalletId = walletId;
  store.cachedWalletAddress = walletAddress;
  store.balanceCacheTime = Date.now();
  store.balanceNeedsRefresh = false;
}

/**
 * Get cached wallet (may be null if never fetched)
 */
export function getCachedWallet(): { id: string; address: string } | null {
  if (store.cachedWalletId && store.cachedWalletAddress) {
    return { id: store.cachedWalletId, address: store.cachedWalletAddress };
  }
  return null;
}

/**
 * Update a payment's transaction hash
 * Called after settlement when the txHash becomes available
 */
export function updatePaymentTxHash(slug: string, payer: string, txHash: string): boolean {
  // Find the most recent payment matching slug and payer without a txHash
  const payment = store.payments.find(
    p => p.slug === slug && p.payer.toLowerCase() === payer.toLowerCase() && !p.txHash
  );

  if (payment) {
    payment.txHash = txHash;
    return true;
  }
  return false;
}
