import orderProductHelper from '@root/src/helpers/orderProduct.helper';
import orderService from '@root/src/services/order.service';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/ship`,
    // Define your schema
    schema: {
      body: z.object({
        id: z.string().describe('ID đơn hàng'),
        refId: z.string().describe('ID đơn hàng'),
        orderId: z.string().describe('ID đơn hàng'),
        status: z.string().describe('Trạng thái đơn hàng'),
        statusDesc: z.string().describe('Mô tả trạng thái đơn hàng'),
        expectedDelivery: z.string().describe('Ngày dự kiến giao hàng'),
        expectedDeliveryDate: z.number().describe('Ngày dự kiến giao hàng'),
        employeeName: z.string().describe('Tên nhân viên'),
        employeePhone: z.string().describe('Số điện thoại nhân viên'),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      const { orderId, refId, status } = req.body;
      const orderIdNumber = Number(orderId);
      const orderShipInfo = await orderService.getOrderShip(
        orderIdNumber,
        refId
      );
      if (!orderShipInfo) {
        return res.status(404).send({ message: 'Order not found' });
      }
      const statusInfo = getOrderStatus(status);
      if (!statusInfo.noUpdate) {
        await orderProductHelper.updateStatusOrderProduct({
          orderId: orderIdNumber,
          status: statusInfo?.code || orderShipInfo.status,
          shipMessage: statusInfo?.message || '',
          canCancelOrder: statusInfo?.canCancel || false,
        });
      }
      console.log('🚀 ~ file: ship.ts:34 ~ handler: ~ statusInfo:', statusInfo);
      return res.status(200).send({ message: 'Order updated' });
    },
  });
};

const getOrderStatus = (statusCode: string): OrderStatusDetail => {
  return {
    ...(statusMapping[statusCode] || {
      code: OrderStatus.PROCESSING,
      message: 'Trạng thái không xác định',
      canCancel: false,
    }),
    noUpdate: statusMapping[statusCode]?.noUpdate || false,
  };
};

enum OrderStatus {
  PROCESSING = 'wait_for_pickup',
  SHIPPING = 'shipping',
  COMPLETED = 'completed',
  CANCELED = 'canceled',
}

interface OrderStatusDetail {
  code: OrderStatus;
  message: string;
  canCancel: boolean;
  noUpdate?: boolean;
}

const statusMapping: Record<string, OrderStatusDetail> = {
  // Processing statuses
  '102': {
    code: OrderStatus.PROCESSING,
    message: 'Đơn hàng đang chờ xử lý trong hệ thống',
    canCancel: true,
  },
  '104': {
    code: OrderStatus.PROCESSING,
    message: 'Đã phân công bưu tá đi lấy hàng',
    canCancel: true,
  },
  '201': {
    code: OrderStatus.PROCESSING,
    message: 'Hủy nhập vận đơn tại bưu cục',
    canCancel: false,
  },
  '202': {
    code: OrderStatus.PROCESSING,
    message: 'Sửa thông tin vận đơn',
    canCancel: false,
    noUpdate: true,
  },

  // Shipping statuses
  '200': {
    code: OrderStatus.PROCESSING,
    message: 'Bưu cục gốc đã nhận hàng từ nhân viên thu gom',
    canCancel: false,
  },
  '103': {
    code: OrderStatus.PROCESSING,
    message: 'Đơn hàng đã được chuyển đến bưu cục gốc',
    canCancel: true,
  },
  '105': {
    code: OrderStatus.PROCESSING,
    message: 'Bưu tá đã lấy hàng thành công',
    canCancel: false,
  },
  '300': {
    code: OrderStatus.SHIPPING,
    message: 'Đơn hàng đang được vận chuyển đi',
    canCancel: false,
  },
  '400': {
    code: OrderStatus.SHIPPING,
    message: 'Đơn hàng đang được vận chuyển đến',
    canCancel: false,
  },
  '500': {
    code: OrderStatus.SHIPPING,
    message: 'Đã phân công nhân viên đi giao hàng',
    canCancel: false,
  },
  '508': {
    code: OrderStatus.SHIPPING,
    message: 'Yêu cầu giao lại hàng',
    canCancel: false,
  },
  '509': {
    code: OrderStatus.SHIPPING,
    message: 'Chuyển đơn sang bưu cục khác để giao',
    canCancel: false,
  },
  '515': {
    code: OrderStatus.SHIPPING,
    message: 'Đã xác nhận trả hàng về',
    canCancel: false,
  },
  '550': {
    code: OrderStatus.SHIPPING,
    message: 'Đang thực hiện giao lại hàng',
    canCancel: false,
  },
  '507': {
    code: OrderStatus.SHIPPING,
    message: 'Khách hàng đến bưu cục nhận hàng',
    canCancel: false,
  },
  '506': {
    code: OrderStatus.SHIPPING,
    message:
      'Người nhận hẹn phát lại - Khách hàng không có nhà/không liên lạc được',
    canCancel: false,
  },

  // Completed statuses
  '501': {
    code: OrderStatus.COMPLETED,
    message: 'Giao hàng thành công cho người nhận',
    canCancel: false,
  },

  // Canceled statuses
  '101': {
    code: OrderStatus.CANCELED,
    message: 'ViettelPost yêu cầu hủy đơn hàng',
    canCancel: true,
  },
  '107': {
    code: OrderStatus.CANCELED,
    message: 'Đối tác yêu cầu hủy đơn qua API',
    canCancel: false,
  },
  '503': {
    code: OrderStatus.CANCELED,
    message: 'Hủy đơn theo yêu cầu của khách hàng',
    canCancel: false,
  },
  '505': {
    code: OrderStatus.CANCELED,
    message: 'Thông báo chuyển hoàn',
    canCancel: false,
    noUpdate: true,
  },
  '502': {
    code: OrderStatus.CANCELED,
    message: 'Đã trả hàng về bưu cục gốc',
    canCancel: false,
  },
  '504': {
    code: OrderStatus.CANCELED,
    message: 'Trả hàng thành công về cho người gửi',
    canCancel: false,
  },
};
