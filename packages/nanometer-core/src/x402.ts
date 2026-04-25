/**
 * x402 Payment-Required protocol — server-side challenge + verify.
 *
 * Flow:
 *   1. Client GET /resource → no PAYMENT-SIGNATURE header
 *      → server returns 402 + JSON { price, asset, network, splits, nonce, expiry }
 *   2. Client signs EIP-3009 transferWithAuthorization offchain
 *      → re-requests with header: X-PAYMENT: <base64 JSON of signature + auth>
 *   3. Server verifies signature, optionally batches via Gateway, returns 200 + resource
 *      with header: X-PAYMENT-RESPONSE: <base64 JSON of settlement proof>
 *
 * Spec: https://github.com/coinbase/x402 (HTTP 402 revival, Coinbase + Circle)
 */
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { randomBytes } from "node:crypto";

export interface SplitSpec {
  addr: Address;
  bps: number; // basis points; sum must equal 10000
}

export interface PaymentRequired {
  /** USDC amount in human units, e.g. "0.001" */
  price: string;
  /** USDC contract address on Arc */
  asset: Address;
  /** chainId */
  network: number;
  /** receiver — usually seller's EOA */
  to: Address;
  /** optional: revenue split — sellers can declare OSS/platform splits */
  splits?: SplitSpec[];
  /** anti-replay nonce */
  nonce: Hex;
  /** unix seconds until quote expires */
  validBefore: number;
  /** unix seconds before which auth is invalid */
  validAfter: number;
  /** EIP-712 domain for USDC transferWithAuthorization */
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  /** scheme identifier */
  scheme: "x402-eip3009";
  /** human readable description for wallet UIs */
  description?: string;
}

export interface SignedPayment {
  from: Address;
  to: Address;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: Hex;
  signature: Hex;
}

export interface SettlementProof {
  status: "settled" | "batched" | "failed";
  authorizationId: string;
  /** if batched: gateway settlement id (onchain hash arrives later) */
  gatewaySettlementId?: string;
  /** if settled directly: tx hash */
  txHash?: Hex;
  splits?: { addr: Address; amount: string }[];
  timestamp: number;
}

export interface BuildChallengeOpts {
  price: string;
  asset: Address;
  to: Address;
  network: number;
  splits?: SplitSpec[];
  validityWindowSec?: number;
  description?: string;
  usdcDomainName?: string;
  usdcDomainVersion?: string;
}

/**
 * Build an x402 PAYMENT-REQUIRED challenge.
 */
export function buildChallenge(opts: BuildChallengeOpts): PaymentRequired {
  const now = Math.floor(Date.now() / 1000);
  const window = opts.validityWindowSec ?? 300;
  const nonce = ("0x" + randomBytes(32).toString("hex")) as Hex;
  return {
    price: opts.price,
    asset: opts.asset,
    network: opts.network,
    to: opts.to,
    splits: opts.splits,
    nonce,
    validAfter: now - 5,
    validBefore: now + window,
    scheme: "x402-eip3009",
    description: opts.description,
    domain: {
      name: opts.usdcDomainName ?? "USD Coin",
      version: opts.usdcDomainVersion ?? "2",
      chainId: opts.network,
      verifyingContract: opts.asset,
    },
  };
}

/**
 * EIP-3009 typed-data structure for transferWithAuthorization.
 */
export const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Verify an x402 payment by recovering the EIP-712 signer and matching `from`.
 *
 * Returns the recovered address on success; throws on mismatch / replay / expiry.
 *
 * NOTE: This is offchain verify only. Final settlement (Gateway batch or onchain
 * transferWithAuthorization tx) is the caller's responsibility.
 */
export async function verifyPayment(
  challenge: PaymentRequired,
  signed: SignedPayment,
  /** human-readable price → atomic units; default USDC 6 decimals */
  decimals = 6,
): Promise<Address> {
  const now = Math.floor(Date.now() / 1000);
  if (now < signed.validAfter) throw new Error("x402: auth not yet valid");
  if (now > signed.validBefore) throw new Error("x402: auth expired");
  if (signed.nonce !== challenge.nonce) throw new Error("x402: nonce mismatch");
  if (signed.to.toLowerCase() !== challenge.to.toLowerCase())
    throw new Error("x402: payee mismatch");

  const expectedAtomic = priceToAtomic(challenge.price, decimals);
  if (BigInt(signed.value) !== expectedAtomic)
    throw new Error(`x402: value mismatch — expected ${expectedAtomic}, got ${signed.value}`);

  const recovered = await recoverTypedDataAddress({
    domain: challenge.domain,
    types: TRANSFER_WITH_AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: signed.from,
      to: signed.to,
      value: BigInt(signed.value),
      validAfter: BigInt(signed.validAfter),
      validBefore: BigInt(signed.validBefore),
      nonce: signed.nonce,
    },
    signature: signed.signature,
  });
  if (recovered.toLowerCase() !== signed.from.toLowerCase())
    throw new Error(`x402: recovered ${recovered} != claimed ${signed.from}`);
  return recovered;
}

/**
 * Compute split amounts in atomic USDC units. Validates basis points sum to 10000.
 */
export function computeSplits(
  totalAtomic: bigint,
  splits: SplitSpec[],
): { addr: Address; amount: string }[] {
  const total = splits.reduce((s, x) => s + x.bps, 0);
  if (total !== 10_000) throw new Error(`splits must sum to 10000 bps, got ${total}`);
  let dust = totalAtomic;
  const out = splits.map((s, i) => {
    if (i === splits.length - 1) {
      const amt = dust;
      return { addr: s.addr, amount: amt.toString() };
    }
    const amt = (totalAtomic * BigInt(s.bps)) / 10_000n;
    dust -= amt;
    return { addr: s.addr, amount: amt.toString() };
  });
  return out;
}

/**
 * Convert "0.005" → 5000n (USDC, 6 decimals).
 */
export function priceToAtomic(price: string, decimals = 6): bigint {
  const [whole, frac = ""] = price.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + padded);
}

/** Convert 5000n → "0.005" */
export function atomicToPrice(atomic: bigint, decimals = 6): string {
  const s = atomic.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** Encode payment header value (base64 JSON). */
export function encodePaymentHeader(signed: SignedPayment): string {
  return Buffer.from(JSON.stringify(signed)).toString("base64");
}

/** Decode payment header value. */
export function decodePaymentHeader(header: string): SignedPayment {
  return JSON.parse(Buffer.from(header, "base64").toString("utf-8")) as SignedPayment;
}

/** Encode response header (settlement proof). */
export function encodeResponseHeader(proof: SettlementProof): string {
  return Buffer.from(JSON.stringify(proof)).toString("base64");
}

/** Decode response header. */
export function decodeResponseHeader(header: string): SettlementProof {
  return JSON.parse(Buffer.from(header, "base64").toString("utf-8")) as SettlementProof;
}
