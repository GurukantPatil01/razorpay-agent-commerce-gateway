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
    description: 'Flagship mechanical keyboard with PBT keycaps, gasket-mounted sound dampening, and rapid-trigger magnetic switches.',
    specifications: {
      connectivity: 'Tri-mode Wireless + BT 5.3 + Type-C',
      batteryLife: '300 Hours',
      switchType: 'Magnetic Hall-Effect switches',
      backlight: 'Per-key ARGB',
      compatibility: 'Windows, macOS, iOS, Android',
    },
    basePricePaise: 260000,   // ₹2,600.00
    gstRate: 0.18,
    taxPaise: 40000,          // ₹400.00
    shippingFeePaise: 9900,   // ₹99.00
    discountPaise: 0,
    inventory: 18,
    deliveryDays: 2,          // Satisfies 2 days
    returnDays: 7,
    rating: 4.9,
    reviewCount: 430,
    inStock: true,            // Total = ₹3,099 (Fails budget constraint: > ₹3,000)
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
];

export function getProductById(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export function getProductsByMerchant(merchantId: string): Product[] {
  return products.filter((p) => p.merchantId === merchantId);
}

export function searchProducts(query: string, category?: string): Product[] {
  const q = query.toLowerCase().trim();
  return products.filter((p) => {
    const matchesCategory = category ? p.category.toLowerCase() === category.toLowerCase() : true;
    const matchesQuery =
      q === '' ||
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      Object.values(p.specifications).some((val) => val.toLowerCase().includes(q));
    return matchesCategory && matchesQuery;
  });
}
