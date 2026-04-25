import type { Address, Hex } from "viem";

export interface SplitSpec {
  addr: Address;
  /** Basis points (1/10000). Sum across all splits MUST equal 10000. */
  bps: number;
}

export interface PaymentRequired {
  scheme: "x402-eip3009";
  price: string;
  asset: Address;
  network: number;
  to: Address;
  splits?: SplitSpec[];
  nonce: Hex;
  validAfter: number;
  validBefore: number;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  description?: string;
  action_id?: string;
  quote_id?: string;
}

export interface SignedPayment {
  from: Address;
  to: Address;
  /** Atomic units as decimal string (e.g. USDC has 6 decimals → "1000" = 0.001 USDC). */
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: Hex;
  signature: Hex;
}

export interface SettlementProof {
  status: "settled" | "batched" | "failed" | "pending";
  authorizationId: string;
  /** Set when settled via Circle Gateway batch — references the real Gateway settlement record. */
  gatewaySettlementId?: string;
  /** Set when settled directly via on-chain transferWithAuthorization. */
  txHash?: Hex;
  splits?: { addr: Address; amount: string }[];
  timestamp: number;
}

export interface PriceQuote {
  /** Server-issued quote id; must be echoed back in the eventual 402 challenge. */
  quote_id: string;
  /** Negotiated price in display units. */
  price: string;
  asset: Address;
  network: number;
  to: Address;
  splits?: SplitSpec[];
  /** Quote expiry — buyer must sign before this. */
  expires_at: number;
  /** Optional human-readable rationale ("bulk discount applied", "surge pricing", ...). */
  rationale?: string;
}

export interface BuyerQuoteRequest {
  /** Resource the buyer wants to access. */
  resource: string;
  /** Buyer-proposed price in display units (server may accept, counter, or reject). */
  proposed_price?: string;
  /** Optional volume hint (number of calls, batch size). */
  volume?: number;
  /** Optional buyer reputation handle / address for tier pricing. */
  buyer?: Address;
}
