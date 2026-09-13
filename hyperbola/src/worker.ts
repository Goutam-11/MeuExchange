import { Hono } from "hono";
import { cors } from "hono/cors";
import { LiquidityPlatform, type PlatformSnapshot } from "./domain.js";
import { IntentBook, type TransactionIntent } from "./intents.js";
import { AtsGateway } from "./gateway.js";
import { createApp } from "./app.js";
import { MemoryDocumentStore } from "./state.js";
import { HederaMirrorClient } from "./mirror.js";
import { WalletAuth } from "./auth.js";

export interface WorkerEnv {
  DB: D1Database;
  MODE?: "demo" | "testnet";
  API_ACCESS_TOKEN?: string;
  SESSION_SECRET?: string;
  SESSION_ORIGIN?: string;
  OPERATOR_ACCOUNT_IDS?: string;
  HEDERA_MIRROR_NODE?: string;
  HEDERA_RPC_NODE?: string;
  FRONTEND_ORIGIN?: string;
  ATS_RESOLVER_ADDRESS?: string;
  ATS_FACTORY_ADDRESS?: string;
  ATS_CONFIG_ID?: string;
  ATS_CONFIG_VERSION?: string;
  ATS_REFERENCE_SECURITY_ID?: string;
}

const app = new Hono<{ Bindings: WorkerEnv }>();
let walletAuth: WalletAuth | undefined;
app.use("/api/*", cors({ origin: (origin, context) => context.env.FRONTEND_ORIGIN === "*" ? origin || "*" : context.env.FRONTEND_ORIGIN || origin || "*", allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"], allowMethods: ["GET", "POST", "OPTIONS"] }));
app.all("*", async (context) => {
  const snapshot = await loadJson<PlatformSnapshot>(context.env.DB, "platform");
  const intentsSnapshot = await loadJson<TransactionIntent[]>(context.env.DB, "intents");
  const platform = new LiquidityPlatform(new AtsGateway(context.env.MODE || "demo"), new MemoryDocumentStore(snapshot));
  const intents = new IntentBook(new MemoryDocumentStore(intentsSnapshot));
  const mirror = new HederaMirrorClient(context.env.HEDERA_MIRROR_NODE || "");
  if (!context.env.SESSION_SECRET) return context.json({ error: "SESSION_SECRET is required" }, 500);
  walletAuth ||= new WalletAuth(context.env.SESSION_SECRET, mirror, context.env.SESSION_ORIGIN || "https://meu-exchange", new Set((context.env.OPERATOR_ACCOUNT_IDS || "").split(",").map((value) => value.trim()).filter(Boolean)));
  if (context.req.path === "/api/auth/challenge" && context.req.method === "POST") {
    const body = await context.req.json() as { accountId?: string };
    const challenge = walletAuth.challenge(String(body.accountId || ""));
    await context.env.DB.prepare("INSERT INTO auth_challenges (nonce, account_id, message, expires_at) VALUES (?, ?, ?, ?)").bind(challenge.nonce, String(body.accountId || ""), challenge.message, challenge.expiresAt).run();
    return context.json(challenge);
  }
  if (context.req.path === "/api/auth/session" && context.req.method === "POST") {
    const body = await context.req.json() as { accountId?: string; nonce?: string; signature?: string };
    const row = await context.env.DB.prepare("DELETE FROM auth_challenges WHERE nonce = ? RETURNING account_id, message, expires_at").bind(String(body.nonce || "")).first<{ account_id: string; message: string; expires_at: number }>();
    if (!row) return context.json({ error: "Challenge is missing, expired, or already used" }, 403);
    try { return context.json(await walletAuth.sessionFromChallenge(String(body.accountId || ""), String(body.nonce || ""), String(body.signature || ""), { accountId: row.account_id, message: row.message, expiresAt: row.expires_at })); }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : "Wallet authentication failed" }, 403); }
  }
  const api = createApp(platform, context.env.MODE || "demo", intents, context.env.API_ACCESS_TOKEN, mirror, walletAuth, { resolverAddress: context.env.ATS_RESOLVER_ADDRESS, factoryAddress: context.env.ATS_FACTORY_ADDRESS, mirrorNode: context.env.HEDERA_MIRROR_NODE, rpcNode: context.env.HEDERA_RPC_NODE, configId: context.env.ATS_CONFIG_ID, configVersion: context.env.ATS_CONFIG_VERSION ? Number(context.env.ATS_CONFIG_VERSION) : 0, referenceSecurityId: context.env.ATS_REFERENCE_SECURITY_ID });
  const idem = context.req.method === "POST" ? context.req.header("idempotency-key") : undefined;
  const idemKey = idem ? `${context.req.path}:${idem}` : "";
  if (idemKey) {
    const cached = await context.env.DB.prepare("SELECT status, body FROM idempotency WHERE cache_key = ? AND expires_at > ?").bind(idemKey, Date.now()).first<{ status: number; body: string }>();
    if (cached) return new Response(cached.body, { status: cached.status, headers: { "content-type": "application/json" } });
  }
  const response = await api.fetch(context.req.raw);
  if (idemKey && response.status >= 200 && response.status < 300) await context.env.DB.prepare("INSERT OR REPLACE INTO idempotency (cache_key, status, body, expires_at) VALUES (?, ?, ?, ?)").bind(idemKey, response.status, await response.clone().text(), Date.now() + 15 * 60_000).run();
  await saveJson(context.env.DB, "platform", platform.state());
  await saveJson(context.env.DB, "intents", intents.all());
  return response;
});

async function loadJson<T>(db: D1Database, id: string): Promise<T | undefined> {
  const row = await db.prepare("SELECT value FROM snapshots WHERE id = ?").bind(id).first<{ value: string }>();
  return row ? JSON.parse(row.value) as T : undefined;
}
async function saveJson(db: D1Database, id: string, value: unknown) {
  await db.prepare("INSERT INTO snapshots (id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(id, JSON.stringify(value), new Date().toISOString()).run();
}

export default app;
