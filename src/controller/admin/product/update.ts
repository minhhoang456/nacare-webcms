import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import productService from '@src/services/product.service';
import userMidlleware from '@root/src/middleware/user';
import actionLogMidlleware from '@root/src/middleware/actionLog';
import { prismaClient } from '@root/src/utils/prisma';

const shippingSchema = z.object({
  weight: z.number().min(1, 'Cân nặng phải lớn hơn 0'),
  dimensions: z.object({
    length: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional()
  }).optional()
});

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/update`,
    preHandler: [userMidlleware, actionLogMidlleware as any],
    schema: {
      body: z.object({
        id: z.string(),
        name: z.string().min(1, 'Tên sản phẩm không được để trống'),
        description: z.string().optional(),
        categoryId: z.number().min(1, 'Danh mục cha không được để trống'),
        subCategoryId: z.number().optional().describe("Danh mục con"),
        images: z.array(z.string()).min(1, 'Cần ít nhất 1 hình ảnh'),
        thumbnail: z.string(),
        brandId: z.number().optional(),
        originPrice: z.number().min(0),
        paymentCash: z.number().min(0),
        isActive: z.boolean(),
        isApprove: z.boolean(),
        categoryStoreId: z.number().optional(),
        tags: z.array(z.string()).optional(),
        certificate: z.string().optional(),
        variations: z.array(z.object({
          name: z.string(),
          options: z.array(z.object({
            id: z.number(),
            value: z.string()
          }))
        })).optional(),
        combinations: z.array(z.object({
          id: z.number().optional(),
          variation1: z.string(),
          variation2: z.string().optional(),
          price: z.number().min(0),
          stock: z.number().min(0),
          sku: z.string().optional(),
          image: z.string().optional(),
          shipping: shippingSchema.optional()
        })).optional(),
        shipping: shippingSchema.optional()
      }),
      response: {}
    },
    handler: async (req: any, res) => {
      try {
        const {
          id,
          name, description, categoryId,
          images, variations, combinations,
          shipping, thumbnail, brandId, originPrice, paymentCash, isActive, isApprove, categoryStoreId, tags, subCategoryId, certificate
        } = req.body;
        const storeId = req.user.storeId;
        if (!storeId) {
          return res.code(403).send({
            code: 403,
            message: "You do not have permission to access",
          });
        }
        const store = await prismaClient.store.findUnique({
          where: {
            id: storeId,
          },
        });
        if (!store) {
          return res.code(404).send({
            code: 404,
            message: "Store does not exist",
          });
        } if (req.user.roleSpecial !== 'SHOP' && req.user.roleSpecial !== 'ADMIN' && req.user.roleSpecial !== 'OPERATOR') {
          return res.code(403).send({
            code: 403,
            message: "You do not have permission to create product",
          });
        }
        const productTypeInfo = {
          id: Number(id),
          name,
          description,
          images,
          tags,
          thumbnail: thumbnail || images[0],
          variations,
          brandId,
          originPrice,
          paymentCash,
          isActive,
          isApprove,
          storeId: store.id,
          categoryStoreId,
          categoryId,
          userId: req.user.id,
          subCategoryId,
          certificate,
          products: combinations?.map((combo: any) => ({
            id: combo.id,
            name: `${name} - ${combo.variation1}${combo.variation2 ? ` - ${combo.variation2}` : ''}`,
            payment_cash: combo.price,
            origin_price: combo.price,
            weight: combo.shipping?.weight || shipping?.weight,
            dimensions: combo.shipping?.dimensions || shipping?.dimensions,
            total: combo.stock,
            sku: combo.sku,
            images: combo.image ? [combo.image] : images,
            val_attributes: [
              { name: variations?.[0]?.name, value: combo.variation1 },
              ...(combo.variation2 ? [{ name: variations?.[1]?.name, value: combo.variation2 }] : [])
            ]
          }))
        };

        const result = await productService.updateProduct({
          productTypeInfo,
          categoryId
        });

        await productService.initCache();

        return res.status(200).send({
          code: 0,
          message: 'Update product successfully',
          data: result
        });

      } catch (error) {
        console.error('Error updating product:', error);
        return res.status(500).send({
          code: 1,
          message: 'Error when updating product',
          error
        });
      }
    }
  });
};
