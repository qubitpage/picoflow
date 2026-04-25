import { recoverTypedDataAddress, type Address } from "viem";
import AjvImport from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { signedPaymentSchema } from "./schema.js";
import { TRANSFER_WITH_AUTH_TYPES, USDC_DECIMALS } from "./constants.js";
import { priceToAtomic } from "./challenge.js";
import type { PaymentRequired, SignedPayment, SettlementProof } from "./types.js";

const Ajv2020 = ((AjvImport as unknown as { default?: unknown }).default ?? AjvImport) as new (
  opts?: Record<string, unknown>,
) => { compile: (schema: unknown) => ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] } };
const addFormats = ((addFormatsImport as unknown as { default?: unknown }).default ??
  addFormatsImport) as (ajv: unknown) => void;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSigned = ajv.compile(signedPaymentSchema);

export function assertValidSignedPayment(body: unknown): asserts body is SignedPayment {
  if (!validateSigned(body)) {
    const msg = validateSigned.errors
      ?.map((e: { instancePath: string; message?: string }) => `${e.instancePath} ${e.message}`)
      .join("; ");
    throw new Error(`x402-facilitator: invalid SignedPayment body: ${msg}`);
  }
}

export interface VerifyOptions {
  /** Asset decimals — defaults to USDC's 6. */
  decimals?: number;
  /**
   * Optional callback to enforce nonce uniqueness (replay defense across requests).
   * MUST throw or return false on a previously-seen nonce. The facilitator package
   * does NOT persist nonces — that is the caller's responsibility.
   */
  isNonceFresh?: (nonce: string) => Promise<boolean> | boolean;
}

/**
 * Verify a buyer-signed x402 payment against the issued challenge.
 *
 * Performs:
 *   1. Schema validation of the SignedPayment body.
 *   2. Time-window enforcement (validAfter / validBefore).
 *   3. Nonce match against the original challenge.
 *   4. Payee address match.
 *   5. Value match against challenge.price.
 *   6. Optional caller-supplied replay-nonce uniqueness check.
 *   7. EIP-712 typed-data signature recovery against the EIP-3009 TransferWithAuthorization struct.
 *
 * Returns the recovered signer address. Throws on any failure.
 *
 * NOTE: There is intentionally NO `trustless` / "skip verification" flag.
 * Skipping verification turns x402 into "free money mode" and is unsafe in any
 * environment that touches mainnet keys, real USDC, or production settlement.
 */
export async function verifyPayment(
  challenge: PaymentRequired,
  signed: unknown,
  opts: VerifyOptions = {},
): Promise<Address> {
  assertValidSignedPayment(signed);
  const decimals = opts.decimals ?? USDC_DECIMALS;
  const now = Math.floor(Date.now() / 1000);
  if (now < signed.validAfter) throw new Error("x402: auth not yet valid");
  if (now > signed.validBefore) throw new Error("x402: auth expired");
  if (signed.nonce !== challenge.nonce) throw new Error("x402: nonce mismatch");
  if (signed.to.toLowerCase() !== challenge.to.toLowerCase()) {
    throw new Error("x402: payee mismatch");
  }
  const expectedAtomic = priceToAtomic(challenge.price, decimals);
  if (BigInt(signed.value) !== expectedAtomic) {
    throw new Error(`x402: value mismatch — expected ${expectedAtomic}, got ${signed.value}`);
  }
  if (opts.isNonceFresh) {
    const fresh = await opts.isNonceFresh(signed.nonce);
    if (!fresh) throw new Error("x402: nonce already seen (replay)");
  }
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
  if (recovered.toLowerCase() !== signed.from.toLowerCase()) {
    throw new Error(`x402: recovered ${recovered} != claimed ${signed.from}`);
  }
  return recovered;
}

export function encodeSettlementResponseHeader(proof: SettlementProof): string {
  return Buffer.from(JSON.stringify(proof)).toString("base64");
}

export function decodeSettlementResponseHeader(header: string): SettlementProof {
  return JSON.parse(Buffer.from(header, "base64").toString("utf-8")) as SettlementProof;
}
