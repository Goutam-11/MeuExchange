# MEU Exchange

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TypeScript with Hono and Astro, confirmed by the user.

## Users

Issuer and operations teams demonstrating and operating compliant RWA liquidity workflows on Hedera Testnet. Investors, lenders, and their own wallets/custodians are represented as participants in the operational flows.

## Product Purpose

MEU Exchange makes the lifecycle of a compliant tokenised asset legible: issue an ATS-backed RWA, verify participants, lock collateral for repo, settle a secondary trade, and prepare a distribution.

## Positioning

An exchange operations API that treats ATS compliance controls as the settlement boundary while presenting repo liquidity, order matching, and corporate actions as one connected workflow. It never holds a participant's signing key.

## Operating Context

An operator uses the dashboard during a Hedera Testnet demonstration or back-office session. The live network implementation remains an integration target; the initial interface uses clearly labelled demonstration data and actions.

## Capabilities and Constraints

- Initial instrument catalogue: tokenised fixed-income notes and tokenised fund units. Each issuer supplies its own offering documents, eligibility rules, terms, and legal approvals; MEU Exchange does not claim to originate or guarantee an asset.
- ATS-compatible security-token lifecycle: issuance, KYC, transfer controls, locking and corporate actions.
- Repo collateral lifecycle with lock, funded, release, and default-sensitive states.
- Off-chain order matching with on-chain compliant settlement as the MVP trading model.
- Hedera Schedule and oracle integration points.
- All account IDs, pricing and transactions shown in the first build are illustrative testnet data, not proof of a deployed contract.

## Evidence on Hand

The user supplied the ATS/Hedera architecture, example flows, requirements, and source links. No deployed addresses, verified contracts, accounts, production metrics, images, customer claims, or brand assets have been supplied.

## Product Principles

- Compliance is visible at the moment it matters, never a hidden afterthought.
- Operational state should be easy to scan and hard to misread.
- Prefer the smallest testnet-ready workflow over simulated sophistication.
- Show the relationship between token, collateral, trade, and payout as one lifecycle.
