import ono from '@jsdevtools/ono';
import { prismaClient } from '../utils/prisma';
import _ from 'lodash';

export const attributevalueService = {
  handleAttribuleValue: async (
    product?: any,
    createProduct?: any,
    _newAttrs?: any,
    newAttrValues?: any,
    db?: typeof prismaClient,
    createProductType?: any,
    attributeInfo?: any
  ) => {
    if (!db) {
      throw ono('E_NOT_FOUND_DB', new Error('Không tìm thấy db'));
    }
    const delProdAttrValues = await db.productattributevalue.findMany({
      where: { productId: createProduct.id },
    });

    const delAttrValues = await db.attributevalue.findMany({
      where: {
        id: {
          in: delProdAttrValues.map((i) => i.attributeValueId || 0),
        },
      },
    });
    let proAttributeValues = product.pAttrValue;
    const attrsInProd = attributeInfo.map((i: any) => {
      return { id: i.id, name: i.name };
    });
    proAttributeValues = _.omit(proAttributeValues, [
      'id',
      'isNew',
      'key',
      'attrIds',
    ]);

    for (const keyAttr of Object.keys(proAttributeValues)) {
      const existNewAttrs = (attrsInProd || []).find(
        (i: any) => i.name === keyAttr
      );
      const existNewAttrValues = newAttrValues.filter(
        (i: any) => i.name === proAttributeValues[keyAttr]
      );
      let cAttrValue =
        existNewAttrValues.length > 0 ? existNewAttrValues[0] : null;
      if (!cAttrValue) {
        cAttrValue = await db.attributevalue.create({
          data: {
            name: proAttributeValues[keyAttr],
            attributeId: existNewAttrs.id,
            productTypeId: createProductType.id,
          },
        });
        if (!cAttrValue) {
          throw ono(
            'E_NOT_CREATE_PRODUCT',
            new Error('Tạo phân loại sản phẩm thất bại')
          );
        }
        newAttrValues.push(cAttrValue);
      }

      await db.productattributevalue.create({
        data: {
          productId: createProduct.id,
          attributeValueId: cAttrValue.id,
        },
      });
    }
    await db.productattributevalue.deleteMany({
      where: {
        id: { in: delProdAttrValues.map((i) => i.id) },
      },
    });
    await db.attributevalue.deleteMany({
      where: {
        id: { in: delAttrValues.map((i) => i.id) },
      },
    });
  },
};
export default attributevalueService;
