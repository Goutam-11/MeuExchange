import assert from "node:assert/strict";
import test from "node:test";
import { LiquidityPlatform, type ChainGateway, type RepoAgreement, type Trade } from "../src/domain.js";
import { createApp } from "../src/app.js";
import { AtsGateway } from "../src/gateway.js";
import { IntentBook } from "../src/intents.js";

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
  await platform.grantKyc("0.0.1", "seller", "vc-seller");
  await platform.grantKyc("0.0.1", "buyer", "vc-buyer");
  await platform.placeOrder({ tokenId: "0.0.1", owner: "seller", side: "sell", quantity: 50, priceHbar: 2 });
  const result = await platform.placeOrder({ tokenId: "0.0.1", owner: "buyer", side: "buy", quantity: 50, priceHbar: 3 });
  assert.equal(result.order.status, "filled");
  assert.equal(result.trades[0].priceHbar, 2);
  assert.equal(result.trades[0].settlementReference, "trade-1");
});

test("unverified accounts cannot place or match orders", async () => {
  const platform = new LiquidityPlatform(chain);
  await assert.rejects(() => platform.placeOrder({ tokenId: "0.0.1", owner: "unverified", side: "sell", quantity: 1, priceHbar: 1 }), /not KYC eligible/);
});

test("testnet gateway fails explicitly until an external signer submits ATS work", async () => {
  await assert.rejects(() => new AtsGateway("testnet").grantKyc("0.0.1", "0.0.2", "vc"), /prepared but not submitted/);
});

test("Hono exposes health without a network listener", async () => {
  const response = await createApp(new LiquidityPlatform(chain), "demo").request("http://local/health");
  assert.deepEqual(await response.json(), { status: "ok", mode: "demo" });
});

test("dashboard snapshot exposes ATS and MEU integration state", async () => {
  const response = await createApp(new LiquidityPlatform(chain), "demo").request("http://local/api/dashboard");
  const body = await response.json() as { mode: string; custody: string; ats: { sdk: string }; assets: unknown[]; state: { repos: unknown[] } };
  assert.equal(response.status, 200);
  assert.equal(body.mode, "demo");
  assert.equal(body.custody, "non-custodial");
  assert.equal(body.ats.sdk, "@hashgraph/asset-tokenization-sdk");
  assert.equal(body.assets.length, 2);
  assert.deepEqual(body.state.repos, []);
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

test("intent signing loop records a signature, submission, and confirmation", async () => {
  const app = createApp(new LiquidityPlatform(chain), "demo");
  const created = await app.request("http://local/api/intents/issuance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetType: "fixed-income-note", name: "MEU Note", symbol: "MEUN", isin: "TEST00000002", currency: "USD", units: "1000", configId: "0.0.123456", configVersion: 1, ownerAccount: "0.0.42" }) });
  const intent = await created.json() as { id: string };
  const signed = await app.request(`http://local/api/intents/${intent.id}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: "0.0.42", signature: "0xsigned" }) });
  assert.equal((await signed.json() as { status: string }).status, "signed");
  const submitted = await app.request(`http://local/api/intents/${intent.id}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId: "0.0.123@1.2.3" }) });
  assert.equal((await submitted.json() as { status: string }).status, "submitted");
  const confirmed = await app.request(`http://local/api/intents/${intent.id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId: "0.0.123@1.2.3" }) });
  assert.equal((await confirmed.json() as { status: string }).status, "confirmed");
});

test("configured API access token protects API routes", async () => {
  const app = createApp(new LiquidityPlatform(chain), "demo", undefined, "secret-token");
  assert.equal((await app.request("http://local/api/dashboard")).status, 401);
  assert.equal((await app.request("http://local/api/dashboard", { headers: { authorization: "Bearer secret-token" } })).status, 200);
});

test("intent requests use ATS field names and validated value types", () => {
  const book = new IntentBook();
  const kyc = book.kyc("0.0.10", "0.0.20", "credential");
  const transfer = book.transfer("0.0.10", "0.0.30", 12);
  const lock = book.lock("0.0.10", "0.0.20", 5, "2030-01-01T00:00:00.000Z");
  const release = book.release("0.0.10", "0.0.20", 4);
  assert.deepEqual(kyc.request, { securityId: "0.0.10", targetId: "0.0.20", vcBase64: Buffer.from("credential").toString("base64") });
  assert.deepEqual(transfer.request, { securityId: "0.0.10", targetId: "0.0.30", amount: "12" });
  assert.deepEqual(lock.request, { securityId: "0.0.10", targetId: "0.0.20", amount: "5", expirationTimestamp: "2030-01-01T00:00:00.000Z" });
  assert.deepEqual(release.request, { securityId: "0.0.10", targetId: "0.0.20", lockId: 4 });
  assert.equal(kyc.schemaVersion, 2);
});

test("ATS request validation rejects malformed issuance and operations", () => {
  const book = new IntentBook();
  assert.throws(() => book.issue({ assetType: "fixed-income-note", name: "Bond", symbol: "BND", isin: "bad", currency: "USD", units: "100", configId: "cfg", configVersion: 1 }));
  assert.throws(() => book.transfer("0.0.10", "0.0.20", -1));
  assert.throws(() => book.kyc("0.0.10", "0.0.20", ""));
});
