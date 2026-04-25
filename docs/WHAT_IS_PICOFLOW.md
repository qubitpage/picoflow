# What is PicoFlow?

> One-line pitch: **PicoFlow lets AI agents and apps pay each other for individual API calls — even fractions of a cent — without credit cards, invoices, or human accounts.**

Copy/paste version (no jargon):

---

## In plain English

Imagine your AI assistant needs to call a weather service, a market-data feed, an image generator, and a translation API to answer one question. Today each of those vendors expects you to:

1. Sign up.
2. Put a credit card on file.
3. Pre-pay a $50 minimum.
4. Wait for a monthly invoice.
5. Manage rate limits and overage fees per vendor.

That doesn't work when an AI agent is making thousands of tiny calls per minute, each worth a hundredth of a cent. Card processors charge **30 cents plus 2.9 %** on every transaction — so a $0.001 call would lose 30,000 % to fees. The whole sub-cent economy is impossible on traditional rails.

**PicoFlow fixes that.** It turns any HTTP API into a metered, USDC-priced endpoint. Your AI agent (or any app) gets one API key, pastes it into a normal HTTP header, and every call is automatically:

- **Quoted** — the seller declares "this call costs $0.0005 USDC."
- **Authorized** — the buyer signs a tiny cryptographic permission slip off-chain (free, instant).
- **Settled in a batch** — hundreds of calls are bundled and pushed on-chain as one transaction, so the per-call settlement cost is fractions of a cent.

The buyer sees a normal API response. The seller sees a real on-chain payment in their wallet. Nobody touches a credit card, a Stripe dashboard, or a monthly invoice.

---

## How does the money flow?

Every paid call splits the revenue automatically across three buckets, on-chain, with no manual reconciliation:

1. **Provider** (you, the seller) — the bulk share, paid directly to your wallet in USDC.
2. **Platform** — a small percentage (2 % on the Growth tier) for running the gateway and dashboard.
3. **OSS treasury** — a public address that funds the open-source codebase and any libraries the call depended on.

Splits are configurable per endpoint, per organization, or per route. The breakdown is visible to anyone on the live ledger — there's no hidden middleman.

---

## What does the customer actually do with the API key?

The API key uses PicoFlow's `pf_...` format. The customer:

1. **Pastes it into one HTTP header**:
   ```
   Authorization: <Bearer API key>
   ```
2. **Calls a PicoFlow URL** like `https://picoflow.qubitpage.com/api/featherless/infer` exactly the way they'd call any other API. No SDK to install. No code changes. The body and response look identical to the upstream service.
3. **Reads three response headers** to track spend:
   - `x-pf-action-id` — the audit row, viewable in the public ledger.
   - `x-pf-price-usdc` — exactly what they were charged ($0.0005, $0.000001, whatever).
   - `x-pf-batch-id` — which on-chain settlement batch this call rolled up into.

That's the entire integration. They keep using their existing fetch / axios / OpenAI client / curl — only the URL and one header change.

---

## Where can it be used?

Anywhere a service has a marginal compute cost and the buyer is software (not a human filling out a form):

- **LLM inference** — pay per token, settle per minute.
- **Real-time market data** — bond prices, FX, crypto OHLC ticks.
- **Image / video / audio generation** — pay per render, no upfront credits.
- **RPC providers** — sub-cent per request to read a blockchain.
- **Vector search & retrieval** — pay per query against a hosted index.
- **Webhook fan-out, geocoding, OCR, translation, captioning** — anywhere a SaaS API has a per-call cost.
- **AI agent marketplaces** — agents discovering each other and paying for tasks they couldn't do alone.

The unifying property: a buyer who is software and wants to make many small calls cheaply, without opening accounts on every vendor.

---

## What still needs to be built to make this real?

PicoFlow already runs end-to-end on Arbitrum One mainnet — a real call settles real USDC on-chain through a real wallet, every time. To turn it into a polished product:

1. **Production providers** — wire up real LLM, market-data, and image-gen vendors as first-class sellers (today's catalog is intentionally small for the proof).
2. **KYC and fiat on-ramps** — let customers buy USDC inside the dashboard with a card, so they don't need to touch a crypto exchange.
3. **Spend controls** — per-key daily caps, alerts, hard cutoffs, monthly statements.
4. **More chains** — the registry already supports Arbitrum, Base, Optimism, Polygon, Ethereum mainnet plus testnets; each one needs the three Vyper contracts deployed and a relayer funded.
5. **Customer support tooling** — refunds, dispute resolution, bond slashing UX, reputation feedback loops.
6. **Self-serve seller onboarding** — let any developer publish an endpoint to the catalog without manual review, with automated reputation bootstrapping.

None of these change the protocol — they're product polish on top of a foundation that already settles real money.

---

## Why is this proven on Arbitrum mainnet today?

Because the same code that settles on Arbitrum One drops into **Arc Mainnet** the day Arc ships, with a single environment variable change. The chain registry already knows about eight chains; switching is `ARC_CHAIN_ID=...` and a relayer top-up. No rebuild, no re-deploy of the application — just deploy the three contracts on the new chain and flip the var.

That's the whole point of the multi-chain design: PicoFlow is **chain-agnostic infrastructure**, not an Arc-only product. Today's mainnet activity on Arbitrum is the dress rehearsal that proves the protocol works with real USDC, real gas, and real customers — so when Arc Mainnet launches, the platform is already battle-tested.

---

## Three customer scenarios

**1. The agent builder.** Alex builds a research assistant that calls 6 different vendors per question. Today she has 6 invoices and burns 30 % of revenue on card fees. With PicoFlow she has one key, one ledger row per call, sub-cent costs, and her users see a clean per-question price.

**2. The data vendor.** A small team publishes high-frequency FX prices. They can't justify a $50/month minimum because most users would consume $2 of data — so they have no customers. They list on PicoFlow, charge $0.0001 per tick, and suddenly they have 400 small AI agents paying them $80/month each in aggregated micropayments.

**3. The platform integrator.** A SaaS company wants to expose its image-generation backend to AI agents but doesn't want to build a billing system. They drop PicoFlow in front, set a price per request, and revenue arrives in their wallet daily — no Stripe, no chargebacks, no PCI.

---

## Try it

- **Live ledger:** [https://picoflow.qubitpage.com/dashboard](https://picoflow.qubitpage.com/dashboard)
- **Network status:** [https://picoflow.qubitpage.com/network](https://picoflow.qubitpage.com/network)
- **Self-serve signup:** [https://picoflow.qubitpage.com/signup](https://picoflow.qubitpage.com/signup) — 100,000 free calls per month, no card required.
