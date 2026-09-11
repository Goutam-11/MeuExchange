import { Hono } from "hono";
import { LiquidityPlatform } from "./domain.js";
import { offeredAssetTypes } from "./assets.js";
import { IntentBook } from "./intents.js";

export function createApp(platform: LiquidityPlatform, mode: "demo" | "testnet", intents = new IntentBook()) {
  const app = new Hono();
  app.get("/health", (context) => context.json({ status: "ok", mode }));
  app.get("/api/state", (context) => context.json(platform.state()));
  app.get("/api/assets", (context) => context.json({ assets: offeredAssetTypes, disclaimer: "Instrument terms and legal approvals are issuer supplied." }));
  app.get("/api/intents", (context) => context.json({ intents: intents.all() }));
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
      return context.json(await platform.grantKyc(body.tokenId, body.accountId, body.vcData), 201);
    } catch (error) { return context.json({ error: message(error) }, 400); }
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
  app.post("/api/orders", async (context) => {
    try { return context.json(await platform.placeOrder(await context.req.json()), 201); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.post("/api/distributions", async (context) => {
    try { return context.json(platform.createDistribution(await context.req.json()), 201); }
    catch (error) { return context.json({ error: message(error) }, 400); }
  });
  app.notFound((context) => context.json({ error: "Route not found" }, 404));
  return app;
}

function message(error: unknown) { return error instanceof Error ? error.message : "Unknown error"; }
