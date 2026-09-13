import assert from "node:assert/strict";
import test from "node:test";
import { LiquidityPlatform, type ChainGateway, type RepoAgreement, type Trade } from "../src/domain.js";
import { createApp } from "../src/app.js";
import { AtsGateway } from "../src/gateway.js";
import { IntentBook } from "../src/intents.js";
import { HederaMirrorClient } from "../src/mirror.js";
import { WalletAuth } from "../src/auth.js";
import sha3 from "js-sha3";
import { secp256k1 } from "@noble/curves/secp256k1";

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

function signWalletMessage(message: string, privateKey: Uint8Array) {
  const prefix = `\x19Ethereum Signed Message:\n${Buffer.byteLength(message, "utf8")}`;
  const hash = Uint8Array.from(Buffer.from(sha3.keccak_256(Buffer.from(`${prefix}${message}`, "utf8")), "hex"));
  const signature = secp256k1.sign(hash, privateKey);
  return `0x${Buffer.from(signature.toCompactRawBytes()).toString("hex")}${(signature.recovery + 27).toString(16).padStart(2, "0")}`;
}

test("wallet challenge issues a session and consumes the nonce", async () => {
  const mirror = new HederaMirrorClient("https://mirror", async () => new Response(JSON.stringify({ account: "0.0.42" }), { status: 200 }));
  const auth = new WalletAuth("test-secret", mirror, "https://meu.example");
  const privateKey = new Uint8Array(32).fill(7);
  const challenge = auth.challenge("0.0.42");
  const session = await auth.session("0.0.42", challenge.nonce, signWalletMessage(challenge.message, privateKey));
  assert.equal(auth.verify(session.token)?.account, "0.0.42");
  await assert.rejects(() => auth.session("0.0.42", challenge.nonce, "0x" + "00".repeat(65)), /missing, expired, or already used/);
});

test("wallet challenge rejects expired and unresolved accounts", async () => {
  const mirror = new HederaMirrorClient("https://mirror", async () => new Response(JSON.stringify({}), { status: 200 }));
  const auth = new WalletAuth("test-secret", mirror);
  const challenge = auth.challenge("0.0.99");
  await assert.rejects(() => auth.session("0.0.99", challenge.nonce, signWalletMessage(challenge.message, new Uint8Array(32).fill(8))), /does not control/);
});

test("wallet sessions cannot be spoofed by headers or used for another account", async () => {
  const mirror = new HederaMirrorClient("https://mirror", async () => new Response(JSON.stringify({ account: "0.0.42" }), { status: 200 }));
  const auth = new WalletAuth("test-secret", mirror);
  const app = createApp(new LiquidityPlatform(chain), "demo", new IntentBook(), undefined, mirror, auth);
  const unauthenticated = await app.request("http://local/api/intents/fake/sign", { method: "POST", headers: { "content-type": "application/json", "x-meu-account": "0.0.42" }, body: JSON.stringify({ accountId: "0.0.42", signature: "ignored" }) });
  assert.equal(unauthenticated.status, 403);
  const challenge = auth.challenge("0.0.42");
  const session = await auth.session("0.0.42", challenge.nonce, signWalletMessage(challenge.message, new Uint8Array(32).fill(7)));
  const forbidden = await app.request("http://local/api/orders", { method: "POST", headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" }, body: JSON.stringify({ tokenId: "0.0.1", owner: "0.0.99", side: "sell", quantity: 1, priceHbar: 1 }) });
  assert.equal(forbidden.status, 403);
});

test("ATS request validation rejects malformed issuance and operations", () => {
  const book = new IntentBook();
  assert.throws(() => book.issue({ assetType: "fixed-income-note", name: "Bond", symbol: "BND", isin: "bad", currency: "USD", units: "100", configId: "cfg", configVersion: 1 }));
  assert.throws(() => book.transfer("0.0.10", "0.0.20", -1));
  assert.throws(() => book.kyc("0.0.10", "0.0.20", ""));
});

test("testnet confirmation rejects fabricated transactions and marks the intent failed", async () => {
  const mirror = new HederaMirrorClient("https://mirror.test/api/v1", async () => new Response(JSON.stringify({ transactions: [] }), { status: 200 }));
  const app = createApp(new LiquidityPlatform(chain), "testnet", undefined, undefined, mirror);
  const created = await app.request("http://local/api/intents/issuance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetType: "fixed-income-note", name: "MEU Note", symbol: "MEUN", isin: "TEST00000002", currency: "USD", units: "1000", configId: "0.0.123456", configVersion: 1, ownerAccount: "0.0.42" }) });
  const intent = await created.json() as { id: string };
  await app.request(`http://local/api/intents/${intent.id}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: "0.0.42", signature: "ats-sdk-wallet" }) });
  await app.request(`http://local/api/intents/${intent.id}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId: "0.0.123@1.2.3" }) });
  const response = await app.request(`http://local/api/intents/${intent.id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId: "0.0.123@1.2.3" }) });
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /not found/);
});

test("idempotency key returns the original POST result", async () => {
  const app = createApp(new LiquidityPlatform(chain), "demo");
  const request = { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "issuance-1" }, body: JSON.stringify({ assetType: "fixed-income-note", name: "MEU Note", symbol: "MEUN", isin: "TEST00000002", currency: "USD", units: "1000", configId: "0.0.123456", configVersion: 1 }) };
  const first = await app.request("http://local/api/intents/issuance", request);
  const second = await app.request("http://local/api/intents/issuance", request);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal((await first.json() as { id: string }).id, (await second.json() as { id: string }).id);
});

test("unauthorized idempotency requests cannot poison authenticated retries", async () => {
  const app = createApp(new LiquidityPlatform(chain), "demo", undefined, "secret");
  const body = JSON.stringify({ assetType: "fixed-income-note", name: "MEU Note", symbol: "MEUN", isin: "TEST00000002", currency: "USD", units: "1000", configId: "0.0.123456", configVersion: 1 });
  const denied = await app.request("http://local/api/intents/issuance", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "same" }, body });
  const accepted = await app.request("http://local/api/intents/issuance", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer secret", "idempotency-key": "same" }, body });
  assert.equal(denied.status, 401);
  assert.equal(accepted.status, 201);
});

test("crossing orders are serialized when submitted concurrently", async () => {
  const platform = new LiquidityPlatform(chain);
  await platform.grantKyc("0.0.1", "seller", "vc-seller");
  await platform.grantKyc("0.0.1", "buyer", "vc-buyer");
  const results = await Promise.all([
    platform.placeOrder({ tokenId: "0.0.1", owner: "seller", side: "sell", quantity: 10, priceHbar: 2 }),
    platform.placeOrder({ tokenId: "0.0.1", owner: "buyer", side: "buy", quantity: 10, priceHbar: 3 }),
  ]);
  assert.equal(platform.trades.size, 1);
  assert.equal(platform.orders.size, 2);
  assert.equal(results.every((result) => result.order.status === "filled"), true);
});

test("matching never self-trades and uses price-time priority", async () => {
  const platform = new LiquidityPlatform(chain);
  await platform.grantKyc("0.0.1", "trader", "vc");
  await platform.placeOrder({ tokenId: "0.0.1", owner: "trader", side: "sell", quantity: 10, priceHbar: 2 });
  const self = await platform.placeOrder({ tokenId: "0.0.1", owner: "trader", side: "buy", quantity: 10, priceHbar: 3 });
  assert.equal(self.trades.length, 0);
  const priority = new LiquidityPlatform(chain);
  await priority.grantKyc("0.0.1", "first", "vc");
  await priority.grantKyc("0.0.1", "second", "vc");
  await priority.grantKyc("0.0.1", "buyer", "vc");
  await priority.placeOrder({ tokenId: "0.0.1", owner: "first", side: "sell", quantity: 1, priceHbar: 2 });
  await priority.placeOrder({ tokenId: "0.0.1", owner: "second", side: "sell", quantity: 1, priceHbar: 2 });
  const fill = await priority.placeOrder({ tokenId: "0.0.1", owner: "buyer", side: "buy", quantity: 1, priceHbar: 2 });
  assert.equal(fill.trades.at(-1)?.seller, "first");
});

test("repo default, order cancellation, and distribution submission are reachable", async () => {
  const platform = new LiquidityPlatform(chain);
  const repo = await platform.createRepo({ tokenId: "0.0.1", borrower: "borrower", lender: "lender", collateralAmount: 10, principalHbar: 2, maturityAt: "2020-01-01T00:00:00.000Z" }).catch(() => undefined);
  assert.equal(repo, undefined);
  const futureRepo = await platform.createRepo({ tokenId: "0.0.1", borrower: "borrower", lender: "lender", collateralAmount: 10, principalHbar: 2, maturityAt: "2030-01-01T00:00:00.000Z" });
  assert.equal(platform.checkRepoMaturities(Date.parse("2031-01-01T00:00:00.000Z"))[0].status, "defaulted");
  const distribution = platform.createDistribution({ tokenId: "0.0.1", amountHbar: 1, recordDate: "2030-01-01T00:00:00.000Z" });
  assert.equal(platform.submitDistribution(distribution.id).status, "submitted");
  await platform.grantKyc("0.0.1", "seller", "vc");
  const order = (await platform.placeOrder({ tokenId: "0.0.1", owner: "seller", side: "sell", quantity: 1, priceHbar: 1 })).order;
  assert.equal(platform.cancelOrder(order.id).status, "cancelled");
  assert.equal(futureRepo.status, "defaulted");
});
