/**
 * @picoflow/agent-wallet — buyer-side helper for x402 paid HTTP calls.
 *
 * The agent-wallet is the symmetric counterpart to `@picoflow/x402-facilitator`.
 * Where the facilitator validates inbound 402 challenges and signed payments
 * on the SELLER side, the agent-wallet sits on the BUYER side and:
 *
 *   1. Calls a normal HTTP endpoint
 *   2. If the response is `402 Payment Required`, parses the challenge
 *   3. (Optional) Negotiates a price via `/price_quote` if the seller advertises it
 *   4. Signs an EIP-3009 `transferWithAuthorization` against USDC on Arc
 *   5. Re-issues the request with the signed `X-PAYMENT` header
 *   6. Returns the body, the signed payment, and the parsed settlement proof
 *
 * Design goals:
 *   - Zero seller-specific config — works against any spec-compliant facilitator
 *   - Strict types — no `any`, no synthetic placeholders, no fake hashes
 *   - Real on-chain balance check before signing (refuse if balance < value)
 *   - Predictable error model: every failure raises a typed `AgentWalletError`
 *
 * Settlement is OUT OF SCOPE — the seller is responsible for either submitting
 * the signed authorization to Circle Gateway in a batch, or invoking
 * `transferWithAuthorization` directly. This package only signs.
 */
export * from "./agent-wallet.js";
export * from "./errors.js";
export * from "./types.js";
