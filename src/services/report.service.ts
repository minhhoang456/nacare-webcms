// import ono from '@jsdevtools/ono'
// import { Prisma, prismaClient } from '../utils/prisma'
// import moment from 'moment'
// import limiterService from './limiter.service'
// import redis from '../utils/redis'

// export const reportService = {
//   reportSoldVoucherByVoucher: async (voucherId: number) => {
//     const startOfMonth = moment().startOf('month').valueOf()
//     const startOfDay = moment().startOf('day').valueOf()
//     const startOfHour = moment().startOf('hour').valueOf()
//     const currentDay = moment().format('YYYYMMDD').valueOf()
//     const currentMonth = moment().format('YYYYMM').valueOf()
//     if (!voucherId)
//       throw ono({
//         message: 'Voucher id is required'
//       })
//     const voucher = await prismaClient.voucher.findUnique({
//       where: {
//         id: Number(voucherId)
//       }
//     })
//     if (!voucher)
//       throw ono({
//         message: 'Voucher not found'
//       })
//     const [totalQuantity, thisMonth, today, lastHour] =
//       await prismaClient.$transaction([
//         prismaClient.code.count({
//           where: {
//             voucherId: voucher.id
//           }
//         }),
//         prismaClient.code.count({
//           where: {
//             voucherId: voucher.id,
//             createdAt: {
//               gte: startOfMonth
//             }
//           }
//         }),
//         prismaClient.code.count({
//           where: {
//             voucherId: voucher.id,
//             createdAt: {
//               gte: startOfDay
//             }
//           }
//         }),
//         prismaClient.code.count({
//           where: {
//             voucherId: voucher.id,
//             createdAt: {
//               gte: startOfHour
//             }
//           }
//         })
//       ])
//     const keyItemCount = limiterService.getKeyItemCount(voucher.itemId)
//     const keyItemDayCount = limiterService.getKeyItemDayCount(
//       voucher.itemId,
//       currentDay
//     )
//     const keyItemMonthCount = limiterService.getKeyItemMonthCount(
//       voucher.itemId,
//       currentMonth
//     )
//     const multi = redis.multi()
//     multi.get(keyItemCount)
//     multi.get(keyItemDayCount)
//     multi.get(keyItemMonthCount)
//     let listIncr: any = await multi.exec()
//     listIncr = listIncr.map((item: any) => {
//       return Number(item[1])
//     })
//     return {
//       voucherName: voucher.name,
//       voucherImage: voucher.thumb,
//       totalQuantity,
//       thisMonth,
//       today,
//       lastHour,
//       totalQuantityCache: listIncr[0],
//       thisMonthCache: listIncr[1],
//       todayCache: listIncr[2],
//       lastHourCache: 'N/A'
//     }
//   },

//   reportSoldVoucherByCustomer: async ({
//     customerId,
//     voucherId
//   }: {
//     customerId: number
//     voucherId?: number
//   }) => {
//     const startOfMonth = moment().startOf('month').valueOf()
//     const startOfDay = moment().startOf('day').valueOf()
//     const startOfHour = moment().startOf('hour').valueOf()
//     const currentDay = moment().format('YYYYMMDD').valueOf()
//     const currentMonth = moment().format('YYYYMM').valueOf()
//     let totalQuantityCache = 0
//     let thisMonthCache = 0
//     let todayCache = 0
//     const lastHourCache = 'N/A'
//     if (!customerId)
//       throw ono({
//         message: 'Mã khách hàng là bắt buộc'
//       })
//     const customer = await prismaClient.customer.findUnique({
//       where: {
//         id: customerId
//       }
//     })
//     if (!customer)
//       throw ono({
//         message: 'Khách hàng không tồn tại'
//       })
//     const whereCode: Prisma.codeWhereInput = {
//       customerId: customer.id
//     }
//     if (voucherId) {
//       const voucher = await prismaClient.voucher.findUnique({
//         where: {
//           id: voucherId
//         }
//       })
//       if (!voucher)
//         throw ono({
//           message: 'Voucher không tồn tại'
//         })
//       whereCode.voucherId = voucher.id
//       const keyItemCustomerCount = limiterService.getKeyItemCustomerCount(
//         voucher.itemId,
//         customer.id
//       )
//       const keyItemCustomerDayCount = limiterService.getKeyItemCustomerDayCount(
//         voucher.itemId,
//         customer.id,
//         currentDay
//       )
//       const keyItemMonthCustomerCount =
//         limiterService.getKeyItemCustomerMonthCount(
//           voucher.itemId,
//           customer.id,
//           currentMonth
//         )
//       const multi = redis.multi()
//       multi.get(keyItemCustomerCount)
//       multi.get(keyItemCustomerDayCount)
//       multi.get(keyItemMonthCustomerCount)
//       let listIncr: any = await multi.exec()
//       listIncr = listIncr.map((item: any) => {
//         return Number(item[1])
//       })
//       totalQuantityCache = listIncr[0]
//       todayCache = listIncr[1]
//       thisMonthCache = listIncr[2]
//     }
//     const [totalQuantity, thisMonth, today, lastHour, lastCodePurchase] =
//       await prismaClient.$transaction([
//         prismaClient.code.count({
//           where: whereCode
//         }),
//         prismaClient.code.count({
//           where: {
//             ...whereCode,
//             createdAt: {
//               gte: startOfMonth
//             }
//           }
//         }),
//         prismaClient.code.count({
//           where: {
//             ...whereCode,
//             createdAt: {
//               gte: startOfDay
//             }
//           }
//         }),
//         prismaClient.code.count({
//           where: {
//             ...whereCode,
//             createdAt: {
//               gte: startOfHour
//             }
//           }
//         }),
//         prismaClient.code.findFirst({
//           where: whereCode,
//           orderBy: {
//             createdAt: 'desc'
//           }
//         })
//       ])
//     return {
//       customerName: customer.name,
//       customerEmail: customer.email,
//       customerPhone: customer.name,
//       totalQuantity,
//       thisMonth,
//       today,
//       lastHour,
//       totalQuantityCache,
//       thisMonthCache,
//       todayCache,
//       lastHourCache,
//       lastCodePurchase: lastCodePurchase
//         ? moment(Number(lastCodePurchase.createdAt)).format(
//             'DD/MM/YYYY HH:mm:ss'
//           )
//         : 'N/A'
//     }
//   },

//   convertPhoneNumber: (phone: string) => {
//     if (phone.startsWith('0')) {
//       return '84' + phone.slice(1)
//     } else if (phone.startsWith('+84')) {
//       return phone.slice(1)
//     }
//     return phone
//   },

//   reportSoldVoucherByFlashsale: async (flashsaleId: number) => {
//     const flashsale = await prismaClient.flashSaleVoucher.findUnique({
//       where: {
//         id: flashsaleId
//       }
//     })
//     if (!flashsale)
//       throw ono({
//         message: 'Flashsale không tồn tại'
//       })
//     const query = `
//                      SELECT
//         	flashsale_voucher_detail."voucherId" as "voucherId",
//         	voucher."name" as "voucherName",
//         	item."id" as "itemId",
//         	item.total,
//         	item.purchased,
//         	refTable."totalReal"
//         FROM
//         	flashsale_voucher_detail
//         	JOIN item ON item."id" = flashsale_voucher_detail."itemId"
//         	JOIN voucher on voucher."id" = flashsale_voucher_detail."voucherId"
//         	JOIN (
//         	SELECT
//         		orderitem."typeId" AS "voucherId",
//         		COUNT ( orderitem."typeId" ) AS "totalReal"
//         	FROM
//         		orderitem
//         		JOIN ( SELECT * FROM "order" WHERE "paymentStatus" = 'completed' AND "flashSaleVoucherId" IN ( SELECT "id" FROM flashsale_voucher_detail WHERE "flashSaleVoucherId" = ${flashsaleId} ) ) AS orderref ON orderitem."orderId" = orderref."id"
//         	GROUP BY
//         		orderitem."typeId"
//         	) AS refTable ON refTable."voucherId" = flashsale_voucher_detail."voucherId"
//         WHERE
//         	flashsale_voucher_detail."flashSaleVoucherId" = ${flashsaleId}
//         	order by "voucherId"
//     `
//     const result: any = await prismaClient.$queryRawUnsafe(query)
//     return {
//       flashsaleName: flashsale.name,
//       startTime: moment(Number(flashsale.startTime)).format(
//         'DD/MM/YYYY HH:mm:ss'
//       ),
//       endTime: moment(Number(flashsale.endTime)).format('DD/MM/YYYY HH:mm:ss'),
//       voucherData: result.map((item: any) => {
//         return {
//           voucherId: item.voucherId,
//           voucherName: item.voucherName,
//           itemId: item.itemId,
//           total: item.total,
//           purchased: item.purchased,
//           totalReal: item.totalReal
//         }
//       })
//     }
//   }
// }
// export default reportService
