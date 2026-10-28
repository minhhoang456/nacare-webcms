import { prismaClient } from "../utils/prisma";
import {
  DailyCommissionRequest,
  DailyCommissionResult,
  DeferredRewardResult,
} from "../types/commission.type";
import {
  buildRequest,
  businessDateFromTimestamp,
  callCalculator,
  dateBounds,
  money,
} from "./commissionRun.service";
import { referralsForDailySnapshot } from "./commissionReferralSnapshot";
import { clearConsumptionPointCache } from "./consumptionPoint.service";
import { completeRepurchasesForDate } from "./commissionRepurchase.core";
import { withCommissionRepurchaseStock } from "./commissionRepurchase.service";

const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

function rewardAmount(item: DeferredRewardResult): number {
  return Number(item.amount ?? item.paidAmount ?? 0);
}

function openingRequest(
  current: DailyCommissionRequest,
  snapshot?: DailyCommissionRequest | null,
): DailyCommissionRequest {
  // Kỳ đã bắt đầu bằng chính sách realtime cũ vẫn tiếp tục cách tính cũ.
  // Kỳ mới chỉ quyết toán Mục 3 và cộng hưởng từ Mục 3 tại cron 07:00.
  const oldRealtimeSmallBranch = Boolean(
    snapshot && !snapshot.dailySmallBranchSettlement,
  );
  return {
    ...current,
    // Giữ cây của lần tính đầu tiên trong ngày khi admin chuyển nhánh.
    // Lần realtime tiếp theo vẫn tính lại các đơn cùng ngày trên cùng một cây.
    referrals: snapshot
      ? referralsForDailySnapshot(current.referrals, snapshot.referrals)
      : current.referrals,
    // Mục 4 phải luôn tính lại từ số dư đầu ngày, không lấy số dư đã
    // được chính lần realtime trước cập nhật.
    positiveBalances: snapshot?.positiveBalances || current.positiveBalances,
    additionalCommissionIncome:
      snapshot?.additionalCommissionIncome || current.additionalCommissionIncome,
    openEntitlements: snapshot?.openEntitlements || current.openEntitlements,
    policy: oldRealtimeSmallBranch
      ? current.policy
      : {
          ...current.policy,
          smallBranchRateBps: 0,
          resonanceRateBps: 0,
          resonanceMinimumOrderAmount: 0,
        },
    dailySmallBranchSettlement: !oldRealtimeSmallBranch,
    deferAccumulationDistribution: true,
  };
}

function transactionRows(result: DailyCommissionResult): any[] {
  const rows: any[] = [];
  // Mục 1 - Hoa hồng trực tiếp.
  for (const item of result.directCommissions) {
    rows.push({
      idempotencyKey: item.idempotencyKey,
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
  // Mục 3 - Thưởng doanh số nhóm nhỏ (đã trừ Mục 5).
  for (const item of result.smallBranchCommissions) {
    rows.push({
      idempotencyKey: item.idempotencyKey,
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
  // Mục 4 - Khoản trích tích cực. Mục 2 chưa ghi nợ ở realtime, chỉ giữ riêng.
  for (const item of result.positiveAccumulations) {
    rows.push({
      idempotencyKey: item.idempotencyKey,
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
  // Mục 4 thưởng tuyến trên và Mục 5 cộng hưởng được ghi có ngay.
  for (const item of [
    ...result.positiveUplineRewards,
    ...result.resonanceRewards,
  ]) {
    const amount = rewardAmount(item);
    rows.push({
      idempotencyKey: item.idempotencyKey,
      calculationDate: result.calculationDate,
      type: item.type,
      direction: "credit",
      customerId: item.customerId,
      sourceCustomerId: item.sourceCustomerId || null,
      rateBps: item.rateBps || null,
      grossAmount: BigInt(amount),
      deductionAmount: BigInt(0),
      netAmount: BigInt(amount),
      amount: BigInt(amount),
      metadata: item,
    });
  }
  // Mục 6 - Thưởng doanh số đại lý và đồng cấp.
  for (const item of [
    ...result.agencyRevenueRewards,
    ...result.agencySameTierRewards,
  ]) {
    rows.push({
      idempotencyKey: item.idempotencyKey,
      calculationDate: result.calculationDate,
      type: item.type,
      direction: "credit",
      customerId: item.customerId,
      sourceCustomerId: item.sourceCustomerId || null,
      sourceOrderId: item.sourceOrderId ? BigInt(item.sourceOrderId) : null,
      rateBps: item.rateBps || item.differentialRateBps || null,
      grossAmount: BigInt(item.amount || 0),
      deductionAmount: BigInt(0),
      netAmount: BigInt(item.amount || 0),
      amount: BigInt(item.amount || 0),
      metadata: item,
    });
  }
  return rows;
}

async function persistRealtime(
  runId: bigint,
  request: DailyCommissionRequest,
  result: DailyCommissionResult,
): Promise<void> {
  const now = BigInt(Date.now());
  await withCommissionRepurchaseStock((reserveStock) => prismaClient.$transaction(
    async (tx: any) => {
      const rows = transactionRows(result);
      const realtimeTypes = [
        "direct",
        "small_branch",
        "positive_contribution",
        "positive_upline_reward",
        "resonance",
        "agency_revenue",
        "agency_same_tier",
      ];
      // Kết quả được tính lại cộng dồn theo ngày. Xóa những dòng realtime cũ
      // không còn nằm trong snapshot mới (ví dụ nguồn Mục 5 gần hơn xuất hiện)
      // để không giữ đồng thời cả kết quả cũ và mới.
      await tx.commissionTransaction.deleteMany({
        where: {
          calculationDate: result.calculationDate,
          runId: null,
          type: { in: realtimeTypes },
          ...(rows.length > 0
            ? {
                idempotencyKey: {
                  notIn: rows.map((row) => row.idempotencyKey),
                },
              }
            : {}),
        },
      });
      for (const row of rows) {
        await tx.commissionTransaction.upsert({
          where: { idempotencyKey: row.idempotencyKey },
          // Prisma extension hiện không tự gắn createdAt cho nhánh create của
          // upsert, vì vậy phải ghi rõ để lịch sử không nhận createdAt = 0.
          create: { ...row, runId: null, createdAt: now },
          update: {
            rateBps: row.rateBps,
            grossAmount: row.grossAmount,
            deductionAmount: row.deductionAmount,
            netAmount: row.netAmount,
            amount: row.amount,
            metadata: row.metadata,
          },
        });
      }

      // Mục 1 - Điểm tiêu dùng là ví riêng, không cộng vào thu nhập tiền mặt.
      // Kết quả realtime được tính lại cộng dồn trong ngày nên đồng bộ theo
      // idempotencyKey giống sổ hoa hồng.
      await tx.consumptionPointTransaction.deleteMany({
        where: {
          calculationDate: result.calculationDate,
          type: "direct_reward",
          ...(result.directConsumptionPoints.length > 0
            ? {
                idempotencyKey: {
                  notIn: result.directConsumptionPoints.map(
                    (item) => item.idempotencyKey,
                  ),
                },
              }
            : {}),
        },
      });
      for (const item of result.directConsumptionPoints) {
        await tx.consumptionPointTransaction.upsert({
          where: { idempotencyKey: item.idempotencyKey },
          create: {
            idempotencyKey: item.idempotencyKey,
            calculationDate: result.calculationDate,
            type: "direct_reward",
            direction: "credit",
            customerId: item.customerId,
            sourceCustomerId: item.sourceCustomerId || null,
            sourceOrderId: BigInt(item.sourceOrderId),
            policyId: result.policyId,
            policyVersion: result.policyVersion,
            rateBps: item.rateBps,
            amount: BigInt(item.amount),
            metadata: item,
            createdAt: now,
          },
          update: {
            policyId: result.policyId,
            policyVersion: result.policyVersion,
            rateBps: item.rateBps,
            amount: BigInt(item.amount),
            metadata: item,
          },
        });
      }

      // Mục 2 - giữ tiền ngay, nhưng chưa tạo giao dịch debit trước 07:00.
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
            reservedAmount: BigInt(item.contribution || 0),
            status: "pending",
            createdAt: now,
            updatedAt: now,
          },
          update: {
            grossIncome: BigInt(item.grossIncome || 0),
            reservedAmount: BigInt(item.contribution || 0),
            status: "pending",
            updatedAt: now,
          },
        });
      }

      // Mục 2 - hạn mức của đơn được tạo ngay để cron hôm sau chỉ phân phối quỹ.
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
          update: { updatedAt: now },
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
      await tx.agencyQualificationDaily.deleteMany({
        where: { calculationDate: result.calculationDate },
      });
      if (result.agencyQualifications.length > 0) {
        await tx.agencyQualificationDaily.createMany({
          data: result.agencyQualifications.map((item) => ({
            runId: null,
            calculationDate: result.calculationDate,
            customerId: item.customerId,
            tierLevel: item.tierLevel,
            tierName: item.tierName,
            personalRevenue: BigInt(item.personalRevenue || 0),
            smallBranchRevenue: BigInt(item.smallBranchRevenue || 0),
            systemRateBps: item.systemRateBps,
            sameTierRateBps: item.sameTierRateBps,
          })),
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
            runId: null,
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

      // Mục 4: đơn tái mua và thưởng tuyến trên phải cùng commit hoặc cùng rollback.
      await completeRepurchasesForDate(tx, result.calculationDate, reserveStock);
      await tx.commissionRealtimeRun.update({
        where: { id: runId },
        data: {
          status: "completed",
          policyId: result.policyId,
          policyVersion: result.policyVersion,
          requestSnapshot: request as any,
          responseSnapshot: result as any,
          errorMessage: null,
          completedAt: now,
          updatedAt: now,
        },
      });
    },
    { maxWait: 30000, timeout: 120000 },
  ));
  await clearConsumptionPointCache(
    result.directConsumptionPoints.map((item) => item.customerId),
  );
}

async function runForDate(
  calculationDate: string,
): Promise<DailyCommissionResult | null> {
  dateBounds(calculationDate);
  const now = Date.now();
  let run = await prismaClient.commissionRealtimeRun.findUnique({
    where: { calculationDate },
  });
  if (
    run?.status === "calculating" &&
    money(run.startedAt) > now - PROCESSING_TIMEOUT_MS
  ) {
    return (run.responseSnapshot as unknown as DailyCommissionResult) || null;
  }
  if (!run) {
    try {
      run = await prismaClient.commissionRealtimeRun.create({
        data: {
          calculationDate,
          status: "calculating",
          startedAt: BigInt(now),
          createdAt: BigInt(now),
          updatedAt: BigInt(now),
        },
      });
    } catch {
      run = await prismaClient.commissionRealtimeRun.findUniqueOrThrow({
        where: { calculationDate },
      });
      if (
        run.status === "calculating" &&
        money(run.startedAt) > now - PROCESSING_TIMEOUT_MS
      )
        return null;
    }
  }
  run = await prismaClient.commissionRealtimeRun.update({
    where: { id: run.id },
    data: {
      status: "calculating",
      startedAt: BigInt(now),
      completedAt: null,
      errorMessage: null,
      updatedAt: BigInt(now),
    },
  });

  try {
    // Đơn cũ chỉ tham gia quỹ và hạn mức Mục 2 ở cron ngày sau, không
    // phát lại hoa hồng realtime của các Mục khác.
    const current = await buildRequest(calculationDate, false);
    const request = openingRequest(
      current,
      run.requestSnapshot as unknown as DailyCommissionRequest | null,
    );
    const result = await callCalculator(request);
    await persistRealtime(run.id, request, result);
    return result;
  } catch (error: any) {
    await prismaClient.commissionRealtimeRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage: String(error?.message || error).slice(0, 10000),
        updatedAt: BigInt(Date.now()),
      },
    });
    throw error;
  }
}

async function processCompletedOrder(orderId: number): Promise<void> {
  const order = await prismaClient.order.findUnique({
    where: { id: orderId },
    select: { paymentStatus: true, timeCompletedOrder: true },
  });
  if (order?.paymentStatus !== "completed" || !order.timeCompletedOrder) return;
  await runForDate(businessDateFromTimestamp(money(order.timeCompletedOrder)));
}

// Quét bù các ngày có đơn hoàn tất nhưng lần realtime trước bị lỗi/mất tiến trình.
async function runPending(): Promise<void> {
  const now = Date.now();
  const markers = await prismaClient.commissionRealtimeRun.findMany({
    where: { lastOrderCompletedAt: { not: null } },
    orderBy: { calculationDate: "asc" },
    take: 100,
  });
  for (const marker of markers) {
    const isStaleProcessing =
      marker.status === "calculating" &&
      money(marker.startedAt) <= now - PROCESSING_TIMEOUT_MS;
    const hasOrderAfterSnapshot =
      marker.status === "completed" &&
      money(marker.lastOrderCompletedAt) > money(marker.startedAt);
    if (
      marker.status === "pending" ||
      marker.status === "failed" ||
      isStaleProcessing ||
      hasOrderAfterSnapshot
    ) {
      await runForDate(marker.calculationDate);
    }
  }
}

export const commissionRealtimeService = {
  runForDate,
  processCompletedOrder,
  runPending,
};
export default commissionRealtimeService;
