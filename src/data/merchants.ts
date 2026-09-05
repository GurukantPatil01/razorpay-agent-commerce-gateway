/**
 * Multi-Merchant Directory for RazorPay Agent Commerce Gateway
 *
 * Exposes merchant capabilities, ratings, return policies, and Razorpay support
 * to AI Buyers and agent protocols.
 */

export interface MerchantCapability {
  productSearch: boolean;
  cart: boolean;
  checkout: boolean;
  payment: boolean;
  refunds: boolean;
}

export interface Merchant {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  rating: number;
  reviewCount: number;
  standardDeliveryDays: number;
  returnPolicyDays: number;
  returnPolicyDescription: string;
  supportedCurrencies: string[];
  paymentProvider: 'razorpay' | 'other';
  razorpayAccountId?: string;
  agentPurchasesSupported: boolean;
  requiresHumanApproval: boolean;
  capabilities: string[];
  contactEmail: string;
  status: 'active' | 'inactive';
}

export const merchants: Merchant[] = [
  {
    id: 'merchant_acme',
    name: 'Acme Electronics',
    slug: 'acme-electronics',
    tagline: 'Premium PC peripherals & audio engineering',
    rating: 4.6,
    reviewCount: 1420,
    standardDeliveryDays: 2,
    returnPolicyDays: 7,
    returnPolicyDescription: '7-day hassle-free replacement & return on all electronic accessories',
    supportedCurrencies: ['INR'],
    paymentProvider: 'razorpay',
    razorpayAccountId: 'acc_acme_prod_01',
    agentPurchasesSupported: true,
    requiresHumanApproval: true,
    capabilities: ['product_search', 'product_details', 'cart', 'checkout', 'payment', 'refunds', 'agent_purchase'],
    contactEmail: 'orders@acme-electronics.in',
    status: 'active',
  },
  {
    id: 'merchant_quickgear',
    name: 'QuickGear',
    slug: 'quick-gear',
    tagline: 'Affordable consumer electronics & office gear',
    rating: 4.8,
    reviewCount: 890,
    standardDeliveryDays: 4,
    returnPolicyDays: 14,
    returnPolicyDescription: '14-day extended return window with free courier pickup',
    supportedCurrencies: ['INR'],
    paymentProvider: 'razorpay',
    razorpayAccountId: 'acc_qg_prod_02',
    agentPurchasesSupported: true,
    requiresHumanApproval: true,
    capabilities: ['product_search', 'product_details', 'cart', 'checkout', 'payment', 'refunds', 'agent_purchase'],
    contactEmail: 'support@quickgear.in',
    status: 'active',
  },
  {
    id: 'merchant_nova',
    name: 'Nova Store',
    slug: 'nova-store',
    tagline: 'High-performance enthusiast gaming hardware & ultra-fast delivery',
    rating: 4.4,
    reviewCount: 2310,
    standardDeliveryDays: 1,
    returnPolicyDays: 10,
    returnPolicyDescription: '10-day return window with instant replacement',
    supportedCurrencies: ['INR'],
    paymentProvider: 'razorpay',
    razorpayAccountId: 'acc_nova_prod_03',
    agentPurchasesSupported: true,
    requiresHumanApproval: true,
    capabilities: ['product_search', 'product_details', 'cart', 'checkout', 'payment', 'refunds', 'agent_purchase'],
    contactEmail: 'concierge@novastore.in',
    status: 'active',
  },
  {
    id: 'merchant_technest',
    name: 'TechNest',
    slug: 'tech-nest',
    tagline: 'Next-gen workspace ergonomic solutions',
    rating: 4.5,
    reviewCount: 650,
    standardDeliveryDays: 3,
    returnPolicyDays: 10,
    returnPolicyDescription: '10-day ergonomic satisfaction guarantee',
    supportedCurrencies: ['INR'],
    paymentProvider: 'razorpay',
    razorpayAccountId: 'acc_tn_prod_04',
    agentPurchasesSupported: true,
    requiresHumanApproval: true,
    capabilities: ['product_search', 'product_details', 'cart', 'checkout', 'payment', 'agent_purchase'],
    contactEmail: 'help@technest.co.in',
    status: 'active',
  },
  {
    id: 'merchant_legacy',
    name: 'Legacy Mart',
    slug: 'legacy-mart',
    tagline: 'Traditional offline electronics retailer (Manual purchase only)',
    rating: 4.9,
    reviewCount: 4500,
    standardDeliveryDays: 2,
    returnPolicyDays: 7,
    returnPolicyDescription: '7-day in-store return only',
    supportedCurrencies: ['INR'],
    paymentProvider: 'razorpay',
    agentPurchasesSupported: false, // Incompatible with AI agent checkout
    requiresHumanApproval: true,
    capabilities: ['product_search'],
    contactEmail: 'support@legacymart.in',
    status: 'active',
  },
  {
    id: 'merchant_global',
    name: 'Global Goods',
    slug: 'global-goods',
    tagline: 'International importer supporting non-Razorpay checkout',
    rating: 4.8,
    reviewCount: 1200,
    standardDeliveryDays: 1,
    returnPolicyDays: 14,
    returnPolicyDescription: '14-day global guarantee',
    supportedCurrencies: ['INR', 'USD'],
    paymentProvider: 'other', // Non-Razorpay provider
    agentPurchasesSupported: true,
    requiresHumanApproval: true,
    capabilities: ['product_search', 'product_details', 'cart', 'checkout'],
    contactEmail: 'ops@globalgoods.com',
    status: 'active',
  },
];

export function getMerchantById(id: string): Merchant | undefined {
  const norm = id.toLowerCase().trim();
  return merchants.find((m) => m.id.toLowerCase() === norm || m.slug.toLowerCase() === norm || m.name.toLowerCase() === norm);
}

export function getAllMerchants(): Merchant[] {
  return merchants;
}

/**
 * Generates the official machine-readable capability document
 * compliant with the Razorpay Agent Commerce Protocol.
 */
export function getMerchantCapabilityDocument(merchantId: string) {
  const m = getMerchantById(merchantId);
  if (!m) return null;

  return {
    version: '1.0',
    merchant: {
      id: m.id,
      name: m.name,
      slug: m.slug,
      tagline: m.tagline,
      rating: m.rating,
    },
    capabilities: m.capabilities,
    payment: {
      provider: m.paymentProvider,
      currency: m.supportedCurrencies[0] || 'INR',
      supported_currencies: m.supportedCurrencies,
      supported: m.paymentProvider === 'razorpay',
    },
    commerce: {
      agent_purchase: m.agentPurchasesSupported,
      human_approval_supported: m.requiresHumanApproval,
      standard_delivery_days: m.standardDeliveryDays,
      return_policy_days: m.returnPolicyDays,
    },
    policies: {
      max_order_value_paise: 300000,
      minimum_return_days: m.returnPolicyDays,
      return_policy_description: m.returnPolicyDescription,
    },
  };
}
