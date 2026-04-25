import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  buildChallenge,
  isValidChallenge,
  assertValidChallenge,
  priceToAtomic,
  encodePaymentHeader,
  decodePaymentHeader,
} from "../challenge.js";
import { verifyPayment, assertValidSignedPayment } from "../verify.js";
import { QuoteEngine } from "../quote.js";
import { ARC_TESTNET, TRANSFER_WITH_AUTH_TYPES } from "../constants.js";
import type { Address, Hex } from "viem";

// Checksummed (mixed-case) per EIP-55 — viem rejects non-checksum addresses.
const SELLER = "0x000000000000000000000000000000000000dEaD" as Address;

test("buildChallenge produces a body that passes its own JSON Schema", () => {
  const c = buildChallenge({
    price: "0.001",
    asset: ARC_TESTNET.usdc,
    to: SELLER,
    network: ARC_TESTNET.chainId,
    description: "test resource",
  });
  assert.equal(c.scheme, "x402-eip3009");
  assert.equal(c.network, ARC_TESTNET.chainId);
  assert.match(c.nonce, /^0x[0-9a-f]{64}$/);
  assert.ok(isValidChallenge(c));
});

test("isValidChallenge rejects malformed bodies", () => {
  assert.equal(isValidChallenge({ scheme: "wrong" }), false);
  assert.equal(isValidChallenge({}), false);
  assert.equal(isValidChallenge(null), false);
});

test("priceToAtomic respects USDC 6 decimals", () => {
  assert.equal(priceToAtomic("0.001"), 1000n);
  assert.equal(priceToAtomic("1"), 1_000_000n);
  assert.equal(priceToAtomic("0.000001"), 1n);
});

test("verifyPayment recovers correct signer for a real EIP-712 signature", async () => {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);

  const challenge = buildChallenge({
    price: "0.005",
    asset: ARC_TESTNET.usdc,
    to: SELLER,
    network: ARC_TESTNET.chainId,
  });

  const value = priceToAtomic(challenge.price);
  const signature = (await account.signTypedData({
    domain: challenge.domain,
    types: TRANSFER_WITH_AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: SELLER,
      value,
      validAfter: BigInt(challenge.validAfter),
      validBefore: BigInt(challenge.validBefore),
      nonce: challenge.nonce,
    },
  })) as Hex;

  const signed = {
    from: account.address,
    to: SELLER,
    value: value.toString(),
    validAfter: challenge.validAfter,
    validBefore: challenge.validBefore,
    nonce: challenge.nonce,
    signature,
  };

  // Round-trip header encode/decode.
  const header = encodePaymentHeader(signed);
  const decoded = decodePaymentHeader(header);
  assertValidSignedPayment(decoded);

  const recovered = await verifyPayment(challenge, decoded);
  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
});

test("verifyPayment rejects nonce mismatch", async () => {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const challenge = buildChallenge({
    price: "0.001",
    asset: ARC_TESTNET.usdc,
    to: SELLER,
    network: ARC_TESTNET.chainId,
  });
  const value = priceToAtomic(challenge.price);
  const signature = (await account.signTypedData({
    domain: challenge.domain,
    types: TRANSFER_WITH_AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: SELLER,
      value,
      validAfter: BigInt(challenge.validAfter),
      validBefore: BigInt(challenge.validBefore),
      nonce: ("0x" + "11".repeat(32)) as Hex,
    },
  })) as Hex;

  const signed = {
    from: account.address,
    to: SELLER,
    value: value.toString(),
    validAfter: challenge.validAfter,
    validBefore: challenge.validBefore,
    nonce: ("0x" + "11".repeat(32)) as Hex,
    signature,
  };

  await assert.rejects(verifyPayment(challenge, signed), /nonce mismatch/);
});

test("verifyPayment honors isNonceFresh callback", async () => {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const challenge = buildChallenge({
    price: "0.001",
    asset: ARC_TESTNET.usdc,
    to: SELLER,
    network: ARC_TESTNET.chainId,
  });
  const value = priceToAtomic(challenge.price);
  const signature = (await account.signTypedData({
    domain: challenge.domain,
    types: TRANSFER_WITH_AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: SELLER,
      value,
      validAfter: BigInt(challenge.validAfter),
      validBefore: BigInt(challenge.validBefore),
      nonce: challenge.nonce,
    },
  })) as Hex;
  const signed = {
    from: account.address,
    to: SELLER,
    value: value.toString(),
    validAfter: challenge.validAfter,
    validBefore: challenge.validBefore,
    nonce: challenge.nonce,
    signature,
  };
  await assert.rejects(
    verifyPayment(challenge, signed, { isNonceFresh: () => false }),
    /replay/,
  );
});

test("QuoteEngine applies volume discounts and floor", () => {
  const eng = new QuoteEngine({
    asset: ARC_TESTNET.usdc,
    network: ARC_TESTNET.chainId,
    to: SELLER,
    basePrice: "0.01",
    volumeTiers: [
      { minVolume: 100, discountBps: 1000 }, // 10% off at 100+
      { minVolume: 1000, discountBps: 2500 }, // 25% off at 1000+
    ],
    floorPrice: "0.005",
  });
  const q1 = eng.quote({ resource: "/api/x", volume: 10 });
  assert.equal(q1.price, "0.01");
  const q2 = eng.quote({ resource: "/api/x", volume: 200 });
  assert.equal(q2.price, "0.009");
  const q3 = eng.quote({ resource: "/api/x", volume: 5000 });
  assert.equal(q3.price, "0.0075");

  // Floor enforcement.
  const eng2 = new QuoteEngine({
    asset: ARC_TESTNET.usdc,
    network: ARC_TESTNET.chainId,
    to: SELLER,
    basePrice: "0.01",
    volumeTiers: [{ minVolume: 1, discountBps: 9999 }],
    floorPrice: "0.001",
  });
  const q4 = eng2.quote({ resource: "/api/x", volume: 1 });
  assert.equal(q4.price, "0.001");

  // Issued quote can be looked up.
  const got = eng2.consume(q4.quote_id);
  assert.equal(got?.price, "0.001");
});
