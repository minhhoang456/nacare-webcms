import { prismaClient } from "../utils/prisma";
import itemService from "./item.service";
import {
  completeRepurchase,
  withRepurchaseStock,
  ReserveRepurchaseStock,
} from "./commissionRepurchase.core";

export function withCommissionRepurchaseStock<T>(
  work: (reserve: ReserveRepurchaseStock) => Promise<T>,
): Promise<T> {
  return withRepurchaseStock(
    {
      hold: async (itemId) => {
        await itemService.holdingItem([{ itemId, quantity: 1 }]);
      },
      release: (items) => itemService.rollbackHolding(items),
    },
    work,
  );
}

// Mục 4: khôi phục yêu cầu cũ còn pending; đơn và orderId luôn commit cùng nhau.
async function runPending() {
  const requests = await prismaClient.commissionRepurchase.findMany({
    where: { status: { in: ["pending", "failed"] } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  for (const request of requests) {
    try {
      await withCommissionRepurchaseStock((reserve) =>
        prismaClient.$transaction(
          (tx) => completeRepurchase(tx, request.id, reserve),
          { maxWait: 30000, timeout: 60000 },
        ),
      );
    } catch (error) {
      await prismaClient.commissionRepurchase.updateMany({
        where: { id: request.id, status: { in: ["pending", "failed"] } },
        data: {
          status: "failed",
          attempts: { increment: 1 },
          errorMessage: String(error).slice(0, 2000),
          updatedAt: BigInt(Date.now()),
        },
      });
    }
  }
}

export const commissionRepurchaseService = { runPending };
