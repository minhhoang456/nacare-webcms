import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import Customer from "@src/services/customer.service";
import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@src/utils/prisma";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-customer-info`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Customer - Lấy thông tin chi tiết của khách hàng",
      description: "Get customer info",
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const customerInfo: any = await Customer.getCustomerInfo(
          req.customerId,
        );
        // Tổng tiền thực trả cho đơn mua hàng hoàn tất. Loại đơn tái mua tự sinh
        // và đơn 50,4 triệu chỉ tạo để cấp hạn mức tích sản. Tiền thanh toán bằng
        // điểm, ví hoa hồng và các khoản giảm giá không nằm trong moneyPaid.
        const paidOrders = await prismaClient.order.aggregate({
          where: {
            customerId: Number(req.customerId),
            paymentStatus: "completed",
            timeCompletedOrder: { not: null },
            AND: [
              {
                OR: [
                  { typeOrder: null },
                  { typeOrder: { not: "return_order" } },
                ],
              },
              {
                OR: [
                  { sourceOrder: null },
                  {
                    sourceOrder: {
                      notIn: ["commission_positive_repurchase"],
                    },
                  },
                ],
              },
              {
                OR: [
                  { requestId: null },
                  {
                    requestId: {
                      not: { startsWith: "legacy-accumulation-50:" },
                    },
                  },
                ],
              },
            ],
          },
          _sum: { moneyPaid: true },
        });
        customerInfo.totalPaidAmount = paidOrders._sum.moneyPaid ?? 0;

        // delete customerInfo.secure
        return res.send({
          code: 0,
          message: "Lấy thông tin thành công",
          customerInfo,
        });
      } catch (error: any) {
        return res.status(500).send({
          code: -1,
          message: msg[error.message] || "Hệ thống bận",
        });
      }
    },
  });
};

const msg: any = {
  e_cannot_find_customer_info: "Không tìm thấy thông tin khách hàng",
};
// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
