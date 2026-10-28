import { prismaClient } from '@root/src/utils/prisma';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import moment from 'moment';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-list-time`,
    // Define your schema
    schema: {
      tags: ['FlashSale'],
      summary: 'Lấy danh sách khung giờ flashsale tính từ thời điểm hiện tại',
      description:
        'Lấy danh sách khung giờ flashsale tính từ thời điểm hiện tại',
      // body: z.object({
      // }),
      querystring: z.object({
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
      }),
      response: {},
    },
    handler: async (req: any, _res) => {
      try {
        const timeFrameFlashSaleFind =
          await prismaClient.timeFrameFlashSale.findMany({
            where: {
              isActive: true,
            },
            select: {
              startHour: true,
              endHour: true,
            },
          });
        const TimeSlotStart = timeFrameFlashSaleFind.map(
          (slot) => slot.startHour
        );
        const TimeSlotEnd = timeFrameFlashSaleFind.map((slot) => slot.endHour);
        const NumberOfNextDay = 2;
        const hourNow = moment().hour();
        let indexTimeSlotChoose: any = 0;
        const dataResult = [];
        for (let i = 0; i < TimeSlotStart.length; i++) {
          if (hourNow < TimeSlotStart[i]) {
            indexTimeSlotChoose = i;
            break;
          }
        }
        if (indexTimeSlotChoose === 0) {
          const hourStart: any =
            TimeSlotStart[TimeSlotStart.length - 2].toString().length > 1
              ? `${TimeSlotStart[TimeSlotStart.length - 2]}`
              : `0${TimeSlotStart[TimeSlotStart.length - 2]}`;
          const hourEnd: any =
            TimeSlotEnd[TimeSlotEnd.length - 2].toString().length > 1
              ? `${TimeSlotEnd[TimeSlotEnd.length - 2]}`
              : `0${TimeSlotEnd[TimeSlotEnd.length - 2]}`;
          dataResult.push({
            timeStart: moment({ hour: hourStart, minute: 0 }).valueOf(),
            timeEnd:
              hourEnd === 0
                ? moment({ hour: hourEnd, minute: 0 }).valueOf()
                : moment({ hour: hourEnd, minute: 0 }).valueOf(),
            message: `${hourStart}:00-${hourEnd}:00 ${moment().format(
              'DD/MM/YYYY'
            )}`,
          });
        } else {
          if (indexTimeSlotChoose === 1) {
            const hourStart: any =
              TimeSlotStart[TimeSlotStart.length - 1].toString().length > 1
                ? `${TimeSlotStart[TimeSlotStart.length - 1]}`
                : `0${TimeSlotStart[TimeSlotStart.length - 1]}`;
            const hourEnd: any =
              TimeSlotEnd[TimeSlotEnd.length - 1].toString().length > 1
                ? `${TimeSlotEnd[TimeSlotEnd.length - 1]}`
                : `0${TimeSlotEnd[TimeSlotEnd.length - 1]}`;
            dataResult.push({
              timeStart: moment({ hour: hourStart, minute: 0 })
                .add(-1, 'days')
                .valueOf(),
              timeEnd:
                hourEnd === 0
                  ? moment({ hour: hourEnd, minute: 0 }).valueOf()
                  : moment({ hour: hourEnd, minute: 0 }).valueOf(),
              message: `${hourStart}:00-${hourEnd}:00 ${moment().format(
                'DD/MM/YYYY'
              )}`,
            });
          } else {
            const hourStart: any =
              TimeSlotStart[indexTimeSlotChoose - 1].toString().length > 1
                ? `${TimeSlotStart[indexTimeSlotChoose - 1]}`
                : `0${TimeSlotStart[indexTimeSlotChoose - 1]}`;
            const hourEnd: any =
              TimeSlotEnd[indexTimeSlotChoose - 1].toString().length > 1
                ? `${TimeSlotEnd[indexTimeSlotChoose - 1]}`
                : `0${TimeSlotEnd[indexTimeSlotChoose - 1]}`;
            dataResult.push({
              timeStart: moment({ hour: hourStart, minute: 0 }).valueOf(),
              timeEnd:
                hourEnd === 0
                  ? moment({ hour: hourEnd, minute: 0 }).valueOf()
                  : moment({ hour: hourEnd, minute: 0 }).valueOf(),
              message: `${hourStart}:00-${hourEnd}:00 ${moment().format(
                'DD/MM/YYYY'
              )}`,
            });
          }
        }
        for (let i = 0; i < NumberOfNextDay; i++) {
          if (!i) {
            for (let j = indexTimeSlotChoose; j < TimeSlotStart.length; j++) {
              const hourStart =
                TimeSlotStart[j].toString().length > 1
                  ? `${TimeSlotStart[j]}`
                  : `0${TimeSlotStart[j]}`;
              const hourEnd =
                TimeSlotEnd[j].toString().length > 1
                  ? `${TimeSlotEnd[j]}`
                  : `0${TimeSlotEnd[j]}`;
              dataResult.push({
                timeStart: moment({ hour: TimeSlotStart[j], minute: 0 })
                  .add(i, 'days')
                  .valueOf(),
                timeEnd:
                  TimeSlotEnd[j] === 0
                    ? moment({ hour: TimeSlotEnd[j], minute: 0 })
                        .add(i + 1, 'days')
                        .valueOf()
                    : moment({ hour: TimeSlotEnd[j], minute: 0 })
                        .add(i, 'days')
                        .valueOf(),
                message: `${hourStart}:00-${hourEnd}:00 ${moment()
                  .add(i, 'days')
                  .format('DD/MM/YYYY')}`,
              });
            }
          } else {
            for (let j = 0; j < TimeSlotStart.length; j++) {
              const hourStart =
                TimeSlotStart[j].toString().length > 1
                  ? `${TimeSlotStart[j]}`
                  : `0${TimeSlotStart[j]}`;
              const hourEnd =
                TimeSlotEnd[j].toString().length > 1
                  ? `${TimeSlotEnd[j]}`
                  : `0${TimeSlotEnd[j]}`;
              dataResult.push({
                timeStart: moment({ hour: TimeSlotStart[j], minute: 0 })
                  .add(i, 'days')
                  .valueOf(),
                timeEnd:
                  TimeSlotEnd[j] === 0
                    ? moment({ hour: TimeSlotEnd[j], minute: 0 })
                        .add(i + 1, 'days')
                        .valueOf()
                    : moment({ hour: TimeSlotEnd[j], minute: 0 })
                        .add(i, 'days')
                        .valueOf(),
                message: `${hourStart}:00-${hourEnd}:00 ${moment()
                  .add(i, 'days')
                  .format('DD/MM/YYYY')}`,
              });
            }
          }
        }
        return {
          code: 0,
          message: 'Thành công',
          data: dataResult.slice(req.query.skip, req.query.limit),
        };
      } catch (err) {
        console.log('Err time slot flashsale :', err);
        return {
          code: 1,
          message: 'Đã có lỗi xảy ra, vui lòng thử lại',
        };
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
