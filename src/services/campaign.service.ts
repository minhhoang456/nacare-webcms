import moment from 'moment'
import redis from '@root/src/utils/redis'
import common from '../utils/common'

export const campaignService = {
  getHashCampaign: (type: string) => {
    return `campaign_gift_voucher_info_${type}`
  },

  beforeCreate: async (campaign: any) => {
    if (!campaign.type) {
      campaign.type = common.generateShortUnique()
    }
    return campaign
  },

  beforeUpdate: async (campaign: any) => {
    if (!campaign.type) {
      campaign.type = common.generateShortUnique()
    }
    return campaign
  },

  afterCreate: async (campaign: any) => {
    const key = campaignService.getHashCampaign(campaign.type)
    const now = moment()
    if (Number(campaign.endDate) >= now.valueOf()) {
      const maintainTimeSeconds = moment(Number(campaign.endDate)).diff(
        now,
        'seconds'
      )
      await redis.set(key, JSON.stringify(campaign), 'EX', maintainTimeSeconds)
    }
    return campaign
  },

  afterUpdate: async (campaign: any) => {
    const key = campaignService.getHashCampaign(campaign.type)
    const now = moment()
    if (Number(campaign.endDate) >= now.valueOf()) {
      const maintainTimeSeconds = moment(Number(campaign.endDate)).diff(
        now,
        'seconds'
      )
      await redis.set(key, JSON.stringify(campaign), 'EX', maintainTimeSeconds)
    }
    return campaign
  },

  getCampaignInfo: async (campaignType: string) => {
    let campaignInfo = null
    const campaignInfoCached = await redis.get(
      campaignService.getHashCampaign(campaignType)
    )
    if (campaignInfoCached) {
      campaignInfo = JSON.parse(campaignInfoCached)
    }
    return campaignInfo
  }
}
export default campaignService
