import customerMiddleware from '@root/src/middleware/customer';
import { geocodingService } from '@root/src/services';
import redis from '@root/src/utils/redis';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/search`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ['Customer'],
      summary: 'Tìm kiếm địa chỉ',
      description: 'Tìm kiếm địa chỉ',
      body: z.object({
        address: z.string(),
        wardId: z.number().optional(),
        districtId: z.number().optional(),
        provinceId: z.number().optional(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { address, wardId, districtId, provinceId } = req.body;

        let fullAddress = address;

        if (wardId && provinceId) {
          const [wardsRedis, districtsRedis, provincesRedis] =
            await Promise.all([
              redis
                .get('wards')
                .then((result) => (result ? JSON.parse(result) : null)),
              redis
                .get('districts')
                .then((result) => (result ? JSON.parse(result) : null)),
              redis
                .get('provinces')
                .then((result) => (result ? JSON.parse(result) : null)),
            ]);

          const ward = wardsRedis?.find((w: any) => w.id === wardId);
          const district = districtId
            ? districtsRedis?.find((d: any) => d.id === districtId)
            : null;
          const province = provincesRedis?.find(
            (p: any) => p.id === provinceId
          );

          fullAddress = [
            address,
            ward?.name,
            district?.name,
            province?.name,
          ]
            .filter(Boolean)
            .join(', ')
            .trim();
        }

        const addresses =
          await geocodingService.getLatLongFromAddress(fullAddress);

        const addressesWithId =
          addresses?.data.map((address: any, index: number) => ({
            id: index + 1,
            ...address,
            latitude: Number(address.latitude),
            longitude: Number(address.longitude),
          })) || [];

        res.send({
          code: 0,
          message: 'Thành công',
          data: addressesWithId,
        });
      } catch (error) {
        console.error('Error in address search:', error);
        res.status(500).send({
          code: -1,
          message: 'Hệ thống bận!',
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
