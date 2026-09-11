export const offeredAssetTypes = [
  {
    id: "fixed-income-note",
    name: "Tokenised fixed-income note",
    atsTemplate: "Bond",
    use: "Issuer financing and repo-eligible collateral",
    requiredTerms: ["ISIN", "currency", "nominal value", "maturity date", "coupon terms", "investor eligibility"]
  },
  {
    id: "fund-unit",
    name: "Tokenised fund unit",
    atsTemplate: "Equity",
    use: "Compliant primary issuance and secondary transfers",
    requiredTerms: ["fund documents", "NAV policy", "transfer rules", "investor eligibility"]
  }
] as const;
