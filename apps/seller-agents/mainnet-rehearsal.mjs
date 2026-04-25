/**
 * Mainnet rehearsal — first paid call on Arbitrum One.
 * Self-contained: implements x402 negotiation + EIP-3009 sign with bare viem.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount, signTypedData } from "viem/accounts";
import { createPublicClient, http } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const BUYER_SECRET = path.join(ROOT, "contracts", ".arbitrum-buyer.secret.json");

const URL_ = process.env.PAID_URL ?? "https://picoflow.qubitpage.com/api/aisa/data?symbol=BTC";
const API_KEY = process.env.BUYER_API_KEY;
if (!API_KEY) throw new Error("BUYER_API_KEY env required");

const RPC = "https://arb1.arbitrum.io/rpc";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view",
  inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] }];

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

function priceToAtomic(p, decimals = 6) {
  const [i, f = ""] = String(p).split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

function encodePaymentHeader(signed) {
  return Buffer.from(JSON.stringify(signed)).toString("base64");
}

async function main() {
  const buyer = JSON.parse(fs.readFileSync(BUYER_SECRET, "utf8"));
  let pk = buyer.private_key;
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  const acct = privateKeyToAccount(pk);
  console.log(`[mainnet] buyer = ${acct.address}`);
  console.log(`[mainnet] api_key = ${API_KEY.slice(0, 18)}...`);
  console.log(`[mainnet] url = ${URL_}`);

  const pub = createPublicClient({ transport: http(RPC) });
  const bal = await pub.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [acct.address] });
  console.log(`[mainnet] buyer USDC balance: ${Number(bal) / 1e6}`);

  const t0 = Date.now();
  const r1 = await fetch(URL_, { headers: { Authorization: `Bearer ${API_KEY}` } });
  console.log(`[step1] status=${r1.status} elapsed=${Date.now() - t0}ms`);
  if (r1.status !== 402) {
    console.log("body:", await r1.text());
    throw new Error("expected 402");
  }
  const challenge = await r1.json();
  console.log("[step1] challenge:", JSON.stringify(challenge, null, 2));

  const value = priceToAtomic(challenge.price, 6);
  const message = {
    from: acct.address,
    to: challenge.to,
    value,
    validAfter: BigInt(challenge.validAfter),
    validBefore: BigInt(challenge.validBefore),
    nonce: challenge.nonce,
  };
  const signature = await signTypedData({
    privateKey: pk,
    domain: challenge.domain,
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  });
  const signed = {
    from: acct.address,
    to: challenge.to,
    value: value.toString(),
    validAfter: challenge.validAfter,
    validBefore: challenge.validBefore,
    nonce: challenge.nonce,
    signature,
  };
  console.log("[sign] signed:", { ...signed, signature: signature.slice(0, 12) + "..." });

  const t1 = Date.now();
  const r2 = await fetch(URL_, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "X-PAYMENT": encodePaymentHeader(signed),
    },
  });
  console.log(`[step3] status=${r2.status} elapsed=${Date.now() - t1}ms`);
  const body = await r2.text();
  console.log("[step3] body:", body.slice(0, 800));
  const respHeader = r2.headers.get("x-payment-response");
  if (respHeader) {
    try {
      const proof = JSON.parse(Buffer.from(respHeader, "base64").toString("utf8"));
      console.log("[step3] x-payment-response:", JSON.stringify(proof, null, 2));
    } catch (e) {
      console.log("[step3] x-payment-response raw:", respHeader);
    }
  } else {
    console.log("[step3] no x-payment-response header (async settlement)");
  }
  if (r2.status !== 200) process.exit(1);
  console.log(`[done] total=${Date.now() - t0}ms`);
}

main().catch((e) => {
  console.error("[FAIL]", e);
  process.exit(1);
});
