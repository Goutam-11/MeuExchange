# MEU Exchange API

A TypeScript/Hono backend for ATS-backed RWA lifecycle operations on Hedera: KYC, repo collateral workflow, off-chain order matching with compliant ATS settlement, and distribution drafts. MEU Exchange does not custody signing keys.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

`MODE=demo` is the default and never signs or broadcasts a transaction. It creates traceable `demo-*` references so the entire lifecycle can be exercised locally.

## API

- `GET /health` and `GET /api/state`
- `GET /api/assets` — initial asset catalogue and required issuance terms
- `POST /api/intents/issuance`, `/kyc`, `/lock`, `/release`, `/transfer` — create canonical ATS SDK inputs for a connected wallet/custodian to sign. Issuance requires the deployed ATS configuration ID/version rather than guessing one.
- `POST /api/kyc/grants` — `{ "tokenId", "accountId", "vcData" }`
- `POST /api/repos` — `{ "tokenId", "borrower", "lender", "collateralAmount", "principalHbar", "maturityAt" }`
- `POST /api/repos/:id/fund`, then `POST /api/repos/:id/release`
- `POST /api/orders` — `{ "tokenId", "owner", "side", "quantity", "priceHbar" }`
- `POST /api/distributions` — `{ "tokenId", "amountHbar", "recordDate" }`

## Landing page

```bash
npm run dev:web
npm run build:web
```

The Astro landing page runs independently of the Hono API. It includes an aerial-image scanner, asset application tabs, lifecycle annotations, and a local four-step walkthrough. The walkthrough does not call the backend or send transactions.

Move the cursor, touch the image, or focus an image section and use the arrow keys to reveal aligned mesh, X-ray, and illustrative heatmap layers. The scanner has a pause control and starts disabled with reduced-motion preferences. Static imagery and page content remain available without the effect. There is no map API, geospatial analysis, or live asset data behind the visualisation.

The operations dashboard is available at `/dashboard`. Its Astro surface is split into `src/components/dashboard/` (`Sidebar`, `DashboardHeader`, `OverviewPanel`, `AtsPanel`, `MeuPanel`, `IntentsPanel`, and `WalletDialog`). `src/scripts/dashboard.ts` reads `GET /api/dashboard`, prepares ATS issuance intents through the Hono API, and connects a participant-owned wallet through MetaMask SDK. The dashboard never receives private keys; intents remain `awaiting_signature` until an external wallet or custodian signs them.

Visual decisions are recorded in [DESIGN.md](DESIGN.md). Reference-image provenance and launch requirements are recorded in [ASSETS.md](ASSETS.md).

## Hedera ATS integration

With `MODE=testnet`, the gateway validates that operations require an external ATS-compatible signer and fails explicitly before any local state is marked settled. The backend does not pretend to submit ATS transactions without a signer. Signing is delegated to a participant's wallet or existing custodian integration; the API never accepts or stores a private key.

The intent routes make that delegation concrete: they persist an `awaiting_signature` request payload using ATS's `CreateBondRequest`/`CreateEquityRequest`, `GrantKycRequest`, `LockRequest`, `ReleaseRequest`, or `TransferRequest` field shapes. `POST /api/intents/:id/sign` records the wallet signature, `POST /api/intents/:id/submit` records the Hedera transaction ID, and `POST /api/intents/:id/confirm` closes the lifecycle after finality. The dashboard exposes those three steps.

Set `API_ACCESS_TOKEN` to require `Authorization: Bearer <token>` on every `/api/*` route. The dashboard reads an optional `meu-api-token` value from browser `localStorage` for that bearer header. The server persists platform and intent state as atomic JSON files at `STATE_FILE` (default `./var/meu-state.json`); isolated tests can still construct the app with memory stores.

Production startup fails closed if `NODE_ENV=production` is set without `API_ACCESS_TOKEN`.

The configured Testnet endpoints and example resolver/factory IDs follow the [ATS SDK integration guide](https://github.com/hashgraph/asset-tokenization-studio/blob/main/docs/ats/developer-guides/sdk-integration.md). Deploying a private ATS deployment requires updating the two addresses from its generated deployment manifest.
