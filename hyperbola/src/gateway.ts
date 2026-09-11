import type { ChainGateway, RepoAgreement, Trade } from "./domain.js";

/** ATS adapter. Demo mode is deterministic; testnet mode calls the documented ATS SDK. */
export class AtsGateway implements ChainGateway {
  private initialized = false;
  constructor(private readonly mode: "demo" | "testnet") {}

  async grantKyc(tokenId: string, accountId: string, vcData: string) {
    if (this.mode === "demo") return this.reference("kyc");
    const ats = await this.sdk();
    await ats.Kyc.grantKyc(new ats.GrantKycRequest({ tokenId, targetId: accountId, vcData }));
    return this.reference("kyc");
  }

  async lockCollateral(repo: Pick<RepoAgreement, "tokenId" | "borrower" | "collateralAmount" | "maturityAt">) {
    if (this.mode === "demo") return this.reference("lock");
    // ATS exposes lock operations through its deployed LockFacet. The exact signed call
    // is deployment-specific, so this endpoint refuses to pretend it has custody.
    await this.sdk();
    throw new Error(`Configure a custodial signer for LockFacet.lock on ${repo.tokenId}; server-side lock submission is intentionally fail-closed`);
  }

  async releaseCollateral(repo: RepoAgreement) {
    if (this.mode === "demo") return this.reference("release");
    await this.sdk();
    throw new Error(`Configure a custodial signer for LockFacet.release on ${repo.tokenId}; server-side release is intentionally fail-closed`);
  }

  async settleTrade(trade: Trade) {
    if (this.mode === "demo") return this.reference("trade");
    const ats = await this.sdk();
    await ats.Security.transfer(new ats.TransferRequest({ tokenId: trade.tokenId, targetId: trade.buyer, amount: trade.quantity }));
    return this.reference("trade");
  }

  private async sdk(): Promise<any> {
    const ats = await import("@hashgraph/asset-tokenization-sdk");
    if (!this.initialized) {
      const env = process.env;
      for (const key of ["ATS_RESOLVER_ADDRESS", "ATS_FACTORY_ADDRESS"]) if (!env[key]) throw new Error(`${key} is required in MODE=testnet`);
      await ats.Network.init(new ats.InitializationRequest({
        network: "testnet",
        mirrorNode: { baseUrl: env.HEDERA_MIRROR_NODE || "https://testnet.mirrornode.hedera.com/api/v1/", apiKey: "", headerName: "" },
        rpcNode: { baseUrl: env.HEDERA_RPC_NODE || "https://testnet.hashio.io/api", apiKey: "", headerName: "" },
        configuration: { resolverAddress: env.ATS_RESOLVER_ADDRESS, factoryAddress: env.ATS_FACTORY_ADDRESS }
      }));
      this.initialized = true;
    }
    return ats;
  }

  private reference(action: string) { return `demo-${action}-${crypto.randomUUID()}`; }
}
