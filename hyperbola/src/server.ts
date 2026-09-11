import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { AtsGateway } from "./gateway.js";
import { LiquidityPlatform } from "./domain.js";

const mode = process.env.MODE === "testnet" ? "testnet" : "demo";
export const platform = new LiquidityPlatform(new AtsGateway(mode));
const port = Number(process.env.PORT || 3000);

export const app = new Hono();

app.get("/health", (context) => context.json({ status: "ok", mode }));
app.get("/api/state", (context) => context.json(platform.state()));
app.post("/api/kyc/grants", async (context) => {
  try {
    const body = await context.req.json();
    return context.json(await platform.grantKyc(body.tokenId, body.accountId, body.vcData), 201);
  } catch (error) {
    return context.json({ error: message(error) }, 400);
  }
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

function message(error: unknown) { return error instanceof Error ? error.message : "Unknown error"; }

serve({ fetch: app.fetch, port }, () => console.log(`Hyperbola API listening on http://localhost:${port} (${mode})`));
