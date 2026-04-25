import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  buildChallenge,
  decodePaymentHeader,
  type PaymentRequired,
  type SignedPayment,
} from "@picoflow/x402-facilitator";
import { AgentWallet, AgentWalletError } from "../index.js";

const TEST_TO = "0x000000000000000000000000000000000000abcd" as const;

function makeChallenge(price = "0.001"): PaymentRequired {
  return buildChallenge({
    price,
    to: TEST_TO,
    asset: "0x3600000000000000000000000000000000000000",
    network: 5_042_002,
    description: "test",
  });
}

describe("AgentWallet", () => {
  it("throws when no private key is supplied", () => {
    assert.throws(
      () => new AgentWallet({ privateKey: undefined as unknown as `0x${string}` }),
      (err: unknown) => err instanceof AgentWalletError && err.code === "MISSING_PRIVATE_KEY",
    );
  });

  it("derives the correct address from the private key", () => {
    const pk = generatePrivateKey();
    const expected = privateKeyToAccount(pk).address;
    const w = new AgentWallet({ privateKey: pk });
    assert.equal(w.address, expected);
  });

  it("signs an EIP-3009 challenge with the buyer's address", async () => {
    const pk = generatePrivateKey();
    const w = new AgentWallet({ privateKey: pk });
    const challenge = makeChallenge();
    const signed = await w.sign(challenge);
    assert.equal(signed.from.toLowerCase(), w.address.toLowerCase());
    assert.equal(signed.to, TEST_TO);
    assert.equal(signed.value, "1000"); // 0.001 USDC = 1000 atomic
    assert.match(signed.signature, /^0x[0-9a-f]{130}$/i);
  });

  it("paidCall short-circuits when the first response is not 402", async () => {
    const pk = generatePrivateKey();
    let calls = 0;
    const stub: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const w = new AgentWallet({ privateKey: pk, fetcher: stub });
    const r = await w.paidCall("https://example/api/free");
    assert.equal(calls, 1);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true });
    assert.equal(r.payment, undefined);
  });

  it("paidCall negotiates 402 → signs → retries with X-PAYMENT", async () => {
    const pk = generatePrivateKey();
    const challenge = makeChallenge("0.005");
    let observedHeader: string | null = null;
    const stub: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      const xpay = headers.get("x-payment");
      if (!xpay) {
        return new Response(JSON.stringify(challenge), {
          status: 402,
          headers: { "content-type": "application/json" },
        });
      }
      observedHeader = xpay;
      const decoded = decodePaymentHeader(xpay) as SignedPayment;
      return new Response(JSON.stringify({ ok: true, echoed: decoded.from }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const w = new AgentWallet({ privateKey: pk, fetcher: stub });
    const r = await w.paidCall<{ ok: boolean; echoed: string }>("https://example/api/paid");
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.equal(r.data.echoed.toLowerCase(), w.address.toLowerCase());
    assert.ok(observedHeader, "X-PAYMENT header must have been sent");
    assert.equal(r.payment?.value, "5000");
  });

  it("paidCall throws PAYMENT_RETRY_FAILED if seller still returns 402 after signed retry", async () => {
    const pk = generatePrivateKey();
    const challenge = makeChallenge();
    const stub: typeof fetch = async () =>
      new Response(JSON.stringify(challenge), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    const w = new AgentWallet({ privateKey: pk, fetcher: stub });
    await assert.rejects(
      () => w.paidCall("https://example/api/broken"),
      (err: unknown) => err instanceof AgentWalletError && err.code === "PAYMENT_RETRY_FAILED",
    );
  });

  it("requestQuote raises QUOTE_REJECTED on 404", async () => {
    const pk = generatePrivateKey();
    const stub: typeof fetch = async () => new Response("not found", { status: 404 });
    const w = new AgentWallet({ privateKey: pk, fetcher: stub });
    await assert.rejects(
      () => w.requestQuote("https://example/api/price_quote", { resource: "/api/aisa/data" }),
      (err: unknown) => err instanceof AgentWalletError && err.code === "QUOTE_REJECTED",
    );
  });

  it("requestQuote returns the negotiated quote", async () => {
    const pk = generatePrivateKey();
    const stub: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          quote_id: "q_test",
          price: "0.0008",
          asset: "0x3600000000000000000000000000000000000000",
          network: 5_042_002,
          to: TEST_TO,
          expires_at: Math.floor(Date.now() / 1000) + 60,
          rationale: "volume discount",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const w = new AgentWallet({ privateKey: pk, fetcher: stub });
    const q = await w.requestQuote("https://example/api/price_quote", {
      resource: "/api/aisa/data",
      volume: 1000,
    });
    assert.equal(q.quote_id, "q_test");
    assert.equal(q.price, "0.0008");
  });

  it("getBalance fails clearly when no rpcUrl is configured", async () => {
    const pk = generatePrivateKey();
    const w = new AgentWallet({ privateKey: pk });
    await assert.rejects(
      () => w.getBalance(),
      (err: unknown) => err instanceof AgentWalletError && err.code === "RPC_FAILED",
    );
  });
});
