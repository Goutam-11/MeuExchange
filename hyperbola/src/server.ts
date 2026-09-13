import { serve } from "@hono/node-server";
import { AtsGateway } from "./gateway.js";
import { LiquidityPlatform } from "./domain.js";
import { createApp } from "./app.js";
import { JsonDocumentStore } from "./state.js";
import type { PlatformSnapshot } from "./domain.js";
import type { TransactionIntent } from "./intents.js";
import { IntentBook } from "./intents.js";
import { randomBytes } from "node:crypto";

const mode = process.env.MODE === "testnet" ? "testnet" : "demo";
if (process.env.NODE_ENV === "production" && !process.env.API_ACCESS_TOKEN) throw new Error("API_ACCESS_TOKEN is required in production");
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required in production");
if (!process.env.SESSION_SECRET) {
  if (mode === "testnet") throw new Error("SESSION_SECRET is required outside demo mode");
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
}
const port = Number(process.env.PORT || 3000);
const stateFile = process.env.STATE_FILE || "./var/meu-state.json";
export const platform = new LiquidityPlatform(new AtsGateway(mode), stateFile ? new JsonDocumentStore<PlatformSnapshot>(stateFile) : undefined);
const intents = new IntentBook(stateFile ? new JsonDocumentStore<TransactionIntent[]>(`${stateFile}.intents`) : undefined);
export const app = createApp(platform, mode, intents);

serve({ fetch: app.fetch, port }, () => console.log(`MEU Exchange API listening on http://localhost:${port} (${mode})`));
