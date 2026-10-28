// import { prismaClient } from '@root/src/utils/prisma';
// import redis from '../utils/redis';

export const tagService = {
  // updateVouchersWithTag: async (tagId: string, addTag: boolean) => {
  //   const activeVouchers = await prismaClient.voucher.findMany()
  //   const updateOperations = activeVouchers.map(async (voucher) => {
  //     const currentTagsId: any = voucher.tagsId || []
  //     let updatedTagsId
  //     if (addTag) {
  //       updatedTagsId = Array.from(new Set([...currentTagsId, tagId]))
  //     } else {
  //       updatedTagsId = currentTagsId.filter((id: any) => id !== tagId)
  //     }
  //     return prismaClient.voucher.update({
  //       where: { id: voucher.id },
  //       data: { tagsId: updatedTagsId }
  //     })
  //   })
  //   await Promise.all(updateOperations)
  // },
  // afterCreate: async (inst: any) => {
  //   const typeTags = await prismaClient.typestag.findFirst({
  //     where: { id: inst.typeTagsId }
  //   })
  //   if (typeTags?.required == true) {
  //     const activeVouchers = await prismaClient.voucher.findMany({
  //       where: {
  //         isActive: true
  //       }
  //     })
  //     const updateOperations = activeVouchers.map(async (voucher) => {
  //       const currentTagsId: any = voucher ? voucher.tagsId : []
  //       const updatedTagsId = Array.from(new Set([...currentTagsId, inst.id]))
  //       const updatedVoucher = await prismaClient.voucher.update({
  //         where: {
  //           id: voucher.id
  //         },
  //         data: {
  //           tagsId: updatedTagsId
  //         }
  //       })
  //       return updatedVoucher
  //     })
  //     await Promise.all(updateOperations)
  //   }
  //   return inst
  // },
  // getListTags: async () => {
  //   try {
  //     let tags: any = await redis.get('voucher_tags')
  //     if (tags) {
  //       tags = JSON.parse(tags)
  //     } else {
  //       tags = await prismaClient.tag.findMany({
  //         where: {},
  //         include: {
  //           typesTagInfo: true
  //         }
  //       })
  //       await redis.set('voucher_tags', JSON.stringify(tags), 'EX', 300)
  //     }
  //     return tags
  //   } catch (error) {
  //     return []
  //   }
  // }
};

export default tagService;
