import { RoleSpecial } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import { businessDateFromTimestamp } from "@src/services/accumulationPoolTopup.core";
import { commissionRunService } from "@src/services";
import { prismaClient } from "@src/utils/prisma";

const bodySchema = z.object({
  calculationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function registerRunRoutes(
  fastify: FastifyInstance,
  dependencies: {
    client?: typeof prismaClient;
    middleware?: typeof userMiddleware;
    runDaily?: typeof commissionRunService.runDaily;
    now?: () => number;
  } = {},
) {
  const client = dependencies.client ?? prismaClient;
  const middleware = dependencies.middleware ?? userMiddleware;
  const runDaily = dependencies.runDaily ?? commissionRunService.runDaily;
  const now = dependencies.now ?? Date.now;
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/run",
    preHandler: [middleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Chạy quyết toán tích sản thủ công cho một ngày",
      description:
        "Chỉ admin/root được chạy. Kỳ đã hoàn tất được trả lại kết quả cũ, không chia lần hai. " +
        "Sau khi kỳ bắt đầu quyết toán, admin không thể điều chỉnh quỹ của ngày đó nữa.",
      body: bodySchema,
      response: {},
    },
    handler: async (req: any, res) => {
      if (
        req.roleSpecial !== RoleSpecial.ROOT &&
        req.roleSpecial !== RoleSpecial.ADMIN
      ) {
        return res
          .code(403)
          .send({ code: 1, message: "Không có quyền truy cập" });
      }
      const { calculationDate } = req.body;
      const start = Date.parse(`${calculationDate}T00:00:00+07:00`);
      if (
        !Number.isFinite(start) ||
        businessDateFromTimestamp(start) !== calculationDate ||
        calculationDate > businessDateFromTimestamp(now())
      ) {
        return res
          .code(400)
          .send({ code: 1, message: "Ngày quyết toán không hợp lệ" });
      }
      try {
        const existing = await client.commissionRun.findUnique({
          where: { calculationDate },
          select: { status: true },
        });
        const result = await runDaily(calculationDate);
        return res.send({
          code: 0,
          message:
            existing?.status === "completed"
              ? "Kỳ này đã hoàn tất trước đó"
              : "Quyết toán thành công",
          data: {
            calculationDate,
            alreadyCompleted: existing?.status === "completed",
            distributedCustomers: result.accumulationDistributions.length,
            totalDistributedAmount: result.accumulationDistributions.reduce(
              (sum, item) => sum + item.amount,
              0,
            ),
          },
        });
      } catch (error: any) {
        req.log.error(error);
        const message = String(error?.message || error);
        return res.code(message.includes("already running") ? 409 : 500).send({
          code: 1,
          message: `Không thể quyết toán: ${message}`,
        });
      }
    },
  });
}

export default registerRunRoutes;
