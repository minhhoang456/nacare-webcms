import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import retryHelper from '../helpers/retry.helper';
import * as services from '../services';
import cursorStream from 'prisma-cursorstream';

// import ono from '@jsdevtools/ono'
const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prismaNew = new PrismaClient({
  adapter,
  log: [
    {
      emit: 'event',
      level: 'query',
    },
    {
      emit: 'stdout',
      level: 'error',
    },
    {
      emit: 'stdout',
      level: 'info',
    },
    {
      emit: 'stdout',
      level: 'warn',
    },
  ],
});
if (Number(process.env.LOG_PRISMA) === 1) {
  prismaNew.$on('query', (e) => {
    console.log('Query: ' + e.query);
    console.log('Params: ' + e.params);
    console.log('Duration: ' + e.duration + 'ms');
  });
}
const prismaClient = prismaNew
  .$extends({
    query: {
      $allModels: {
        async findMany({ args, query, model }) {
          const serviceName = `${model}Service`;
          if ((services as any)[serviceName]?.beforeFindMany) {
            args = await (services as any)[serviceName]?.beforeFindMany(args);
          }
          let result = await query(args);
          if ((services as any)[serviceName]?.afterFindMany) {
            result = await (services as any)[serviceName].afterFindMany(result);
          }
          return result;
        },
        async create({ args, query, model }) {
          const models = Prisma.dmmf.datamodel.models;
          const modelCreate = models.find(
            (modelPrisma) => modelPrisma.name === model
          );
          const now = new Date().getTime();
          const objectWithTime: any = {};
          if (modelCreate?.fields) {
            for (let i = 0; i < modelCreate?.fields.length; i++) {
              const fieldInfo = modelCreate?.fields[i];
              if (fieldInfo.name === 'updatedAt') {
                objectWithTime.updatedAt = now;
              }
              if (fieldInfo.name === 'createdAt') {
                objectWithTime.createdAt = now;
              }
              const typesNumber = ['Decimal', 'Float', 'Int', 'BigInt'];
              if (
                args.data &&
                args.data[fieldInfo.name as keyof typeof args.data] &&
                typesNumber.some((e) => e === fieldInfo?.type)
              ) {
                const field = fieldInfo.name as keyof typeof args.data;
                if (typeof args.data[field] === 'string') {
                  (args.data[field] as any) = Number(args.data[field]);
                }
              }
            }
          }
          const serviceName = `${model}Service`;
          if ((services as any)[serviceName]?.validateData) {
            await (services as any)[serviceName]?.validateData(args.data);
          }
          if ((services as any)[serviceName]?.beforeCreate) {
            args.data = await (services as any)[serviceName]?.beforeCreate(
              args.data
            );
          }
          let result = await query({
            select: args.select,
            data: {
              ...args.data,
              ...objectWithTime,
            },
          });
          if ((services as any)[serviceName]?.afterCreate) {
            result = await (services as any)[serviceName].afterCreate(result);
          }
          return result;
        },
        async createMany({ args, query, model }) {
          const models = Prisma.dmmf.datamodel.models;
          const modelCreate = models.find(
            (modelPrisma) => modelPrisma.name === model
          );
          const now = new Date().getTime();
          const objectWithTime: any = {};
          if (Array.isArray(args.data)) {
            if (modelCreate?.fields) {
              for (let i = 0; i < modelCreate?.fields.length; i++) {
                const fieldInfo = modelCreate?.fields[i];
                if (fieldInfo.name === 'updatedAt') {
                  objectWithTime.updatedAt = now;
                }
                if (fieldInfo.name === 'createdAt') {
                  objectWithTime.createdAt = now;
                }
                const typesNumber = ['Decimal', 'Float', 'Int', 'BigInt'];
                if (typesNumber.some((e) => e === fieldInfo?.type)) {
                  for (let j = 0; j < args.data.length; j++) {
                    const row = args.data[j] as Record<string, unknown>;
                    if (row[fieldInfo.name]) {
                      row[fieldInfo.name] = Number(row[fieldInfo.name]);
                    }
                  }
                }
              }
            }
            return query({
              skipDuplicates: args.skipDuplicates,
              data: args.data.map((row) => ({
                ...row,
                ...objectWithTime,
              })),
            });
          } else {
            if (modelCreate?.fields) {
              for (let i = 0; i < modelCreate?.fields.length; i++) {
                const fieldInfo = modelCreate?.fields[i];
                if (fieldInfo.name === 'updatedAt') {
                  objectWithTime.updatedAt = now;
                }
                if (fieldInfo.name === 'createdAt') {
                  objectWithTime.createdAt = now;
                }
                const typesNumber = ['Decimal', 'Float', 'Int', 'BigInt'];
                const data = args.data as Record<string, unknown>;
                if (
                  data &&
                  data[fieldInfo.name] &&
                  typesNumber.some((e) => e === fieldInfo?.type)
                ) {
                  data[fieldInfo.name] = Number(data[fieldInfo.name]);
                }
              }
            }
            return query({
              skipDuplicates: args.skipDuplicates,
              data: {
                ...args.data,
                ...objectWithTime,
              },
            });
          }
        },
        async update({ args, query, model }) {
          const models = Prisma.dmmf.datamodel.models;
          const modelUpdating = models.find(
            (modelPrisma) => modelPrisma.name === model
          );
          const now = new Date().getTime();
          const objectWithTime: any = {};
          if (modelUpdating?.fields) {
            for (let i = 0; i < modelUpdating?.fields.length; i++) {
              const fieldInfo = modelUpdating?.fields[i];
              if (fieldInfo.name === 'updatedAt') {
                objectWithTime.updatedAt = now;
              }
              const typesNumber = ['Decimal', 'Float', 'Int', 'BigInt'];
              const data = args.data as Record<string, unknown>;
              if (
                data &&
                data[fieldInfo.name] &&
                typesNumber.some((e) => e === fieldInfo?.type)
              ) {
                data[fieldInfo.name] = Number(data[fieldInfo.name]);
              }
            }
          }

          const serviceName = `${model}Service`;
          if ((services as any)[serviceName]?.validateData) {
            await (services as any)[serviceName]?.validateData(args.data);
          }
          if ((services as any)[serviceName]?.beforeUpdate) {
            args.data = await (services as any)[serviceName]?.beforeUpdate(
              args.data
            );
          }
          const argumentsQuery = {
            data: {
              ...args.data,
              ...objectWithTime,
            },
            where: args.where,
            select: args.select,
          } as typeof args;
          let result = await query(argumentsQuery);
          if ((services as any)[serviceName]?.afterUpdate) {
            result = await (services as any)[serviceName].afterUpdate(result);
          }
          return result;
        },
        async updateMany({ args, query, model }) {
          const models = Prisma.dmmf.datamodel.models;
          const modelUpdating = models.find(
            (modelPrisma) => modelPrisma.name === model
          );
          const now = new Date().getTime();
          const objectWithTime: any = {};
          if (modelUpdating?.fields) {
            for (let i = 0; i < modelUpdating?.fields.length; i++) {
              const fieldInfo = modelUpdating?.fields[i];
              if (fieldInfo.name === 'updatedAt') {
                objectWithTime.updatedAt = now;
              }
              const typesNumber = ['Decimal', 'Float', 'Int', 'BigInt'];
              const data = args.data as Record<string, unknown>;
              if (
                data &&
                data[fieldInfo.name] &&
                typesNumber.some((e) => e === fieldInfo?.type)
              ) {
                data[fieldInfo.name] = Number(data[fieldInfo.name]);
              }
            }
          }
          const argumentsQuery = {
            data: {
              ...args.data,
              ...objectWithTime,
            },
            where: args.where,
          } as typeof args;
          return query(argumentsQuery);
        },
      },
    },
  })
  .$extends(cursorStream);

async function connectWithRetryPrisma() {
  const operation = retryHelper.createRetryOperationPrisma();

  return new Promise((resolve, reject) => {
    operation.attempt(async (currentAttempt) => {
      try {
        await prismaClient.$connect();
        resolve(true);
      } catch (error: any) {
        console.error(
          `Error connecting to the database (Attempt ${currentAttempt}): ${error.message}`
        );
        if (operation.retry(error)) {
          console.log(`Retrying connection database`);
          return;
        }
        reject(new Error('Unable to connect to the database'));
      }
    });
  });
}

export { prismaClient, Prisma, connectWithRetryPrisma };
