import { Hono } from "hono";
import { LiquidityPlatform } from "./domain.js";
import { offeredAssetTypes } from "./assets.js";
import { IntentBook } from "./intents.js";
import { HederaMirrorClient } from "./mirror.js";
import { serveStatic } from "@hono/node-server/serve-static";
import { WalletAuth } from "./auth.js";

export function createApp(platform: LiquidityPlatform, mode: "demo" | "testnet", intents = new IntentBook(), accessToken = process.env.API_ACCESS_TOKEN, mirror = new HederaMirrorClient(process.env.HEDERA_MIRROR_NODE || ""), walletAuth = process.env.SESSION_SECRET ? new WalletAuth(process.env.SESSION_SECRET, mirror, process.env.SESSION_ORIGIN || "http://localhost", new Set((process.env.OPERATOR_ACCOUNT_IDS || "").split(",").map((value) => value.trim()).filter(Boolean))) : undefined, config: Partial<Record<"resolverAddress" | "factoryAddress" | "mirrorNode" | "rpcNode" | "configId" | "referenceSecurityId", string>> & { configVersion?: number } = {}) {
  const app = new Hono();
  const idempotentResponses = new Map<string, { status: number; headers: Headers; body: string; expiresAt: number }>();
  const idempotentInFlight = new Map<string, Promise<void>>();
  app.get("/health", (context) => context.json({ status: "ok", mode }));
  app.use("/api/*", async (context, next) => {
    if (context.req.path.startsWith("/api/auth/")) return next();
    const authorization = context.req.header("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!accessToken) return next();
    if (authorization === `Bearer ${accessToken}` || walletAuth?.verify(token)) return next();
    return context.json({ error: "Authentication required" }, 401);
  });
  app.use("/api/*", async (context, next) => {
    if (context.req.method !== "POST") return next();
    const key = context.req.header("idempotency-key");
    if (!key) return next();
    const cacheKey = `${context.req.path}:${key}`;
    const cached = idempotentResponses.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return new Response(cached.body, { status: cached.status, headers: cached.headers });
    if (cached) idempotentResponses.delete(cacheKey);
    const inFlight = idempotentInFlight.get(cacheKey);
    if (inFlight) { await inFlight; const completed = idempotentResponses.get(cacheKey); return completed ? new Response(completed.body, { status: completed.status, headers: completed.headers }) : next(); }
    const completion = (async () => {
      await next();
      const response = context.res;
      if (response.status >= 200 && response.status < 300) idempotentResponses.set(cacheKey, { status: response.status, headers: new Headers(response.headers), body: await response.clone().text(), expiresAt: Date.now() + 15 * 60_000 });
    })();
    idempotentInFlight.set(cacheKey, completion);
    try { await completion; } finally { idempotentInFlight.delete(cacheKey); }
    return context.res;
  });
  app.get("/api/state", (context) => context.json(platform.state()));
  app.get("/api/assets", (context) => context.json({ assets: offeredAssetTypes, disclaimer: "Instrument terms and legal approvals are issuer supplied." }));
  app.get("/api/intents", (context) => context.json({ intents: intents.all() }));
  app.get("/api/intents/:id", (context) => {
    const intent = intents.get(context.req.param("id"));
    return intent ? context.json(intent) : context.json({ error: "Intent not found" }, 404);
  });
  app.get("/api/kyc/status", (context) => context.json(platform.kycStatus(context.req.query("tokenId") || "", context.req.query("accountId") || "")));
  app.get("/api/dashboard", (context) => context.json({
    mode,
    network: "hedera-testnet",
    custody: "non-custodial",
    ats: {
      sdk: "@hashgraph/asset-tokenization-sdk",
      complianceBoundary: "ATS token controls",
      resolverAddress: config.resolverAddress ?? process.env.ATS_RESOLVER_ADDRESS ?? "",
      factoryAddress: config.factoryAddress ?? process.env.ATS_FACTORY_ADDRESS ?? "",
      mirrorNode: config.mirrorNode ?? process.env.HEDERA_MIRROR_NODE ?? "",
      rpcNode: config.rpcNode ?? process.env.HEDERA_RPC_NODE ?? "",
      configId: config.configId ?? process.env.ATS_CONFIG_ID ?? "",
      configVersion: config.configVersion ?? (process.env.ATS_CONFIG_VERSION ? Number(process.env.ATS_CONFIG_VERSION) : 0),
      referenceSecurityId: config.referenceSecurityId ?? process.env.ATS_REFERENCE_SECURITY_ID ?? "",
    },
    assets: offeredAssetTypes,
    state: platform.state(),
    intents: intents.all()
  }));
  app.post("/api/auth/challenge", async (context) => {
    try { if (!walletAuth) return context.json({ error: "Wallet authentication is not configured" }, 503); const body = await context.req.json(); return context.json(walletAuth.challenge(String(body.accountId || ""))); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/auth/session", async (context) => {
    try { if (!walletAuth) return context.json({ error: "Wallet authentication is not configured" }, 503); const body = await context.req.json(); return context.json(await walletAuth.session(String(body.accountId || ""), String(body.nonce || ""), String(body.signature || ""))); }
    catch (error) { return context.json({ error: message(error) }, 403); }
  });
  app.post("/api/intents/:id/sign", async (context) => {
    try { const body = await context.req.json(); requireWalletActor(context, walletAuth, body.accountId); return context.json(intents.sign(context.req.param("id"), body.accountId, body.signature)); }
    catch (error) { return context.json({ error: message(error) }, error instanceof HttpError ? error.status : 400); }
  });
  app.post("/api/intents/:id/submit", async (context) => {
    try { const body = await context.req.json(); return context.json(intents.submit(context.req.param("id"), body.transactionId)); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/intents/:id/confirm", async (context) => {
    try {
      const body = await context.req.json();
      if (mode === "testnet") {
        const verification = await mirror.verifyTransaction(body.transactionId);
        if (!verification.ok) {
          const intent = intents.get(context.req.param("id"));
          if (intent?.status === "submitted") intents.fail(intent.id, verification.reason || "Mirror node rejected the transaction");
          return context.json({ error: verification.reason || "Transaction verification failed" }, 400);
        }
      }
      const confirmed = intents.confirm(context.req.param("id"), body.transactionId);
      if (confirmed.kind === "grantKyc") platform.reconcileKyc(String(confirmed.request.securityId), String(confirmed.request.targetId));
      return context.json(confirmed);
    }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/intents/issuance", async (context) => {
    try { return context.json(intents.issue(await context.req.json()), 201); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/intents/kyc", async (context) => {
    try { const body = await context.req.json(); return context.json(intents.kyc(body.tokenId, body.accountId, body.vcData), 201); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/intents/lock", async (context) => {
    try { const body = await context.req.json(); return context.json(intents.lock(body.tokenId, body.accountId, body.amount, body.expirationTimestamp), 201); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/intents/release", async (context) => {
    try { const body = await context.req.json(); return context.json(intents.release(body.tokenId, body.accountId, body.lockId), 201); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/intents/transfer", async (context) => {
    try { const body = await context.req.json(); return context.json(intents.transfer(body.tokenId, body.targetId, body.amount), 201); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/kyc/grants", async (context) => {
    try {
      const body = await context.req.json();
      requireOperator(context, walletAuth);
      return context.json(await platform.grantKyc(body.tokenId, body.accountId, body.vcData), 201);
    } catch (error) { return context.json({ error: message(error) }, error instanceof HttpError ? error.status : 400); }
  });
  app.post("/api/repos", async (context) => {
    try { return context.json(await platform.createRepo(await context.req.json()), 201); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/repos/:id/fund", (context) => {
    try { return context.json(platform.fundRepo(context.req.param("id"))); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/repos/:id/release", async (context) => {
    try { return context.json(await platform.releaseRepo(context.req.param("id"))); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/repos/check-maturity", (context) => context.json({ defaulted: platform.checkRepoMaturities() }));
  app.post("/api/orders", async (context) => {
    try { const body = await context.req.json(); requireWalletActor(context, walletAuth, body.owner); return context.json(await platform.placeOrder(body), 201); }
    catch (error) { return context.json({ error: message(error) }, error instanceof HttpError ? error.status : 400); }
  });
  app.post("/api/orders/:id/cancel", (context) => {
    try { return context.json(platform.cancelOrder(context.req.param("id"))); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/distributions", async (context) => {
    try { return context.json(platform.createDistribution(await context.req.json()), 201); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/distributions/:id/submit", (context) => {
    try { return context.json(platform.submitDistribution(context.req.param("id"))); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.use("/*", serveStatic({ root: "./dist", index: "index.html" }));
  app.notFound((context) => context.json({ error: "Route not found" }, 404));
  return app;
}

class HttpError extends Error { constructor(readonly status: 403, message: string) { super(message); } }
function message(error: unknown) { return error instanceof Error ? error.message : "Unknown error"; }
function requireWalletActor(context: { req: { header(name: string): string | undefined } }, auth: WalletAuth | undefined, account: string) {
  if (!auth) return;
  const token = context.req.header("authorization")?.startsWith("Bearer ") ? context.req.header("authorization")!.slice(7) : "";
  const session = auth.verify(token);
  if (!session || session.account !== account) throw new HttpError(403, "Wallet identity does not match the requested account");
}
function requireOperator(context: { req: { header(name: string): string | undefined } }, auth: WalletAuth | undefined) {
  if (!auth) return;
  const token = context.req.header("authorization")?.startsWith("Bearer ") ? context.req.header("authorization")!.slice(7) : "";
  const session = auth.verify(token);
  if (!session || session.role !== "operator") throw new HttpError(403, "Operator authorization required");
}
