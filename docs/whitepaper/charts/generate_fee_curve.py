"""
Generate the PicoFlow fee-curve chart for the whitepaper.

REAL inputs (no mocks):
  - Stripe published fee:    $0.30 fixed + 2.9% (https://stripe.com/pricing)
  - Arc native gas (USDC):   ~$0.009 per simple ERC-20 transfer
                             (Circle Arc docs + observed testnet receipts)
  - Batched x402 amortised:  g / N, where g = $0.009 and N = batch size
                             (per Circle Gateway transferWithAuthorization batch)

Output:  docs/whitepaper/charts/fee-curve.png  (300 dpi, log-log)
         docs/whitepaper/charts/fee-curve.svg  (vector)

Run:     python docs/whitepaper/charts/generate_fee_curve.py
"""

from __future__ import annotations
import os
import numpy as np
import matplotlib.pyplot as plt

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Action prices: $0.000001 .. $10
prices = np.logspace(-6, 1, 400)

CARD_FIXED = 0.30
CARD_PCT = 0.029
ARC_GAS = 0.009  # per simple USDC transfer on Arc

def margin_card(p):
    return p - CARD_FIXED - CARD_PCT * p

def margin_raw(p):
    return p - ARC_GAS

def margin_batched(p, N):
    return p - ARC_GAS / N


fig, ax = plt.subplots(figsize=(8, 5.2), dpi=150)

ax.axhline(0, color="#666666", linewidth=0.6, linestyle="--", alpha=0.7)

ax.plot(prices, margin_card(prices), label="Card (Stripe: $0.30 + 2.9%)",
        color="#EF4444", linewidth=2)
ax.plot(prices, margin_raw(prices), label="Raw on-chain (Arc gas ≈ $0.009)",
        color="#F59E0B", linewidth=2)

for N, color in [(10, "#9CA3AF"), (100, "#10B981"), (1000, "#3B5BDB")]:
    ax.plot(prices, margin_batched(prices, N),
            label=f"Batched x402 (N={N:,})", color=color, linewidth=2)

ax.set_xscale("log")
ax.set_yscale("symlog", linthresh=1e-6)
ax.set_xlim(1e-6, 1e1)
ax.set_ylim(-1, 1e1)

ax.set_xlabel("Action price (USDC, log)")
ax.set_ylabel("Margin per action (USDC, symlog)")
ax.set_title("Per-action margin vs price under each settlement rail",
             fontsize=11, pad=10)

# Mark sub-cent zone
ax.axvspan(1e-6, 0.01, alpha=0.06, color="#3B5BDB",
           label=None)
ax.text(3e-6, 7, "sub-cent zone\n(only batched\nrails are profitable)",
        fontsize=8, color="#3B5BDB", ha="left", va="top")

ax.legend(loc="lower right", fontsize=8.5, framealpha=0.95)
ax.grid(True, which="both", alpha=0.18)

# Watermark with real data source
fig.text(0.99, 0.005,
         "PicoFlow whitepaper — fee curve generated from published Stripe + Circle Arc costs (April 2026).",
         ha="right", fontsize=6.5, color="#888888", style="italic")

fig.tight_layout()
png_path = os.path.join(OUT_DIR, "fee-curve.png")
svg_path = os.path.join(OUT_DIR, "fee-curve.svg")
fig.savefig(png_path, dpi=300, bbox_inches="tight")
fig.savefig(svg_path, bbox_inches="tight")
print(f"wrote {png_path}")
print(f"wrote {svg_path}")

# Also print a tiny break-even table for the README/whitepaper
print("\nBreak-even action prices:")
print(f"  Card               : ${(CARD_FIXED) / (1 - CARD_PCT):0.4f}")
print(f"  Raw on-chain (Arc) : ${ARC_GAS:0.6f}")
for N in (10, 100, 1000, 10000):
    print(f"  Batched N={N:>5,}   : ${ARC_GAS / N:0.8f}")
