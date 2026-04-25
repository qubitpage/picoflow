/**
 * @picoflow/x402-facilitator — open-source reference TypeScript facilitator
 * for the x402 HTTP payment-required protocol on Circle Arc.
 *
 * This package exists because, at the time of writing, Circle has not shipped
 * an official `@circle/x402-facilitator` SDK. We extracted PicoFlow's verifier
 * into a clean, framework-agnostic module so any builder can:
 *
 *   1. Build a spec-compliant 402 challenge body
 *   2. Validate inbound challenges and signed payments against published JSON Schemas
 *   3. Recover the EIP-3009 signer for transferWithAuthorization
 *   4. Negotiate a price via the optional /price_quote handshake
 *   5. Plug into Express via the thin adapter under "@picoflow/x402-facilitator/express"
 *
 * Settlement is deliberately OUT OF SCOPE for this package — the facilitator's job
 * ends at verification. The caller is responsible for either submitting the signed
 * authorization to Circle Gateway in a batch, or invoking transferWithAuthorization
 * directly on the asset contract.
 */
export * from "./types.js";
export * from "./challenge.js";
export * from "./verify.js";
export * from "./quote.js";
export * from "./schema.js";
export * from "./constants.js";
