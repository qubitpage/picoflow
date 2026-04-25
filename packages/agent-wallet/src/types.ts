import type { Address, Hex, PublicClient } from "viem";
import type { PaymentRequired, PriceQuote, SettlementProof, SignedPayment } from "@picoflow/x402-facilitator";

export interface AgentWalletOpts {
  /** EOA private key — required to sign EIP-3009 transfers. */
  privateKey: Hex;
  /** USDC asset address. Defaults to Arc Testnet USDC (`0x36...0000`). */
  asset?: Address;
  /** Chain id — defaults to Arc Testnet (5042002). */
  chainId?: number;
  /** RPC URL for balance checks. Required if balance pre-check is enabled. */
  rpcUrl?: string;
  /** USDC decimals — always 6 on Circle deployments. */
  decimals?: number;
  /** If true, query on-chain USDC balance before signing and refuse if too low. */
  checkBalance?: boolean;
  /** Optional fetch override — useful for tests or instrumented transports. */
  fetcher?: typeof fetch;
  /** If true, log negotiation steps to console. */
  verbose?: boolean;
  /** Pre-built viem PublicClient — overrides rpcUrl/chainId. */
  publicClient?: PublicClient;
}

export interface QuoteRequestInput {
  /** Resource path the buyer wants to access (echoed in the quote). */
  resource: string;
  /** Optional buyer-proposed price in display units. */
  proposed_price?: string;
  /** Optional volume hint (number of intended calls). */
  volume?: number;
  /** Optional buyer reputation handle / address. */
  buyer?: Address;
}

export interface PaidCallResult<T = unknown> {
  /** Final HTTP status (typically 200). */
  status: number;
  /** Response body decoded as JSON when content-type allows, else as text. */
  data: T;
  /** The signed payment that was sent in `X-PAYMENT` (if any). */
  payment?: SignedPayment;
  /** The original 402 challenge (if any). */
  challenge?: PaymentRequired;
  /** Decoded settlement proof from `X-PAYMENT-RESPONSE` (if seller returned one). */
  settlement?: SettlementProof;
  /** Optional negotiated quote consumed by this call. */
  quote?: PriceQuote;
  /** Wall-clock latency including the full negotiation. */
  totalLatencyMs: number;
}
