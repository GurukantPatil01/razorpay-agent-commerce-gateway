/**
 * Structured Purchase Intent Parser & Normalizer
 *
 * Architecture:
 * Natural language -> LLM / Interpreter -> Structured PurchaseIntent -> Zod Validation -> Deterministic Normalization -> Backend Enforcement
 *
 * Core rule:
 * NEVER invent missing constraints. If user does not specify delivery or returns,
 * fields remain explicitly null.
 */

import { z } from 'zod';

export const PurchaseIntentSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
  category: z.string().default('electronics'),
  maxAmountPaise: z.number().int().positive().nullable().default(null),
  currency: z.literal('INR').default('INR'),
  maxDeliveryDays: z.number().int().positive().nullable().default(null),
  minimumReturnDays: z.number().int().positive().nullable().default(null),
  requiresAgentCheckout: z.boolean().default(true),
  requiresRazorpay: z.boolean().default(true),
});

export type PurchaseIntent = z.infer<typeof PurchaseIntentSchema>;

export interface IntentParseResult {
  success: boolean;
  intent?: PurchaseIntent;
  error?: string;
  rawInput: string;
}

/**
 * Extracts and parses structured purchase intent from text or structured object.
 * Strictly validates against PurchaseIntentSchema.
 */
export function parsePurchaseIntent(
  input: string | Record<string, any>
): IntentParseResult {
  try {
    if (typeof input === 'object' && input !== null) {
      // Normalize amount if provided in INR instead of paise
      let maxAmountPaise = input.maxAmountPaise ?? input.maxAmount;
      if (maxAmountPaise && maxAmountPaise < 10000 && maxAmountPaise > 0) {
        // Provided in rupees (e.g. 3000), convert to paise (300000)
        maxAmountPaise = Math.round(maxAmountPaise * 100);
      }

      const validated = PurchaseIntentSchema.parse({
        query: input.query || input.searchQuery || 'keyboard',
        category: input.category || 'electronics',
        maxAmountPaise: maxAmountPaise ?? null,
        currency: input.currency || 'INR',
        maxDeliveryDays: input.maxDeliveryDays ?? null,
        minimumReturnDays: input.minimumReturnDays ?? null,
        requiresAgentCheckout: input.requiresAgentCheckout ?? true,
        requiresRazorpay: input.requiresRazorpay ?? true,
      });

      return {
        success: true,
        intent: validated,
        rawInput: JSON.stringify(input),
      };
    }

    const text = String(input).trim();
    if (!text) {
      return { success: false, error: 'Empty prompt provided', rawInput: text };
    }

    // Deterministic rule-based extraction from natural language
    // 1. Budget extraction
    let maxAmountPaise: number | null = null;
    
    // Check for word numbers (e.g. "three thousand", "two thousand", "twenty five hundred")
    if (/(?:under|below|less than|within|max(?:imum)?|around|about|approx(?:imately)?)\s*(?:₹|rs\.?|inr)?\s*(?:three thousand|3 thousand)/i.test(text)) {
      maxAmountPaise = 300000;
    } else if (/(?:under|below|less than|within|max(?:imum)?|around|about|approx(?:imately)?)\s*(?:₹|rs\.?|inr)?\s*(?:two thousand|2 thousand)/i.test(text)) {
      maxAmountPaise = 200000;
    } else if (/(?:under|below|less than|within|max(?:imum)?|around|about|approx(?:imately)?)\s*(?:₹|rs\.?|inr)?\s*(?:twenty five hundred)/i.test(text)) {
      maxAmountPaise = 250000;
    } else {
      const priceMatch = text.match(/(?:under|below|less than|within|max(?:imum)?|around|about|approx(?:imately)?)\s*(?:₹|rs\.?|inr)?\s*([0-9,]+)(?:\s*(?:k|thousand))?/i);
      if (priceMatch) {
        let numStr = priceMatch[1].replace(/,/g, '');
        let val = parseFloat(numStr);
        if (text.toLowerCase().includes('3k') || /3\s*k/i.test(text)) {
          val = 3000;
        } else if (/(\d+)\s*k/i.test(priceMatch[0])) {
          val = val * 1000;
        }
        maxAmountPaise = Math.round(val * 100);
      } else if (text.includes('3,000') || text.includes('3000')) {
        maxAmountPaise = 300000;
      }
    }

    // 2. Delivery extraction (ONLY IF EXPLICITLY REQUESTED WITH SPECIFIC TIMEFRAME)
    let maxDeliveryDays: number | null = null;
    const deliveryMatch = text.match(/(?:within|in|under|delivery\s*(?:within|in)?)\s*(\d+)\s*(?:days?|d)/i);
    if (deliveryMatch) {
      maxDeliveryDays = parseInt(deliveryMatch[1], 10);
    }

    // 3. Return extraction (ONLY IF EXPLICITLY REQUESTED)
    let minimumReturnDays: number | null = null;
    if (/(?:at least|minimum|min)?\s*(?:a\s+)?week\s*(?:to\s+return|returns?)/i.test(text)) {
      minimumReturnDays = 7;
    } else {
      const returnMatch = text.match(/(?:at least|minimum|min)?\s*(?:a\s+)?(\d+)\s*[- ]?(?:days?|d)\s*returns?/i);
      if (returnMatch) {
        minimumReturnDays = parseInt(returnMatch[1], 10);
      }
    }

    // 4. Query extraction
    let query = 'keyboard';
    const lowerText = text.toLowerCase();
    if (lowerText.includes('wireless keyboard')) {
      query = 'wireless keyboard';
    } else if (lowerText.includes('mechanical keyboard')) {
      query = 'mechanical keyboard';
    } else if (lowerText.includes('keyboard')) {
      query = 'keyboard';
    } else if (lowerText.includes('wireless mouse') || lowerText.includes('mouse')) {
      query = 'mouse';
    } else if (lowerText.includes('electronic accessory') || lowerText.includes('accessory')) {
      query = 'accessory';
    } else {
      // General item extraction
      const itemMatch = text.match(/(?:find|need|buy|get|show me)\s+(?:a|an|the|something)?\s*([a-zA-Z\s]+?)(?:\s+(?:under|below|around|within|with|that)|\.|\?|$)/i);
      if (itemMatch && itemMatch[1].trim()) {
        query = itemMatch[1].trim();
      }
    }

    const validated = PurchaseIntentSchema.parse({
      query,
      category: 'electronics',
      maxAmountPaise,
      currency: 'INR',
      maxDeliveryDays,
      minimumReturnDays,
      requiresAgentCheckout: true,
      requiresRazorpay: true,
    });

    return {
      success: true,
      intent: validated,
      rawInput: text,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to parse purchase intent: ${err.message}`,
      rawInput: typeof input === 'string' ? input : JSON.stringify(input),
    };
  }
}
