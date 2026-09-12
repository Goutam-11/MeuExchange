import { MemoryDocumentStore, type DocumentStore } from "./state.js";

export type Id = string;

export type RepoStatus = "collateral_locked" | "funded" | "released" | "defaulted";
export type OrderSide = "buy" | "sell";
export type OrderStatus = "open" | "filled" | "cancelled";

export interface RepoAgreement {
  id: Id;
  tokenId: string;
  borrower: string;
  lender: string;
  collateralAmount: number;
  principalHbar: number;
  maturityAt: string;
  status: RepoStatus;
  lockReference?: string;
  transactions: string[];
}

export interface Order {
  id: Id;
  tokenId: string;
  owner: string;
  side: OrderSide;
  quantity: number;
  priceHbar: number;
  remaining: number;
  status: OrderStatus;
  createdAt: string;
}

export interface Trade {
  id: Id;
  tokenId: string;
  buyOrderId: Id;
  sellOrderId: Id;
  buyer: string;
  seller: string;
  quantity: number;
  priceHbar: number;
  settlementReference?: string;
  createdAt: string;
}

export interface Distribution {
  id: Id;
  tokenId: string;
  amountHbar: number;
  recordDate: string;
  status: "draft" | "submitted";
}

export interface PlatformSnapshot {
  repos: RepoAgreement[];
  orders: Order[];
  trades: Trade[];
  distributions: Distribution[];
  kyc: Array<[string, string[]]>;
}

export interface ChainGateway {
  grantKyc(tokenId: string, accountId: string, vcData: string): Promise<string>;
  lockCollateral(input: Pick<RepoAgreement, "tokenId" | "borrower" | "collateralAmount" | "maturityAt">): Promise<string>;
  releaseCollateral(repo: RepoAgreement): Promise<string>;
  settleTrade(trade: Trade): Promise<string>;
}

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export class LiquidityPlatform {
  readonly repos = new Map<Id, RepoAgreement>();
  readonly orders = new Map<Id, Order>();
  readonly trades = new Map<Id, Trade>();
  readonly distributions = new Map<Id, Distribution>();
  private readonly kyc = new Map<string, Set<string>>();
  private readonly store: DocumentStore<PlatformSnapshot>;

  constructor(private readonly chain: ChainGateway, store: DocumentStore<PlatformSnapshot> = new MemoryDocumentStore()) {
    this.store = store;
    const snapshot = store.load();
    snapshot?.repos.forEach((repo) => this.repos.set(repo.id, repo));
    snapshot?.orders.forEach((order) => this.orders.set(order.id, order));
    snapshot?.trades.forEach((trade) => this.trades.set(trade.id, trade));
    snapshot?.distributions.forEach((distribution) => this.distributions.set(distribution.id, distribution));
    snapshot?.kyc.forEach(([tokenId, accounts]) => this.kyc.set(tokenId, new Set(accounts)));
  }

  async grantKyc(tokenId: string, accountId: string, vcData: string) {
    const transactionId = await this.chain.grantKyc(tokenId, accountId, vcData);
    const accounts = this.kyc.get(tokenId) || new Set<string>();
    accounts.add(accountId);
    this.kyc.set(tokenId, accounts);
    this.persist();
    return { tokenId, accountId, transactionId };
  }

  kycStatus(tokenId: string, accountId: string) {
    return { tokenId, accountId, eligible: this.kyc.get(tokenId)?.has(accountId) === true };
  }

  reconcileKyc(tokenId: string, accountId: string) {
    const accounts = this.kyc.get(tokenId) || new Set<string>();
    accounts.add(accountId);
    this.kyc.set(tokenId, accounts);
    this.persist();
  }

  async createRepo(input: Omit<RepoAgreement, "id" | "status" | "transactions" | "lockReference">) {
    requirePositive(input.collateralAmount, "collateralAmount");
    requirePositive(input.principalHbar, "principalHbar");
    requireFuture(input.maturityAt);
    const agreement: RepoAgreement = { ...input, id: id("repo"), status: "collateral_locked", transactions: [] };
    agreement.lockReference = await this.chain.lockCollateral(agreement);
    agreement.transactions.push(agreement.lockReference);
    this.repos.set(agreement.id, agreement);
    this.persist();
    return agreement;
  }

  fundRepo(repoId: Id) {
    const repo = this.mustRepo(repoId);
    if (repo.status !== "collateral_locked") throw new Error("Only collateral_locked repo agreements can be funded");
    repo.status = "funded";
    this.persist();
    return repo;
  }

  async releaseRepo(repoId: Id) {
    const repo = this.mustRepo(repoId);
    if (repo.status !== "funded") throw new Error("Only funded repo agreements can be released");
    const transactionId = await this.chain.releaseCollateral(repo);
    repo.transactions.push(transactionId);
    repo.status = "released";
    this.persist();
    return repo;
  }

  async placeOrder(input: Omit<Order, "id" | "remaining" | "status" | "createdAt">) {
    requirePositive(input.quantity, "quantity");
    requirePositive(input.priceHbar, "priceHbar");
    this.requireEligible(input.tokenId, input.owner);
    const order: Order = { ...input, id: id("order"), remaining: input.quantity, status: "open", createdAt: new Date().toISOString() };
    this.orders.set(order.id, order);
    const result = await this.match(order);
    this.persist();
    return result;
  }

  createDistribution(input: Omit<Distribution, "id" | "status">) {
    requirePositive(input.amountHbar, "amountHbar");
    const distribution: Distribution = { ...input, id: id("distribution"), status: "draft" };
    this.distributions.set(distribution.id, distribution);
    this.persist();
    return distribution;
  }

  state() {
    return { repos: [...this.repos.values()], orders: [...this.orders.values()], trades: [...this.trades.values()], distributions: [...this.distributions.values()], kyc: [...this.kyc.entries()].map(([tokenId, accounts]) => ({ tokenId, accounts: [...accounts] })) };
  }

  private async match(taker: Order) {
    const candidates = [...this.orders.values()].filter((maker) => maker.id !== taker.id && maker.status === "open" && maker.tokenId === taker.tokenId && maker.side !== taker.side && this.isEligible(maker.tokenId, maker.owner) && this.isEligible(taker.tokenId, taker.owner) && compatible(taker, maker));
    candidates.sort((a, b) => taker.side === "buy" ? a.priceHbar - b.priceHbar : b.priceHbar - a.priceHbar);
    for (const maker of candidates) {
      if (!taker.remaining) break;
      const quantity = Math.min(taker.remaining, maker.remaining);
      const trade: Trade = { id: id("trade"), tokenId: taker.tokenId, buyOrderId: taker.side === "buy" ? taker.id : maker.id, sellOrderId: taker.side === "sell" ? taker.id : maker.id, buyer: taker.side === "buy" ? taker.owner : maker.owner, seller: taker.side === "sell" ? taker.owner : maker.owner, quantity, priceHbar: maker.priceHbar, createdAt: new Date().toISOString() };
      trade.settlementReference = await this.chain.settleTrade(trade);
      this.trades.set(trade.id, trade);
      taker.remaining -= quantity;
      maker.remaining -= quantity;
      if (!maker.remaining) maker.status = "filled";
    }
    if (!taker.remaining) taker.status = "filled";
    return { order: taker, trades: [...this.trades.values()].filter((trade) => trade.buyOrderId === taker.id || trade.sellOrderId === taker.id) };
  }

  private mustRepo(repoId: string) {
    const repo = this.repos.get(repoId);
    if (!repo) throw new Error("Repo agreement not found");
    return repo;
  }

  private isEligible(tokenId: string, accountId: string) { return this.kyc.get(tokenId)?.has(accountId) === true; }
  private requireEligible(tokenId: string, accountId: string) { if (!this.isEligible(tokenId, accountId)) throw new Error(`Account ${accountId} is not KYC eligible for token ${tokenId}`); }
  private persist() { this.store.save({ repos: [...this.repos.values()], orders: [...this.orders.values()], trades: [...this.trades.values()], distributions: [...this.distributions.values()], kyc: [...this.kyc.entries()].map(([tokenId, accounts]) => [tokenId, [...accounts]]) }); }
}

function compatible(taker: Order, maker: Order) {
  return taker.side === "buy" ? taker.priceHbar >= maker.priceHbar : taker.priceHbar <= maker.priceHbar;
}
function requirePositive(value: number, name: string) { if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`); }
function requireFuture(iso: string) { if (Number.isNaN(Date.parse(iso)) || Date.parse(iso) <= Date.now()) throw new Error("maturityAt must be a future ISO timestamp"); }
