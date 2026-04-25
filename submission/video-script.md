# PicoFlow — submission video script (≤ 3 min)

> Live URL: https://picoflow.qubitpage.com · Arc faucet tx: https://testnet.arcscan.app/tx/0xba0307bba4d9f330d3b6c1b4579686a9e6048cf18bf272ba1e6db037ec373315

## 0:00 – 0:15  Hook
> "Today, billing one LLM call costs more than the call itself. Stripe charges 30 cents on a half-cent inference. PicoFlow fixes that with Arc + Circle Nanopayments — and we proved it live with 80 onchain transactions for 19 cents total."

[ Open https://picoflow.qubitpage.com — show landing page ]

## 0:15 – 0:45  The problem & the insight
> "Per-action AI billing is broken because every traditional rail has a fixed fee that swamps the call price. Arc fixes this: USDC is gas, settlement is sub-cent, and Circle Gateway lets us batch authorizations without a custodian. PicoFlow turns any HTTP API into a paid endpoint over x402 + EIP-3009."

[ Cut to architecture slide ]

## 0:45 – 1:30  Live demo (the money shot)
> "Watch the buyer agent settle 56 paid actions in real time."

1. Click https://picoflow.qubitpage.com/demo → press **Run**.
2. Pan to log: actions stream by, all status `ok`. Final report: `{ok: 56, fail: 0, spent_usdc: "0.190000"}`.
3. Open https://picoflow.qubitpage.com/splits → grand total grows live; recipients fill 80/10/10.
4. Open https://picoflow.qubitpage.com/providers → Featherless + AI/ML API rows show `featherless-real` and `aimlapi-real` source, sample reply "PONG", latency in ms.
5. Open https://testnet.arcscan.app, paste faucet tx `0xba0307bba4d9f330d3b6c1b4579686a9e6048cf18bf272ba1e6db037ec373315` → confirmed on Arc Testnet.

## 1:30 – 2:00  Track + margin
[ Open https://picoflow.qubitpage.com/track ]
> "We compete primarily in Per-API Monetization and Agent-to-Agent Loop, with secondary fits in the other two. Every requirement on this page is checked: Arc, USDC, x402, Gateway batching, ≤ $0.01 floor, 50+ onchain tx."

[ Open https://picoflow.qubitpage.com/margin ]
> "Card rails would charge $0.30 per call. PicoFlow on Arc with Gateway batching costs about $0.0009. That's a $0.299 saving on every single call."

## 2:00 – 2:30  Featherless + AI/ML
> "Featherless gives us a wide open-model catalog, and AI/ML API gives us OpenAI, Gemini and Claude behind one billing surface. The credits we received cover every real inference behind every demo run — and you can see them respond live on the Providers page."

## 2:30 – 2:50  Circle Product Feedback
> "We opted into the Product Feedback Incentive and submitted the full feedback in the lablab.ai form: what worked, what to improve, and concrete recommendations for production-grade nanopayment APIs."

## 2:50 – 3:00  Close
> "PicoFlow proves the agentic economy works at sub-cent prices today. The repo, the live demo, the explorer txs, and the feedback are all linked from the README. Thank you."

[ Show GitHub URL + https://picoflow.qubitpage.com on screen ]
