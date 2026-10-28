import { prismaClient } from '@src/utils/prisma'
import { news, Prisma } from '@prisma/client'

export type NewsCategory = 'uu_dai' | 'su_kien'

const slugifyTitle = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

// Đảm bảo slug không trùng (news.slug là @unique), thêm hậu tố -2, -3... nếu cần
const ensureUniqueSlug = async (
  base: string,
  excludeId?: number
): Promise<string> => {
  const slug = base || 'tin-tuc'
  let candidate = slug
  let suffix = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existed = await prismaClient.news.findFirst({
      where: {
        slug: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {})
      },
      select: { id: true }
    })
    if (!existed) return candidate
    suffix += 1
    candidate = `${slug}-${suffix}`
  }
}

// Field hiển thị ở card danh sách (bỏ content cho nhẹ payload)
const listSelect = {
  id: true,
  slug: true,
  title: true,
  thumbnail: true,
  category: true,
  publishedAt: true,
  createdAt: true
} satisfies Prisma.newsSelect

export const newsService = {
  // Tự sinh slug từ title trước khi insert
  beforeCreate: async (data: any): Promise<any> => {
    if (data?.title) {
      data.slug = await ensureUniqueSlug(slugifyTitle(data.title))
    }
    return data
  },

  // Cập nhật lại slug khi title thay đổi
  beforeUpdate: async (data: any): Promise<any> => {
    if (data?.title) {
      data.slug = slugifyTitle(data.title)
    }
    return data
  },

  getListNews: async (params: {
    category?: NewsCategory
    skip: number
    limit: number
  }): Promise<{ items: Partial<news>[]; total: number }> => {
    const { category, skip, limit } = params
    const where: Prisma.newsWhereInput = {
      isActive: true,
      publishedAt: {
        not: null,
        lte: Date.now()
      },
      ...(category ? { category } : {})
    }

    const [items, total] = await Promise.all([
      prismaClient.news.findMany({
        where,
        select: listSelect,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit
      }),
      prismaClient.news.count({ where })
    ])

    return { items, total }
  },

  getNewsDetail: async (params: {
    id?: number
    slug?: string
  }): Promise<news | null> => {
    const { id, slug } = params
    if (!id && !slug) return null

    return prismaClient.news.findFirst({
      where: {
        isActive: true,
        ...(id ? { id } : {}),
        ...(slug ? { slug } : {})
      }
    })
  }
}

export default newsService
