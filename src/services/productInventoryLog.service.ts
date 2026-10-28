import { prismaClient } from '@root/src/utils/prisma';
import { messagequeueService } from '.';

interface ProductInventory {
    product_id: number;
    quantity: number;
    item_id: number;
}

export const productInventoryLogService = {
    async importInventory({
        productId,
        quantity,
        note,
        userId,
        product,
        type
    }: {
        productId: number;
        quantity: number;
        note?: string;
        userId: number;
        product: { itemId: number };
        type: 'import' | 'adjust';
    }) {
        return await prismaClient.$transaction(async (tx) => {
            const [updatedInventory] = await tx.$queryRaw<(ProductInventory & { is_new?: boolean })[]>`
        WITH inserted AS (
          INSERT INTO product_inventory ("productId", quantity, "itemId", "createdAt", "updatedAt")
          VALUES (${productId}, ${quantity}, ${product.itemId}, ${Date.now()}, ${Date.now()})
          ON CONFLICT ("productId")
          DO UPDATE SET 
            quantity = product_inventory.quantity + ${quantity},
            "updatedAt" = ${Date.now()}
          RETURNING *, (xmax = 0) as is_new
        )
        SELECT * FROM inserted
      `;
            //   xmas kiem tra record vua duoc insert moi ( true ) hay update (fasle)

            if (type === 'adjust') {
                await tx.$executeRaw`
                    UPDATE item 
                    SET "total" = "total" + ${quantity}
                    WHERE "id" = ${product.itemId}
                `;
            }

            messagequeueService.addDbItem({
                model: 'product_inventory_log',
                action: 'create',
                data: {
                    productId,
                    changeAmount: quantity,
                    actionType: updatedInventory.is_new ? 'import' : 'adjust',
                    note: note || (updatedInventory.is_new ? 'Import more products' : 'Adjust inventory quantity'),
                    currentQuantity: updatedInventory.quantity,
                    userId: userId
                }
            });

            return updatedInventory;
        });
    }
};

export default productInventoryLogService;
