import _ from 'lodash'

export const menuService = {
  beforeUpdate: async (ins: any) => {
    try {
      if (!ins.icon || (ins.icon && _.isEmpty(ins.icon))) {
        ins.icon = {
          name: 'akar-icons:triangle-right',
          iconType: 'iconify'
        }
      }
    } catch (error) {
      console.log(
        '🚀 ~ file: menu.service.ts:37 ~ beforeUpdate: ~ error:',
        error
      )
    }
    return ins
  }
}
export default menuService
