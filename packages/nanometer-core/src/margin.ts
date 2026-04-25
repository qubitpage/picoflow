/**
 * Margin math — card vs raw-onchain vs Gateway-batched.
 *
 * Numbers calibrated for April 2026 reality:
 *   - Stripe: 2.9% + $0.30 fixed
 *   - Raw onchain on Arc Testnet: ~$0.009/transfer (Gemini deep-research figure)
 *   - Gateway batch: amortised gas / N
 */
export interface MarginRow {
  scheme: "card" | "raw-onchain" | "gateway-batched";
  price_usdc: number;
  fee_usdc: number;
  net_usdc: number;
  margin_pct: number;
  viable: boolean;
  notes: string;
}

export interface MarginReport {
  price_usdc: number;
  n_calls: number;
  rows: MarginRow[];
  best_scheme: MarginRow["scheme"];
  savings_vs_raw_usdc: number;
}

export const STRIPE_FIXED_USD = 0.30;
export const STRIPE_PCT = 0.029;
export const RAW_ONCHAIN_USDC = 0.009;
/** Approximate Gateway batch settlement gas, divided across N batched authorisations. */
export const GATEWAY_BATCH_FIXED_USDC = 0.05; // a single onchain settle ~$0.05
export const GATEWAY_BATCH_DEFAULT_N = 1000;

export function computeMargin(price_usdc: number, n_calls = GATEWAY_BATCH_DEFAULT_N): MarginReport {
  const cardFee = STRIPE_FIXED_USD + price_usdc * STRIPE_PCT;
  const rawFee = RAW_ONCHAIN_USDC;
  const gwFee = GATEWAY_BATCH_FIXED_USDC / Math.max(1, n_calls);

  const make = (
    scheme: MarginRow["scheme"],
    fee: number,
    notes: string,
  ): MarginRow => {
    const net = price_usdc - fee;
    return {
      scheme,
      price_usdc,
      fee_usdc: fee,
      net_usdc: net,
      margin_pct: price_usdc > 0 ? (net / price_usdc) * 100 : 0,
      viable: net > 0,
      notes,
    };
  };

  const rows: MarginRow[] = [
    make("card", cardFee, "Stripe 2.9% + $0.30 fixed — fixed fee dominates sub-cent prices"),
    make("raw-onchain", rawFee, `Direct Arc transfer ≈ $${rawFee.toFixed(4)} per tx`),
    make(
      "gateway-batched",
      gwFee,
      `One settlement amortised across N=${n_calls} authorisations`,
    ),
  ];
  const best = rows.reduce((b, r) => (r.net_usdc > b.net_usdc ? r : b));
  return {
    price_usdc,
    n_calls,
    rows,
    best_scheme: best.scheme,
    savings_vs_raw_usdc: best.net_usdc - (rows.find((r) => r.scheme === "raw-onchain")?.net_usdc ?? 0),
  };
}
