import orderProductHelper from "@root/src/helpers/orderProduct.helper";
import customerMiddleware from "@root/src/middleware/customer";
import flashSaleProductService from "@root/src/services/flashSaleProduct.service";
import itemService from "@root/src/services/item.service";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/calculate-price`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["order"],
      description: "Tính giá tiền hàng",
      summary: "Tính giá tiền hàng",
      body: z.object({
        productsInfo: z.array(
          z.object({
            productId: z.number().describe("ID sản phẩm"),
            quantity: z.number().describe("Số lượng sản phẩm"),
          }),
        ),
        fullAddress: z.string().optional().describe("Địa chỉ nhận hàng"),
        provinceId: z
          .number()
          .optional()
          .describe("ID Tỉnh/Thành phố nhận hàng"),
        wardId: z.number().optional().describe("ID Phường/Xã nhận hàng"),
        address: z.string().optional().describe("Địa chỉ chi tiết nhận hàng"),
        voucherCode: z.string().optional().describe("Mã voucher"),
        consumptionPointUsed: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .describe("Số điểm tiêu dùng áp dụng cho đơn"),
        commissionWalletUsed: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .describe("Số tiền ví hoa hồng áp dụng cho đơn"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const {
          productsInfo,
          voucherCode,
          consumptionPointUsed,
          commissionWalletUsed,
        } = req.body;
        //@ts-ignore
        const customerId = req.customerId;
        const fullProductInfo =
          await orderProductHelper.processProductInfo(productsInfo);
        const flashSaleProducts: any =
          await flashSaleProductService.getFlashSaleProductInfoByProductIds(
            productsInfo.map((e) => e.productId),
          );
        let itemsHoldFlashSaleInfo: any[];
        let flashSaleIdsNotEnoughQuantity: number[] = [];
        if (flashSaleProducts.length > 0) {
          itemsHoldFlashSaleInfo = flashSaleProducts.map((e: any) => {
            const product = productsInfo.find(
              (productInfo) => productInfo.productId === e.productDetailId,
            );
            return {
              itemId: e.itemId,
              quantity: product?.quantity,
            };
          });
          const itemIdsflashSaleIdsNotEnoughQuantity: number[] =
            await itemService.holdingItemFlashSale({
              itemsHoldInfo: itemsHoldFlashSaleInfo,
              isCalculatPrice: true,
            });
          if (itemIdsflashSaleIdsNotEnoughQuantity.length > 0) {
            flashSaleIdsNotEnoughQuantity = flashSaleProducts
              .filter((e: any) => {
                if (
                  itemIdsflashSaleIdsNotEnoughQuantity.some(
                    (itemId) => itemId === e.itemId,
                  )
                ) {
                  return true;
                }
                return false;
              })
              .map((e: any) => e.id);
          }
        }
        const {
          orderInfo,
          orderItemInfos,
          shippingInfo: shipServiceInfo,
          listShipService: shipServices,
          errorMessageVoucherCode,
        } = await orderProductHelper.prepareOrderWithoutShipping({
          productsInfo: fullProductInfo as any,
          flashSaleIdsNotEnoughQuantity,
          voucherCode,
          customerId,
          consumptionPointUsed,
          commissionWalletUsed,
        });
        return {
          code: 0,
          message: "Thành công",
          data: {
            orderInfo,
            orderItemInfos,
            shippingInfo: shipServiceInfo,
            listShipService: shipServices,
            errorMessageVoucherCode,
          },
        };
      } catch (err: any) {
        const errorCode = err.code || err.message;
        if (errorCode && errorMessage[errorCode]) {
          return res.status(200).send({
            code: 1,
            message: errorMessage[errorCode],
            error: err,
          });
        }
        console.error("Calculate price order error", err);
        return res.status(200).send({
          code: 1,
          message: "Có lỗi xảy ra khi tính giá tiền hàng",
          error: err,
        });
      }
    },
  });
};

const errorMessage: any = {
  e_not_enough_quantity_to_hold: "Không đủ số lượng hàng để đặt hàng",
  e_not_enough_quantity_to_hold_flash_sale:
    "Không đủ số lượng hàng để đặt hàng",
  e_not_enough_quantity_to_hold_flash_sale_item:
    "Không đủ số lượng hàng để đặt hàng",
  e_can_not_find_detail_info_cart: "Không tìm thấy thông tin chi tiết sản phẩm",
  e_can_not_order_item_from: "Không thể đặt hàng từ nhiều đối tác",
  e_can_not_find_ship_service: "Không tìm thấy dịch vụ vận chuyển",
  ERROR_CALCULATE_PRICE_ORDER: "Lỗi tính toán giá đơn hàng",
  e_can_not_find_lat_long_customer: "Không tìm thấy địa chỉ khách hàng",
  e_consumption_point_invalid: "Số điểm tiêu dùng không hợp lệ",
  e_consumption_point_not_enough: "Số dư điểm tiêu dùng không đủ",
  e_consumption_point_exceeds_order:
    "Số điểm sử dụng vượt quá giá trị đơn hàng",
  e_consumption_point_minimum_payment:
    "Số tiền còn thanh toán online phải từ 10.000đ, hoặc dùng ví thanh toán toàn bộ đơn hàng",
  e_commission_wallet_invalid: "Số tiền ví hoa hồng không hợp lệ",
  e_commission_wallet_exceeds_order:
    "Tổng tiền dùng từ các ví vượt quá giá trị đơn hàng",
  e_commission_wallet_not_enough: "Số dư ví hoa hồng không đủ",
};
