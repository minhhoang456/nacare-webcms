import { Prisma, prismaClient } from '../utils/prisma';
import SocketHandler from '../utils/socket';
import ono from '@jsdevtools/ono';

export const notificationService = {
  createNoti: async (data: Prisma.notificationCreateInput) => {
    return await Promise.all([
      prismaClient.notification.create({ data }),
      prismaClient.customer.update({
        where: { id: data.customerId },
        data: { countNotiUnRead: { increment: 1 } },
      }),
      SocketHandler.getInstance().emitNotification({
        customerId: data.customerId,
        title: data.title || '',
        content: data.content || '',
      }),
    ]);
  },
  getNotifications: async (customerId: number, skip: number, limit: number) => {
    return await prismaClient.notification.findMany({
      where: {
        customerId,
      },
      skip,
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });
  },
  markAsRead: async (customerId: number, notificationId: number) => {
    try {
      const notification = await prismaClient.notification.findFirst({
        where: { id: notificationId, customerId },
      });

      if (!notification) {
        throw ono('e_notification_not_found');
      }

      if (notification.status === 'read') {
        return notification;
      }

      const [updatedNotification, updatedCustomer]: any = await prismaClient.$transaction([
        prismaClient.$queryRaw`
        UPDATE notification 
        SET status = 'read'
        WHERE id = ${notificationId} AND "customerId" = ${customerId}
        RETURNING *
      `,
        prismaClient.$queryRaw`
        UPDATE customer 
        SET "countNotiUnRead" = CASE
          WHEN "countNotiUnRead" > 0 THEN "countNotiUnRead" - 1
          ELSE 0
        END
        WHERE "id" = ${customerId}
        RETURNING id, "countNotiUnRead"
      `
      ]);

      return {
        notification: updatedNotification[0],
        customer: updatedCustomer[0]
      };

    } catch (error) {
      console.log(error);
      throw ono('e_notification_not_found');
    }
  },
  getNotiCount: async (customerId: number) => {
    return await prismaClient.customer.findUnique({
      where: { id: customerId },
      select: { countNotiUnRead: true },
    });
  },
};
export default notificationService;
