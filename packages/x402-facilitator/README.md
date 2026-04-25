# @picoflow/x402-facilitator

> Open-source TypeScript reference facilitator for the
> [x402](https://github.com/coinbase/x402) HTTP payment-required protocol on
> [Circle Arc](https://www.circle.com/en/arc).

This package fills the **"Official x402 facilitator SDK for TypeScript"** gap
called out in PicoFlow's Circle Arc developer feedback. It is framework-agnostic,
ships with a published JSON Schema for both 402 challenges and signed payment
headers, and includes a `price_quote` negotiation engine that two agents can use
to agree a price *before* the buyer signs.

## Install

```bash
npm install @picoflow/x402-facilitator
```

## Quickstart — Express

```ts
import express from "express";
import { facilitator } from "@picoflow/x402-facilitator/express";
import { ARC_TESTNET } from "@picoflow/x402-facilitator";

const app = express();

app.get(
  "/api/aisa/data",
  facilitator({
    price: "0.001",
    asset: ARC_TESTNET.usdc,
    to: "0xSellerEOA",
    network: ARC_TESTNET.chainId,
    splits: [
      { addr: "0xProvider", bps: 8000 },
      { addr: "0xPlatform", bps: 1000 },
      { addr: "0xOSS",      bps: 1000 },
    ],
    isNonceFresh: async (nonce) => {
      // REQUIRED in production. Persist seen nonces and return false on replay.
      return await myDb.firstSightOf(nonce);
    },
    onVerified: async ({ signed, buyer }) => {
      // Submit `signed` to Circle Gateway batch or call transferWithAuthorization.
      // Return a SettlementProof with the real txHash / gatewaySettlementId.
      const proof = await gateway.enqueue(signed);
      return proof;
    },
  }),
  (req, res) => res.json({ ok: true }),
);
```

If `onVerified` is omitted, the response header advertises
`status:"pending"` and your worker is expected to drain the signed
authorization out of band. **There is no `trustless` flag and no mock
settlement path.**

## Schema

The 402 challenge body and the X-PAYMENT header body each have a published
JSON Schema (Draft 2020-12). Buyer libraries SHOULD validate against these:

- `schema/payment-required.schema.json`
- `schema/signed-payment.schema.json`

Both are also exported as JS values:

```ts
import { paymentRequiredSchema, signedPaymentSchema } from "@picoflow/x402-facilitator/schema";
```

## Price-quote negotiation

```ts
import { QuoteEngine, ARC_TESTNET } from "@picoflow/x402-facilitator";

const engine = new QuoteEngine({
  asset: ARC_TESTNET.usdc,
  network: ARC_TESTNET.chainId,
  to: "0xSellerEOA",
  basePrice: "0.01",
  volumeTiers: [
    { minVolume: 100,  discountBps: 1000 },  // 10% at 100+
    { minVolume: 1000, discountBps: 2500 },  // 25% at 1000+
  ],
  floorPrice: "0.005",
});

app.post("/price_quote", express.json(), (req, res) => {
  const quote = engine.quote(req.body);          // { quote_id, price, expires_at, ... }
  res.json(quote);
});
```

The buyer can echo `quote_id` into the eventual `X-PAYMENT` flow and the
server-side facilitator can verify the signed authorization matches the
quoted price/recipient/expiry.

## Why no `trustless` flag

Skipping verification turns x402 into "free-money mode" — a single forged
header would let a buyer drain seller-controlled splits without ever signing.
PicoFlow's earlier hackathon code carried such a flag for local fixtures; we
removed it. If you need a dev shortcut, mock at the test boundary, not in the
production middleware.

## License

MIT.
