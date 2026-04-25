import type { NextFunction, Request, Response, RequestHandler } from "express";
import type { Address } from "viem";
import {
  buildChallenge,
  decodePaymentHeader,
  computeSplits,
  priceToAtomic,
} from "../challenge.js";
import {
  verifyPayment,
  encodeSettlementResponseHeader,
  type VerifyOptions,
} from "../verify.js";
import type { PaymentRequired, SettlementProof, SplitSpec } from "../types.js";

export interface FacilitatorMiddlewareConfig {
  price: string;
  asset: Address;
  to: Address;
  network: number;
  splits?: SplitSpec[];
  validityWindowSec?: number;
  description?: string;

  /** Replay-defense store. REQUIRED in production. */
  isNonceFresh?: VerifyOptions["isNonceFresh"];

  /**
   * Settlement callback. The facilitator does not settle on-chain itself.
   * If omitted, the response header is marked status:"pending" and your worker
   * is expected to drain the SignedPayment from your own queue/DB.
   *
   * Returning a SettlementProof allows the middleware to attach the real proof
   * (txHash or gatewaySettlementId) inline.
   */
  onVerified?: (ctx: {
    challenge: PaymentRequired;
    signed: ReturnType<typeof decodePaymentHeader>;
    buyer: Address;
    actionId: string;
    req: Request;
  }) => Promise<SettlementProof | void> | SettlementProof | void;
}

/**
 * Express middleware that exposes a route as an x402 paid resource.
 *
 * No mock fallbacks. No `trustless` flag. If `onVerified` returns nothing,
 * the response header advertises `status:"pending"` so buyers know that
 * the seller has accepted the authorization but settlement is asynchronous.
 */
export function facilitator(cfg: FacilitatorMiddlewareConfig): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const headerVal = req.header("x-payment");
    const actionId = req.header("x-picoflow-action-id") ?? cryptoRandomId();

    if (!headerVal) {
      const challenge = buildChallenge({
        price: cfg.price,
        asset: cfg.asset,
        to: cfg.to,
        network: cfg.network,
        splits: cfg.splits,
        validityWindowSec: cfg.validityWindowSec,
        description: cfg.description,
        action_id: actionId,
      });
      res.status(402).json(challenge);
      return;
    }

    let challenge: PaymentRequired;
    let signed: ReturnType<typeof decodePaymentHeader>;
    let buyer: Address;
    try {
      signed = decodePaymentHeader(headerVal);
      challenge = buildChallenge({
        price: cfg.price,
        asset: cfg.asset,
        to: cfg.to,
        network: cfg.network,
        splits: cfg.splits,
        action_id: actionId,
      });
      // Reconstruct challenge using buyer-provided nonce/window so verification can run.
      const sg = signed as { nonce: string; validAfter: number; validBefore: number };
      challenge.nonce = sg.nonce as `0x${string}`;
      challenge.validAfter = sg.validAfter;
      challenge.validBefore = sg.validBefore;
      buyer = await verifyPayment(challenge, signed, { isNonceFresh: cfg.isNonceFresh });
    } catch (err) {
      res.status(402).json({ error: "invalid x402 payment", reason: (err as Error).message });
      return;
    }

    let proof: SettlementProof | void;
    try {
      proof = cfg.onVerified
        ? await cfg.onVerified({ challenge, signed, buyer, actionId, req })
        : undefined;
    } catch (err) {
      res
        .status(402)
        .json({ error: "settlement callback failed", reason: (err as Error).message });
      return;
    }

    const sg = signed as { nonce: string };
    const finalProof: SettlementProof = proof ?? {
      status: "pending",
      authorizationId: sg.nonce,
      timestamp: Date.now(),
      splits: cfg.splits ? computeSplits(priceToAtomic(cfg.price), cfg.splits) : undefined,
    };
    res.setHeader("X-PAYMENT-RESPONSE", encodeSettlementResponseHeader(finalProof));

    (req as Request & { picoflow?: unknown }).picoflow = {
      action_id: actionId,
      buyer_addr: buyer,
      price_usdc: cfg.price,
    };

    next();
  };
}

function cryptoRandomId(): string {
  // 16 random hex chars — sufficient for correlation, not security-critical.
  const arr = new Uint8Array(8);
  // node:crypto via globalThis to avoid pulling node imports in dual-runtime adapters.
  (globalThis.crypto as Crypto).getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
