export interface CustomerAmount {
  customerId: number;
  amount: number;
}

export interface ReferralEdge {
  id: number;
  referrerCustomerId: number;
  referredCustomerId: number;
  inviteCode: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReferralListResponse<T> {
  items: T[];
  total: number;
  limit: number;
  skip: number;
}

export interface CompletedCommissionOrder {
  id: number;
  customerId: number;
  revenue: number;
  completedAt: number;
}

export interface AccumulationEntitlementInput {
  id?: number;
  customerId: number;
  orderId: number;
  group: string;
  orderAmount: number;
  multiplier: number;
  maximumAmount: number;
  receivedAmount: number;
  remainingAmount: number;
  createdAt: number;
  completed: boolean;
  entitlementVersion: number;
}

export interface AgencyTierPolicy {
  level: number;
  name: string;
  personalRevenueRequired: number;
  smallBranchRevenueRequired: number;
  systemRevenueRateBps: number;
  sameTierRateBps: number;
}

export interface CommissionPolicyInput {
  id: number;
  version: number;
  directCommissionRateBps: number;
  directConsumptionPointRateBps: number;
  accumulationRevenueRateBps: number;
  accumulationIncomeRateBps: number;
  accumulationBelow50MRateBps: number;
  accumulationFrom50MRateBps: number;
  smallBranchRateBps: number;
  smallBranchWeeklyLimit: number;
  positiveIncomeRateBps: number;
  positiveRepurchaseAmount: number;
  positiveUplineRewardRateBps: number;
  resonanceRateBps: number;
  resonanceMinimumOrderAmount: number;
  agencyTiers: AgencyTierPolicy[];
}

export interface DailyCommissionRequest {
  calculationDate: string;
  policy: CommissionPolicyInput;
  orders: CompletedCommissionOrder[];
  referrals: ReferralEdge[];
  activeCustomerIds: number[];
  weeklySmallBranchPaid: CustomerAmount[];
  cumulativeCustomerRevenues?: CustomerAmount[];
  openEntitlements: AccumulationEntitlementInput[];
  accumulationOnlyOrderIds?: number[];
  positiveBalances: CustomerAmount[];
  additionalCommissionIncome: CustomerAmount[];
  manualAccumulationPoolAmount?: number;
  deferAccumulationDistribution?: boolean;
  downstreamOnlyFromAccumulation?: boolean;
  dailySmallBranchSettlement?: boolean;
  skipAccumulationDistributionDownstream?: boolean;
}

export interface CommissionTransactionResult {
  idempotencyKey: string;
  type: string;
  customerId: number;
  sourceCustomerId?: number;
  sourceOrderId?: number;
  rateBps?: number;
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  calculationDate: string;
}

export interface DirectConsumptionPointResult {
  idempotencyKey: string;
  customerId: number;
  sourceCustomerId?: number;
  sourceOrderId: number;
  rateBps: number;
  amount: number;
  calculationDate: string;
}

export interface SmallBranchCommissionResult {
  idempotencyKey: string;
  customerId: number;
  smallestBranchId?: number;
  smallestBranchRevenue?: number;
  excludedLargestBranchIds?: number[];
  eligibleBranchIds?: number[];
  eligibleDailyRevenue?: number;
  rateBps: number;
  calculatedAmount: number;
  paidAmount: number;
  resonanceDeduction: number;
  netPaidAmount: number;
  cappedAmount: number;
  weeklyPaidBefore: number;
  weeklyLimit: number;
  calculationDate: string;
}

export interface IncomeContributionResult {
  idempotencyKey: string;
  customerId: number;
  grossIncome: number;
  rateBps: number;
  contribution: number;
  netIncome: number;
  calculationDate: string;
}

export interface AccumulationDistributionResult {
  idempotencyKey: string;
  customerId: number;
  group: string;
  amount: number;
  calculationDate: string;
  allocations: Array<{ orderId: number; amount: number }>;
}

export interface PositiveAccumulationResult {
  idempotencyKey: string;
  customerId: number;
  grossIncome: number;
  contributionRateBps: number;
  contributionAmount: number;
  incomeAfterContribution: number;
  openingBalance: number;
  balanceBeforeRepurchase: number;
  repurchaseCount: number;
  repurchaseTotalAmount: number;
  closingBalance: number;
  calculationDate: string;
}

export interface DeferredRewardResult {
  idempotencyKey: string;
  type: string;
  customerId: number;
  sourceCustomerId?: number;
  amount?: number;
  paidAmount?: number;
  rateBps: number;
  calculationDate: string;
  [key: string]: unknown;
}

export interface AgencyQualificationResult {
  customerId: number;
  tierLevel: number;
  tierName: string;
  personalRevenue: number;
  smallBranchRevenue: number;
  systemRateBps: number;
  sameTierRateBps: number;
  calculationDate: string;
}

export interface AgencyRewardResult {
  idempotencyKey: string;
  type: string;
  customerId: number;
  sourceCustomerId?: number;
  sourceOrderId?: number;
  rateBps?: number;
  differentialRateBps?: number;
  amount: number;
  calculationDate: string;
  [key: string]: unknown;
}

export interface RepurchaseRequestResult {
  idempotencyKey: string;
  customerId: number;
  sequence: number;
  amount: number;
  calculationDate: string;
}

export interface DailyCommissionResult {
  calculationDate: string;
  weekStartDate: string;
  weekEndDate: string;
  policyId: number;
  policyVersion: number;
  systemRevenue: number;
  directCommissions: CommissionTransactionResult[];
  directConsumptionPoints: DirectConsumptionPointResult[];
  smallBranchCommissions: SmallBranchCommissionResult[];
  incomeContributions: IncomeContributionResult[];
  accumulationPools: Array<{
    group: string;
    allocationRateBps: number;
    availableAmount: number;
    distributedAmount: number;
    unallocatedAmount: number;
    eligibleCustomerCount: number;
  }>;
  accumulationDistributions: AccumulationDistributionResult[];
  entitlements: AccumulationEntitlementInput[];
  positiveAccumulations: PositiveAccumulationResult[];
  repurchaseRequests: RepurchaseRequestResult[];
  positiveUplineRewards: DeferredRewardResult[];
  resonanceRewards: DeferredRewardResult[];
  agencyQualifications: AgencyQualificationResult[];
  agencyRevenueRewards: AgencyRewardResult[];
  agencySameTierRewards: AgencyRewardResult[];
  agencyIncomes: Array<Record<string, unknown>>;
}

export interface ReferralServiceResponse<T> {
  code: number;
  message: string;
  data?: T;
}
