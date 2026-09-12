export interface MirrorVerification { ok: boolean; reason?: string; transactionId?: string }

export class HederaMirrorClient {
  constructor(private readonly baseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  async verifyTransaction(transactionId: string): Promise<MirrorVerification> {
    if (!this.baseUrl) return { ok: false, reason: "HEDERA_MIRROR_NODE is not configured" };
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const response = await this.fetcher(`${base}transactions/${encodeURIComponent(transactionId)}`, { headers: { accept: "application/json" } });
    if (!response.ok) return { ok: false, reason: `Mirror node returned HTTP ${response.status}` };
    const body = await response.json() as { transactions?: Array<{ transaction_id?: string; result?: string }> };
    const transaction = body.transactions?.find((item) => normalizeTransactionId(item.transaction_id || "") === normalizeTransactionId(transactionId)) || body.transactions?.[0];
    if (!transaction) return { ok: false, reason: "Transaction was not found on the Hedera mirror node" };
    if (transaction.transaction_id && normalizeTransactionId(transaction.transaction_id) !== normalizeTransactionId(transactionId)) return { ok: false, reason: "Mirror transaction ID does not match the submitted ID" };
    if (transaction.result !== "SUCCESS") return { ok: false, reason: `Hedera transaction result was ${transaction.result || "unknown"}` };
    return { ok: true, transactionId: transaction.transaction_id || transactionId };
  }
}

function normalizeTransactionId(value: string) {
  const match = value.match(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value;
}
