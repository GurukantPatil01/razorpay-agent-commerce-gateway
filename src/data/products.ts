/**
 * Structured Product Catalog for RazorPay Agent Commerce Gateway
 *
 * All financial amounts are stored as INTEGER PAISE internally (1 INR = 100 paise).
 * The server-side pricing calculator uses these raw figures to compute deterministic totals.
 */

export interface Product {
  id: string;
  merchantId: string;
  name: string;
  category: string;
  description: string;
  specifications: Record<string, string>;
  basePricePaise: number;     // e.g. 249900 = ₹2,499
  gstRate: number;            // e.g. 0.18 = 18% GST
  taxPaise: number;           // Calculated GST component e.g. 45000 = ₹450
  shippingFeePaise: number;   // e.g. 0 or 4900
  discountPaise: number;      // e.g. 0
  inventory: number;
  deliveryDays: number;
  returnDays: number;
  rating: number;
  reviewCount: number;
  imageUrl?: string;
  inStock: boolean;
}

export const products: Product[] = [
  // ── Acme Electronics ──
  {
    id: 'prod_acme_keyboard',
    merchantId: 'merchant_acme',
    name: 'Acme Pro Wireless Mechanical Keyboard',
    category: 'electronics',
    description: 'Multi-device Bluetooth 5.2 and 2.4GHz mechanical keyboard with hot-swappable switches, low-latency gaming mode, and 400-hour battery life.',
    specifications: {
      connectivity: 'Bluetooth 5.2 / 2.4GHz Wireless / USB-C',
      batteryLife: '400 Hours',
      switchType: 'Hot-swappable tactile Brown',
      backlight: 'RGB Multi-zone',
      compatibility: 'Windows, macOS, Linux, Android, iOS',
    },
    basePricePaise: 249900,   // ₹2,499.00
    gstRate: 0.18,
    taxPaise: 45000,          // ₹450.00
    shippingFeePaise: 0,      // Free shipping
    discountPaise: 0,
    inventory: 45,
    deliveryDays: 2,          // Satisfies delivery <= 3 days
    returnDays: 7,            // Satisfies return >= 7 days
    rating: 4.8,
    reviewCount: 320,
    inStock: true,
  },
  {
    id: 'prod_acme_mouse',
    merchantId: 'merchant_acme',
    name: 'Acme Precision Wireless Mouse',
    category: 'electronics',
    description: 'Ergonomic 4000 DPI wireless mouse with silent clicks and fast USB-C recharging.',
    specifications: {
      sensor: 'Optical 4000 DPI',
      connectivity: 'Dual Mode 2.4GHz + Bluetooth',
      weight: '85g',
    },
    basePricePaise: 129900,
    gstRate: 0.18,
    taxPaise: 23382,
    shippingFeePaise: 0,
    discountPaise: 10000,
    inventory: 60,
    deliveryDays: 2,
    returnDays: 7,
    rating: 4.7,
    reviewCount: 150,
    inStock: true,
  },

  // ── QuickGear ──
  {
    id: 'prod_qg_keyboard',
    merchantId: 'merchant_quickgear',
    name: 'QuickGear AirSlim Wireless Keyboard',
    category: 'electronics',
    description: 'Ultra-thin membrane wireless keyboard for productivity. Lightweight, compact layout with dedicated media controls.',
    specifications: {
      connectivity: '2.4GHz USB Dongle',
      batteryLife: '120 Hours (2x AAA)',
      switchType: 'Scissor Membrane',
      backlight: 'None',
      compatibility: 'Windows, macOS',
    },
    basePricePaise: 235000,   // ₹2,350.00
    gstRate: 0.18,
    taxPaise: 40000,          // ₹400.00
    shippingFeePaise: 4900,   // ₹49.00 shipping
    discountPaise: 0,
    inventory: 120,
    deliveryDays: 5,          // Fails constraint: 5 days > 3 days
    returnDays: 14,
    rating: 4.4,
    reviewCount: 210,
    inStock: true,
  },

  // ── Nova Store ──
  {
    id: 'prod_nova_keyboard',
    merchantId: 'merchant_nova',
    name: 'Nova Apex RGB Wireless Keyboard',
    category: 'electronics',
    description: 'Flagship mechanical keyboard with rapid 1-day express delivery, PBT keycaps, and magnetic switches.',
    specifications: {
      connectivity: 'Tri-mode Wireless + BT 5.3 + Type-C',
      batteryLife: '300 Hours',
      switchType: 'Magnetic Hall-Effect switches',
      backlight: 'Per-key ARGB',
      compatibility: 'Windows, macOS, iOS, Android',
    },
    basePricePaise: 262600,   // ₹2,626.00
    gstRate: 0.18,
    taxPaise: 47300,          // ₹473.00
    shippingFeePaise: 0,
    discountPaise: 0,
    inventory: 25,
    deliveryDays: 2,
    returnDays: 7,
    rating: 4.9,
    reviewCount: 430,
    inStock: true,            // Total = ₹3,099 (Exceeds ₹3,000 budget)
  },

  // ── TechNest ──
  {
    id: 'prod_technest_keyboard',
    merchantId: 'merchant_technest',
    name: 'TechNest Waveform Ergonomic Keyboard',
    category: 'electronics',
    description: 'Split ergonomic wireless keyboard with integrated cushioned wrist rest and curved keyframe to reduce strain.',
    specifications: {
      connectivity: 'Bluetooth 5.0 / 2.4GHz',
      batteryLife: '24 Months',
      design: 'Split wave ergonomically curved',
      compatibility: 'Universal',
    },
    basePricePaise: 269900,   // ₹2,699.00
    gstRate: 0.18,
    taxPaise: 48500,          // ₹485.00
    shippingFeePaise: 0,
    discountPaise: 0,
    inventory: 25,
    deliveryDays: 3,
    returnDays: 10,
    rating: 4.5,
    reviewCount: 95,
    inStock: true,            // Total = ₹3,184 (Fails budget constraint: > ₹3,000)
  },

  // ── Legacy Mart (Non-Agent Merchant Test Case) ──
  {
    id: 'prod_legacy_keyboard',
    merchantId: 'merchant_legacy',
    name: 'Legacy Standard Keyboard (In-Store Only)',
    category: 'electronics',
    description: 'Reliable office mechanical and wireless keyboard sold by traditional retailer without autonomous agent API support.',
    specifications: {
      connectivity: 'USB / Wireless',
      switchType: 'Blue Mechanical',
    },
    basePricePaise: 194800,   // ₹1,948.00
    gstRate: 0.18,
    taxPaise: 35100,          // ₹351.00
    shippingFeePaise: 0,
    discountPaise: 0,
    inventory: 50,
    deliveryDays: 2,
    returnDays: 7,
    rating: 4.9,
    reviewCount: 410,
    inStock: true,            // Total = ₹2,299
  },

  // ── Global Goods (Non-Razorpay Merchant Test Case) ──
  {
    id: 'prod_stripe_keyboard',
    merchantId: 'merchant_global',
    name: 'Global Goods CyberKey Wireless Keyboard',
    category: 'electronics',
    description: 'International compact wireless keyboard from a merchant without Razorpay gateway integration.',
    specifications: {
      connectivity: 'Bluetooth 5.0',
      switchType: 'Scissor Switch',
    },
    basePricePaise: 186300,   // ₹1,863.00
    gstRate: 0.18,
    taxPaise: 33600,          // ₹336.00
    shippingFeePaise: 0,
    discountPaise: 0,
    inventory: 80,
    deliveryDays: 1,
    returnDays: 14,
    rating: 4.8,
    reviewCount: 520,
    inStock: true,            // Total = ₹2,199
  },
];

// Snapshot of initial baseline prices for clean test mutations
const defaultProductPrices: Record<string, { basePricePaise: number; taxPaise: number }> = {
  prod_acme_keyboard: { basePricePaise: 249900, taxPaise: 45000 },
  prod_qg_keyboard: { basePricePaise: 235000, taxPaise: 40000 },
  prod_nova_keyboard: { basePricePaise: 262600, taxPaise: 47300 },
  prod_technest_keyboard: { basePricePaise: 269900, taxPaise: 48500 },
};

/**
 * Mutates a product price in the live catalog.
 * Used for Demo 4 (Price Change Protection) and dynamic pricing tests.
 */
export function mutateProductPrice(productId: string, newBasePricePaise: number, newTaxPaise?: number): Product {
  const prod = products.find((p) => p.id === productId);
  if (!prod) throw new Error(`Product ${productId} not found`);
  prod.basePricePaise = newBasePricePaise;
  prod.taxPaise = newTaxPaise ?? Math.round(newBasePricePaise * prod.gstRate);
  return prod;
}

/**
 * Resets a product price back to its original baseline.
 */
export function resetProductPrice(productId: string): Product {
  const defaults = defaultProductPrices[productId];
  if (!defaults) return getProductById(productId)!;
  return mutateProductPrice(productId, defaults.basePricePaise, defaults.taxPaise);
}

export function getProductById(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export function getProductsByMerchant(merchantId: string): Product[] {
  return products.filter((p) => p.merchantId === merchantId);
}

export function searchProducts(query: string, category?: string): Product[] {
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  return products.filter((p) => {
    const matchesCategory = category ? p.category.toLowerCase() === category.toLowerCase() : true;
    if (!matchesCategory) return false;
    if (words.length === 0) return true;

    const targetText = `${p.name} ${p.description} ${p.category} ${Object.values(p.specifications).join(' ')}`.toLowerCase();
    return words.every((w) => targetText.includes(w));
  });
}
