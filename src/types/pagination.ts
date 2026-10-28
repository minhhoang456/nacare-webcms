import { z } from 'zod'
export const pagination = z.object({
  skip: z
    .union([z.number(), z.string()])
    .default(0)
    .transform((value) => {
      if (typeof value === 'string') {
        const numberValue = parseFloat(value)
        if (!isNaN(numberValue)) {
          return numberValue
        }
      }
      return value
    }),
  limit: z
    .union([z.number(), z.string()])
    .default(12)
    .transform((value) => {
      if (typeof value === 'string') {
        const numberValue = parseFloat(value)
        if (!isNaN(numberValue)) {
          return numberValue
        }
      }
      return value
    }),
  isTest: z.string().optional()
})
