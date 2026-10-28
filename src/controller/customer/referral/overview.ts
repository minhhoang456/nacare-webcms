import { Prisma } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import moment from "moment";
import { z } from "zod";
import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@src/utils/prisma";
import reportUtils from "@src/utils/report";
import referralClientService from "@src/services/referralClient.service";

type ReferralExcelRow = {
  id: number;
  name: string | null;
  phone: string | null;
  isBlock: boolean | null;
  referredAt: bigint | null;
};

type SystemOverviewRow = {
  total: bigint;
  totalActive: bigint;
  totalInactive: bigint;
};

function safeNumber(value: bigint | null | undefined, field: string): number {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`${field} vượt giới hạn số nguyên an toàn`);
  }
  return number;
}

// Doanh số nhóm của F1 gồm doanh số cá nhân lịch sử đã import của từng
// thành viên trong nhánh và đơn mới của cả nhánh. User cũ có salesRevenue NULL.
// Chỉ lấy các đơn hoàn tất hợp lệ như đầu vào tính hoa hồng Mục 3/6.
async function getGroupRevenueByRoot(
  customerIds: number[],
): Promise<Map<number, number>> {
  if (customerIds.length === 0) return new Map();
  const rows = await prismaClient.$queryRaw<
    Array<{ rootId: number; groupRevenue: bigint }>
  >(Prisma.sql`
    WITH RECURSIVE branch_tree ("rootId", "customerId", path) AS (
      SELECT c.id, c.id, ARRAY[c.id]
      FROM customer c
      WHERE c.id IN (${Prisma.join(customerIds)})
      UNION ALL
      SELECT tree."rootId", r."referredCustomerId", tree.path || r."referredCustomerId"
      FROM branch_tree tree
      INNER JOIN referral r ON r."referrerCustomerId" = tree."customerId"
      WHERE NOT r."referredCustomerId" = ANY(tree.path)
    ), historical_revenue AS (
      SELECT tree."rootId",
        SUM(COALESCE(member."salesRevenue", 0)) AS amount
      FROM branch_tree tree
      INNER JOIN customer member ON member.id = tree."customerId"
      GROUP BY tree."rootId"
    ), new_order_revenue AS (
      SELECT tree."rootId",
        SUM(GREATEST(COALESCE(o."totalMoney", 0) - COALESCE(o."shipMoney", 0), 0)) AS amount
      FROM branch_tree tree
      INNER JOIN "order" o ON o."customerId" = tree."customerId"
        AND o."paymentStatus" = 'completed'
        AND o."timeCompletedOrder" IS NOT NULL
        AND (o."typeOrder" IS NULL OR o."typeOrder" <> 'return_order')
        AND (o."sourceOrder" IS NULL OR o."sourceOrder" NOT IN
          ('commission_positive_repurchase', 'legacy_accumulation_import'))
        AND (o."requestId" IS NULL OR o."requestId" NOT LIKE 'legacy-accumulation-50:%')
      GROUP BY tree."rootId"
    )
    SELECT history."rootId",
      (history.amount + COALESCE(orders.amount, 0))::bigint AS "groupRevenue"
    FROM historical_revenue history
    LEFT JOIN new_order_revenue orders ON orders."rootId" = history."rootId"
  `);
  return new Map(
    rows.map((row) => {
      const groupRevenue = Number(row.groupRevenue);
      if (!Number.isSafeInteger(groupRevenue)) {
        throw new Error(
          `Doanh số nhóm vượt giới hạn số nguyên cho customer ${row.rootId}`,
        );
      }
      return [row.rootId, groupRevenue];
    }),
  );
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/overview",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Customer - Tổng quan hệ thống giới thiệu",
      description:
        "Trả thống kê thành viên tuyến dưới, doanh số của khách cùng tuyến dưới và danh sách F1 hiện tại.",
      querystring: z.object({
        skip: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        isActive: z
          .enum(["true", "false"])
          .transform((value) => value === "true")
          .optional(),
        isExcel: z
          .enum(["true", "false"])
          .transform((value) => value === "true")
          .optional(),
        phone: z.string().trim().min(1).max(32).optional(),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = Number(req.customerId);
      if (!Number.isSafeInteger(customerId) || customerId <= 0) {
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      }

      const { limit, skip, isActive, isExcel, phone } = req.query;
      try {
        if (isExcel === true) {
          const referrals = await prismaClient.$queryRaw<ReferralExcelRow[]>(
            Prisma.sql`
              SELECT
                c.id,
                c.name,
                c.phone,
                c."isBlock",
                r."createdAt" AS "referredAt"
              FROM referral r
              INNER JOIN customer c ON c.id = r."referredCustomerId"
              WHERE r."referrerCustomerId" = ${customerId}
              ORDER BY r."createdAt" DESC, r.id DESC
              LIMIT 2000
            `,
          );
          const groupRevenueByRoot = await getGroupRevenueByRoot(
            referrals.map((referral) => referral.id),
          );
          const report = await reportUtils.reportPageBasic({
            header: {
              sequence: "STT",
              name: "Tên",
              phone: "SĐT",
              groupRevenue: "DOANH SỐ NHÓM",
              status: "TRẠNG THÁI",
              referredAt: "NGÀY THAM GIA",
            },
            data: referrals.map((referral, index) => ({
              sequence: index + 1,
              name: referral.name || "",
              phone: referral.phone || "",
              groupRevenue: groupRevenueByRoot.get(referral.id) || 0,
              status:
                referral.isBlock === true
                  ? "Ngừng hoạt động"
                  : "Đang hoạt động",
              referredAt: referral.referredAt
                ? moment(Number(referral.referredAt)).format(
                    "DD/MM/YYYY HH:mm:ss",
                  )
                : "",
            })),
          });

          res.header(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
          res.header(
            "Content-Disposition",
            'attachment; filename="danh-sach-gioi-thieu.xlsx"',
          );
          return res.send(report);
        }

        const [resp, overviewRows] = await Promise.all([
          referralClientService.listDirectReferrals(
            customerId,
            limit,
            skip,
            isActive,
            phone,
          ),
          prismaClient.$queryRaw<SystemOverviewRow[]>(Prisma.sql`
            WITH RECURSIVE downline (id, path) AS (
              SELECT ${customerId}::int, ARRAY[${customerId}::int]
              UNION ALL
              SELECT r."referredCustomerId", downline.path || r."referredCustomerId"
              FROM downline
              INNER JOIN referral r ON r."referrerCustomerId" = downline.id
              WHERE NOT r."referredCustomerId" = ANY(downline.path)
            ), member_ids AS (
              SELECT DISTINCT id FROM downline
            ), member_stats AS (
              SELECT COUNT(*)::bigint AS "total",
                COUNT(*) FILTER (
                  WHERE COALESCE(c."isBlock", FALSE) = FALSE
                )::bigint AS "totalActive",
                COUNT(*) FILTER (
                  WHERE c."isBlock" = TRUE
                )::bigint AS "totalInactive"
              FROM member_ids
              INNER JOIN customer c ON c.id = member_ids.id
            )
            SELECT member_stats.* FROM member_stats
          `),
        ]);
        if (resp.code !== 0 || !resp.data) {
          return res.code(200).send({
            code: 1,
            message: resp.message || "Đã có lỗi xảy ra, vui lòng thử lại sau",
          });
        }
        // Tương thích response cũ của Go từng bỏ các field rỗng do omitempty.
        const directReferralEdges = {
          items: Array.isArray(resp.data.items) ? resp.data.items : [],
          total: Number(resp.data.total || 0),
          limit: Number(resp.data.limit || limit),
          skip: Number(resp.data.skip || skip),
        };
        const customerIds = directReferralEdges.items.map(
          (item) => item.referredCustomerId,
        );
        const customers =
          customerIds.length === 0
            ? []
            : await prismaClient.customer.findMany({
                where: { id: { in: customerIds } },
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  avatar: true,
                  isBlock: true,
                  createdAt: true,
                },
              });
        const customerById = new Map(
          customers.map((customer) => [customer.id, customer]),
        );
        // Cùng quy tắc với doanh số nhóm của từng F1: gồm doanh số của F0
        // và tất cả cấp dưới, không phụ thuộc phân trang danh sách F1.
        const groupRevenueByRoot = await getGroupRevenueByRoot([
          customerId,
          ...customerIds,
        ]);

        return res.send({
          code: 0,
          message: "Thành công",
          total: safeNumber(overviewRows[0]?.total, "total"),
          totalActive: safeNumber(overviewRows[0]?.totalActive, "totalActive"),
          totalInactive: safeNumber(overviewRows[0]?.totalInactive, "totalInactive"),
          systemRevenue: groupRevenueByRoot.get(customerId) || 0,
          data: {
            directReferrals: {
              items: directReferralEdges.items.flatMap((edge) => {
                const customer = customerById.get(edge.referredCustomerId);
                if (!customer) return [];
                return [
                  {
                    id: customer.id,
                    name: customer.name,
                    phone: customer.phone,
                    avatar: customer.avatar,
                    isActive: customer.isBlock !== true,
                    groupRevenue: groupRevenueByRoot.get(customer.id) || 0,
                    referredAt: edge.createdAt,
                  },
                ];
              }),
              limit: directReferralEdges.limit,
              skip: directReferralEdges.skip,
            },
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Đã có lỗi xảy ra, vui lòng thử lại sau",
        });
      }
    },
  });
};
