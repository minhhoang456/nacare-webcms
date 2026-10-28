import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prismaClient } from '@root/src/utils/prisma';
import _ from 'lodash';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-product-type-info`,
    schema: {
      querystring: z.object({
        productTypeId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { productTypeId } = req.query;

        // Lấy thông tin productType
        const productType = await prismaClient.productType.findUnique({
          where: {
            id: productTypeId,
          },
        });

        if (!productType) {
          return res.status(404).send({
            code: 1,
            message: 'Không tìm thấy loại sản phẩm',
          });
        }

        // Lấy danh sách products không bị xóa
        const products = await prismaClient.product.findMany({
          where: {
            productTypeId: productTypeId,
            isDelete: false,
          },
        });

        // Lấy attribute values của products
        const productAttributeValues = await prismaClient.productattributevalue.findMany({
          where: {
            productId: {
              in: products.map((p) => p.id),
            },
          },
        });

        // Lấy thông tin inventory của products
        const productInventories = await prismaClient.product_inventory.findMany({
          where: {
            productId: {
              in: products.map((p) => p.id),
            },
          },
        });

        // Lấy attributes của product type
        const productTypeAttributes = await prismaClient.productTypeAttribute.findMany({
          where: {
            productTypeId: productTypeId
          },
        });

        // Lấy thông tin chi tiết của attributes
        const attributes = await prismaClient.attribute.findMany({
          where: {
            id: {
              in: productTypeAttributes.map((pta) => pta.attributeId),
            },
          },
        });

        // Lấy attribute values
        const attributeValues = await prismaClient.attributevalue.findMany({
          where: {
            productTypeId: productTypeId,
            attributeId: {
              in: attributes.map((attr) => attr.id),
            },
          },
        });

        // Xây dựng variations
        const variations = attributes.map((attr) => ({
          name: attr.name,
          options: attributeValues
            .filter((av) => av.attributeId === attr.id)
            .map((av) => ({
              id: av.id,
              value: av.name || '',
            })),
        }));

        // Xây dựng combinations (products)
        const combinations = products.map((product) => {
          // Lấy attribute values của product
          const productAttrs = productAttributeValues
            .filter((pav) => pav.productId === product.id)
            .map((pav) => {
              const attrValue = attributeValues.find((av) => av.id === pav.attributeValueId);
              const attr = attributes.find((a) => a.id === attrValue?.attributeId);
              return {
                name: attr?.name || '',
                value: attrValue?.name || '',
              };
            });

          // Lấy thông tin inventory của product
          const inventory = productInventories.find(inv => inv.productId === product.id);

          return {
            id: product.id,
            variation1: productAttrs[0]?.value || '',
            variation2: productAttrs[1]?.value,
            price: product.paymentCash,
            stock: inventory?.quantity || 0,
            sku: product.sku || '',
            image: (product.images as any[])[0] || '',
            shipping: {
              weight: product.weight,
              dimensions: product.dimensions as any,
            },
          };
        });

        // Kết hợp thông tin
        const response = {
          ...productType,
          variations,
          combinations,
        };

        return res.status(200).send({
          code: 0,
          data: response,
        });

      } catch (err: any) {
        console.error('Error in get-product-type-info:', err);
        return res.status(500).send({
          code: 1,
          message: 'Đã có lỗi xảy ra',
          error: err.message || err,
        });
      }
    },
  });
};
