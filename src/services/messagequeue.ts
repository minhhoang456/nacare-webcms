import Queue, { QueueOptions } from "bull";
import ConfigSystem from "@src/config/config";
import { prismaClient, Prisma } from "../utils/prisma";
import { sendMail } from "@src/helpers/func.helper";
import exchange from "../utils/exchange";
interface JobType {
  action: "create" | "update" | "destroy" | "createMany";
  model: Prisma.ModelName;
  data: any;
  updateCrit?: any;
  destroyCrit?: any;
}

interface EventType {
  action: "push_mail" | "sync_state_code_exchange";
  data: any;
}

const queueOptions: QueueOptions = {
  redis: {
    db: ConfigSystem.REDIS_CONFIG.db,
    password: ConfigSystem.REDIS_CONFIG.password,
    host: ConfigSystem.REDIS_CONFIG.host,
    port: ConfigSystem.REDIS_CONFIG.port,
  },
  prefix: `${process.env.REDIS_PREFIX}bull_queue`,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    timeout: 30000,
    attempts: 5,
    backoff: {
      type: "fixed",
      delay: 3000,
    },
  },
  settings: {
    stalledInterval: 60000, //thời gian chờ 6os
  },
};
const dbQueue = new Queue("database_request", queueOptions);
//
dbQueue.process(async (job) => {
  const now = new Date().getTime();
  const { action, model, data, updateCrit, destroyCrit } = job.data;
  const prismaTableController: any =
    prismaClient[model as keyof typeof prismaClient];
  switch (action) {
    case "create":
      data.createdAt = data.createdAt || now;
      data.updatedAt = data.updatedAt || now;
      await prismaTableController.create({ data });
      break;
    case "update":
      data.updatedAt = data.updatedAt || now;
      const queryUpdate = {
        where: updateCrit,
        data,
      };
      await prismaTableController.updateMany(queryUpdate);
      break;
    case "createMany":
      const createManyData = Array.isArray(data) ? data : [data];
      // createManyData.forEach(item => {
      //   item.createdAt = item.createdAt || now
      //   item.updatedAt = item.updatedAt || now
      // })
      await prismaTableController.createMany({
        data: createManyData,
        skipDuplicates: false, // or true, depending on your needs
      });
      break;
    case "destroy":
      await prismaTableController.delete({
        where: destroyCrit,
      });
      break;
    default:
      break;
  }
});
dbQueue.on("failed", (job, err) => {
  console.error(err);
  console.log(
    `Failed job ${job.id} and trying to retry number : ${job.attemptsMade}`
  );
});
dbQueue.on("error", (error) => {
  console.log(error);
});

const dbQueueEvents = new Queue("database_request_events", {
  redis: {
    db: ConfigSystem.REDIS_CONFIG.db,
    password: ConfigSystem.REDIS_CONFIG.password,
    host: ConfigSystem.REDIS_CONFIG.host,
    port: ConfigSystem.REDIS_CONFIG.port,
  },
  prefix: `${process.env.REDIS_PREFIX}bull_queue_event`,
  defaultJobOptions: {
    removeOnComplete: true,
    timeout: 30000,
    attempts: 5,
    backoff: {
      type: "fixed",
      delay: 3000,
    },
  },
});
dbQueueEvents.process(async (job) => {
  const { action, data } = job.data;
  try {
    switch (action) {
      case "push_mail":
        await sendMail(data);
        break;
      case "sync_state_code_exchange":
        await exchange.syncCodeState(data);
        break;
      default:
        break;
    }
  } catch (error) {
    console.log(
      "🚀 ~ file: messagequeue.ts:114 ~ dbQueueEvents.process ~ error:",
      error
    );
    throw error;
  }
});
dbQueueEvents.on("failed", (job, err) => {
  console.error(err);
  console.log(
    `Failed job ${job.id} and trying to retry number : ${job.attemptsMade}`
  );
});
dbQueueEvents.on("error", (error) => {
  console.log(error);
});

export const messagequeueService = {
  addDbItem: (job: JobType) => {
    dbQueue.add(job);
  },
  addEvent: (event: EventType) => {
    dbQueueEvents.add(event);
  },
};
export default messagequeueService;
