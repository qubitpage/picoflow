---
marp: true
theme: default
paginate: true
size: 16:9
title: "PicoFlow — The Agentic Settlement Mesh on Arc"
style: |
  :root {
    --paper:    #F8F6F1;
    --cream:    #FCFAF5;
    --ink:      #1E2330;
    --ink2:     #4A5468;
    --indigo:   #3B5BDB;
    --emerald:  #10B981;
    --amber:    #F59E0B;
    --coral:    #EF4444;
    --hairline: #E5E0D6;
  }
  section {
    background: var(--paper);
    color: var(--ink);
    font-family: 'Inter', system-ui, sans-serif;
    padding: 60px 80px;
  }
  h1 { color: var(--ink); font-weight: 800; letter-spacing: -0.02em; }
  h2 { color: var(--indigo); font-weight: 700; }
  h3 { color: var(--ink2); font-weight: 600; }
  strong { color: var(--indigo); }
  code, pre {
    background: #FBF7EE;
    color: var(--ink);
    border: 1px solid var(--hairline);
    border-radius: 8px;
    font-family: 'JetBrains Mono', 'Söhne Mono', monospace;
  }
  table {
    border-collapse: collapse;
    border: 1px solid var(--hairline);
  }
  th { background: var(--cream); color: var(--ink); }
  td, th { border: 1px solid var(--hairline); padding: 8px 14px; }
  blockquote {
    border-left: 4px solid var(--indigo);
    background: var(--cream);
    padding: 12px 18px;
    color: var(--ink2);
    font-style: italic;
  }
  footer { color: var(--ink2); font-size: 14px; }
  section.cover {
    background: linear-gradient(160deg, var(--paper) 0%, var(--cream) 100%);
    text-align: center;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  section.cover h1 { font-size: 96px; margin-bottom: 0; }
  section.cover .tag { color: var(--indigo); font-size: 26px; margin-top: 6px; }
footer: 'PicoFlow · v0.3 · Mainnet proof + Arc readiness · April 2026'
---

<!-- _class: cover -->

# PicoFlow

<div class="tag"><strong>The Agentic Settlement Mesh on Arc</strong></div>

*Every API call gets a price, a ledger row, a cost row, and a settlement proof path.*

###### Built for the lablab.ai *Build the Agentic Economy on Arc using USDC and Nanopayments* hackathon — April 2026

---

## The Hook

> **AI agents will run 90 % of internet transactions by 2030.**
> None of today's payment rails work for them.

- Stripe minimums: $0.30 + 2.9 % ⇒ break-even ≈ $10
- Raw onchain (even on Arc): ≈ $0.009 per transfer ⇒ break-even ≈ $0.05
- Manual API keys + KYC: agents can't do that

**Result today:** the entire sub-cent agentic economy is locked behind subscription middlemen.

---

## The Problem

| Mechanism | Per-tx cost | Min. viable price | $0.005 calls |
|---|---|---|---|
| Card (Stripe) | $0.30 + 2.9 % | ~$10 | ❌ negative margin |
| Raw onchain (Arc) | ~$0.009 | ~$0.05 | ❌ negative margin |
| **PicoFlow (Gateway-batched x402)** | **amortised** | **$0.000001** | ✅ profitable |

a16z's *Cloud Paradox* — $100 B of margin sits with cloud middlemen because billing happens at the wrong granularity. PicoFlow makes per-action the default unit.

---

## The Insight

**Three primitives, in production today, finally compose:**

1. **HTTP 402** — the dormant payment-required status, revived as the *x402* protocol
2. **Arc** — USDC as native gas, Malachite ≈ 387 ms finality
3. **Circle Gateway / Nanopayments** — offchain EIP-3009 authorizations batched and net-settled onchain

Together: **$0.000001-resolution USDC payments that are real, atomic, and auditable.**

PicoFlow is honest about chain status:

- **Arbitrum One `42161`** — live real-funds mainnet proof today.
- **Arc Testnet `5042002`** — Arc-native contract and settlement rehearsal.
- **Arc Mainnet** — drop-in target when Circle publishes it.

---

## Solution — Five Layers

| Layer | What it does |
|---|---|
| **NanoMeter Core** | x402 server SDK + Gemini orchestrator + Postgres ledger |
| **TollBooth** | drop-in Express/Caddy proxy: any API → x402 in 5 lines |
| **ProofMesh** | ERC-8004 reputation + USDC bond / slash / refund (Vyper) |
| **Rev-Split** | atomic OSS dependency payouts via `splits[]` |
| **StreamMeter** | sub-cent per-tick WebSocket billing (literal $0.000001 floor) |

Plus: full-CRUD admin, *Explain-like-I'm-five* boxes on every widget, EN/RO/ES/FR/DE i18n.

---

## Live demo: real proof, not fake mainnet

The homepage and network page show both lanes clearly:

| Lane | Purpose | What judges should trust |
|---|---|---|
| Arbitrum One mainnet | real USDC working example | public mainnet addresses, live ledger, real-funds UX |
| Arc Testnet | sponsor-native execution path | Vyper contracts, USDC-gas semantics, ProofMesh events |
| Arc Mainnet | future target | same product redeployed by chain config |

```
$ pnpm demo:run
✅ paid API calls ≤ $0.01 each
✅ provider_costs populated
✅ action_id returned in response headers
✅ settlement states kept honest: intent/submitted/confirmed/failed
```

---

## Differentiation

PicoFlow is built around product primitives that work together as one settlement mesh:

| Capability | PicoFlow implementation |
|---|---|
| Open marketplace | Any API can publish a paid capability |
| 1-line seller onboarding | TollBooth middleware wraps Express endpoints |
| Onchain reputation bonds | ProofMesh / ERC-8004-style staking, slash, refund path |
| Atomic OSS rev-split | 80/10/10 split rows for seller, platform, dependency pool |
| Sub-cent streaming | StreamMeter supports $0.000001 ticks |
| Validator selection | Verifiable-random audit assignment path |

---

## Sponsor Coverage (15)

**Arc** · **Circle USDC** · **Circle Nanopayments** · **Circle Gateway** · **x402** · **Circle App Kit / Bridge Kit** · **Circle Wallets** · **Circle MCP / Skills** · **Gemini** · **Google AI Studio** · **Featherless** · **AI/ML API** · **AIsa** · **ERC-8004** · **Vyper / titanoboa**

> Every sponsor has at least one *hero moment* visible in the dashboard with a direct artifact link: real Arbitrum tx, Arc contract address, Arc faucet tx, Gateway/network panel, Gemini transcript, provider status, ProofMesh event, etc.

---

## Margin Story

```
For a $0.005 paid action:

  Card    : -$0.295   ← $0.30 + 2.9 % fixed fee, completely impossible
  Onchain :  -$0.004  ← raw transfer costs more than the action
  PicoFlow: +$0.0049  ← amortised across batch (N=1000)
```

Four orders of magnitude below the raw-onchain floor. **This is the missing rail.**

Live cost accounting is now visible: the ledger records `provider_costs` for
Featherless, AI/ML API, AIsa/Kraken and the validator lane, so margin is no
longer only a revenue claim.

---

## Trust Layer

- **ProofMesh bonds**: sellers post USDC, validators slash on failure
- **Validator economics**: pay $0.0015, earn $0.0025 on successful slash
- **BlueQubit / IBM Quantum** verifiable randomness picks which validator audits which claim — uncolludable
- **Insurance pool** auto-refunds buyers on validation failure
- **ERC-8004** reputation registry — standards-compliant, queryable

> *The product thesis is simple: the AI economy needs a payment rail where model calls, validators, and dependency authors can all be paid below one cent.*

---

## Roadmap

10 toggle-able post-hackathon modules already designed:

Auto-budget caps · Compliance/tax mode · Sponsor SDK demo cards · Public seller profiles · Replay mode · Carbon-aware routing · Quantum validator selection · Agent-to-agent tipping · Multi-language explainers · Onchain insurance feed.

**Long term:** PicoFlow as the **operating system of the agentic economy** — the BGP of pay-per-action.

---

<!-- _class: cover -->

# Thank you.

<div class="tag">PicoFlow — *The Agentic Settlement Mesh on Arc*</div>

| | |
|---|---|
| **Demo**     | https://picoflow.qubitpage.com |
| **GitHub**   | https://github.com/qubitpage/picoflow |
| **Arc Wallet** | https://testnet.arcscan.app/address/0x5257613C0a0b87405d08B21c62Be3F65CbD0a5bF |
| **Contact**  | contact@qubitpage.com |
