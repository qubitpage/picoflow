import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";
import AjvImport from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { paymentRequiredSchema } from "./schema.js";
import { DEFAULT_QUOTE_WINDOW_SEC } from "./constants.js";
import type { PaymentRequired, SplitSpec } from "./types.js";

// AJV ships as both ESM-default and CJS — handle both shapes.
const Ajv2020 = ((AjvImport as unknown as { default?: unknown }).default ?? AjvImport) as new (
  opts?: Record<string, unknown>,
) => { compile: (schema: unknown) => ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] } };
const addFormats = ((addFormatsImport as unknown as { default?: unknown }).default ??
  addFormatsImport) as (ajv: unknown) => void;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(paymentRequiredSchema);

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
  /** If issued via /price_quote negotiation, echo the quote_id back into the challenge. */
  quote_id?: string;
  /** Optional server correlation id. */
  action_id?: string;
}

/** Build a spec-compliant PaymentRequired body. Validates the result against the JSON Schema. */
export function buildChallenge(opts: BuildChallengeOpts): PaymentRequired {
  if (opts.splits && opts.splits.length > 0) {
    const total = opts.splits.reduce((s, x) => s + x.bps, 0);
    if (total !== 10_000) {
      throw new Error(`x402-facilitator: splits must sum to 10000 bps, got ${total}`);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const window = opts.validityWindowSec ?? DEFAULT_QUOTE_WINDOW_SEC;
  const nonce = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const challenge: PaymentRequired = {
    scheme: "x402-eip3009",
    price: opts.price,
    asset: opts.asset,
    network: opts.network,
    to: opts.to,
    splits: opts.splits,
    nonce,
    validAfter: now - 5,
    validBefore: now + window,
    domain: {
      name: opts.usdcDomainName ?? "USD Coin",
      version: opts.usdcDomainVersion ?? "2",
      chainId: opts.network,
      verifyingContract: opts.asset,
    },
    description: opts.description,
    quote_id: opts.quote_id,
    action_id: opts.action_id,
  };
  // Strip undefined for clean schema validation.
  const cleaned = JSON.parse(JSON.stringify(challenge)) as PaymentRequired;
  if (!validateSchema(cleaned)) {
    const msg = validateSchema.errors
      ?.map((e: { instancePath: string; message?: string }) => `${e.instancePath} ${e.message}`)
      .join("; ");
    throw new Error(`x402-facilitator: built challenge fails its own schema: ${msg}`);
  }
  return cleaned;
}

/** Validate an arbitrary inbound 402 body. Throws with the AJV errors on failure. */
export function assertValidChallenge(body: unknown): asserts body is PaymentRequired {
  if (!validateSchema(body)) {
    const msg = validateSchema.errors
      ?.map((e: { instancePath: string; message?: string }) => `${e.instancePath} ${e.message}`)
      .join("; ");
    throw new Error(`x402-facilitator: invalid PaymentRequired body: ${msg}`);
  }
}

/** Boolean form for buyer libraries that prefer not to throw. */
export function isValidChallenge(body: unknown): body is PaymentRequired {
  return validateSchema(body) === true;
}

/** Compute split amounts in atomic units. The last recipient absorbs rounding dust. */
export function computeSplits(
  totalAtomic: bigint,
  splits: SplitSpec[],
): { addr: Address; amount: string }[] {
  const total = splits.reduce((s, x) => s + x.bps, 0);
  if (total !== 10_000) throw new Error(`x402-facilitator: splits must sum to 10000 bps, got ${total}`);
  let dust = totalAtomic;
  return splits.map((s, i) => {
    if (i === splits.length - 1) return { addr: s.addr, amount: dust.toString() };
    const amt = (totalAtomic * BigInt(s.bps)) / 10_000n;
    dust -= amt;
    return { addr: s.addr, amount: amt.toString() };
  });
}

/** Convert "0.005" → 5000n (USDC, 6 decimals by default). */
export function priceToAtomic(price: string, decimals = 6): bigint {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(price)) {
    throw new Error(`x402-facilitator: invalid price "${price}"`);
  }
  const [whole, frac = ""] = price.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + padded);
}

/** Convert 5000n → "0.005". */
export function atomicToPrice(atomic: bigint, decimals = 6): string {
  const s = atomic.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** Encode a base64 X-PAYMENT header from a SignedPayment. */
export function encodePaymentHeader(signed: unknown): string {
  return Buffer.from(JSON.stringify(signed)).toString("base64");
}

/** Decode a base64 X-PAYMENT header. Caller should pass the result through `assertValidSignedPayment`. */
export function decodePaymentHeader(header: string): unknown {
  return JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
}
