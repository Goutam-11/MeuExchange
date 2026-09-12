import { serve } from "@hono/node-server";
import { AtsGateway } from "./gateway.js";
import { LiquidityPlatform } from "./domain.js";
import { createApp } from "./app.js";
import { JsonDocumentStore } from "./state.js";
import type { PlatformSnapshot } from "./domain.js";
import type { TransactionIntent } from "./intents.js";
import { IntentBook } from "./intents.js";

const mode = process.env.MODE === "testnet" ? "testnet" : "demo";
if (process.env.NODE_ENV === "production" && !process.env.API_ACCESS_TOKEN) throw new Error("API_ACCESS_TOKEN is required in production");
const port = Number(process.env.PORT || 3000);
const stateFile = process.env.STATE_FILE || "./var/meu-state.json";
export const platform = new LiquidityPlatform(new AtsGateway(mode), stateFile ? new JsonDocumentStore<PlatformSnapshot>(stateFile) : undefined);
const intents = new IntentBook(stateFile ? new JsonDocumentStore<TransactionIntent[]>(`${stateFile}.intents`) : undefined);
export const app = createApp(platform, mode, intents);

serve({ fetch: app.fetch, port }, () => console.log(`MEU Exchange API listening on http://localhost:${port} (${mode})`));
