import customerMiddleware from "@root/src/middleware/customer";
import notificationService from "@root/src/services/notification.service";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/mark-as-read`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ['notification'],
      summary: 'Mark as read',
      description: 'Mark as read',
      body: z.object({
        notificationId: z.number().describe('Notification id')
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const customerId = req.customerId;
        const result = await notificationService.markAsRead(customerId, req.body.notificationId);
        return res.send({
          code: 0,
          message: 'Thành công',
          data: result
        });
      } catch (error: any) {
        console.log(error);
        switch (error.message) {
          case 'e_notification_not_found':
            return res.send({
              code: -1,
              message: "Thông báo không tồn tại.",
            });
          default:
            return res.send({
              code: -1,
              message: "Hệ thống đang bận vui lòng thử lại sau.",
            });
        }
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
