import { Prisma, RoleSpecial } from '@prisma/client'
import bcrypt from 'bcrypt'
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { isPhone } from '@src/helpers/func.helper'
import { generateUniqueCustomerInviteCode } from '@src/helpers/inviteCode.helper'
import userMiddleware from '@src/middleware/user'
import customerService from '@src/services/customer.service'
import { prismaClient } from '@src/utils/prisma'
import redis from '@src/utils/redis'

const phoneSchema = z.string().trim().max(255).refine(isPhone, 'Invalid phone')
const emailSchema = z.string().trim().email().max(255)

function phoneVariants(phone: string) {
  const local = phone.startsWith('84') ? `0${phone.slice(2)}` : phone
  return [local, `84${local.slice(1)}`]
}

async function requireAdmin(req: FastifyRequest, res: FastifyReply) {
  const { roleSpecial } = req as FastifyRequest & { roleSpecial?: string }
  if (roleSpecial !== RoleSpecial.ADMIN && roleSpecial !== RoleSpecial.ROOT) {
    return res.code(403).send({ code: 1, message: 'Không có quyền truy cập' })
  }
}

function handleError(error: unknown, res: FastifyReply) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return res.code(409).send({
        code: 1,
        message: 'Số điện thoại hoặc email đã tồn tại',
      })
    }
    if (error.code === 'P2025') {
      return res
        .code(404)
        .send({ code: 1, message: 'Khách hàng không tồn tại' })
    }
  }
  return res.code(500).send({ code: -1, message: 'Lỗi hệ thống' })
}

export default async function (fastify: FastifyInstance) {
  // Account requests contain credentials and personal information.
  fastify.addHook('onRequest', async (req) => {
    const request = req as FastifyRequest & { notSaveRequestLog?: boolean }
    request.notSaveRequestLog = true
  })

  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: '/find',
    preHandler: [userMiddleware, requireAdmin],
    schema: {
      tags: ['Admin'],
      summary: 'Admin - Tìm thông tin khách hàng bằng email hoặc số điện thoại',
      description:
        'Trả các field customer, địa chỉ và tài khoản ngân hàng; không trả hash mật khẩu.',
      querystring: z
        .object({
          accesstoken: z.string().optional(),
          email: emailSchema.optional(),
          phone: phoneSchema.optional(),
        })
        .strict()
        .refine(
          (value) => Boolean(value.email) !== Boolean(value.phone),
          'Provide exactly one of email or phone',
        ),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { email, phone } = req.query
        const customer = await prismaClient.customer.findFirst({
          where: phone ? { phone: { in: phoneVariants(phone) } } : { email },
          include: { addresses: true, bankAccounts: true },
        })
        if (!customer) {
          return res
            .code(404)
            .send({ code: 1, message: 'Khách hàng không tồn tại' })
        }
        const { secure, ...data } = customer
        return res.send({
          code: 0,
          message: 'Thành công',
          data: {
            ...data,
            hasPassword: Boolean(secure),
          },
        })
      } catch (error) {
        req.log.error('Failed to find customer account')
        return handleError(error, res)
      }
    },
  })

  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: '/create',
    preHandler: [userMiddleware, requireAdmin],
    schema: {
      tags: ['Admin'],
      summary: 'Admin - Tạo tài khoản khách hàng bằng số điện thoại',
      description:
        'Không tự gắn người giới thiệu. Nếu không truyền secure, chủ tài khoản cần dùng luồng OTP đặt lại mật khẩu trước khi đăng nhập bằng mật khẩu.',
      querystring: z.object({ accesstoken: z.string().optional() }),
      body: z
        .object({
          phone: phoneSchema,
          name: z.string().trim().min(1).max(255).optional(),
          email: emailSchema.optional(),
          secure: z
            .string()
            .min(8)
            .refine(
              (value) => Buffer.byteLength(value, 'utf8') <= 72,
              'Password must not exceed 72 bytes',
            )
            .optional(),
        })
        .strict(),
      response: {
        403: z.object({ code: z.number(), message: z.string() }),
        409: z.object({ code: z.number(), message: z.string() }),
        500: z.object({ code: z.number(), message: z.string() }),
        201: z.object({
          code: z.literal(0),
          message: z.string(),
          data: z.object({
            id: z.number(),
            name: z.string().nullable(),
            phone: z.string().nullable(),
            email: z.string().nullable(),
            inviteCode: z.string(),
            hasPassword: z.boolean(),
          }),
        }),
      },
    },
    handler: async (req, res) => {
      const { phone, name, email, secure } = req.body
      const variants = phoneVariants(phone)
      try {
        const hash = secure === undefined ? null : await bcrypt.hash(secure, 10)
        const customer = await prismaClient.$transaction(async (tx) => {
          await tx.$queryRaw(Prisma.sql`
            SELECT 1 FROM pg_advisory_xact_lock(
              hashtext('admin-customer-create'), hashtext(${variants[0]})
            )
          `)
          const conditions: Prisma.customerWhereInput[] = [
            { phone: { in: variants } },
            { merchantRef: { in: variants } },
          ]
          if (email) conditions.push({ email }, { merchantRef: email })
          const duplicate = await tx.customer.findFirst({
            where: { OR: conditions },
            select: { id: true },
          })
          if (duplicate) return null
          return tx.customer.create({
            data: {
              phone: variants[0],
              merchantRef: variants[0],
              name: name ?? variants[0],
              email,
              secure: hash,
              inviteCode: await generateUniqueCustomerInviteCode(tx),
              isBlock: false,
            },
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              inviteCode: true,
            },
          })
        })
        if (!customer) {
          return res.code(409).send({
            code: 1,
            message: 'Số điện thoại hoặc email đã tồn tại',
          })
        }
        req.log.info({ customerId: customer.id }, 'Admin created customer')
        return res.code(201).send({
          code: 0 as const,
          message: 'Tạo tài khoản thành công',
          data: { ...customer, hasPassword: secure !== undefined },
        })
      } catch (error) {
        req.log.error('Failed to create customer account')
        return handleError(error, res)
      }
    },
  })

  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'PUT',
    url: '/update',
    preHandler: [userMiddleware, requireAdmin],
    schema: {
      tags: ['Admin'],
      summary: 'Admin - Thay đổi email, số điện thoại hoặc mật khẩu khách hàng',
      description:
        'secure là mật khẩu mới dạng text, được hash bằng bcrypt trước khi lưu. Chỉ cập nhật các field được gửi lên.',
      querystring: z.object({ accesstoken: z.string().optional() }),
      body: z
        .object({
          customerId: z.number().int().positive(),
          email: emailSchema.optional(),
          phone: phoneSchema.optional(),
          secure: z
            .string()
            .min(1)
            .refine(
              (value) => Buffer.byteLength(value, 'utf8') <= 72,
              'Password must not exceed 72 bytes',
            )
            .optional(),
        })
        .strict()
        .refine(
          (value) =>
            value.email !== undefined ||
            value.phone !== undefined ||
            value.secure !== undefined,
          'Provide at least one field to update',
        ),
      response: {},
    },
    handler: async (req, res) => {
      const { customerId, email, phone, secure } = req.body
      try {
        const customer = await prismaClient.customer.findUnique({
          where: { id: customerId },
          select: { id: true, merchantRef: true },
        })
        if (!customer) {
          return res
            .code(404)
            .send({ code: 1, message: 'Khách hàng không tồn tại' })
        }
        const conditions: Prisma.customerWhereInput[] = []
        if (email !== undefined) conditions.push({ email })
        if (phone !== undefined)
          conditions.push({ phone: { in: phoneVariants(phone) } })
        if (conditions.length) {
          const duplicate = await prismaClient.customer.findFirst({
            where: { id: { not: customerId }, OR: conditions },
            select: { id: true },
          })
          if (duplicate) {
            return res
              .code(409)
              .send({ code: 1, message: 'Số điện thoại hoặc email đã tồn tại' })
          }
        }
        const data: Prisma.customerUpdateInput = {}
        if (email !== undefined) data.email = email
        if (phone !== undefined) data.phone = phoneVariants(phone)[0]
        if (secure !== undefined) data.secure = await bcrypt.hash(secure, 10)
        const updated = await prismaClient.customer.update({
          where: { id: customerId },
          data,
          select: { id: true, email: true, phone: true },
        })
        const cacheKeys = [customerService.getCustomerKey(customerId)]
        if (customer.merchantRef)
          cacheKeys.push(customerService.getCustomerRef(customer.merchantRef))
        await redis.del(...cacheKeys)
        return res.send({
          code: 0,
          message: 'Cập nhật thành công',
          data: updated,
        })
      } catch (error) {
        req.log.error('Failed to update customer account')
        return handleError(error, res)
      }
    },
  })
}
