import { Prisma } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@src/utils/prisma";

const COMMISSION_TYPES = [
  "direct",
  "small_branch",
  "accumulation",
  "income_contribution",
  "positive_contribution",
  "positive_upline_reward",
  "resonance",
  "agency_revenue",
  "agency_same_tier",
  "manual_adjustment",
  "withdrawal",
  "order_payment",
] as const;

// Các loại chính frontend được phép dùng để lọc. Các bút toán trích quỹ,
// thưởng tuyến trên và đồng cấp là subtype nội bộ, backend tự gộp theo mục.
const COMMISSION_QUERY_TYPES = [
  "direct",
  "small_branch",
  "accumulation",
  "positive_contribution",
  "resonance",
  "agency_revenue",
  "withdrawal",
  "order_payment",
] as const;

const MAIN_COMMISSION_TYPES: Partial<
  Record<
    (typeof COMMISSION_TYPES)[number],
    (typeof COMMISSION_QUERY_TYPES)[number]
  >
> = {
  income_contribution: "accumulation",
  positive_upline_reward: "positive_contribution",
  agency_same_tier: "agency_revenue",
};

const COMMISSION_TITLES: Record<(typeof COMMISSION_TYPES)[number], string> = {
  direct: "Nhận hoa hồng trực tiếp",
  small_branch: "Nhận thưởng doanh số nhóm nhỏ",
  accumulation: "Nhận tích sản",
  income_contribution: "Trích thu nhập đóng quỹ tiêu dùng tích sản",
  positive_contribution:
    "Trích thu nhập tích lũy tái mua sản phẩm (thưởng tích cực)",
  positive_upline_reward: "Nhận thưởng tích cực từ tái mua của tuyến dưới",
  resonance: "Nhận thưởng cộng hưởng từ thưởng doanh số nhóm nhỏ",
  agency_revenue: "Nhận thưởng doanh số đại lý",
  agency_same_tier: "Nhận thưởng đồng cấp đại lý",
  manual_adjustment: "Cộng hoa hồng thủ công",
  withdrawal: "Rút tiền",
  order_payment: "Thanh toán đơn hàng bằng ví hoa hồng",
};

// Tên nhóm tương ứng với từng mục trong chính sách kinh doanh (Mục 1-6).
// Một mục có thể phát sinh nhiều loại giao dịch cộng/trừ khác nhau.
const COMMISSION_TYPE_NAMES: Record<(typeof COMMISSION_TYPES)[number], string> =
  {
    direct: "Hoa hồng trực tiếp",
    small_branch: "Thưởng doanh số nhóm nhỏ",
    accumulation: "Tiêu dùng tích sản",
    income_contribution: "Tiêu dùng tích sản",
    positive_contribution: "Thưởng tích cực",
    positive_upline_reward: "Thưởng tích cực",
    resonance: "Thưởng cộng hưởng",
    agency_revenue: "Thưởng đại lý",
    agency_same_tier: "Thưởng đại lý",
    manual_adjustment: "Điều chỉnh hoa hồng",
    withdrawal: "Rút tiền",
    order_payment: "Thanh toán đơn hàng",
  };

const querySchema = z
  .object({
    skip: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    commissionType: z.enum(COMMISSION_QUERY_TYPES).optional(),
    transactionType: z.enum(["increase", "decrease"]).optional(),
    fromDate: z.coerce.number().int().nonnegative().optional(),
    toDate: z.coerce.number().int().nonnegative().optional(),
  })
  .refine(
    ({ fromDate, toDate }) =>
      fromDate === undefined || toDate === undefined || fromDate <= toDate,
    {
      message: "fromDate phải nhỏ hơn hoặc bằng toDate",
      path: ["fromDate"],
    },
  );

type CommissionHistoryRow = {
  type: string;
  direction: string;
  amount: bigint;
  balance: bigint;
  sourceOrderId: bigint | null;
  calculationDate: string | null;
  createdAt: bigint | null;
  metadata: unknown;
  taxPercent: number | null;
  receivedAmount: bigint | null;
};

function money(value: bigint | number | null | undefined): number {
  const result = Number(value || 0);
  if (!Number.isSafeInteger(result)) {
    throw new Error(
      `commission amount is not a safe integer: ${String(value)}`,
    );
  }
  return result;
}

function displayedType(
  row: CommissionHistoryRow,
): (typeof COMMISSION_QUERY_TYPES)[number] {
  if (row.type === "manual_adjustment") {
    const metadata = row.metadata;
    const walletType =
      metadata && typeof metadata === "object" && "walletType" in metadata
        ? String(metadata.walletType || "")
        : "";
    if (walletType === "positive") return "positive_contribution";
    if (walletType === "agency") return "agency_revenue";
    if (
      walletType === "direct" ||
      walletType === "small_branch" ||
      walletType === "accumulation" ||
      walletType === "resonance"
    )
      return walletType;
  }
  return (MAIN_COMMISSION_TYPES[
    row.type as keyof typeof MAIN_COMMISSION_TYPES
  ] || row.type) as (typeof COMMISSION_QUERY_TYPES)[number];
}

function getContent(row: CommissionHistoryRow, title: string): string {
  if (row.type === "withdrawal") {
    if (row.direction === "credit") {
      return `Hoàn ${money(row.amount).toLocaleString("vi-VN")}đ tiền rút hoa hồng bị từ chối`;
    }
    const metadata = row.metadata;
    const savedContent =
      metadata && typeof metadata === "object" && "content" in metadata
        ? metadata.content
        : null;
    if (typeof savedContent === "string" && savedContent.trim()) {
      return savedContent;
    }
    if (row.taxPercent !== null && row.receivedAmount !== null) {
      const receivedAmount = money(row.receivedAmount);
      const grossAmount = money(row.amount);
      if (
        Number.isInteger(row.taxPercent) &&
        row.taxPercent >= 0 &&
        row.taxPercent <= 100 &&
        receivedAmount >= 0 &&
        receivedAmount <= grossAmount
      ) {
        const taxAmount = grossAmount - receivedAmount;
        return `Rút ${grossAmount.toLocaleString("vi-VN")}đ tiền hoa hồng; thuế TNCN ${row.taxPercent}%: ${taxAmount.toLocaleString("vi-VN")}đ; thực nhận ${receivedAmount.toLocaleString("vi-VN")}đ`;
      }
    }
    return `Rút ${money(row.amount).toLocaleString("vi-VN")}đ tiền hoa hồng`;
  }
  if (row.type === "manual_adjustment") {
    const metadata = row.metadata;
    const reason =
      metadata && typeof metadata === "object" && "reason" in metadata
        ? String(metadata.reason || "").trim()
        : "";
    const adjustmentTitle =
      row.direction === "debit" ? "Trừ hoa hồng thủ công" : title;
    return reason ? `${adjustmentTitle}: ${reason}` : adjustmentTitle;
  }
  // Ngày tính doanh số khác ngày ghi sổ: cron ngày 09/10 có thể phân phối
  // tích sản của ngày 08/10. Không dùng createdAt để đặt nội dung nghiệp vụ.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.calculationDate || "");
  const date = match ? ` ngày ${match[3]}/${match[2]}/${match[1]}` : "";
  const source = row.sourceOrderId
    ? ` từ đơn hàng #${String(row.sourceOrderId)}`
    : "";
  return `${title}${source}${date}`;
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/commissions",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Customer - Lịch sử hoa hồng",
      description:
        "Trả lịch sử cộng/trừ hoa hồng, hỗ trợ lọc loại hoa hồng, loại giao dịch và thời gian phát sinh.",
      querystring: querySchema,
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = Number(req.customerId);
      if (!Number.isSafeInteger(customerId) || customerId <= 0) {
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      }

      const { limit, skip, commissionType, transactionType, fromDate, toDate } =
        req.query;

      // Sổ hoa hồng hiển thị cả tiền nhận tích sản và khoản trích đóng quỹ.
      // API accumulations bổ sung góc nhìn hạn mức được tích/tiền đã tích.
      const filters: Prisma.Sql[] = [Prisma.sql`"amount" > 0`];
      if (commissionType) {
        const manualWalletType =
          commissionType === "positive_contribution"
            ? "positive"
            : commissionType === "agency_revenue"
              ? "agency"
              : commissionType;
        if (commissionType === "accumulation") {
          filters.push(
            Prisma.sql`("type" IN ('accumulation', 'income_contribution') OR
              ("type" = 'manual_adjustment' AND "metadata"->>'walletType' = ${manualWalletType}))`,
          );
        } else if (commissionType === "positive_contribution") {
          filters.push(
            Prisma.sql`("type" IN ('positive_contribution', 'positive_upline_reward') OR
              ("type" = 'manual_adjustment' AND "metadata"->>'walletType' = ${manualWalletType}))`,
          );
        } else if (commissionType === "agency_revenue") {
          filters.push(
            Prisma.sql`("type" IN ('agency_revenue', 'agency_same_tier') OR
              ("type" = 'manual_adjustment' AND "metadata"->>'walletType' = ${manualWalletType}))`,
          );
        } else {
          filters.push(
            Prisma.sql`("type" = ${commissionType} OR
              ("type" = 'manual_adjustment' AND "metadata"->>'walletType' = ${manualWalletType}))`,
          );
        }
      }
      if (transactionType) {
        const direction = transactionType === "increase" ? "credit" : "debit";
        filters.push(Prisma.sql`"direction" = ${direction}`);
      }
      if (fromDate !== undefined) {
        filters.push(Prisma.sql`"createdAt" >= ${BigInt(fromDate)}`);
      }
      if (toDate !== undefined) {
        filters.push(Prisma.sql`"createdAt" <= ${BigInt(toDate)}`);
      }

      const historyFilter = Prisma.join(filters, " AND ");

      try {
        // Tính số dư trên toàn bộ sổ cái trước khi áp dụng bộ lọc.
        // Vì vậy mỗi dòng vẫn có đúng số dư ngay sau giao dịch tương ứng.
        const [transactions, countRows, balanceRows] = await Promise.all([
          prismaClient.$queryRaw<CommissionHistoryRow[]>(Prisma.sql`
            WITH ledger AS (
              SELECT
                "id",
                "idempotencyKey",
                "type",
                "direction",
                "amount",
                "sourceOrderId",
                "calculationDate",
                "createdAt",
                "metadata",
                SUM(
                  CASE
                    WHEN "direction" = 'credit' THEN "amount"
                    ELSE -"amount"
                  END
                ) OVER (
                  ORDER BY "createdAt" ASC NULLS FIRST, "id" ASC
                ) AS "balance"
              FROM "commissionTransaction"
              WHERE "customerId" = ${customerId}
            ), page AS (
              SELECT * FROM ledger
              WHERE ${historyFilter}
              ORDER BY "createdAt" DESC NULLS LAST, "id" DESC
              OFFSET ${skip}
              LIMIT ${limit}
            )
            SELECT page."type", page."direction", page."amount",
              page."balance", page."sourceOrderId", page."calculationDate",
              page."createdAt", page."metadata", w."taxPercent",
              w."receivedAmount"
            FROM page
            LEFT JOIN "commissionWithdrawal" w
              ON page."type" = 'withdrawal'
              AND page."direction" = 'debit'
              AND page."idempotencyKey" = 'withdrawal:' || w."id"::text
              AND w."customerId" = ${customerId}
            ORDER BY page."createdAt" DESC NULLS LAST, page."id" DESC
          `),
          prismaClient.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
            SELECT COUNT(*)::bigint AS "total"
            FROM "commissionTransaction"
            WHERE "customerId" = ${customerId}
              AND ${historyFilter}
          `),
          prismaClient.$queryRaw<
            Array<{
              totalCommissionAmount: bigint;
              pendingWithdrawalAmount: bigint;
              pendingOrderAmount: bigint;
            }>
          >(
            Prisma.sql`
              WITH pending AS (
                SELECT
                  COALESCE(SUM(w."amount"), 0)::bigint AS "amount",
                  COALESCE(SUM(w."amount") FILTER (WHERE t."id" IS NULL), 0)::bigint
                    AS "legacyAmount"
                FROM "commissionWithdrawal" w
                LEFT JOIN "commissionTransaction" t
                  ON t."idempotencyKey" = 'withdrawal:' || w."id"::text
                  AND t."customerId" = w."customerId"
                  AND t."type" = 'withdrawal' AND t."direction" = 'debit'
                WHERE w."customerId" = ${customerId} AND w."status" = 'pending'
              ), pending_order AS (
                SELECT COALESCE(SUM(r."amount"), 0)::bigint AS "amount"
                FROM "commissionWalletOrderReservation" r
                WHERE r."customerId" = ${customerId} AND r."status" = 'pending'
              )
              SELECT GREATEST(
                COALESCE(w."balance" - w."reservedAmount", 0) - p."legacyAmount"
                - pending_order."amount", 0
              )::bigint AS "totalCommissionAmount",
                p."amount" AS "pendingWithdrawalAmount",
                pending_order."amount" AS "pendingOrderAmount"
              FROM pending p
              CROSS JOIN pending_order
              LEFT JOIN "commissionWallet" w
                ON w."customerId" = ${customerId} AND w."walletType" = 'total'
            `,
          ),
        ]);

        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            totalCommissionAmount: money(balanceRows[0]?.totalCommissionAmount),
            pendingWithdrawalAmount: money(
              balanceRows[0]?.pendingWithdrawalAmount,
            ),
            pendingOrderAmount: money(balanceRows[0]?.pendingOrderAmount),
            items: transactions.map((transaction) => {
              const amount = money(transaction.amount);
              const isCredit = transaction.direction === "credit";
              const title =
                COMMISSION_TITLES[
                  transaction.type as keyof typeof COMMISSION_TITLES
                ] || "Giao dịch hoa hồng";
              const commissionTypeName =
                COMMISSION_TYPE_NAMES[
                  displayedType(
                    transaction,
                  ) as keyof typeof COMMISSION_TYPE_NAMES
                ] || "Hoa hồng";

              return {
                createdAt: money(transaction.createdAt),
                commissionType: displayedType(transaction),
                commissionTypeName,
                content: getContent(transaction, title),
                changedAmount: isCredit ? amount : -amount,
                balance: money(transaction.balance),
                transactionType: isCredit ? "increase" : "decrease",
              };
            }),
            total: money(countRows[0]?.total),
            limit,
            skip,
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể lấy lịch sử hoa hồng lúc này",
        });
      }
    },
  });
};
