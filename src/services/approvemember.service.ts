import cache from '@src/utils/localCache'
// import { prismaClient } from '@root/src/utils/prisma'
export const approvememberService = {
  // initCache: async () => {
  //   const results = await prismaClient.approvemember.findMany()

  //   if (results.length === 0) {
  //     return
  //   }
  //   const listApproveMembers: any = {}
  //   results.forEach((e) => {
  //     listApproveMembers[e.id] = e
  //   })
  //   await cache.set('list_approve_member', listApproveMembers)
  // },

  runCronjob30Minutes: async () => {
    try {
      // await approvememberService.initCache()
    } catch (error) {
      console.log(error)
    }
  },

  getApproveMemberById: (approveMemberId: number, type: string) => {
    const listApproveMembers: any = cache.get('list_approve_member')
    const approveInfo = listApproveMembers[approveMemberId]
    if (!approveInfo) {
      return []
    }
    if (type === 'voucher') {
      return approveInfo.voucherIds
    }
    if (type === 'product') {
      return approveInfo.productIds
    }
    return []
  }
}
export default approvememberService
