# PicoFlow

**PicoFlow is the Agentic Settlement Mesh on Arc.** It turns AI/API calls into priced, signed, metered, ledgered, and settlement-ready actions using USDC nanopayments, x402-style HTTP payment flows, and Circle/Arc infrastructure.

<p align="center">
  <a href="https://picoflow.qubitpage.com"><strong>Live demo</strong></a> |
  <a href="https://picoflow.qubitpage.com/docs"><strong>Docs</strong></a> |
  <a href="https://picoflow.qubitpage.com/demo"><strong>Run demo</strong></a> |
  <a href="https://qubitpage.com"><strong>QubitPage</strong></a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-v0.2.0-blue" />
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-green" />
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22-339933" />
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-9.12.0-F69220" />
  <img alt="Status" src="https://img.shields.io/badge/status-public%20hackathon%20release-purple" />
</p>

---

## Public links

| Item | Link |
|---|---|
| Live product demo | https://picoflow.qubitpage.com |
| GitHub repository | https://github.com/qubitpage/picoflow |
| QubitPage homepage | https://qubitpage.com |
| QubitPage GitHub org | https://github.com/qubitpage |
| Arc Testnet wallet / deployer proof | https://testnet.arcscan.app/address/0x5257613C0a0b87405d08B21c62Be3F65CbD0a5bF |
| Contact | contact@qubitpage.com |

Built for the lablab.ai **Build the Agentic Economy on Arc using USDC and Nanopayments** hackathon, April 20-26, 2026.

---

## What PicoFlow does

PicoFlow is a working settlement layer for agentic commerce:

1. A buyer agent calls a paid HTTP endpoint.
2. The seller returns a 402-style payment challenge.
3. The buyer signs a bounded USDC authorization.
4. The seller verifies the payment, serves the response, and records the action.
5. PicoFlow writes ledger rows for actions, payments, settlements, provider costs, and revenue splits.
6. Proof links show both the sponsor-native Arc Testnet path and a real-funds Arbitrum One mainnet path.

No credit card flow is required. The buyer funds a wallet with USDC and pays per request.

---

## Current production truth

| Area | Status |
|---|---|
| Arc Testnet | Contracts are live and verified. This is the sponsor-native proof path. |
| Arc Mainnet | Not public yet, so PicoFlow does not claim Arc Mainnet deployment. |
| Arbitrum One | Live real-funds proof path with public USDC transaction and contract links. |
| Base Mainnet | Fallback deployment path prepared; unfunded until gas is sent. |
| Providers | Featherless and AI/ML API are real upstreams. AIsa falls back to live Kraken public market data when its key is absent. |
| Public docs | Exactly one whitepaper and one pitch deck are published. |

Key proof links:

- Arbitrum One real USDC transaction: https://arbiscan.io/tx/0xcacbbfcb3f54f92bb01919810cfd9e5ebecc2b99ddc80bd93afd8681efe94afd
- Arbitrum One BondVault: https://arbiscan.io/address/0x140A306E5c51C8521827e9be1E5167399dc31c75
- Arc Testnet faucet transaction: https://testnet.arcscan.app/tx/0xba0307bba4d9f330d3b6c1b4579686a9e6048cf18bf272ba1e6db037ec373315
- Arc Testnet BondVault: https://testnet.arcscan.app/address/0x00792829C3553B95A84bafe33c76E93570D0AbA4
- Arc Testnet ReputationRegistry: https://testnet.arcscan.app/address/0x8Cf86bA01806452B336369D4a25466c34951A086
- Arc Testnet MetadataLogger: https://testnet.arcscan.app/address/0x2853EDc8BAa06e7A7422CCda307ED3E7f0E96FA8

---

## Repository map

```text
picoflow/
|-- apps/
|   |-- dashboard/        Next.js 15 dashboard, docs, account, admin, proof pages
|   |-- buyer-agent/      Autonomous buyer runner for paid API calls
|   `-- seller-agents/    Express API server, paid routes, provider probes, gateway worker
|-- contracts/            Vyper contracts and deployment scripts
|-- docs/
|   |-- whitepaper/       Main whitepaper source and charts
|   |-- pitch/            Pitch deck source
|   `-- product/          Admin guide, critique, product notes
|-- packages/
|   |-- nanometer-core/   Ledger, registry, margin, x402 and proof helpers
|   |-- tollbooth/        HTTP payment middleware package
|   |-- x402-facilitator/ Payment challenge and verification primitives
|   |-- agent-wallet/     Agent wallet abstractions and signing helpers
|   `-- create-x402-app/  Starter app generator templates
|-- scripts/              Docs, deployment helpers, smoke checks, Vultr tooling
|-- submission/           Paste-ready hackathon submission materials
|-- docker-compose.yml    Local Postgres, Redis, sellers, stream, dashboard stack
|-- .env.example          Safe environment template only
`-- package.json          Workspace scripts and version metadata
```

---

## Tech used

| Layer | Tech |
|---|---|
| Frontend | Next.js 15, React 19, Tailwind CSS |
| API server | Node.js 22, Express, TypeScript |
| Package manager | pnpm 9.12.0 workspaces |
| Payments | USDC, x402-style HTTP 402 challenge, EIP-3009-style signed authorization |
| Chains | Arc Testnet, Arbitrum One, Base Mainnet fallback path |
| Contracts | Vyper, titanoboa-style testing, BondVault, ReputationRegistry, MetadataLogger |
| Ledger | PostgreSQL, explicit action/payment/settlement/split/provider-cost rows |
| Local services | Docker Compose, Postgres 16, Redis 7 |
| AI providers | Featherless, AI/ML API, AIsa/Kraken fallback, Gemini orchestration hooks |
| Docs | Markdown, Pandoc/XeLaTeX optional for PDF builds |

---

## Requirements

Minimum local setup:

- Windows, macOS, or Linux
- Git
- Node.js 22 or newer
- pnpm 9.12.0 via Corepack
- Docker Desktop or Docker Engine
- Optional for PDF docs: Pandoc and XeLaTeX
- Optional for contract scripts: Python 3.11+ with the packages required by the deploy scripts

Secrets are not included. Copy `.env.example` to `.env` and fill only the keys you need. Never commit `.env`, private keys, API keys, local wallets, deployment bundles, database files, or node state.

---

## Install locally

```powershell
git clone https://github.com/qubitpage/picoflow.git
cd picoflow

corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install

Copy-Item .env.example .env
docker compose up -d postgres redis
pnpm build
```

For development:

```powershell
pnpm dev
```

For the production-style local stack:

```powershell
docker compose up --build
```

Default local ports:

| Service | URL |
|---|---|
| Dashboard | http://127.0.0.1:3000 |
| Seller API | http://127.0.0.1:3030 |
| Stream API | http://127.0.0.1:3024 |
| Postgres | 127.0.0.1:5432 |
| Redis | 127.0.0.1:6379 |

---

## Useful commands

```powershell
pnpm build             # Build all workspace packages/apps that expose build scripts
pnpm test              # Run workspace tests where configured
pnpm docs:bundle       # Build the public docs bundle used by the dashboard
pnpm docs:whitepaper   # Build the whitepaper source outputs
pnpm docs:pitch        # Build the pitch deck source outputs
pnpm vultr:inventory   # Read-only inventory helper for the deployment environment
```

The public one-click demo is available at https://picoflow.qubitpage.com/demo.

---

## API usage model

PicoFlow supports normal bearer-key API usage plus a payment challenge/retry flow.

```http
GET /api/whoami HTTP/1.1
Host: picoflow.qubitpage.com
Authorization: <Bearer API key>
```

Paid route flow:

1. Client calls a paid API route with an API key.
2. Server returns `402 Payment Required` with price, receiver, deadline, nonce, and signing domain.
3. Client signs the authorization from its wallet.
4. Client retries with `X-PAYMENT: <base64-json-payment>`.
5. Server verifies, records the ledger entry, and serves the result.

---

## Documentation

Public docs are intentionally small and direct:

- Whitepaper: https://picoflow.qubitpage.com/docs/picoflow-whitepaper.html
- Pitch deck: https://picoflow.qubitpage.com/docs/picoflow-pitch-deck.html
- Docs index: https://picoflow.qubitpage.com/docs

Source files:

- `docs/whitepaper/PicoFlow-Whitepaper.md`
- `docs/pitch/PicoFlow-Pitch.md`
- `docs/product/PicoFlow-Admin-User-Guide.md`

---

## Version and release

Current public release: **v0.2.0-public**.

Suggested release flow:

```powershell
pnpm build
pnpm docs:bundle
git status --short
git tag v0.2.0-public
git push origin main --tags
```

Root package publishing to npm is disabled because this is a workspace application repository. Individual packages can be published later after package-level README, version, and API-stability reviews.

---

## Security and publishing policy

- `.env`, `.env.production`, `.env.credentials`, wallet secrets, private keys, local databases, deployment tarballs, and test artifacts are ignored.
- The public repository includes `.env.example` only.
- Admin and settings surfaces are protected in production.
- Public docs separate real proof from roadmap or fallback paths.
- Arbitrum One is listed only as the real-funds proof path, not as a Circle product.

---

## Related QubitPage links

- QubitPage homepage: https://qubitpage.com
- QubitPage GitHub: https://github.com/qubitpage
- PicoFlow live demo: https://picoflow.qubitpage.com

---

## License

Apache-2.0
