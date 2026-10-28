import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import pageMiddleware from "@src/middleware/page";
import User from "@root/src/services/user.service";
import { prismaClient, Prisma } from "@root/src/utils/prisma";
import reportUtils from "@root/src/utils/report";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/cms-find`,
    preHandler: [userMidlleware as any, pageMiddleware, actionLogMidlleware],
    // Define your schema
    schema: {
      // body: z.object({
      // }),
      querystring: z.object({
        accesstoken: z.string().optional().describe("Token"),
        page: z.string().optional().describe("Token"),
        api: z.string().optional().describe("Token"),
        sort: z.string().optional().describe("Token"),
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .optional()
          .describe("Số lượng bỏ qua"),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .optional()
          .describe("Số lượng lấy"),
        queryInput: z.string().optional().describe("Điều kiện lọc"),
        type: z.string().optional().describe("Kiểu xuất file"),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const modelFiels = Prisma.dmmf.datamodel.models.find(
          (m) => m.name === "tag"
        )?.fields;
        const user: any = req?.user || null;
        const { skip, limit, queryInput, type } = req.query;
        let queryInputParse: any = {};
        if (queryInput) {
          queryInputParse = JSON.parse(queryInput);
        }
        let whereClause = "";
        for (const [key, value] of Object.entries(queryInputParse)) {
          if (typeof value === "string") {
            whereClause += ` AND v."${key}" ~* '${value}'`;
          } else if (value && typeof value === "object") {
            let ids: any[] = [];
            if (Array.isArray(value)) {
              for (let valueItem of value) {
                try {
                  valueItem = JSON.parse(valueItem);
                  if (Array.isArray(valueItem)) {
                    ids = ids.concat(valueItem);
                  }
                } catch (_error: any) {
                  /* empty */
                }
              }
              if (ids.length > 0) {
                whereClause += ` AND v."${key}" in (${ids.join(",")})`;
              }
            } else {
              for (const [key2, value2] of Object.entries(value)) {
                switch (key2) {
                  case "contains": {
                    if (
                      modelFiels?.find((f) => f.name === key)?.kind === "enum"
                    ) {
                      whereClause += ` AND v."${key}" = '${value2}'`;
                    } else {
                      whereClause += ` AND v."${key}" ~* '${value2}'`;
                    }
                    break;
                  }
                  case "gte": {
                    whereClause += ` AND v."${key}" >= ${value2}`;
                    break;
                  }
                  case "lte": {
                    whereClause += ` AND v."${key}" <= ${value2}`;
                    break;
                  }
                  default: {
                    whereClause += ` AND v."${key}" = ${value2}`;
                    break;
                  }
                }
              }
            }
          } else {
            whereClause += ` AND v."${key}" = ${value}`;
          }
        }
        let vouchers: any = [];
        let total: any = {};
        const query = `select v.* from tag v where 1=1 ${whereClause} order by v."id" desc limit ${limit} offset ${skip}`;
        const queryCount = `select count(v."id") as total from tag v where 1=1 ${whereClause}`;
        const rs = await Promise.all([
          prismaClient.$queryRawUnsafe(query),
          prismaClient.$queryRawUnsafe(queryCount),
        ]);
        vouchers = rs[0];
        total = rs[1];
        const access_token = User.createToken({
          userId: user?.id,
          roleId: user?.roleId,
          roleSpecial: user?.roleSpecial,
          storeId: user?.storeId,
        });
        if (type) {
          const fileType = type || "excel";
          const matchingRecords: any = vouchers;
          switch (fileType) {
            case "csv": {
              const fieldNames = req.pageInfo.grid.map((i: any) => i.name);
              let csv = fieldNames.join(",");
              csv += "\n";
              matchingRecords.map((item: any) => {
                let line = "";
                for (let i = 0; i < req.pageInfo.grid.length; i++) {
                  line += `${item[req.pageInfo.grid[i].field] || ""},`;
                }
                csv += line.substr(0, line.length - 1) + "\n";
              });

              res.header(
                "Content-Disposition",
                "attachment; filename=" + "Report.csv"
              );
              res.send(csv);
              break;
            }
            case "excel":
            default: {
              const bin = await reportUtils.reportPageForAutoGenerateModel(
                req.pageInfo,
                matchingRecords
              );
              res.header("Content-Type", "application/vnd.openxmlformats");
              res.header(
                "Content-Disposition",
                "attachment; filename=" + "Report.xlsx"
              );
              res.send(bin);
            }
          }
        } else {
          return res.send({
            access_token,
            data: vouchers,
            count: (total[0]["total"] as number) || 0,
          });
        }
        return res.send({
          code: 0,
          message: "Thành công",
          data: vouchers,
          count: total,
        });
      } catch (err) {
        console.log("🚀 ~ file: cms-find.ts:167 ~ handler: ~ err:", err);
        return res.status(500).send({
          code: 1,
          message: "Lỗi hệ thống",
          err,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
