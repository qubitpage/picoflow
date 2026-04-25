# PicoFlow — Circle Product Feedback (paste-ready for lablab.ai form)

## Products Used

We used the following Circle products directly in PicoFlow:

- **Arc Testnet** — the Arc-specific settlement rehearsal network for PicoFlow. We deployed and verified the ProofMesh Vyper contracts on Arc Testnet and used it to test the USDC-gas/product path that will move to Arc Mainnet when Circle publishes it.
- **USDC on Arc** — the unit of account for paid API actions, route prices, settlement math, and ProofMesh bond accounting.
- **Circle Nanopayments / x402-style HTTP payment flow** — the core request pattern for paid endpoints: a buyer calls an API, receives a 402 payment challenge, signs an authorization, and retries with a payment header.
- **Circle Gateway batch-settlement model** — the settlement pattern PicoFlow is built around: many sub-cent API calls are recorded individually but settled economically as batches.

We evaluated Circle Wallets and CCTP/Bridge Kit as future integration paths, but they are not part of the final claimed live product path in this submission. Arbitrum One is used only as an external real-funds mainnet proof while Arc Mainnet is not public yet; it is not listed as a Circle product.

## Use Case

PicoFlow is a metered payment layer for AI and data APIs. A customer or autonomous agent can call `/api/aisa/data`, `/api/featherless/infer`, `/api/aimlapi/infer`, or `/api/validator/check`, pay only for that action, and get a ledger record with route, price, provider source, split, and settlement state.

We chose Arc, USDC, Nanopayments/x402, and Gateway because ordinary card processing cannot support this price level. A $0.001 or $0.005 API call is destroyed by fixed card fees. Direct per-call onchain settlement is also too expensive when every call becomes its own transaction. PicoFlow uses x402-style authorization plus Gateway-style batching so each call remains individually auditable while settlement cost is amortized across many calls.

The product goal is simple: let AI agents buy useful work from other APIs without subscriptions, prepaid credit cards, or manual invoices.

## Successes

- **Arc Testnet was straightforward to integrate.** Standard EVM tooling worked, and the chain model made it easy to keep the product denominated in USDC.
- **USDC as the native economic unit simplified the product.** Prices, balances, bonds, splits, margin, and settlement reporting all use the same asset instead of forcing developers to explain a second gas token.
- **The x402 challenge/retry pattern maps naturally to HTTP APIs.** It is easy to explain to developers: request, receive price, sign, retry, receive the paid response.
- **Gateway-style batching fits nanopayment economics.** PicoFlow can preserve per-action provenance in the ledger while avoiding one onchain transfer per tiny API call.
- **Explorer proof is clear on Arc Testnet.** Contract addresses and faucet transactions are easy to link in the dashboard and documentation.
- **The product primitives compose well.** Arc provides the payment network, USDC provides the unit of account, x402 provides the HTTP payment handshake, and Gateway provides the path to scalable settlement.

## Challenges

- **Arc Mainnet is not public yet.** We had to be careful not to overclaim. PicoFlow uses Arc Testnet for sponsor-native proof and Arbitrum One only as an external real-funds fallback proof until Arc Mainnet is available.
- **End-to-end examples are still too scattered.** A builder has to connect Arc chain config, USDC addresses, x402 challenge shape, EIP-3009 signing, Gateway batching, and ledger reconciliation from multiple sources.
- **Gateway batch lifecycle needs clearer developer visibility.** For production dashboards, developers need a clean way to distinguish signed payment intent, accepted batch item, submitted settlement, confirmed settlement, and failed/refunded settlement.
- **x402 response schemas need stricter standardization.** A canonical JSON Schema for 402 challenges and payment responses would reduce buyer/seller incompatibility.
- **Error responses should be more machine-readable.** Gateway/x402 integrations need stable error codes for retry, refund, insufficient balance, expired authorization, invalid nonce, unsupported network, and settlement failure.
- **Faucet capacity matters during hackathons.** Arc Testnet faucet worked, but high-volume demo/testing flows can hit limits quickly when teams run repeated deployments and CI-style tests.
- **Agent-wallet guidance is still early.** The most relevant pattern for this hackathon is not a human clicking a wallet; it is a server-side agent signing bounded authorizations safely.

## Recommendations

1. **Ship an official Nanopayments-on-Arc starter kit.** It should include an Express/Fastify paid API, a buyer client, x402 verification, EIP-3009 signing, Gateway-style batching, and a small dashboard showing actions, payments, settlements, and splits.
2. **Publish canonical x402 JSON Schemas.** Standard schemas for the 402 challenge, signed retry, payment response, and error body would make independent buyer/seller implementations safer.
3. **Add machine-readable error codes.** Every Gateway/x402 failure should include a stable `code`, human `message`, and optional `retry_after`/`details` field.
4. **Document the full settlement state machine.** Builders need explicit guidance for `payment_required -> signed -> verified -> queued -> submitted -> settled/failed/refunded`.
5. **Provide a Gateway fee preview calculator.** Given batch size, network, asset, and average payment amount, return estimated cost and finality so teams can price sub-cent APIs correctly.
6. **Create an agent-wallet quick start.** Show a server-side or programmable wallet signing EIP-3009/x402 authorizations with limits, expiration, nonce tracking, and safe key storage.
7. **Offer higher faucet limits for verified hackathon teams.** A temporary higher quota or team faucet would reduce friction during demos and repeated contract deployments.
8. **Publish a provider-cost telemetry pattern.** A recommended schema for action revenue, upstream cost, settlement cost, and split accounting would help teams prove margins honestly.

## Net Feedback

Arc + USDC + Nanopayments/x402 + Gateway is the right product direction for agentic commerce. The primitives make sub-cent API calls economically plausible, and the mental model is strong once the pieces are connected. The biggest improvement would be a single end-to-end reference implementation with clear schemas, error codes, and settlement-state guidance so teams can build production-grade nanopayment APIs without reinventing the glue.
