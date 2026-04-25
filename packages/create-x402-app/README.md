# create-x402-app

Scaffold a working **x402 paid-API** in seconds — Express seller + buyer-agent demo, ready to run on Circle Arc Testnet.

```bash
npx create-x402-app my-paid-api
cd my-paid-api
npm install
cp .env.example .env   # paste any test EOA private key into BUYER_PRIVATE_KEY
npm run dev:server     # paid API on :3030
npm run demo           # buyer agent calls it 3x
```

You should see a `402 → signed → 200` round-trip in well under a second.

## Templates

| Flag                    | Generates                                          |
| ----------------------- | -------------------------------------------------- |
| (default)               | Both seller and buyer                              |
| `--template seller`     | Just the Express paid-API                           |
| `--template buyer`      | Just the buyer agent (handy for hitting a deployed seller) |

## Powered by

- [`@picoflow/x402-facilitator`](https://www.npmjs.com/package/@picoflow/x402-facilitator)
- [`@picoflow/agent-wallet`](https://www.npmjs.com/package/@picoflow/agent-wallet)
- Live demo: [picoflow.qubitpage.com](https://picoflow.qubitpage.com)

## License

MIT
