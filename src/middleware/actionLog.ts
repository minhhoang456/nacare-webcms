import { prismaClient } from '@src/utils/prisma'
import { FastifyReply, FastifyRequest } from 'fastify'
import _ from 'lodash'
export default async function actionLogMidlleware(
  req: FastifyRequest & {
    query: {
      api?: any
    }
    apiInfo?: any
    pageInfo?: any
    user?: any
    params: {
      id?: number | string
    }
  },
  _res: FastifyReply
) {
  const ignoreActions = ['find']
  const api = req.query?.api
  let apiInfo: any = null
  if (req.pageInfo) {
    req.pageInfo.apis.map((a: any) => {
      if (a.name == api) {
        apiInfo = a
      }
    })
  }
  if (!apiInfo) {
    apiInfo = req.apiInfo
  }
  const model = apiInfo?.url
  const action = apiInfo?.type
  if (_.includes(ignoreActions, action)) {
    return
  }
  try {
    const data: any = _.clone(req.body)
    if (action === 'update') {
      data.id = req?.params?.id
    }
    prismaClient.actionlog
      .create({
        data: {
          model,
          action,
          userId: req.user ? req.user.id : null,
          role: req.user ? req.user.role : null,
          data: data || {},
          ip: req.ip
        }
      })
      .then(() => {})
      // eslint-disable-next-line handle-callback-err
      .catch((err) => {
        console.log(err)
      })
  } catch (err) {
    console.log('🚀 ~ file: actionLog.ts:29 ~ err:', err)
  }
}
