# Hyperbola RWA Liquidity API

A TypeScript/Hono backend for ATS-backed RWA lifecycle operations on Hedera: KYC, repo collateral workflow, off-chain order matching with compliant ATS settlement, and distribution drafts.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

`MODE=demo` is the default and never signs or broadcasts a transaction. It creates traceable `demo-*` references so the entire lifecycle can be exercised locally.

## API

- `GET /health` and `GET /api/state`
- `POST /api/kyc/grants` — `{ "tokenId", "accountId", "vcData" }`
- `POST /api/repos` — `{ "tokenId", "borrower", "lender", "collateralAmount", "principalHbar", "maturityAt" }`
- `POST /api/repos/:id/fund`, then `POST /api/repos/:id/release`
- `POST /api/orders` — `{ "tokenId", "owner", "side", "quantity", "priceHbar" }`
- `POST /api/distributions` — `{ "tokenId", "amountHbar", "recordDate" }`

## Hedera ATS integration

With `MODE=testnet`, the gateway initializes the ATS SDK using the configured resolver/factory, calls the documented `Kyc.grantKyc` and `Security.transfer` SDK APIs, and fails closed for collateral lock/release until a custodial signer is deliberately configured for the deployed `LockFacet`. This prevents a backend from silently taking custody or inventing a transaction signature flow.

The configured Testnet endpoints and example resolver/factory IDs follow the [ATS SDK integration guide](https://github.com/hashgraph/asset-tokenization-studio/blob/main/docs/ats/developer-guides/sdk-integration.md). Deploying a private ATS deployment requires updating the two addresses from its generated deployment manifest.
