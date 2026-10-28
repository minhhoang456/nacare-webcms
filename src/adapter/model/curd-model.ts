import { FastifyReply } from "fastify";
import _ from "lodash";
import reportUtils from "@root/src/utils/report";
import { Prisma } from "@root/src/utils/prisma";
import Conf from "@src/services/conf";
const tableHandle: any = {
  productType: "Loại sản phẩm",
  product: "Sản phẩm",
  product_inventory_log: "Lịch sử nhập xuất kho",
};
export const generateItemCreate =
  (prismaTableController: any, fieldTable: any) =>
  async (_request: any, reply: FastifyReply) => {
    try {
      _request.autoGenerateModel = true;
      const data: any = _request.body;
      for (const key in data) {
        const fieldInfo = fieldTable.find((e: any) => e.name === key);
        if (!fieldInfo) {
          delete data[key];
          continue;
        }
        if (fieldInfo.type === "Boolean") {
          data[key] = data[key] ? true : false;
        }
        // parse value to number if type is number
        if (fieldInfo.type === "Int" || fieldInfo.type === "Float") {
          data[key] = Number(data[key]);
        }
      }
      const newItem = await prismaTableController.create({ data });
      reply.send(newItem);
    } catch (error: any) {
      console.log(`🚀 ERROR create ${prismaTableController}`, error);
      return reply.code(500).send({
        code: 1,
        message: error?.message ? error?.message : "Đã có lỗi xảy ra",
        error: error?.message,
      });
    }
  };

export const generateItemsRead =
  (prismaTableController: any, fieldTable: any, _tableName?: string) =>
  async (req: any, res: FastifyReply) => {
    try {
      req.autoGenerateModel = true;
      const {
        skip = 0,
        limit = 100,
        sort = '[{ "id": "desc" }]',
        // order = "desc",
        where,
        select,
        search,
      } = req.query as any;
      // Note: offset pagination does not scale well
      // https://www.prisma.io/docs/concepts/components/prisma-client/pagination#-cons-of-offset-pagination
      const query = {
        ...JSON.parse(where || "{}"),
        ...(search ? JSON.parse(search) : undefined),
      };
      for (const key in query) {
        const fieldInfo: Prisma.DMMF.Field = fieldTable.find(
          (e: any) => e.name === key
        );
        if (fieldInfo?.type === "Boolean") {
          if (typeof query[key] === "string") {
            query[key] = query[key] === "true";
          } else {
            query[key] = query[key] ? true : false;
          }
        }
        if (!fieldInfo) {
          delete query[key];
          continue;
        }
        // parse value to number if type is number
        if (
          typeof query[key] === "string" &&
          (fieldInfo?.type === "Int" ||
            fieldInfo?.type === "Float" ||
            fieldInfo?.type === "Decimal" ||
            fieldInfo?.type === "BigInt")
        ) {
          query[key] = Number(query[key]);
        }
        if (Array.isArray(query[key])) {
          query[key] = {
            in: query[key],
          };
        }
        if (query[key].contains) {
          if (
            fieldInfo.kind === "enum" &&
            typeof query[key] === "object" &&
            Object.keys(query[key]).length === 1
          ) {
            query[key] = query[key].contains;
          } else {
            query[key] = {
              ...query[key],
              mode: "insensitive",
            };
          }
        }
      }

      if (req.roleId == Conf.get("ADMIN_ROLE_ID", 15)) {
        if (_tableName && tableHandle[_tableName]) {
          switch (_tableName) {
            case "productType": {
              query.storeId = req.storeId || 0;
              break;
            }
            case "product": {
              query.storeId = req.storeId || 0;
              break;
            }
            case "product_inventory_log": {
              query.userId = req.user.id || 0;
              break;
            }
          }
        }
      }

      const fullQuery: any = {
        where: query,
        skip: Number(skip),
        take: Number(limit),
        select,
      };
      if (typeof sort === "string") {
        fullQuery.orderBy = JSON.parse(sort).flatMap((obj: any) =>
          Object.entries(obj).map(([key, value]) => ({ [key]: value }))
        );
      } else {
        fullQuery.orderBy = sort.flatMap((obj: any) =>
          Object.entries(obj).map(([key, value]) => ({ [key]: value }))
        );
      }
      if (req.apiInfo && req.apiInfo.downloadReport) {
        const queryReport: any = _.pick(fullQuery, [
          "where",
          "orderBy",
          "select",
        ]);
        queryReport.skip = 0;
        queryReport.take = 5000;
        const items = await prismaTableController.findMany(queryReport);
        switch (req.query?.type) {
          case "csv": {
            const fieldNames = req.pageInfo.grid.map((i: any) => i.name);
            let csv = fieldNames.join(",");
            csv += "\n";
            items.map((item: any) => {
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
          default: {
            const bin = await reportUtils.reportPageForAutoGenerateModel(
              req.pageInfo,
              items
            );
            res.header("Content-Type", "application/vnd.openxmlformats");
            res.header(
              "Content-Disposition",
              "attachment; filename=" + "Report.xlsx"
            );
            res.send(bin);
            break;
          }
        }
      }
      const [items, count] = await Promise.all([
        prismaTableController.findMany(fullQuery),
        prismaTableController.count({
          where: query,
        }),
      ]);
      res.send({ count, data: items });
    } catch (error: any) {
      console.log(`🚀 ERROR GET ${prismaTableController}`, error);
      return res.code(500).send({
        code: 1,
        message: "Đã có lỗi xảy ra",
        error: error?.message,
      });
    }
  };

export const generateItemRead =
  (prismaTableController: any, fieldTable: any) =>
  async (req: any, res: FastifyReply) => {
    try {
      req.autoGenerateModel = true;
      console.log(fieldTable);
      const { primaryKeyField } = prismaTableController;
      const { id }: any = req.params;
      let { includes = [] }: any = req.query;

      if (typeof includes === "string") includes = [includes];

      const query: any = { where: { [primaryKeyField]: Number(id) } };
      if (includes.length)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        query.include = includes.reduce(
          (prev: any, i: any) => ({ ...prev, [i]: true }),
          {}
        );

      const item = await prismaTableController.findUnique(query);
      res.send(item);
    } catch (error: any) {
      console.log(`🚀 ERROR READ UNIQUE ${prismaTableController}`, error);
      return res.code(500).send({
        code: 1,
        message: "Đã có lỗi xảy ra",
        error: error?.message,
      });
    }
  };

export const generateItemUpdate =
  (prismaTableController: any, fieldTable: any) =>
  async (req: any, res: FastifyReply) => {
    try {
      req.autoGenerateModel = true;
      const { primaryKeyField } = prismaTableController;
      const { id }: any = req.params;
      const data: any = req.body;
      for (const key in data) {
        const fieldInfo = fieldTable.find((e: any) => e.name === key);
        if (!fieldInfo) {
          delete data[key];
          continue;
        }
        if (fieldInfo.type === "Boolean") {
          data[key] = data[key] ? true : false;
        }
        // parse value to number if type is number
        if (fieldInfo.type === "Int" || fieldInfo.type === "Float") {
          data[key] = Number(data[key]);
        }
      }
      // delete data?.id
      const query = {
        where: { [primaryKeyField]: Number(id) },
        data: {
          ...data,
          id: Number(id),
        },
      };
      const itemUpdate = await prismaTableController.update(query);
      res.send(itemUpdate);
    } catch (error: any) {
      console.log(`🚀 ERROR UPDATE ${prismaTableController}`, error);
      return res.code(500).send({
        code: 1,
        message: error?.message ? error?.message : "Đã có lỗi xảy ra",
        error: error?.message,
      });
    }
  };

export const generateItemDelete =
  (prismaTableController: any) => async (req: any, res: FastifyReply) => {
    try {
      req.autoGenerateModel = true;
      const { primaryKeyField } = prismaTableController;
      const { id }: any = req.params;
      const query = { where: { [primaryKeyField]: Number(id) } };
      const itemDelete = await prismaTableController.delete(query);
      res.send(itemDelete);
    } catch (error: any) {
      console.log(`🚀 ERROR DELETE ${prismaTableController}`, error);
      return res.code(500).send({
        code: 1,
        message: "Đã có lỗi xảy ra",
        error: error?.message,
      });
    }
  };
