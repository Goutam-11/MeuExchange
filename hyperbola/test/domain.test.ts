import assert from "node:assert/strict";
import test from "node:test";
import { LiquidityPlatform, type ChainGateway, type RepoAgreement, type Trade } from "../src/domain.js";
import { createApp } from "../src/app.js";

const chain: ChainGateway = {
  grantKyc: async () => "kyc-1",
  lockCollateral: async () => "lock-1",
  releaseCollateral: async () => "release-1",
  settleTrade: async () => "trade-1"
};

test("repo can lock, fund, and release collateral", async () => {
  const platform = new LiquidityPlatform(chain);
  const repo = await platform.createRepo({ tokenId: "0.0.1", borrower: "0.0.2", lender: "0.0.3", collateralAmount: 100, principalHbar: 20, maturityAt: "2030-01-01T00:00:00.000Z" });
  assert.equal(repo.status, "collateral_locked");
  assert.equal(platform.fundRepo(repo.id).status, "funded");
  assert.equal((await platform.releaseRepo(repo.id)).status, "released");
});

test("crossing orders settle at the resting order price", async () => {
  const platform = new LiquidityPlatform(chain);
  await platform.placeOrder({ tokenId: "0.0.1", owner: "seller", side: "sell", quantity: 50, priceHbar: 2 });
  const result = await platform.placeOrder({ tokenId: "0.0.1", owner: "buyer", side: "buy", quantity: 50, priceHbar: 3 });
  assert.equal(result.order.status, "filled");
  assert.equal(result.trades[0].priceHbar, 2);
  assert.equal(result.trades[0].settlementReference, "trade-1");
});

test("Hono exposes health without a network listener", async () => {
  const response = await createApp(new LiquidityPlatform(chain), "demo").request("http://local/health");
  assert.deepEqual(await response.json(), { status: "ok", mode: "demo" });
});

test("Hono prepares a non-custodial ATS bond issuance intent", async () => {
  const app = createApp(new LiquidityPlatform(chain), "demo");
  const response = await app.request("http://local/api/intents/issuance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetType: "fixed-income-note", name: "MEU Demo Note", symbol: "MDN", isin: "TEST00000001", currency: "USD", units: "1000", configId: "0.0.123456", configVersion: 1 }) });
  const body = await response.json() as { kind: string; status: string; request: { internalKycActivated: boolean } };
  assert.equal(response.status, 201);
  assert.equal(body.kind, "createBond");
  assert.equal(body.status, "awaiting_signature");
  assert.equal(body.request.internalKycActivated, true);
});
