import { FastifyInstance } from 'fastify';
import {
  generateItemCreate,
  generateItemsRead,
  generateItemRead,
  generateItemUpdate,
  generateItemDelete,
} from './curd-model';
import { Prisma, prismaClient } from '../../utils/prisma';
import pageMiddleware from '@src/middleware/page';
import userMidlleware from '@src/middleware/user';
import actionLogMidlleware from '@root/src/middleware/actionLog';

const generateTableRouter =
  (fastify: FastifyInstance) =>
  async (prismaTableController: any, tableName: string, fields?: any) => {
    fastify.register(
      (app, _, done) => {
        app.post(
          `/`,
          {
            preHandler: [
              userMidlleware as any,
              pageMiddleware,
              actionLogMidlleware,
            ],
          },
          generateItemCreate(prismaTableController, fields)
        );
        app.get(
          `/`,
          {
            preHandler: [
              userMidlleware as any,
              pageMiddleware,
              actionLogMidlleware,
            ],
          },
          generateItemsRead(prismaTableController, fields, tableName)
        );
        done();
      },
      { prefix: `/${tableName}` }
    );

    fastify.register(
      (app, _, done) => {
        app.get(
          `/`,
          {
            preHandler: [
              userMidlleware as any,
              pageMiddleware,
              actionLogMidlleware,
            ],
          },
          generateItemRead(prismaTableController, fields)
        );
        app.patch(
          `/`,
          {
            preHandler: [
              userMidlleware as any,
              pageMiddleware,
              actionLogMidlleware,
            ],
          },
          generateItemUpdate(prismaTableController, fields)
        );
        app.delete(
          `/`,
          {
            preHandler: [
              userMidlleware as any,
              pageMiddleware,
              actionLogMidlleware,
            ],
          },
          generateItemDelete(prismaTableController)
        );
        done();
      },
      { prefix: `/${tableName}/:id` }
    );
  };

export default async function generateCurdModel(fastify: FastifyInstance) {
  const models = Prisma.dmmf.datamodel.models;
  models.forEach((model) => {
    const { name, fields } = model;
    const prismaTableController: any =
      prismaClient[name as keyof typeof prismaClient];
    prismaTableController.primaryKeyField = fields.find(({ isId }: any) => isId)
      ?.name;
    generateTableRouter(fastify)(prismaTableController, name, fields);
  });
}
