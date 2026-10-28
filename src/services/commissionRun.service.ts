import { prismaClient } from "../utils/prisma";
import { completeRepurchasesForDate } from "./commissionRepurchase.core";
import { withCommissionRepurchaseStock } from "./commissionRepurchase.service";
import { referralsForDailySnapshot } from "./commissionReferralSnapshot";
import {
  AccumulationEntitlementInput,
  CommissionPolicyInput,
  DailyCommissionRequest,
  DailyCommissionResult,
  DeferredRewardResult,
} from "../types/commission.type";
import referralClientService from "./referralClient.service";
import {
  businessDateFromTimestamp,
  LEGACY_ACCUMULATION_ORDER_SOURCE,
} from "./accumulationPoolTopup.core";

export {
  businessDateFromTimestamp,
  LEGACY_ACCUMULATION_ORDER_SOURCE,
} from "./accumulationPoolTopup.core";

const DAY_MS = 24 * 60 * 60 * 1000;
const GENERATED_ORDER_SOURCES = [
  "commission_positive_repurchase",
  "legacy_sales_import",
];

function defaultCalculationDate(): string {
  return businessDateFromTimestamp(Date.now() - DAY_MS);
}

export function dateBounds(date: string): { start: number; end: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("calculationDate must use YYYY-MM-DD");
  }
  const start = new Date(`${date}T00:00:00+07:00`).getTime();
  if (!Number.isFinite(start)) throw new Error("invalid calculationDate");
  return { start, end: start + DAY_MS };
}

function addDays(date: string, days: number): string {
  const { start } = dateBounds(date);
  return businessDateFromTimestamp(start + days * DAY_MS);
}

function weekStartDate(date: string): string {
  const { start } = dateBounds(date);
  const day = new Date(start + 7 * 60 * 60 * 1000).getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  return addDays(date, -daysFromMonday);
}

export function money(value: bigint | number | null | undefined): number {
  const result = Number(value || 0);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`money value is not a safe integer: ${String(value)}`);
  }
  return result;
}

function arrays(result: DailyCommissionResult): DailyCommissionResult {
  const arrayFields: Array<keyof DailyCommissionResult> = [
    "directCommissions",
    "directConsumptionPoints",
    "smallBranchCommissions",
    "incomeContributions",
    "accumulationPools",
    "accumulationDistributions",
    "entitlements",
    "positiveAccumulations",
    "repurchaseRequests",
    "positiveUplineRewards",
    "resonanceRewards",
    "agencyQualifications",
    "agencyRevenueRewards",
    "agencySameTierRewards",
    "agencyIncomes",
  ];
  const mutable = result as unknown as Record<string, unknown>;
  for (const field of arrayFields) {
    if (!Array.isArray(mutable[field])) mutable[field] = [];
  }
  return result;
}

export async function getPolicy(
  calculationDate: string,
): Promise<CommissionPolicyInput> {
  const { start } = dateBounds(calculationDate);
  const policy = await prismaClient.commissionPolicy.findFirst({
    where: {
      status: "active",
      effectiveFrom: { lte: BigInt(start) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: BigInt(start) } }],
    },
    include: { agencyTiers: { orderBy: { level: "asc" } } },
    orderBy: [{ version: "desc" }, { id: "desc" }],
  });
  if (!policy) {
    throw new Error(`no active commission policy for ${calculationDate}`);
  }
  return {
    id: policy.id,
    version: policy.version,
    directCommissionRateBps: policy.directCommissionRateBps,
    directConsumptionPointRateBps: policy.directConsumptionPointRateBps,
    accumulationRevenueRateBps: policy.accumulationRevenueRateBps,
    accumulationIncomeRateBps: policy.accumulationIncomeRateBps,
    accumulationBelow50MRateBps: policy.accumulationBelow50MRateBps,
    accumulationFrom50MRateBps: policy.accumulationFrom50MRateBps,
    smallBranchRateBps: policy.smallBranchRateBps,
    smallBranchWeeklyLimit: money(policy.smallBranchWeeklyLimit),
    positiveIncomeRateBps: policy.positiveIncomeRateBps,
    positiveRepurchaseAmount: money(policy.positiveRepurchaseAmount),
    positiveUplineRewardRateBps: policy.positiveUplineRewardRateBps,
    resonanceRateBps: policy.resonanceRateBps,
    resonanceMinimumOrderAmount: money(policy.resonanceMinimumOrderAmount),
    agencyTiers: policy.agencyTiers.map((tier) => ({
      level: tier.level,
      name: tier.name,
      personalRevenueRequired: money(tier.personalRevenueRequired),
      smallBranchRevenueRequired: money(tier.smallBranchRevenueRequired),
      systemRevenueRateBps: tier.systemRevenueRateBps,
      sameTierRateBps: tier.sameTierRateBps,
    })),
  };
}

export async function buildRequest(
  calculationDate: string,
  includeLegacyAccumulationOrders = true,
): Promise<DailyCommissionRequest> {
  const { start, end } = dateBounds(calculationDate);
  const monday = weekStartDate(calculationDate);
  const [
    policy,
    rawOrders,
    rawReferrals,
    activeCustomers,
    weeklyTransactions,
    rawEntitlements,
    rawPositiveBalances,
    deferredIncome,
  ] = await Promise.all([
    getPolicy(calculationDate),
    prismaClient.order.findMany({
      where: {
        paymentStatus: "completed",
        timeCompletedOrder: { gte: BigInt(start), lt: BigInt(end) },
        AND: [
          {
            OR: [{ typeOrder: null }, { typeOrder: { not: "return_order" } }],
          },
          {
            OR: [
              { sourceOrder: null },
              {
                sourceOrder: {
                  notIn: includeLegacyAccumulationOrders
                    ? GENERATED_ORDER_SOURCES
                    : [...GENERATED_ORDER_SOURCES, LEGACY_ACCUMULATION_ORDER_SOURCE],
                },
              },
            ],
          },
        ],
      },
      select: {
        id: true,
        customerId: true,
        totalMoney: true,
        shipMoney: true,
        timeCompletedOrder: true,
      },
      orderBy: { id: "asc" },
    }),
    prismaClient.referral.findMany({ orderBy: { id: "asc" } }),
    prismaClient.customer.findMany({
      where: { OR: [{ isBlock: false }, { isBlock: null }] },
      select: { id: true },
      orderBy: { id: "asc" },
    }),
    prismaClient.commissionTransaction.findMany({
      where: {
        type: "small_branch",
        direction: "credit",
        calculationDate: { gte: monday, lt: calculationDate },
      },
      select: { customerId: true, grossAmount: true },
    }),
    prismaClient.accumulationEntitlement.findMany({
      where: { completed: false },
      orderBy: [{ sourceCreatedAt: "asc" }, { orderId: "asc" }],
    }),
    prismaClient.positiveBalance.findMany({ orderBy: { customerId: "asc" } }),
    prismaClient.deferredCommissionIncome.findMany({
      where: { availableDate: calculationDate, consumedRunId: null },
      orderBy: { id: "asc" },
    }),
  ]);

  const weeklyByCustomer = new Map<number, number>();
  for (const item of weeklyTransactions) {
    weeklyByCustomer.set(
      item.customerId,
      (weeklyByCustomer.get(item.customerId) || 0) + money(item.grossAmount),
    );
  }
  const deferredByCustomer = new Map<number, number>();
  for (const item of deferredIncome) {
    deferredByCustomer.set(
      item.customerId,
      (deferredByCustomer.get(item.customerId) || 0) + money(item.amount),
    );
  }

  const orders = rawOrders
    .map((order) => {
      const customerId = Number(order.customerId);
      const revenue = (order.totalMoney || 0) - (order.shipMoney || 0);
      if (!Number.isSafeInteger(customerId) || customerId <= 0) {
        throw new Error(`order ${order.id} has invalid customerId`);
      }
      if (!Number.isSafeInteger(revenue)) {
        throw new Error(
          `order ${order.id} revenue is not an integer VND value`,
        );
      }
      return {
        id: order.id,
        customerId,
        revenue,
        completedAt: money(order.timeCompletedOrder),
      };
    })
    .filter((order) => order.revenue > 0);

  return {
    calculationDate,
    policy,
    orders,
    referrals: rawReferrals.map((edge) => ({
      id: money(edge.id),
      referrerCustomerId: edge.referrerCustomerId,
      referredCustomerId: edge.referredCustomerId,
      inviteCode: edge.inviteCode,
      createdAt: money(edge.createdAt),
      updatedAt: money(edge.updatedAt),
    })),
    activeCustomerIds: activeCustomers.map((customer) => customer.id),
    weeklySmallBranchPaid: [...weeklyByCustomer.entries()].map(
      ([customerId, amount]) => ({ customerId, amount }),
    ),
    openEntitlements: rawEntitlements.map(
      (item): AccumulationEntitlementInput => ({
        id: money(item.id),
        customerId: item.customerId,
        orderId: money(item.orderId),
        group: item.groupName,
        orderAmount: money(item.orderAmount),
        multiplier: money(item.multiplier),
        maximumAmount: money(item.maximumAmount),
        receivedAmount: money(item.receivedAmount),
        remainingAmount: money(item.remainingAmount),
        createdAt: money(item.sourceCreatedAt),
        completed: item.completed,
        entitlementVersion: item.entitlementVersion,
      }),
    ),
    positiveBalances: rawPositiveBalances.map((item) => ({
      customerId: item.customerId,
      amount: money(item.balance),
    })),
    additionalCommissionIncome: [...deferredByCustomer.entries()].map(
      ([customerId, amount]) => ({ customerId, amount }),
    ),
  };
}

export async function callCalculator(
  payload: DailyCommissionRequest,
): Promise<DailyCommissionResult> {
  const result = await referralClientService.calculateDailyCommission(payload);
  return arrays(result);
}

function rewardAmount(reward: DeferredRewardResult): number {
  return Number(reward.amount ?? reward.paidAmount ?? 0);
}

// Giữ để đọc/đối soát các snapshot run cũ trước migration; scheduler mới không
// gọi hàm này vì từ nay cron chỉ được phép ghi kết quả Mục 2.
export async function persistLegacyDailyResult(
  runId: bigint,
  requestPayload: DailyCommissionRequest,
  result: DailyCommissionResult,
): Promise<void> {
  const now = Date.now();
  const availableDate = addDays(result.calculationDate, 1);
  await withCommissionRepurchaseStock((reserveStock) => prismaClient.$transaction(
    async (tx: any) => {
      const transactions: any[] = [];
      // Mục 1 - Hoa hồng trực tiếp: ghi khoản tiền người giới thiệu được nhận.
      for (const item of result.directCommissions) {
        transactions.push({
          idempotencyKey: item.idempotencyKey,
          runId,
          calculationDate: result.calculationDate,
          type: item.type || "direct",
          direction: "credit",
          customerId: item.customerId,
          sourceCustomerId: item.sourceCustomerId || null,
          sourceOrderId: item.sourceOrderId ? BigInt(item.sourceOrderId) : null,
          rateBps: item.rateBps || null,
          grossAmount: BigInt(item.grossAmount || 0),
          deductionAmount: BigInt(item.deductionAmount || 0),
          netAmount: BigInt(item.netAmount || 0),
          amount: BigInt(item.netAmount || 0),
          metadata: item,
        });
      }
      // Mục 3 - Thưởng doanh số nhóm nhỏ: lưu cả tiền trước và sau khi Mục 5 trừ.
      for (const item of result.smallBranchCommissions) {
        transactions.push({
          idempotencyKey: item.idempotencyKey,
          runId,
          calculationDate: result.calculationDate,
          type: "small_branch",
          direction: "credit",
          customerId: item.customerId,
          rateBps: item.rateBps,
          grossAmount: BigInt(item.paidAmount || 0),
          deductionAmount: BigInt(item.resonanceDeduction || 0),
          netAmount: BigInt(item.netPaidAmount || 0),
          amount: BigInt(item.netPaidAmount || 0),
          metadata: item,
        });
      }
      // Mục 2 - Tiêu dùng tích sản: khoản trích từ thu nhập là một giao dịch ghi nợ.
      for (const item of result.incomeContributions) {
        transactions.push({
          idempotencyKey: item.idempotencyKey,
          runId,
          calculationDate: result.calculationDate,
          type: "income_contribution",
          direction: "debit",
          customerId: item.customerId,
          rateBps: item.rateBps,
          grossAmount: BigInt(item.grossIncome || 0),
          deductionAmount: BigInt(item.contribution || 0),
          netAmount: BigInt(item.netIncome || 0),
          amount: BigInt(item.contribution || 0),
          metadata: item,
        });
      }
      // Mục 2 - Tiêu dùng tích sản: phần quỹ phân phối là giao dịch ghi có.
      for (const item of result.accumulationDistributions) {
        transactions.push({
          idempotencyKey: item.idempotencyKey,
          runId,
          calculationDate: result.calculationDate,
          type: "accumulation",
          direction: "credit",
          customerId: item.customerId,
          grossAmount: BigInt(item.amount || 0),
          netAmount: BigInt(item.amount || 0),
          amount: BigInt(item.amount || 0),
          metadata: item,
        });
      }
      // Khoản Mục 2 vừa phân phối là thu nhập mới tại 07:00, vì vậy Mục 4
      // được xử lý ngay trong cùng transaction (không chờ ngày kế tiếp).
      for (const item of result.positiveAccumulations) {
        const idempotencyKey = `accumulation-downstream:${item.idempotencyKey}`;
        await tx.commissionTransaction.upsert({
          where: { idempotencyKey },
          create: {
            idempotencyKey,
            runId,
            calculationDate: result.calculationDate,
            type: "positive_contribution",
            direction: "debit",
            customerId: item.customerId,
            rateBps: item.contributionRateBps,
            grossAmount: BigInt(item.grossIncome || 0),
            deductionAmount: BigInt(item.contributionAmount || 0),
            netAmount: BigInt(item.incomeAfterContribution || 0),
            amount: BigInt(item.contributionAmount || 0),
            metadata: item,
            createdAt: BigInt(now),
          },
          update: {
            runId,
            grossAmount: BigInt(item.grossIncome || 0),
            deductionAmount: BigInt(item.contributionAmount || 0),
            netAmount: BigInt(item.incomeAfterContribution || 0),
            amount: BigInt(item.contributionAmount || 0),
            metadata: item,
          },
        });
      }
      for (const item of result.positiveUplineRewards) {
        const amount = BigInt(item.amount || 0);
        const idempotencyKey = `accumulation-downstream:${item.idempotencyKey}`;
        await tx.commissionTransaction.upsert({
          where: { idempotencyKey },
          create: {
            idempotencyKey,
            runId,
            calculationDate: result.calculationDate,
            type: item.type,
            direction: "credit",
            customerId: item.customerId,
            sourceCustomerId: item.sourceCustomerId || null,
            rateBps: item.rateBps || null,
            grossAmount: amount,
            netAmount: amount,
            amount,
            metadata: item,
            createdAt: BigInt(now),
          },
          update: {
            runId,
            grossAmount: amount,
            netAmount: amount,
            amount,
            metadata: item,
          },
        });
      }
      // Mục 4 - Thưởng tích cực: trích thu nhập vào số dư tích lũy.
      for (const item of result.positiveAccumulations) {
        transactions.push({
          idempotencyKey: item.idempotencyKey,
          runId,
          calculationDate: result.calculationDate,
          type: "positive_contribution",
          direction: "debit",
          customerId: item.customerId,
          rateBps: item.contributionRateBps,
          grossAmount: BigInt(item.grossIncome || 0),
          deductionAmount: BigInt(item.contributionAmount || 0),
          netAmount: BigInt(item.incomeAfterContribution || 0),
          amount: BigInt(item.contributionAmount || 0),
          metadata: item,
        });
      }
      // Mục 4 (TVBT) và Mục 5 được ghi nhận ở ngày phát sinh để đối soát,
      // đồng thời deferredCommissionIncome quyết định ngày khoản này được đưa
      // vào thu nhập tính tiếp.
      for (const item of [
        ...result.positiveUplineRewards,
        ...result.resonanceRewards,
      ]) {
        const amount = rewardAmount(item);
        transactions.push({
          idempotencyKey: item.idempotencyKey,
          runId,
          calculationDate: result.calculationDate,
          type: item.type,
          direction: "credit",
          customerId: item.customerId,
          sourceCustomerId: item.sourceCustomerId || null,
          rateBps: item.rateBps || null,
          grossAmount: BigInt(amount),
          netAmount: BigInt(amount),
          amount: BigInt(amount),
          metadata: item,
        });
      }
      for (const item of [
        ...result.agencyRevenueRewards,
        ...result.agencySameTierRewards,
      ]) {
        // Mục 6 - Thưởng đại lý: lưu thưởng chênh lệch và thưởng đồng cấp.
        transactions.push({
          idempotencyKey: item.idempotencyKey,
          runId,
          calculationDate: result.calculationDate,
          type: item.type,
          direction: "credit",
          customerId: item.customerId,
          sourceCustomerId: item.sourceCustomerId || null,
          sourceOrderId: item.sourceOrderId ? BigInt(item.sourceOrderId) : null,
          rateBps: item.rateBps || item.differentialRateBps || null,
          grossAmount: BigInt(item.amount || 0),
          netAmount: BigInt(item.amount || 0),
          amount: BigInt(item.amount || 0),
          metadata: item,
        });
      }
      if (transactions.length > 0) {
        await tx.commissionTransaction.createMany({
          data: transactions.map((transaction) => ({
            ...transaction,
            createdAt: BigInt(now),
          })),
          skipDuplicates: true,
        });
      }

      for (const item of result.entitlements) {
        // Mục 2 - Lưu hạn mức còn lại của từng đơn cho ngày tiếp theo.
        await tx.accumulationEntitlement.upsert({
          where: { orderId: BigInt(item.orderId) },
          create: {
            customerId: item.customerId,
            orderId: BigInt(item.orderId),
            groupName: item.group,
            orderAmount: BigInt(item.orderAmount),
            multiplier: BigInt(item.multiplier),
            maximumAmount: BigInt(item.maximumAmount),
            // Go response dùng omitempty nên các giá trị số bằng 0 có thể
            // không xuất hiện trong JSON. Luôn chuẩn hóa về 0 trước khi đổi
            // sang BigInt để persist kết quả hoa hồng an toàn.
            receivedAmount: BigInt(item.receivedAmount || 0),
            remainingAmount: BigInt(item.remainingAmount || 0),
            entitlementVersion: item.entitlementVersion,
            completed: item.completed,
            sourceCreatedAt: BigInt(item.createdAt),
            createdAt: BigInt(now),
            updatedAt: BigInt(now),
          },
          update: {
            groupName: item.group,
            receivedAmount: BigInt(item.receivedAmount || 0),
            remainingAmount: BigInt(item.remainingAmount || 0),
            completed: item.completed,
            updatedAt: BigInt(now),
          },
        });
      }
      for (const item of result.accumulationPools) {
        await tx.accumulationPoolDaily.upsert({
          where: {
            calculationDate_groupName: {
              calculationDate: result.calculationDate,
              groupName: item.group,
            },
          },
          create: {
            runId,
            calculationDate: result.calculationDate,
            groupName: item.group,
            allocationRateBps: item.allocationRateBps,
            availableAmount: BigInt(item.availableAmount || 0),
            distributedAmount: BigInt(item.distributedAmount || 0),
            unallocatedAmount: BigInt(item.unallocatedAmount || 0),
            eligibleCustomerCount: item.eligibleCustomerCount || 0,
            createdAt: BigInt(now),
          },
          update: {
            runId,
            availableAmount: BigInt(item.availableAmount || 0),
            distributedAmount: BigInt(item.distributedAmount || 0),
            unallocatedAmount: BigInt(item.unallocatedAmount || 0),
            eligibleCustomerCount: item.eligibleCustomerCount || 0,
          },
        });
      }
      for (const item of result.positiveAccumulations) {
        await tx.positiveBalance.upsert({
          where: { customerId: item.customerId },
          create: {
            customerId: item.customerId,
            balance: BigInt(item.closingBalance || 0),
            updatedAt: now,
          },
          update: { balance: BigInt(item.closingBalance || 0), updatedAt: now },
        });
      }
      const downstreamRepurchases = result.repurchaseRequests.map((item) => ({
        ...item,
        ruleType: "positive",
      }));
      if (downstreamRepurchases.length > 0) {
        await tx.commissionRepurchase.createMany({
          data: downstreamRepurchases.map((item) => ({
            idempotencyKey: `accumulation-downstream:${item.idempotencyKey}`,
            runId,
            calculationDate: item.calculationDate,
            customerId: item.customerId,
            ruleType: item.ruleType,
            sequence: item.sequence,
            amount: BigInt(item.amount),
            status: "pending",
          })),
          skipDuplicates: true,
        });
      }
      for (const item of result.positiveAccumulations) {
        // Mục 4 - Chốt số dư tài khoản tích lũy cuối ngày.
        await tx.positiveBalance.upsert({
          where: { customerId: item.customerId },
          create: {
            customerId: item.customerId,
            balance: BigInt(item.closingBalance || 0),
            updatedAt: BigInt(now),
          },
          update: {
            balance: BigInt(item.closingBalance || 0),
            updatedAt: BigInt(now),
          },
        });
      }
      const deferredRows = [
        ...result.positiveUplineRewards,
        ...result.resonanceRewards,
      ]
        .map((item) => ({
          idempotencyKey: item.idempotencyKey,
          sourceRunId: runId,
          customerId: item.customerId,
          sourceCustomerId: item.sourceCustomerId || null,
          sourceType: item.type,
          amount: BigInt(rewardAmount(item)),
          availableDate,
        }))
        .filter((item) => item.amount > BigInt(0));
      if (deferredRows.length > 0) {
        await tx.deferredCommissionIncome.createMany({
          data: deferredRows,
          skipDuplicates: true,
        });
      }
      if (result.agencyQualifications.length > 0) {
        await tx.agencyQualificationDaily.createMany({
          data: result.agencyQualifications.map((item) => ({
            runId,
            calculationDate: result.calculationDate,
            customerId: item.customerId,
            tierLevel: item.tierLevel,
            tierName: item.tierName,
            personalRevenue: BigInt(item.personalRevenue || 0),
            smallBranchRevenue: BigInt(item.smallBranchRevenue || 0),
            systemRateBps: item.systemRateBps,
            sameTierRateBps: item.sameTierRateBps,
          })),
          skipDuplicates: true,
        });
      }
      const repurchases = result.repurchaseRequests.map((item) => ({
        ...item,
        ruleType: "positive",
      }));
      if (repurchases.length > 0) {
        await tx.commissionRepurchase.createMany({
          data: repurchases.map((item) => ({
            idempotencyKey: item.idempotencyKey,
            runId,
            calculationDate: item.calculationDate,
            customerId: item.customerId,
            ruleType: item.ruleType,
            sequence: item.sequence,
            amount: BigInt(item.amount),
            status: "pending",
          })),
          skipDuplicates: true,
        });
      }

      await completeRepurchasesForDate(tx, result.calculationDate, reserveStock);
      await tx.deferredCommissionIncome.updateMany({
        where: {
          availableDate: requestPayload.calculationDate,
          consumedRunId: null,
        },
        data: { consumedRunId: runId, consumedAt: BigInt(now) },
      });
      await tx.commissionRun.update({
        where: { id: runId },
        data: {
          status: "completed",
          policyId: result.policyId,
          policyVersion: result.policyVersion,
          systemRevenue: BigInt(result.systemRevenue || 0),
          responseSnapshot: result as any,
          completedAt: BigInt(now),
          errorMessage: null,
        },
      });
    },
    { maxWait: 30000, timeout: 120000 },
  ));
}

export async function buildAccumulationRequest(
  calculationDate: string,
): Promise<DailyCommissionRequest> {
  const [base, reserves, topupTotals, realtimeRun] = await Promise.all([
    buildRequest(calculationDate),
    prismaClient.commissionIncomeReserveDaily.findMany({
      where: { calculationDate, status: "pending" },
      orderBy: { customerId: "asc" },
    }),
    prismaClient.$queryRaw<Array<{ amount: bigint }>>`
      SELECT COALESCE(SUM("amount"), 0)::bigint AS amount
      FROM "accumulationPoolTopup"
      WHERE "calculationDate" = ${calculationDate}
    `,
    prismaClient.commissionRealtimeRun.findUnique({
      where: { calculationDate },
      select: { requestSnapshot: true },
    }),
  ]);
  const realtimeSnapshot = realtimeRun?.requestSnapshot as unknown as
    | DailyCommissionRequest
    | undefined;
  const todayOrderIds = base.orders.map((item) => item.id);
  const legacyOrders = todayOrderIds.length
    ? await prismaClient.order.findMany({
        where: {
          id: { in: todayOrderIds },
          OR: [
            { sourceOrder: LEGACY_ACCUMULATION_ORDER_SOURCE },
            { requestId: { startsWith: "legacy-accumulation-50:" } },
          ],
        },
        select: { id: true },
      })
    : [];
  // Kỳ nhập đơn cũ chỉ phục vụ Mục 2. Quỹ từ đơn import còn có thể chia cho
  // hạn mức của đơn thường đang mở, nên riêng kỳ này không nối khoản vừa chia
  // sang Mục 4. Các kỳ sau vẫn xử lý bình thường cho đơn thường.
  const hasLegacyOrdersToday = legacyOrders.length > 0;
  // Snapshot cũ đã ghi Mục 3 realtime thì không ghi lần nữa ở cron.
  const dailySmallBranchSettlement =
    !realtimeSnapshot || realtimeSnapshot.dailySmallBranchSettlement === true;
  const { end } = dateBounds(calculationDate);
  const cumulativeRows = dailySmallBranchSettlement
    ? await prismaClient.$queryRaw<Array<{ customerId: number; amount: bigint }>>`
        SELECT c.id AS "customerId",
          (COALESCE(c."salesRevenue", 0) + COALESCE(orders.amount, 0))::bigint AS amount
        FROM customer c
        LEFT JOIN (
          SELECT o."customerId",
            SUM(GREATEST(COALESCE(o."totalMoney", 0) - COALESCE(o."shipMoney", 0), 0))::bigint AS amount
          FROM "order" o
          WHERE o."paymentStatus" = 'completed'
            AND o."timeCompletedOrder" IS NOT NULL
            AND o."timeCompletedOrder" < ${BigInt(end)}
            AND (o."typeOrder" IS NULL OR o."typeOrder" <> 'return_order')
            AND (o."sourceOrder" IS NULL OR o."sourceOrder" NOT IN
              ('commission_positive_repurchase', 'legacy_accumulation_import'))
            AND (o."requestId" IS NULL OR o."requestId" NOT LIKE 'legacy-accumulation-50:%')
          GROUP BY o."customerId"
        ) orders ON orders."customerId" = c.id
        WHERE c."salesRevenue" IS NOT NULL OR orders.amount IS NOT NULL
      `
    : [];
  return {
    ...base,
    // Cron chia ngày dùng cùng cây với phần hoa hồng realtime của ngày đó.
    referrals: referralsForDailySnapshot(base.referrals, realtimeSnapshot?.referrals),
    accumulationOnlyOrderIds: legacyOrders.map((order) => money(order.id)),
    // Cron 07:00 tính Mục 3 mới và Mục 2 cùng kỳ. Các mục đã trả realtime
    // không được tính lại; khoản thu nhập cũ lấy từ tiền đã giữ.
    policy: {
      ...base.policy,
      directCommissionRateBps: 0,
      directConsumptionPointRateBps: 0,
      smallBranchRateBps: dailySmallBranchSettlement
        ? base.policy.smallBranchRateBps
        : 0,
      smallBranchWeeklyLimit: dailySmallBranchSettlement
        ? base.policy.smallBranchWeeklyLimit
        : 0,
      resonanceRateBps: dailySmallBranchSettlement
        ? base.policy.resonanceRateBps
        : 0,
      resonanceMinimumOrderAmount: dailySmallBranchSettlement
        ? base.policy.resonanceMinimumOrderAmount
        : 0,
      agencyTiers: [],
      ...(hasLegacyOrdersToday && !dailySmallBranchSettlement
        ? {
            positiveIncomeRateBps: 0,
            positiveRepurchaseAmount: 0,
            positiveUplineRewardRateBps: 0,
          }
        : {}),
    },
    weeklySmallBranchPaid: dailySmallBranchSettlement
      ? base.weeklySmallBranchPaid
      : [],
    cumulativeCustomerRevenues: cumulativeRows.map((row) => ({
      customerId: row.customerId,
      amount: money(row.amount),
    })),
    dailySmallBranchSettlement,
    skipAccumulationDistributionDownstream:
      hasLegacyOrdersToday && dailySmallBranchSettlement,
    additionalCommissionIncome: reserves.map((item) => ({
      customerId: item.customerId,
      amount: money(item.grossIncome),
    })),
    manualAccumulationPoolAmount: money(topupTotals[0]?.amount),
    positiveBalances: hasLegacyOrdersToday ? [] : base.positiveBalances,
    deferAccumulationDistribution: false,
    downstreamOnlyFromAccumulation: true,
  };
}

async function persistAccumulationDownstream(
  tx: any,
  runId: bigint,
  result: DailyCommissionResult,
  now: bigint,
): Promise<void> {
  // Khoản Mục 2 vừa phân phối là thu nhập mới tại 07:00, vì vậy Mục 4
  // được xử lý ngay, nhưng dùng namespace riêng để không đè giao dịch
  // realtime của ngày nguồn.
  for (const item of result.positiveAccumulations) {
    const idempotencyKey = `accumulation-downstream:${item.idempotencyKey}`;
    await tx.commissionTransaction.upsert({
      where: { idempotencyKey },
      create: {
        idempotencyKey,
        runId,
        calculationDate: result.calculationDate,
        type: "positive_contribution",
        direction: "debit",
        customerId: item.customerId,
        rateBps: item.contributionRateBps,
        grossAmount: BigInt(item.grossIncome || 0),
        deductionAmount: BigInt(item.contributionAmount || 0),
        netAmount: BigInt(item.incomeAfterContribution || 0),
        amount: BigInt(item.contributionAmount || 0),
        metadata: item,
        createdAt: now,
      },
      update: {
        runId,
        grossAmount: BigInt(item.grossIncome || 0),
        deductionAmount: BigInt(item.contributionAmount || 0),
        netAmount: BigInt(item.incomeAfterContribution || 0),
        amount: BigInt(item.contributionAmount || 0),
        metadata: item,
      },
    });
  }
  for (const item of result.positiveUplineRewards) {
    const idempotencyKey = `accumulation-downstream:${item.idempotencyKey}`;
    const amount = BigInt(item.amount || 0);
    await tx.commissionTransaction.upsert({
      where: { idempotencyKey },
      create: {
        idempotencyKey,
        runId,
        calculationDate: result.calculationDate,
        type: item.type,
        direction: "credit",
        customerId: item.customerId,
        sourceCustomerId: item.sourceCustomerId || null,
        rateBps: item.rateBps || null,
        grossAmount: amount,
        netAmount: amount,
        amount,
        metadata: item,
        createdAt: now,
      },
      update: {
        runId,
        grossAmount: amount,
        netAmount: amount,
        amount,
        metadata: item,
      },
    });
  }
  for (const item of result.positiveAccumulations) {
    await tx.positiveBalance.upsert({
      where: { customerId: item.customerId },
      create: {
        customerId: item.customerId,
        balance: BigInt(item.closingBalance || 0),
        updatedAt: now,
      },
      update: { balance: BigInt(item.closingBalance || 0), updatedAt: now },
    });
  }
  const repurchases = result.repurchaseRequests.map((item) => ({
    ...item,
    ruleType: "positive",
  }));
  if (repurchases.length > 0) {
    await tx.commissionRepurchase.createMany({
      data: repurchases.map((item) => ({
        idempotencyKey: `accumulation-downstream:${item.idempotencyKey}`,
        runId,
        calculationDate: item.calculationDate,
        customerId: item.customerId,
        ruleType: item.ruleType,
        sequence: item.sequence,
        amount: BigInt(item.amount),
        status: "pending",
      })),
      skipDuplicates: true,
    });
  }
}

async function persistAccumulationResult(
  runId: bigint,
  result: DailyCommissionResult,
): Promise<void> {
  const now = BigInt(Date.now());
  await withCommissionRepurchaseStock((reserveStock) => prismaClient.$transaction(
    async (tx: any) => {
      const reserves = await tx.commissionIncomeReserveDaily.findMany({
        where: { calculationDate: result.calculationDate, status: "pending" },
      });
      const reserveByCustomer = new Map<number, { grossIncome: bigint; reservedAmount: bigint }>(
        reserves.map((item: any) => [item.customerId, {
          grossIncome: item.grossIncome,
          reservedAmount: item.reservedAmount,
        }]),
      );
      const newIncomeByCustomer = new Map<number, bigint>();
      for (const item of result.smallBranchCommissions) {
        newIncomeByCustomer.set(
          item.customerId,
          (newIncomeByCustomer.get(item.customerId) || BigInt(0)) +
            BigInt(item.netPaidAmount || 0),
        );
      }
      for (const item of result.resonanceRewards) {
        newIncomeByCustomer.set(
          item.customerId,
          (newIncomeByCustomer.get(item.customerId) || BigInt(0)) +
            BigInt(rewardAmount(item)),
        );
      }
      for (const item of result.incomeContributions) {
        const contribution = BigInt(item.contribution || 0);
        const previouslyHeld = reserveByCustomer.get(item.customerId);
        const newIncome = newIncomeByCustomer.get(item.customerId) || BigInt(0);
        if (
          contribution < (previouslyHeld?.reservedAmount || BigInt(0)) ||
          BigInt(item.grossIncome || 0) !==
            (previouslyHeld?.grossIncome || BigInt(0)) + newIncome ||
          (newIncome === BigInt(0) &&
            contribution !== (previouslyHeld?.reservedAmount || BigInt(0)))
        ) {
          throw new Error(
            `Mục 2 customer ${item.customerId}: quyết toán không khớp khoản đã giữ và thu nhập Mục 3`,
          );
        }
        await tx.commissionTransaction.upsert({
          where: { idempotencyKey: item.idempotencyKey },
          create: {
            idempotencyKey: item.idempotencyKey,
            runId,
            calculationDate: result.calculationDate,
            type: "income_contribution",
            direction: "debit",
            customerId: item.customerId,
            rateBps: item.rateBps,
            grossAmount: BigInt(item.grossIncome || 0),
            deductionAmount: contribution,
            netAmount: BigInt(item.netIncome || 0),
            amount: contribution,
            metadata: item,
            createdAt: now,
          },
          update: {
            runId,
            grossAmount: BigInt(item.grossIncome || 0),
            deductionAmount: contribution,
            netAmount: BigInt(item.netIncome || 0),
            amount: contribution,
            metadata: item,
          },
        });
      }
      for (const item of result.smallBranchCommissions) {
        await tx.commissionTransaction.upsert({
          where: { idempotencyKey: item.idempotencyKey },
          create: {
            idempotencyKey: item.idempotencyKey,
            runId,
            calculationDate: result.calculationDate,
            type: "small_branch",
            direction: "credit",
            customerId: item.customerId,
            rateBps: item.rateBps,
            grossAmount: BigInt(item.paidAmount || 0),
            deductionAmount: BigInt(item.resonanceDeduction || 0),
            netAmount: BigInt(item.netPaidAmount || 0),
            amount: BigInt(item.netPaidAmount || 0),
            metadata: item,
            createdAt: now,
          },
          update: {
            runId,
            grossAmount: BigInt(item.paidAmount || 0),
            deductionAmount: BigInt(item.resonanceDeduction || 0),
            netAmount: BigInt(item.netPaidAmount || 0),
            amount: BigInt(item.netPaidAmount || 0),
            metadata: item,
          },
        });
      }
      for (const item of result.resonanceRewards) {
        const amount = BigInt(rewardAmount(item));
        await tx.commissionTransaction.upsert({
          where: { idempotencyKey: item.idempotencyKey },
          create: {
            idempotencyKey: item.idempotencyKey,
            runId,
            calculationDate: result.calculationDate,
            type: "resonance",
            direction: "credit",
            customerId: item.customerId,
            sourceCustomerId: item.sourceCustomerId || null,
            rateBps: item.rateBps || null,
            grossAmount: amount,
            netAmount: amount,
            amount,
            metadata: item,
            createdAt: now,
          },
          update: {
            runId,
            grossAmount: amount,
            netAmount: amount,
            amount,
            metadata: item,
          },
        });
      }
      for (const item of result.accumulationDistributions) {
        const amount = BigInt(item.amount || 0);
        await tx.commissionTransaction.upsert({
          where: { idempotencyKey: item.idempotencyKey },
          create: {
            idempotencyKey: item.idempotencyKey,
            runId,
            calculationDate: result.calculationDate,
            type: "accumulation",
            direction: "credit",
            customerId: item.customerId,
            grossAmount: amount,
            netAmount: amount,
            amount,
            metadata: item,
            createdAt: now,
          },
          update: {
            runId,
            grossAmount: amount,
            netAmount: amount,
            amount,
            metadata: item,
          },
        });
      }
      for (const item of result.entitlements) {
        await tx.accumulationEntitlement.upsert({
          where: { orderId: BigInt(item.orderId) },
          create: {
            customerId: item.customerId,
            orderId: BigInt(item.orderId),
            groupName: item.group,
            orderAmount: BigInt(item.orderAmount),
            multiplier: BigInt(item.multiplier),
            maximumAmount: BigInt(item.maximumAmount),
            receivedAmount: BigInt(item.receivedAmount || 0),
            remainingAmount: BigInt(item.remainingAmount || 0),
            entitlementVersion: item.entitlementVersion,
            completed: item.completed,
            sourceCreatedAt: BigInt(item.createdAt),
            createdAt: now,
            updatedAt: now,
          },
          update: {
            groupName: item.group,
            receivedAmount: BigInt(item.receivedAmount || 0),
            remainingAmount: BigInt(item.remainingAmount || 0),
            completed: item.completed,
            updatedAt: now,
          },
        });
      }
      for (const item of result.accumulationPools) {
        await tx.accumulationPoolDaily.upsert({
          where: {
            calculationDate_groupName: {
              calculationDate: result.calculationDate,
              groupName: item.group,
            },
          },
          create: {
            runId,
            calculationDate: result.calculationDate,
            groupName: item.group,
            allocationRateBps: item.allocationRateBps,
            availableAmount: BigInt(item.availableAmount || 0),
            distributedAmount: BigInt(item.distributedAmount || 0),
            unallocatedAmount: BigInt(item.unallocatedAmount || 0),
            eligibleCustomerCount: item.eligibleCustomerCount || 0,
            createdAt: now,
          },
          update: {
            runId,
            availableAmount: BigInt(item.availableAmount || 0),
            distributedAmount: BigInt(item.distributedAmount || 0),
            unallocatedAmount: BigInt(item.unallocatedAmount || 0),
            eligibleCustomerCount: item.eligibleCustomerCount || 0,
          },
        });
      }
      await persistAccumulationDownstream(tx, runId, result, now);
      await completeRepurchasesForDate(tx, result.calculationDate, reserveStock);
      await tx.commissionIncomeReserveDaily.updateMany({
        where: { calculationDate: result.calculationDate, status: "pending" },
        data: {
          status: "settled",
          settledRunId: runId,
          settledAmount: BigInt(0),
          updatedAt: now,
        },
      });
      for (const item of result.incomeContributions) {
        await tx.commissionIncomeReserveDaily.upsert({
          where: {
            calculationDate_customerId: {
              calculationDate: result.calculationDate,
              customerId: item.customerId,
            },
          },
          create: {
            calculationDate: result.calculationDate,
            customerId: item.customerId,
            grossIncome: BigInt(item.grossIncome || 0),
            reservedAmount: BigInt(0),
            settledAmount: BigInt(item.contribution || 0),
            status: "settled",
            settledRunId: runId,
            createdAt: now,
            updatedAt: now,
          },
          update: {
            grossIncome: BigInt(item.grossIncome || 0),
            settledAmount: BigInt(item.contribution || 0),
            status: "settled",
            settledRunId: runId,
            updatedAt: now,
          },
        });
      }
      await tx.commissionRun.update({
        where: { id: runId },
        data: {
          status: "completed",
          policyId: result.policyId,
          policyVersion: result.policyVersion,
          systemRevenue: BigInt(result.systemRevenue || 0),
          responseSnapshot: result as any,
          completedAt: now,
          errorMessage: null,
        },
      });
    },
    { maxWait: 30000, timeout: 120000 },
  ));
}

async function runDaily(
  calculationDate = defaultCalculationDate(),
): Promise<DailyCommissionResult> {
  dateBounds(calculationDate);
  const now = Date.now();
  // Cùng khóa với API admin cộng quỹ: khoản cộng phải commit trước snapshot,
  // hoặc API sẽ thấy run đã bắt đầu và từ chối thay đổi kỳ đang quyết toán.
  const claimed = await prismaClient.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS locked FROM pg_advisory_xact_lock(
        170615, ${Number(calculationDate.replaceAll("-", ""))}
      )
    `;
    const existing = await tx.commissionRun.findUnique({
      where: { calculationDate },
    });
    if (existing?.status === "completed" && existing.responseSnapshot) {
      return {
        snapshot: arrays(existing.responseSnapshot as unknown as DailyCommissionResult),
        run: null,
      };
    }
    if (
      existing &&
      (existing.status === "calculating" || existing.status === "persisting") &&
      money(existing.startedAt) > now - 30 * 60 * 1000
    ) {
      throw new Error(`commission run ${calculationDate} is already running`);
    }

    // Cho phép tiếp quản run treo quá 30 phút; bút toán vẫn có idempotencyKey.
    const run = existing
      ? await tx.commissionRun.update({
          where: { id: existing.id },
          data: {
            status: "calculating",
            startedAt: BigInt(now),
            completedAt: null,
            errorMessage: null,
          },
        })
      : await tx.commissionRun.create({
          data: { calculationDate, status: "calculating", startedAt: BigInt(now) },
        });
    return { snapshot: null, run };
  });
  if (claimed.snapshot) return claimed.snapshot;
  const run = claimed.run!;

  try {
    const payload = await buildAccumulationRequest(calculationDate);
    await prismaClient.commissionRun.update({
      where: { id: run.id },
      data: {
        policyId: payload.policy.id,
        policyVersion: payload.policy.version,
        requestSnapshot: payload as any,
      },
    });
    const result = await callCalculator(payload);
    await prismaClient.commissionRun.update({
      where: { id: run.id },
      data: { status: "persisting" },
    });
    await persistAccumulationResult(run.id, result);
    return result;
  } catch (error: any) {
    await prismaClient.commissionRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage: String(error?.message || error).slice(0, 10000),
      },
    });
    throw error;
  }
}

async function runDailyAccumulation(): Promise<DailyCommissionResult | null> {
  const yesterday = defaultCalculationDate();
  const latest = await prismaClient.commissionRun.findFirst({
    where: { status: "completed" },
    orderBy: { calculationDate: "desc" },
    select: { calculationDate: true },
  });

  // Nếu backend tắt qua nhiều ngày, chạy bù tuần tự từ ngày còn thiếu cũ nhất.
  // Lần cài đặt đầu tiên chỉ bắt đầu từ hôm qua để không tự tính ngược toàn bộ
  // dữ liệu lịch sử trước khi tính năng được bật.
  let date = latest ? addDays(latest.calculationDate, 1) : yesterday;
  let lastResult: DailyCommissionResult | null = null;
  while (date <= yesterday) {
    lastResult = await runDaily(date);
    date = addDays(date, 1);
  }
  return lastResult;
}

export const commissionRunService = {
  runDaily,
  runDailyAccumulation,
};

export default commissionRunService;
