import { randomBytes } from "node:crypto";
import type { Address } from "viem";
import type { BuyerQuoteRequest, PriceQuote, SplitSpec } from "./types.js";
import { DEFAULT_QUOTE_WINDOW_SEC } from "./constants.js";

export interface QuoteEngineConfig {
  asset: Address;
  network: number;
  to: Address;
  splits?: SplitSpec[];
  /** Server's listed price ("rack rate"). */
  basePrice: string;
  /** Optional volume-tier discount table — sorted by volume threshold ascending. */
  volumeTiers?: { minVolume: number; discountBps: number }[];
  /** Optional per-buyer overrides, keyed by lowercase address. */
  buyerOverrides?: Record<string, { price: string; rationale?: string }>;
  /** Quote validity in seconds. */
  validityWindowSec?: number;
  /** Floor price — server will never quote below this regardless of buyer proposal. */
  floorPrice?: string;
}

/**
 * Server-side `price_quote` negotiation engine.
 *
 * Implements the optional handshake recommended for the x402 spec by Circle Arc
 * developer feedback (April 2026): a buyer agent POSTs a quote request with an
 * optional proposed price and volume; the server returns a signed-off `quote_id`
 * the buyer can then echo into the eventual signed payment authorization. This
 * lets two agents agree a price BEFORE the buyer commits a signature — the
 * key gap that blocks Gemini-Function-Calling-style negotiation flows.
 *
 * Negotiation policy (deterministic, no LLM in the hot path):
 *   1. Start at basePrice.
 *   2. Apply best-matching volumeTier discount.
 *   3. Apply buyerOverrides (highest priority).
 *   4. If buyer proposed a price within 10% of the resulting price, accept it.
 *   5. Otherwise counter with the policy price.
 *   6. Never quote below floorPrice.
 */
export class QuoteEngine {
  private quotes = new Map<string, PriceQuote>();

  constructor(private cfg: QuoteEngineConfig) {}

  quote(req: BuyerQuoteRequest): PriceQuote {
    const window = this.cfg.validityWindowSec ?? DEFAULT_QUOTE_WINDOW_SEC;
    let price = this.cfg.basePrice;
    let rationale: string | undefined;

    if (this.cfg.volumeTiers && req.volume && req.volume > 0) {
      const matched = [...this.cfg.volumeTiers]
        .sort((a, b) => a.minVolume - b.minVolume)
        .filter((t) => req.volume! >= t.minVolume)
        .pop();
      if (matched) {
        price = applyDiscountBps(price, matched.discountBps);
        rationale = `volume discount ${matched.discountBps / 100}% at ${matched.minVolume}+ calls`;
      }
    }

    if (req.buyer) {
      const override = this.cfg.buyerOverrides?.[req.buyer.toLowerCase()];
      if (override) {
        price = override.price;
        rationale = override.rationale ?? "buyer-tier override";
      }
    }

    if (req.proposed_price && withinTenPercent(req.proposed_price, price)) {
      price = req.proposed_price;
      rationale = (rationale ? rationale + "; " : "") + "buyer proposal accepted";
    }

    if (this.cfg.floorPrice && lessThan(price, this.cfg.floorPrice)) {
      price = this.cfg.floorPrice;
      rationale = (rationale ? rationale + "; " : "") + "floor price applied";
    }

    const quote_id = "q_" + randomBytes(12).toString("hex");
    const quote: PriceQuote = {
      quote_id,
      price,
      asset: this.cfg.asset,
      network: this.cfg.network,
      to: this.cfg.to,
      splits: this.cfg.splits,
      expires_at: Math.floor(Date.now() / 1000) + window,
      rationale,
    };
    this.quotes.set(quote_id, quote);
    // Opportunistic GC of expired quotes.
    if (this.quotes.size > 1000) this.gc();
    return quote;
  }

  /** Look up a previously issued quote. Returns undefined if expired or unknown. */
  consume(quote_id: string): PriceQuote | undefined {
    const q = this.quotes.get(quote_id);
    if (!q) return undefined;
    if (Math.floor(Date.now() / 1000) > q.expires_at) {
      this.quotes.delete(quote_id);
      return undefined;
    }
    return q;
  }

  private gc(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [k, v] of this.quotes) {
      if (now > v.expires_at) this.quotes.delete(k);
    }
  }
}

function applyDiscountBps(priceStr: string, bps: number): string {
  const atomic = priceStrToBigInt(priceStr);
  const discounted = (atomic * BigInt(10_000 - bps)) / 10_000n;
  return bigIntToPriceStr(discounted);
}

function withinTenPercent(a: string, b: string): boolean {
  const A = priceStrToBigInt(a);
  const B = priceStrToBigInt(b);
  if (B === 0n) return false;
  const diff = A > B ? A - B : B - A;
  return (diff * 100n) / B <= 10n;
}

function lessThan(a: string, b: string): boolean {
  return priceStrToBigInt(a) < priceStrToBigInt(b);
}

/** Internal: handle 6-decimal precision uniformly. */
function priceStrToBigInt(p: string): bigint {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(p)) throw new Error(`invalid price "${p}"`);
  const [whole, frac = ""] = p.split(".");
  return BigInt(whole + (frac + "000000").slice(0, 6));
}

function bigIntToPriceStr(n: bigint): string {
  const s = n.toString().padStart(7, "0");
  const whole = s.slice(0, -6);
  const frac = s.slice(-6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
