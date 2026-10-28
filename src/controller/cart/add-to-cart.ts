import customerMiddleware from "@root/src/middleware/customer";
import redis from "@root/src/utils/redis";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/add-to-cart`,
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Cart"],
      description: "Thêm sản phẩm vào giỏ hàng",
      body: z.object({
        cartItem: z.array(z.object({
          itemId: z.number().min(1).describe('Item ID sản phẩm'),
          quantity: z.number().min(1).describe('Số lượng'),
          storeId: z.number().min(1).describe('ID cửa hàng'),
          productTypeId: z.number().min(1).describe('ID sản phẩm'),
          name: z.string().describe('Tên sản phẩm').optional(),
          price: z.number().min(1).describe('Giá sản phẩm').optional(),
          image: z.string().describe('Hình ảnh sản phẩm').optional(),
          attributeValues: z.array(
            z.object({
              id: z.string().describe('ID thuộc tính'),
            })
          ).describe('Danh sách thuộc tính'),
        }))
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        //@ts-ignore
        const customerId = req.customerId;
        const { cartItem }: any = req.body;
        await redis.set(`cart:${customerId}`, JSON.stringify(cartItem));
        return res.status(200).send({
          code: 0,
          message: "Success",
        });
      } catch (error: any) {
        return res.status(404).send({
          code: -1,
          message: msg[error.message] || "Hệ thống bận",
        });
      }
    },
  });
};

const msg: Record<string, string> = {
  e_product_type_not_found: "Sản phẩm không tồn tại",
  e_store_not_found: "Cửa hàng không tồn tại",
  e_attribute_value_not_found: "Giá trị thuộc tính không tồn tại",
  e_product_not_found: "Sản phẩm không tồn tại",
  e_product_type_not_found_in_store: "Sản phẩm không tồn tại trong cửa hàng",
  e_cannot_find_product_type_info: "Không tìm thấy thông tin sản phẩm",
};
