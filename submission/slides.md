# PicoFlow — submission slides (outline)

Built for [lablab.ai "Build the Agentic Economy on Arc using USDC and Nanopayments"](https://lablab.ai/event), Apr 20–26 2026.

---

## 1. Title
**PicoFlow — the agentic settlement mesh on Arc.**
Every action settles. Every dependency gets paid. Every cent has a story.
Live: https://picoflow.qubitpage.com

## 2. The problem (one slide)
- LLM / data / compute APIs want to bill **per call**, but the cheapest rail today (Stripe) costs **$0.30 / call** — 60× a $0.005 LLM call.
- L1 ETH gas for an ERC-20 transfer ranges $0.30–$2.00 — same problem.
- Result: providers gate everything behind monthly plans + custodial credit pools → no agentic economy.

## 3. The insight
USDC-as-gas on Arc + Circle Nanopayments / x402 + Gateway batching = **~$0.0009 / settled call**.
That is the first time per-action billing for AI is *positive-margin* without a custodian.

## 4. What PicoFlow is
A turnkey marketplace that turns any HTTP API into an x402-paywalled, USDC-on-Arc paid endpoint with atomic revenue splits — and an autonomous buyer agent that consumes them.

## 5. Architecture (diagram slide)
Buyer agent (viem/Circle Wallets) → x402 challenge → EIP-3009 sign → Tollbooth verify → Gateway-batched settle on Arc → atomic 80/10/10 splits → Postgres ledger → Dashboard.

## 6. Live demo (record this)
- Open https://picoflow.qubitpage.com/demo, press **Run** → 56/56 paid actions in ~2 min.
- Switch to https://picoflow.qubitpage.com/splits — see the live USDC arrive.
- Switch to https://picoflow.qubitpage.com/providers — Featherless + AI/ML API both showing `featherless-real` / `aimlapi-real` source with live "PONG" replies.
- Open the exact Arc faucet transaction: https://testnet.arcscan.app/tx/0xba0307bba4d9f330d3b6c1b4579686a9e6048cf18bf272ba1e6db037ec373315.

## 7. Track alignment
Primary: Per-API Monetization · Agent-to-Agent Loop.
Secondary: Usage-Based Compute · Real-Time Micro-Commerce.
Full table at https://picoflow.qubitpage.com/track.

## 8. Circle products used
Arc · USDC on Arc · Nanopayments / x402 · Gateway (batch) · Wallets (signer interface) · CCTP hooks staged.

## 9. Featherless + AI/ML role
Featherless gives PicoFlow a wide open-model catalog; AI/ML API gives OpenAI/Gemini/Claude behind one billing surface. Both verified live on /providers. Featherless + AI/ML credits cover all real inference behind every demo run.

## 10. Margin proof
Card $0.30 · L1 ~$0.50 · Single Arc tx ~$0.003 · **Arc + Gateway batch ~$0.0009.**
PicoFlow saves **$0.299 per call** vs. cards.

## 11. Numbers (judges-friendly)
168 paid actions · 80 onchain tx · 504 atomic splits · 4 paid endpoints live · 0 failures in latest run.

## 12. Circle Product Feedback (incentive opt-in)
Long-form feedback was submitted in the lablab.ai feedback field and archived in `submission/circle-feedback.md` for project records.

## 13. What's next
Vyper BondVault + ReputationRegistry + MetadataLogger to live on Arc (titanoboa script staged). Mainnet candidate once Arc mainnet opens. Open-source SDK release for `tollbooth` + `nanometer-core`.

## 14. Thank you / links
GitHub · Demo URL · Whitepaper · Block-explorer txs · Submission video.
