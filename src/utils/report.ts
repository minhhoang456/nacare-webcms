import _ from 'lodash'
import moment from 'moment'
import { Prisma, prismaClient } from './prisma'
import * as excel from 'node-excel-export'

const reportUtils = {
  /**
   * Report page for auto generate model admin . Only for Prisma models
   * @param pageInfo Info of page
   * @param rs Data to export
   * @returns
   */
  async reportPageForAutoGenerateModel(pageInfo: any, rs: any) {
    const modelSelectIds: any = {}
    const gInfos: any = []
    const promises: any = []
    const header: any = {}
    pageInfo.grid.map((g: any) => {
      if (!g.hideInSetting && g.field != '--ACTIONS--') {
        header[g.field] = g.name
      }
    })
    rs.map((d: any) => {
      pageInfo.grid.map((g: any) => {
        if (g.modelSelect) {
          if (!modelSelectIds[g.field]) modelSelectIds[g.field] = []
          if (d[g.field] && !_.includes(modelSelectIds[g.field], d[g.field]))
            modelSelectIds[g.field].push(d[g.field])
        }
        return null
      })
      return null
    })

    for (let i = 0; i < pageInfo.grid.length; i++) {
      if (!pageInfo.grid[i].modelSelect) continue
      const gInfo = pageInfo.grid[i]
      if (
        !(modelSelectIds[gInfo.field] && modelSelectIds[gInfo.field].length > 0)
      )
        continue
      gInfos.push(gInfo)
      promises.push(
        this.getFieldName(pageInfo, gInfo.modelSelectApi, {
          where: { id: { in: modelSelectIds[gInfo.field] } },
          select: {
            name: true,
            id: true
          }
        })
      )
    }
    const fieldNameRs = await Promise.all(promises)
    rs.map((item: any) => {
      for (let gi = 0; gi < pageInfo.grid.length; gi++) {
        if (pageInfo.grid[gi].modelSelect) {
          for (let i = 0; i < gInfos.length; i++) {
            const gInfo = gInfos[i]
            for (let fi = 0; fi < fieldNameRs[i].length; fi++) {
              if (!fieldNameRs[i][fi]) continue
              if (fieldNameRs[i][fi].id === item[gInfo.field]) {
                item[gInfo.field] = fieldNameRs[i][fi].name
                break
              }
            }
          }
        } else {
          if (
            pageInfo.grid[gi].type === 'date' &&
            item[pageInfo.grid[gi].field]
          ) {
            if (String(item[pageInfo.grid[gi].field]).length < 13) {
              item[pageInfo.grid[gi].field] = moment(
                Number(item[pageInfo.grid[gi].field]) * 1000
              ).format('DD/MM/YYYY HH:mm:ss')
            } else {
              item[pageInfo.grid[gi].field] = moment(
                Number(item[pageInfo.grid[gi].field])
              ).format('DD/MM/YYYY HH:mm:ss')
            }
          }
          if (pageInfo.grid[gi].enumable) {
            for (let fi = 0; fi < pageInfo.grid[gi].items.length; fi++) {
              if (
                item[pageInfo.grid[gi].field] ==
                pageInfo.grid[gi].items[fi].value
              ) {
                item[pageInfo.grid[gi].field] = pageInfo.grid[gi].items[fi].key
              }
            }
          }
          if (pageInfo.grid[gi].type === 'boolean') {
            item[pageInfo.grid[gi].field] = item[pageInfo.grid[gi].field]
              ? 'Có'
              : 'Không'
          }
        }
      }
    })
    const binary = await this.reportPageBasic({
      data: rs,
      header
    })
    return binary
  },
  /**
   * Get field of page and model
   * @param pageInfo Information about page
   * @param apiName Api name
   * @param query query to get field
   * @returns
   */
  async getFieldName(pageInfo: any, apiName: any, query: any) {
    let apiInfo = null
    for (let i = 0; i < pageInfo.apis.length; i++) {
      if (pageInfo.apis[i].name === apiName) {
        apiInfo = pageInfo.apis[i]
      }
    }
    if (!apiInfo) throw 'invalid api'
    //find model
    const modelName = apiInfo.url.replace('/api/', '')
    let model: any = null
    const models = Prisma.dmmf.datamodel.models
    models.forEach((itemModel) => {
      const { name } = itemModel
      if (name.toLowerCase() === modelName.toLowerCase()) {
        model = prismaClient[name as keyof typeof prismaClient] as any
      }
    })
    if (!model) return []
    const rs = await model.findMany(query)
    return rs
  },
  /**
   * Report basic data excel
   * @param pageInfo
   * @returns
   */
  async reportPageBasic(pageInfo: { data: any; header: any }) {
    const { data, header } = pageInfo
    const styles = {
      headerDark: {
        fill: {
          fgColor: {
            rgb: 'dcdcdc'
          }
        },
        font: {
          color: {
            rgb: '000000'
          },
          sz: 12,
          bold: true,
          underline: false
        }
      },
      cellWhite: {
        fill: {
          fgColor: {
            rgb: 'ffffff'
          }
        }
      },
      cellPink: {
        fill: {
          fgColor: {
            rgb: 'FFFFCCFF'
          }
        }
      },
      cellGreen: {
        fill: {
          fgColor: {
            rgb: 'FF00FF00'
          }
        }
      }
    }

    // let types = ['number', 'string', 'date', 'boolean']
    const specification: any = {}
    //fix data
    if (header) {
      for (const i in header) {
        // console.log(typeof (data[0][i]));
        // if (!_.includes(types, typeof (data[0][i]))) {
        //     continue;
        // }
        specification[i] = {
          // <- the key should match the actual data key
          displayName: header[i], // <- Here you specify the column header
          headerStyle: styles.headerDark, // <- Header style
          width: 120 // <- width in pixels
        }
      }
    } else {
      for (const i in data[0]) {
        specification[i] = {
          // <- the key should match the actual data key
          displayName: i, // <- Here you specify the column header
          headerStyle: styles.headerDark, // <- Header style
          width: 120 // <- width in pixels
        }
      }
    }

    // Create the excel report.
    // This function will return Buffer
    const report = excel.buildExport([
      // <- Notice that this is an array. Pass multiple sheets to create multi sheet report
      {
        name: 'Report', // <- Specify sheet name (optional)
        // heading: heading, // <- Raw heading array (optional)
        // merges: merges, // <- Merge cell ranges
        specification: specification, // <- Report specification
        data // <-- Report data
      }
    ])
    return report
  }
}

export default reportUtils
