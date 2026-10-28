import { FastifyReply, FastifyRequest } from 'fastify'
const blueprints = ['create', 'update', 'find', 'destroy']
import _ from 'lodash'
import Page from '@src/services/page'

export default async function policieMidlleware(
  req: FastifyRequest & {
    query: {
      page?: any
      pageId?: any
      api?: any
      queryInput?: any
      skip?: number
      limit?: number
      where?: any
      select?: any
    }
    roleId?: number
    user?: any
    pageInfo?: any
    apiInfo?: any
    queryInput?: any
  },
  res: FastifyReply
) {
  const params: any = req.params
  const { api, skip, limit } = req.query
  const page: any = req.query.pageId ? req.query.pageId : req.query.page
  let { queryInput } = req.query
  if (queryInput) {
    queryInput = JSON.parse(queryInput)
  } else {
    queryInput = {}
  }

  let input = queryInput
  if (req.method == 'POST' || req.method == 'PATCH' || req.method == 'PUT') {
    input = req.body
  }
  if (!page || !api) {
    return res.code(400).send({
      code: 400,
      message: 'Không tìm thấy trang'
    })
  }
  const pageInfo = await Page.getPage(page)
  if (!pageInfo)
    return res.code(400).send({
      code: 400,
      message: 'Không tìm thấy trang'
    })
  //check page role
  if (
    pageInfo.roles &&
    pageInfo.roles.length > 0 &&
    !_.includes(pageInfo.roles, req.roleId)
  ) {
    return res.code(400).send({
      code: 400,
      message: 'Không tìm thấy trang'
    })
  }
  if (!pageInfo.apis)
    return res.code(400).send({
      code: 400,
      message: 'Không tìm thấy trang'
    })
  let apiInfo: any = null
  pageInfo.apis.map((a: any) => {
    if (a.name == api) {
      apiInfo = a
    }
  })
  if (!apiInfo)
    return res.code(400).send({
      code: 400,
      message: 'Không tìm thấy trang'
    })
  let action = api

  //check api role
  if (
    apiInfo.roles &&
    apiInfo.roles.length > 0 &&
    !_.includes(apiInfo.roles, req.roleId)
  )
    return res.code(403).send({
      code: 403,
      message: 'Không có quyền truy cập'
    })
  req.pageInfo = pageInfo
  req.apiInfo = apiInfo
  //check parameters
  let prepareData: any = {}
  const criterias: any = {}
  if (apiInfo.requestFields) {
    const requestFields = apiInfo.requestFields.split(',')
    for (let i = 0; i < requestFields.length; i++) {
      const field = requestFields[i]
      prepareData[field] = input[field]
    }
  } else {
    prepareData = input
  }
  //check api options
  if (apiInfo.options && apiInfo.options.length) {
    for (let i = 0; i < apiInfo.options.length; i++) {
      const option = apiInfo.options[i]
      if (typeof option.value == 'string') {
        //last
        prepareData[option.key] = option.value
        if (option.value.substr(0, 2) == '--') {
          const k = option.value.substr(2)
          if (k == 'true' || k == 'false') {
            if (k == 'true') {
              prepareData[option.key] = true
            } else {
              prepareData[option.key] = false
            }
            continue
          } else {
            if (req.user[k]) {
              prepareData[option.key] = req.user[k]
            } else if (!(option.key in req.user)) {
              return res.code(400).send({
                code: 400,
                message: 'Tham số cố định không hợp lệ'
              })
            } else {
              delete prepareData[option.key]
            }
          }
          continue
        }
        let tmp = ''
        if (option.value.substr(0, 'array--'.length) === 'array--') {
          tmp = option.value.substr('array--'.length)
          prepareData[option.key] = {
            in: tmp.split(',')
          }
          continue
        }
        if (
          option.value.substr(0, 'arraynumber--'.length) === 'arraynumber--'
        ) {
          tmp = option.value.substr('arraynumber--'.length)
          prepareData[option.key] = {
            in: tmp.split(',').map((i) => Number(i))
          }
          continue
        }
        if (option.value.substr(0, 'gt--'.length) === 'gt--') {
          tmp = option.value.substr('gt--'.length)
          prepareData[option.key] = { gt: Number(tmp) }
          continue
        }
        if (option.value.substr(0, 'lt--'.length) === 'lt--') {
          tmp = option.value.substr('lt--'.length)
          prepareData[option.key] = { lt: Number(tmp) }
          continue
        }
        if (option.value.substr(0, 'gte--'.length) === 'gte--') {
          tmp = option.value.substr('gte--'.length)
          prepareData[option.key] = { gte: Number(tmp) }
          continue
        }
        if (option.value.substr(0, 'lte--'.length) === 'lte--') {
          tmp = option.value.substr('lte--'.length)
          prepareData[option.key] = { lte: Number(tmp) }
          continue
        }
        if (option.value.substr(0, 'diff--'.length) === 'diff--') {
          tmp = option.value.substr('diff--'.length)
          prepareData[option.key] = { not: tmp }
          continue
        }
        if (option.value.substr(0, 'diffnumber--'.length) === 'diffnumber--') {
          tmp = option.value.substr('diffnumber--'.length)
          prepareData[option.key] = { not: Number(tmp) }
          continue
        }
      }
    }
  }
  //check api criteria
  if (apiInfo.criterias && apiInfo.criterias.length) {
    for (let i = 0; i < apiInfo.criterias.length; i++) {
      const crit: any = apiInfo.criterias[i]
      if (typeof crit.value == 'string' && crit.value.substr(0, 2) == '--') {
        const k = crit.value.substr(2)
        if (k == 'true' || k == 'false') {
          if (k == 'true') {
            criterias[crit.key] = true
          } else {
            criterias[crit.key] = false
          }
        } else {
          if (req.user[k]) {
            criterias[crit.key] = req.user[k]
          } else {
            return res.code(400).send({
              code: 400,
              message: 'Tham số cố định không hợp lệ'
            })
          }
        }
      } else {
        criterias[crit.key] = crit.value
      }
    }
  }
  // let rs = null;
  //if not blueprint
  if (!_.includes(blueprints, action)) {
    // let prepareDataKeys = Object.keys(prepareData);
    if (req.method.toUpperCase() === 'GET') {
      action = 'find'
    } else {
      return
    }
  }
  if (prepareData.id) {
    if (isNumOrStringArray(prepareData.id)) {
      prepareData.id = {
        in: input.id
      }
    } else if (typeof prepareData.id === 'string') {
      prepareData.id = Number(prepareData.id)
    }
  }
  switch (action) {
    case 'find':
      Object.assign(prepareData, criterias)
      if (apiInfo.responseFields) {
        req.query.where = JSON.stringify(prepareData)
        req.query.select = stringToObject(apiInfo.responseFields)
        req.query.limit = limit ? limit : 100
        req.query.skip = skip ? skip : 0
        return
      } else {
        req.query.where = JSON.stringify(prepareData)
        req.query.limit = limit ? limit : 100
        req.query.skip = skip ? skip : 0
        req.query.select = req.query.select
          ? stringToObject(req.query.select)
          : undefined
        return
      }
    case 'update':
      criterias.id = Number(params.id)
      try {
        req.params = criterias
        req.body = prepareData
        return
      } catch (err) {
        return res.code(500).send({
          code: 1,
          message: 'Dữ liệu không được cập nhật'
        })
      }
    // eslint-disable-next-line no-unreachable
    case 'create':
      delete prepareData.id
      req.body = prepareData
      req.query = {}
      req.params = {}
      try {
        req.body = prepareData
        return
      } catch (err) {
        return res.code(500).send({
          code: 1,
          message: 'Không tạo được dữ liệu'
        })
      }
      break
    case 'destroy':
      criterias.id = Number(params.id)
      req.params = criterias
      req.body = prepareData
      return
    default:
      req.body = prepareData
      req.queryInput = prepareData
      return
  }
}

function stringToObject(str: string) {
  const obj: any = {}

  str.split(',').forEach((key) => {
    obj[key.trim()] = true
  })

  return obj
}

function isNumOrStringArray(arr: any) {
  if (Object.prototype.toString.call(arr) !== '[object Array]') {
    return false
  }

  return arr.every(
    (item: any) => typeof item === 'number' || typeof item === 'string'
  )
}
