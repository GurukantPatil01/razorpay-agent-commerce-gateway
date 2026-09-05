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
  paymentProvider: 'razorpay';
  razorpayAccountId?: string; // e.g. for Route / linked accounts
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
    rating: 4.8,
    reviewCount: 1420,
    standardDeliveryDays: 2,
    returnPolicyDays: 7,
    returnPolicyDescription: '7-day hassle-free replacement & return on all electronic accessories',
    supportedCurrencies: ['INR'],
    paymentProvider: 'razorpay',
    razorpayAccountId: 'acc_acme_prod_01',
    agentPurchasesSupported: true,
    requiresHumanApproval: true,
    capabilities: ['product_search', 'cart', 'checkout', 'payment', 'refunds'],
    contactEmail: 'orders@acme-electronics.in',
    status: 'active',
  },
  {
    id: 'merchant_quickgear',
    name: 'QuickGear',
    slug: 'quick-gear',
    tagline: 'Affordable consumer electronics & office gear',
    rating: 4.4,
    reviewCount: 890,
    standardDeliveryDays: 5,
    returnPolicyDays: 14,
    returnPolicyDescription: '14-day standard return window with courier pickup',
    supportedCurrencies: ['INR'],
    paymentProvider: 'razorpay',
    razorpayAccountId: 'acc_qg_prod_02',
    agentPurchasesSupported: true,
    requiresHumanApproval: true,
    capabilities: ['product_search', 'cart', 'checkout', 'payment', 'refunds'],
    contactEmail: 'support@quickgear.in',
    status: 'active',
  },
  {
    id: 'merchant_nova',
    name: 'Nova Store',
    slug: 'nova-store',
    tagline: 'High-performance enthusiast gaming hardware',
    rating: 4.9,
    reviewCount: 2310,
    standardDeliveryDays: 2,
    returnPolicyDays: 7,
    returnPolicyDescription: '7-day return window with instant replacement',
    supportedCurrencies: ['INR'],
    paymentProvider: 'razorpay',
    razorpayAccountId: 'acc_nova_prod_03',
    agentPurchasesSupported: true,
    requiresHumanApproval: true,
    capabilities: ['product_search', 'cart', 'checkout', 'payment', 'refunds'],
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
    capabilities: ['product_search', 'cart', 'checkout', 'payment'],
    contactEmail: 'help@technest.co.in',
    status: 'active',
  },
];

export function getMerchantById(id: string): Merchant | undefined {
  return merchants.find((m) => m.id === id || m.slug === id);
}

export function getAllMerchants(): Merchant[] {
  return merchants;
}
