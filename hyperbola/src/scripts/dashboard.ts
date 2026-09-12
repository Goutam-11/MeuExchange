import type { MetaMaskSDK } from "@metamask/sdk";

type DashboardPayload = {
  mode: "demo" | "testnet";
  network: string;
  custody: string;
  ats: { sdk: string; complianceBoundary: string };
  assets: Array<{
    id: string;
    name: string;
    atsTemplate: string;
    use: string;
    requiredTerms: readonly string[];
  }>;
  state: {
    repos: unknown[];
    orders: unknown[];
    trades: unknown[];
    distributions: unknown[];
  };
  intents: Array<{
    id: string;
    kind: string;
    status: string;
    createdAt: string;
    transactionId?: string;
  }>;
};

const root = document;
const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-tab]")];
const panels = [...root.querySelectorAll<HTMLElement>("[data-panel]")];
const alertBox = root.querySelector<HTMLElement>("#dashboard-alert")!;
let snapshot: DashboardPayload | null = null;
let walletAccount = "";
let walletChain = "";

function showMessage(message: string) {
  alertBox.querySelector("p")!.textContent = message;
  alertBox.hidden = false;
}

function activateTab(name: string) {
  tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  panels.forEach((panel) => {
    const active = panel.dataset.panel === name;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
}

tabs.forEach((tab) =>
  tab.addEventListener("click", () => activateTab(tab.dataset.tab!)),
);
root.querySelectorAll<HTMLElement>("[data-open-tab]").forEach((link) =>
  link.addEventListener("click", (event) => {
    event.preventDefault();
    activateTab(link.dataset.openTab!);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }),
);
alertBox.querySelector("button")!.addEventListener("click", () => {
  alertBox.hidden = true;
});

async function getDashboard() {
  const response = await apiRequest("/api/dashboard", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return (await response.json()) as DashboardPayload;
}

function apiRequest(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = window.localStorage.getItem("meu-api-token");
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

function setText(selector: string, value: string | number) {
  root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    element.textContent = String(value);
  });
}

function render(payload: DashboardPayload) {
  snapshot = payload;
  setText('[data-metric="assets"]', payload.assets.length);
  setText('[data-metric="repos"]', payload.state.repos.length);
  setText('[data-metric="trades"]', payload.state.trades.length);
  setText('[data-metric="intents"]', payload.intents.length);
  setText('[data-count="repos"]', payload.state.repos.length);
  setText('[data-count="orders"]', payload.state.orders.length);
  setText('[data-count="distributions"]', payload.state.distributions.length);
  setText("#api-mode", payload.mode === "demo" ? "Local mode" : "Testnet mode");
  setText("#sync-status", "API connected");
  root.querySelector("#sync-status")!.innerHTML = "<i></i> API connected";
  const assets = root.querySelector("#asset-list")!;
  assets.innerHTML = payload.assets
    .map(
      (asset) =>
        `<article class="surface asset-card"><span class="eyebrow">${escapeHtml(asset.atsTemplate)} TEMPLATE</span><h3>${escapeHtml(asset.name)}</h3><p>${escapeHtml(asset.use)}</p><footer><span>${asset.requiredTerms.length} required terms</span><span>View terms ↗</span></footer></article>`,
    )
    .join("");
  const activity = root.querySelector("#activity-list")!;
  const events = [
    ...payload.state.trades.map(() => "ATS transfer settlement"),
    ...payload.state.repos.map(() => "Repo collateral workflow"),
    ...payload.intents.map((intent) => `${intent.kind} intent prepared`),
  ];
  activity.innerHTML = events.length
    ? events
        .slice(-5)
        .reverse()
        .map(
          (event, index) =>
            `<div class="activity-row"><span>${escapeHtml(event)}</span><span>${index === 0 ? "Just now" : "Recorded"}</span></div>`,
        )
        .join("")
    : '<div class="loading-row">No activity yet. Prepare an ATS intent to begin.</div>';
  const table = root.querySelector("#intent-table")!;
  root.querySelector("#queue-count")!.textContent =
    `${payload.intents.length} request${payload.intents.length === 1 ? "" : "s"}`;
  table.innerHTML = payload.intents.length
    ? payload.intents
        .slice()
        .reverse()
        .map(
          (intent) =>
            `<tr><td>${escapeHtml(intent.id.slice(0, 18))}…</td><td>${escapeHtml(intent.kind)}</td><td class="intent-status">${escapeHtml(intent.status.replaceAll("_", " "))}</td><td>${new Date(intent.createdAt).toLocaleString()}</td><td>${intentAction(intent)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5" class="loading-row">No intents awaiting signature.</td></tr>';
}

function intentAction(intent: DashboardPayload["intents"][number]) {
  if (intent.status === "awaiting_signature") return `<button class="table-action" data-sign-intent="${escapeHtml(intent.id)}">Sign with wallet</button>`;
  if (intent.status === "signed") return `<button class="table-action" data-submit-intent="${escapeHtml(intent.id)}">Record transaction</button>`;
  if (intent.status === "submitted") return `<button class="table-action" data-confirm-intent="${escapeHtml(intent.id)}">Confirm transaction</button>`;
  return intent.transactionId ? `<span class="table-reference">${escapeHtml(intent.transactionId.slice(0, 16))}…</span>` : "—";
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ]!,
  );
}

async function refresh() {
  try {
    render(await getDashboard());
  } catch (error) {
    root.querySelector("#sync-status")!.innerHTML =
      '<i style="background:#c56a69"></i> API unavailable';
    showMessage(
      `${error instanceof Error ? error.message : "Could not reach the MEU API"}. Start the Hono server on port 3000.`,
    );
  }
}

root
  .querySelectorAll<HTMLButtonElement>("[data-refresh]")
  .forEach((button) => button.addEventListener("click", refresh));

let sdk: MetaMaskSDK | null = null;
async function getSdk() {
  if (!sdk) {
    const { MetaMaskSDK: MetaMaskSdkConstructor } = await import("@metamask/sdk");
    sdk = new MetaMaskSdkConstructor({ dappMetadata: { name: "MEU Exchange", url: window.location.origin } });
  }
  return sdk;
}
const walletButton = root.querySelector<HTMLButtonElement>("#wallet-connect")!;
const walletDialog = root.querySelector<HTMLElement>("#wallet-dialog")!;
const walletDialogButton = root.querySelector<HTMLButtonElement>(
  "#wallet-dialog-connect",
)!;
const walletCopy = root.querySelector("#wallet-dialog-copy")!;
function shortAccount(account: string) {
  return `${account.slice(0, 6)}…${account.slice(-4)}`;
}
function updateWallet() {
  setText(
    "#wallet-state",
    walletAccount
      ? `${shortAccount(walletAccount)}${walletChain ? ` · ${walletChain}` : ""}`
      : "Wallet not connected",
  );
  walletButton.querySelector("span:last-child")!.textContent = walletAccount
    ? shortAccount(walletAccount)
    : "Connect wallet";
}
async function connectWallet() {
  walletDialogButton.disabled = true;
  walletCopy.textContent = "Waiting for approval in MetaMask…";
  try {
    const walletSdk = await getSdk();
    const accounts = await walletSdk.connect();
    walletAccount = accounts[0] || "";
    const provider = walletSdk.getProvider();
    if (provider)
      walletChain = String(await provider.request({ method: "eth_chainId" }));
    walletDialog.hidden = true;
    updateWallet();
  } catch (error) {
    walletCopy.textContent =
      error instanceof Error
        ? error.message
        : "MetaMask connection was cancelled.";
  } finally {
    walletDialogButton.disabled = false;
  }
}
async function ensureWallet() { if (!walletAccount) await connectWallet(); if (!walletAccount) throw new Error("Connect MetaMask before signing an intent"); }
walletButton.addEventListener("click", () => {
  walletDialog.hidden = false;
  walletDialogButton.focus();
});
walletDialogButton.addEventListener("click", connectWallet);
root.querySelector("[data-close-wallet]")!.addEventListener("click", () => {
  walletDialog.hidden = true;
});
walletDialog.addEventListener("click", (event) => {
  if (event.target === walletDialog) walletDialog.hidden = true;
});

const intentTable = root.querySelector<HTMLTableSectionElement>("#intent-table")!;
intentTable.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const signId = target.closest<HTMLElement>("[data-sign-intent]")?.dataset.signIntent;
  const submitId = target.closest<HTMLElement>("[data-submit-intent]")?.dataset.submitIntent;
  const confirmId = target.closest<HTMLElement>("[data-confirm-intent]")?.dataset.confirmIntent;
  try {
    if (signId) {
      await ensureWallet();
      const provider = (await getSdk()).getProvider();
      if (!provider) throw new Error("MetaMask provider is unavailable");
      const signature = String(await provider.request({ method: "personal_sign", params: [`MEU Exchange intent ${signId}`, walletAccount] }));
      const response = await apiRequest(`/api/intents/${encodeURIComponent(signId)}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: walletAccount, signature }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The API rejected the signature");
      showMessage("Intent signed by your wallet. Record the Hedera transaction ID after the external ATS submission.");
    } else if (submitId || confirmId) {
      const id = submitId || confirmId!;
      const transactionId = window.prompt(submitId ? "Enter the Hedera transaction ID submitted by your ATS wallet:" : "Confirm the Hedera transaction ID:");
      if (!transactionId) return;
      const endpoint = submitId ? "submit" : "confirm";
      const response = await apiRequest(`/api/intents/${encodeURIComponent(id)}/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The API rejected the transaction reference");
      showMessage(submitId ? "Transaction reference recorded. Confirm it after Hedera finality." : "Transaction confirmed in the intent queue.");
    } else return;
    await refresh();
    activateTab("intents");
  } catch (error) { showMessage(error instanceof Error ? error.message : "Could not update the intent"); }
});

root.querySelector("#prepare-issuance")!.addEventListener("click", async () => {
  const button = root.querySelector<HTMLButtonElement>("#prepare-issuance")!;
  button.disabled = true;
  try {
    const response = await apiRequest("/api/intents/issuance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assetType: "fixed-income-note",
        name: (root.querySelector("#issuance-name") as HTMLInputElement).value,
        symbol: (root.querySelector("#issuance-symbol") as HTMLInputElement)
          .value,
        isin: "MEU-ISSUANCE-0001",
        currency: "USD",
        units: "1000",
        configId: "dashboard-config",
        configVersion: 1,
        ownerAccount: walletAccount || undefined,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(result.error || "The API rejected the issuance intent");
    showMessage(
      "ATS issuance intent prepared. Connect a wallet to sign it; no transaction was broadcast.",
    );
    await refresh();
    activateTab("intents");
  } catch (error) {
    showMessage(
      error instanceof Error
        ? error.message
        : "Could not prepare the issuance intent",
    );
  } finally {
    button.disabled = false;
  }
});

refresh();

export const dashboardReady = true;
