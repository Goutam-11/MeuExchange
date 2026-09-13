type DashboardPayload = {
  mode: "demo" | "testnet";
  network: string;
  custody: string;
  ats: { sdk: string; complianceBoundary: string; resolverAddress: string; factoryAddress: string; mirrorNode: string; rpcNode: string; configId: string; configVersion: number; referenceSecurityId: string };
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
    request: Record<string, unknown>;
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
let atsSdk: typeof import("@hashgraph/asset-tokenization-sdk") | null = null;
let atsInitialized = false;

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
  if (walletAccount) headers.set("x-meu-account", walletAccount);
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

type EthereumProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
function getProvider() { return (window as Window & { ethereum?: EthereumProvider }).ethereum; }
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
    const provider = getProvider();
    if (!provider) throw new Error("MetaMask is not installed");
    const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
    walletAccount = accounts[0] || "";
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

async function getAtsSdk() {
  if (!atsSdk) atsSdk = await import("@hashgraph/asset-tokenization-sdk");
  return atsSdk;
}

async function connectAtsWallet() {
  if (!snapshot) throw new Error("Load the dashboard before connecting ATS");
  const config = snapshot.ats;
  if (!config.resolverAddress || !config.factoryAddress || !config.mirrorNode || !config.rpcNode) throw new Error("ATS testnet configuration is unavailable; set the resolver, factory, mirror-node, and RPC-node values on the API");
  const ats = await getAtsSdk();
  const network = {
    network: "testnet",
    mirrorNode: { baseUrl: config.mirrorNode, name: "testnet" },
    rpcNode: { baseUrl: config.rpcNode, name: "testnet" },
  } as const;
  if (!atsInitialized) {
    await ats.Network.init(new ats.InitializationRequest({
      ...network,
      configuration: { factoryAddress: config.factoryAddress, resolverAddress: config.resolverAddress },
      factories: { factories: [{ factory: config.factoryAddress, environment: "testnet" }] },
      resolvers: { resolvers: [{ resolver: config.resolverAddress, environment: "testnet" }] },
      mirrorNodes: { nodes: [{ mirrorNode: network.mirrorNode, environment: "testnet" }] },
      jsonRpcRelays: { nodes: [{ jsonRpcRelay: network.rpcNode, environment: "testnet" }] },
    }));
    atsInitialized = true;
  }
  await ats.Network.connect(new ats.ConnectRequest({ ...network, wallet: ats.SupportedWallets.METAMASK }));
  if ((!config.configId || !config.configVersion) && config.referenceSecurityId) {
    const info = await ats.Management.getConfigInfo(new ats.GetConfigInfoRequest({ securityId: config.referenceSecurityId }));
    config.configId = info.configId;
    config.configVersion = info.configVersion;
  }
  return ats;
}

async function resolveHederaAccount(wallet = walletAccount) {
  if (!snapshot || !wallet) throw new Error("Connect a wallet before resolving its Hedera account");
  const base = snapshot.ats.mirrorNode.endsWith("/") ? snapshot.ats.mirrorNode : `${snapshot.ats.mirrorNode}/`;
  const response = await fetch(`${base}accounts/${encodeURIComponent(wallet)}`);
  if (!response.ok) throw new Error(`Mirror node could not resolve ${wallet} to a Hedera account`);
  const body = await response.json() as { account?: string };
  if (!body.account) throw new Error("Mirror node returned no Hedera account ID for this wallet");
  return body.account;
}

async function normalizeTarget(value: unknown) { const target = String(value || ""); return target.startsWith("0x") ? resolveHederaAccount(target) : target; }

async function submitAtsIntent(intent: DashboardPayload["intents"][number]) {
  if (!snapshot?.ats.configId || !snapshot.ats.configVersion) throw new Error("ATS configId/configVersion are unavailable; discover them from the deployed resolver before issuance");
  const ats = await connectAtsWallet();
  const request = { ...intent.request, diamondOwnerAccount: await resolveHederaAccount() } as Record<string, unknown>;
  if (request.targetId) request.targetId = await normalizeTarget(request.targetId);
  if (intent.kind === "createBond") {
    const result = await ats.Bond.create(new ats.CreateBondRequest(request as never));
    return result.transactionId;
  }
  if (intent.kind === "createEquity") {
    const result = await ats.Equity.create(new ats.CreateEquityRequest(request as never));
    return result.transactionId;
  }
  if (intent.kind === "grantKyc") return (await ats.Kyc.grantKyc(new ats.GrantKycRequest(request as never))).transactionId;
  if (intent.kind === "lock") return (await ats.Security.lock(new ats.LockRequest(request as never))).transactionId;
  if (intent.kind === "release") return (await ats.Security.release(new ats.ReleaseRequest(request as never))).transactionId;
  if (intent.kind === "transfer") return (await ats.Security.transfer(new ats.TransferRequest(request as never))).transactionId;
  throw new Error(`Browser ATS execution is not implemented for ${intent.kind}`);
}
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
      const intent = snapshot?.intents.find((item) => item.id === signId);
      if (!intent) throw new Error("Intent is no longer in the dashboard snapshot");
      const transactionId = await submitAtsIntent(intent);
      const response = await apiRequest(`/api/intents/${encodeURIComponent(signId)}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: walletAccount, signature: "ats-sdk-wallet" }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The API rejected the signature");
      const submitted = await apiRequest(`/api/intents/${encodeURIComponent(signId)}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId }) });
      const submittedBody = await submitted.json() as { error?: string };
      if (!submitted.ok) throw new Error(submittedBody.error || "The API rejected the Hedera transaction");
      showMessage(`ATS transaction submitted by your wallet: ${transactionId}`);
    } else if (submitId || confirmId) {
      const id = submitId || confirmId!;
      const transactionId = snapshot?.intents.find((intent) => intent.id === id)?.transactionId;
      if (!transactionId) throw new Error("This intent has no transaction ID recorded by the wallet");
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
        configId: snapshot?.ats.configId,
        configVersion: snapshot?.ats.configVersion,
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
