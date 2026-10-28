import { prismaClient } from '@root/src/utils/prisma';
import ono from '@jsdevtools/ono';

export const attributeService = {
  handleAttribule: async (
    createProductType?: any,
    attrs?: any,
    newProdTypeAttrs?: any,
    newAttrs?: any,
    db?: typeof prismaClient
  ) => {
    if (!db) {
      throw ono('E_NOT_FOUND_DB', new Error('Không tìm thấy db'));
    }
    const delProdTypeAttrs = await db.productTypeAttribute.findMany({
      where: { productTypeId: createProductType.id },
    });
    // const delAttrs = await Attribute.find({ where: { id: delProdTypeAttrs.map(i => i.attributeId) } });

    for (const cAttr of attrs) {
      const existNewProTypeAttr = newProdTypeAttrs.filter(
        (i: any) =>
          i.productTypeId === createProductType.id &&
          i.attributeId === cAttr.attrId
      );
      let pTypeAttr =
        existNewProTypeAttr.length > 0 ? existNewProTypeAttr[0] : null;
      if (!pTypeAttr) {
        pTypeAttr = await db.productTypeAttribute.create({
          data: {
            productTypeId: createProductType.id,
            attributeId: cAttr.attrId,
          },
        });
        if (!pTypeAttr) {
          throw ono(
            'E_NOT_CREATE_PRODUCT',
            new Error('Tạo loại sản phẩm phân loại thất bại')
          );
        }
        newProdTypeAttrs.push();
      }
      newAttrs.push(cAttr);
    }

    await db.productTypeAttribute.deleteMany({
      where: {
        id: { in: delProdTypeAttrs.map((i) => i.id) },
      },
    });
  },
};
export default attributeService;
