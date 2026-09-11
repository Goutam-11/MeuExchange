import { serve } from "@hono/node-server";
import { AtsGateway } from "./gateway.js";
import { LiquidityPlatform } from "./domain.js";
import { createApp } from "./app.js";

const mode = process.env.MODE === "testnet" ? "testnet" : "demo";
export const platform = new LiquidityPlatform(new AtsGateway(mode));
const port = Number(process.env.PORT || 3000);
export const app = createApp(platform, mode);

serve({ fetch: app.fetch, port }, () => console.log(`MEU Exchange API listening on http://localhost:${port} (${mode})`));
