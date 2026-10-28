import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prismaClient } from '@root/src/utils/prisma';
import userMidlleware from '@root/src/middleware/user';
import actionLogMidlleware from '@root/src/middleware/actionLog';
import productInventoryLogService from '@root/src/services/productInventoryLog.service';
import redis from '@root/src/utils/redis';
import itemService from '@root/src/services/item.service';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: '/import-inventory',
    preHandler: [userMidlleware, actionLogMidlleware as any],
    schema: {
      body: z.object({
        id: z.number(),
        quantity: z.number().min(1, 'Số lượng phải lớn hơn 0'),
        note: z.string().optional()
      }),
      response: {}
    },
    handler: async (req: any, res) => {
      try {
        const { id, quantity, note } = req.body;
        const storeId = req.user.storeId;

        if (!storeId || (req.user.roleSpecial !== 'SHOP' && req.user.roleSpecial !== 'ADMIN')) {
          return res.code(403).send({
            code: 403,
            message: 'You are not allowed to perform this action'
          });
        }

        console.log(itemService.getItemHashKey(id))

        await redis.hincrby(itemService.getItemHashKey(id), 'total', quantity);
        const product = await prismaClient.product.findFirst({
          where: {
            itemId: id,
            storeId,
          },
          select: {
            itemId: true,
            id: true
          }
        });

        if (!product) {
          return res.code(404).send({
            code: 404,
            message: 'Product not found'
          });
        }

        const result = await productInventoryLogService.importInventory({
          productId: product.id,
          quantity,
          note,
          userId: req.user.id,
          product,
          type: 'adjust'
        });

        return res.status(200).send({
          code: 0,
          message: 'Import products successfully',
          data: {
            currentQuantity: result.quantity
          }
        });

      } catch (error) {
        console.error('Error importing inventory:', error);
        return res.status(500).send({
          code: 1,
          message: 'Error importing inventory'
        });
      }
    }
  });
}; 