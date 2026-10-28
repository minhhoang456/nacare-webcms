import rootMiddleware from '@root/src/middleware/root'
import { Prisma, prismaClient } from '@src/utils/prisma'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import _ from 'lodash'
import { z } from 'zod'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/create-page-pro`,
    preHandler: [rootMiddleware as any],
    // Define your schema
    schema: {
      body: z.object({
        model: z.string(),
        type: z.enum(['default', 'onlyView']).optional()
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req, res) => {
      try {
        const { model } = req.body
        const models = Prisma.dmmf.datamodel.models
        const modelCreatePage = models.find(
          (modelPrisma) => modelPrisma.name === model
        )
        if (!modelCreatePage) {
          return res.status(400).send({
            code: 1,
            message: 'Không tìm thấy model'
          })
        }
        const modelAttribute = modelCreatePage?.fields
        const pageInfoView: any = {
          name: model,
          apis: [],
          buttons: [],
          form: [],
          grid: [],
          submit: '',
          roles: [],
          read: 'find',
          procedures: [],
          schema: []
        }
        pageInfoView.apis.push(
          createApi('GET', 'find', 'find', `/api/${model}`)
        )
        for (let i = 0; i < modelAttribute.length; i++) {
          const tempGrid: any = {}
          tempGrid.name = modelAttribute[i].name
          tempGrid.field = modelAttribute[i].name
          tempGrid.type = ''
          tempGrid.filterable = true
          switch (modelAttribute[i].type) {
            case 'BigInt':
            case 'Int': {
              if (
                modelAttribute[i].name == 'createdAt' ||
                modelAttribute[i].name == 'updatedAt'
              ) {
                tempGrid.type = 'date'
                break
              }
              tempGrid.type = 'number'
              break
            }
            case 'String': {
              if (
                modelAttribute[i].name == 'image' ||
                modelAttribute[i].name == 'images'
              ) {
                tempGrid.display = 'image'
                tempGrid.filterable = false
              }
              tempGrid.type = 'string'
              break
            }
          }
          convertField(modelAttribute[i], tempGrid)
          pageInfoView.grid.push(tempGrid)
        }
        const pageInfo = _.cloneDeep(pageInfoView)
        const pageViewInfo = await prismaClient.page.create({
          data: pageInfoView
        })
        const buttonFixView = {
          mode: 'edit',
          title: 'Sửa',
          color: 'primary',
          action: 'formModal',
          modalQuery: `{"page":${pageViewInfo.id + 1},"mode":"edit","id":#id#}`,
          type: 'button'
        }
        const buttonAddView = {
          mode: 'create',
          title: 'Tạo mới',
          color: 'success',
          icon: 'icon-plus',
          action: 'formModal',
          modalQuery: `{"page":${pageViewInfo.id + 1},"mode":"create"}`,
          type: 'submit'
        }
        pageInfo.buttons.push(buttonFixView)
        pageInfo.buttons.push(buttonAddView)
        await prismaClient.page.update({
          where: {
            id: pageViewInfo.id
          },
          data: {
            buttons: pageInfo.buttons
          }
        })
        const pageInfoForm: any = {
          name: 'Chi tiết ' + model,
          apis: [],
          buttons: [],
          form: [],
          grid: [],
          submit: '',
          roles: [],
          read: 'find',
          procedures: [],
          schema: []
        }
        pageInfoForm.apis.push(
          createApi('GET', 'find', 'find', `/api/${model}`)
        )
        pageInfoForm.apis.push(
          createApi('POST', 'create', 'create', `/api/${model}`)
        )
        pageInfoForm.apis.push(
          createApi('PATCH', 'update', 'update', `/api/${model}`)
        )
        for (let i = 0; i < modelAttribute.length; i++) {
          //create grid
          if (
            modelAttribute[i].name == 'createdAt' ||
            modelAttribute[i].name == 'updatedAt'
          )
            continue
          const tempGrid: any = {}
          tempGrid.name = modelAttribute[i].name
          tempGrid.field = modelAttribute[i].name
          tempGrid.widget = 'Text'
          tempGrid.type = ''
          switch (modelAttribute[i].type) {
            case 'number': {
              tempGrid.type = 'number'
              break
            }
            case 'string': {
              if (modelAttribute[i].name == 'image') {
                tempGrid.name = 'Ảnh'
                tempGrid.widget = 'Image'
              }
              if (modelAttribute[i].name == 'images') {
                tempGrid.name = 'Ảnh'
                tempGrid.widget = 'ArrayImage'
              }
              tempGrid.type = 'string'
              break
            }
          }
          convertField(modelAttribute[i], tempGrid)
          pageInfoForm.schema.push(tempGrid)
        }
        const buttonFixForm = {
          mode: 'edit',
          title: 'Lưu thông tin',
          action: 'api',
          api: 'update',
          type: 'submit',
          color: 'success'
        }
        const buttonAddForm = {
          mode: 'create',
          color: 'primary',
          title: 'Tạo bản ghi mới',
          icon: 'icon-plus',
          action: 'api',
          api: 'create',
          type: 'button'
        }
        pageInfoForm.buttons.push(buttonAddForm)
        pageInfoForm.buttons.push(buttonFixForm)
        await prismaClient.page.create({
          data: pageInfoForm
        })

        return res.send({
          code: 0,
          message: 'Thành công'
        })
      } catch (error) {
        return res.send({
          code: 0,
          message: error
        })
      }
    }
  })
}

function createApi(method: any, name: any, type: any, url: any) {
  const temp = {
    method,
    name,
    type,
    url,
    requestFields: '',
    responseFields: ''
  }
  return temp
}
function convertField(data: any, tempGrid: any) {
  switch (data.name) {
    case 'id':
      tempGrid.name = 'ID'
      tempGrid.disabled = true
      break
    case 'createdAt':
      tempGrid.name = 'Ngày tạo'
      break
    case 'image':
      tempGrid.name = 'Ảnh'
      break
    case 'updatedAt':
      tempGrid.name = 'Ngày sửa'
      break
    case 'isActive':
      tempGrid.name = 'Kích hoạt'
      break
    case 'type':
      tempGrid.name = 'Loại'
      break
    case 'name':
      tempGrid.name = 'Tên'
      break
    case 'customerId':
      tempGrid.name = 'Người dùng'
      break
    case 'userId':
      tempGrid.name = 'Người quản trị'
      break
    case 'description':
      tempGrid.name = 'Mô tả'
      break
    case 'status':
      tempGrid.name = 'Trạng thái'
      break
    case 'note':
      tempGrid.name = 'Ghi chú'
      break
    case 'total':
      tempGrid.name = 'Tổng'
      break
    case 'count':
      tempGrid.name = 'Đếm'
      break
    default:
      if (data.name.endsWith('Ids')) {
        tempGrid.name = `Danh sách ${data.name.slice(0, -3)}`
      }
      if (data.name.endsWith('Id')) {
        const txt = data.name.slice(0, -3)
        tempGrid.name = `${txt.charAt(0).toUpperCase() + txt.slice(1)}`
      }
      break
  }
}
