/* eslint-disable no-extra-semi */
import { Queue, Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import * as services from "../services";
import ConfigSystem from "../config/config";
import moment from "moment";

const redisConfig = {
  host: ConfigSystem.REDIS_CONFIG.host,
  port: Number(ConfigSystem.REDIS_CONFIG.port),
  db: Number(ConfigSystem.REDIS_CONFIG.db),
  ...(ConfigSystem.REDIS_CONFIG.password && {
    password: ConfigSystem.REDIS_CONFIG.password,
  }),
  prefix:
    ConfigSystem.REDIS_CONFIG.keyPrefix &&
    ConfigSystem.REDIS_CONFIG.keyPrefix.includes(":")
      ? ConfigSystem.REDIS_CONFIG.keyPrefix.replace(":", "")
      : ConfigSystem.REDIS_CONFIG.keyPrefix || "hhvn-fastify-dev-local",
};

const SCHEDULER_CONFIG = [
  {
    id: "commission-repurchase-recovery-scheduler",
    pattern: "* * * * *",
    methodName: "runPendingCommissionRepurchases",
  },
  {
    id: "one-minute-scheduler",
    pattern: "* * * * *",
    methodName: "runCronjob1",
  },
  {
    id: "five-minute-scheduler",
    pattern: "*/5 * * * *",
    methodName: "runCronjob5",
  },
  {
    id: "thirty-minute-scheduler",
    pattern: "*/30 * * * *",
    methodName: "runCronjob30Minutes",
  },
  {
    id: "hour-scheduler",
    pattern: "0 * * * *",
    methodName: "runCronjob1Hour",
  },
  {
    id: "six-hours-scheduler",
    pattern: "0 */6 * * *",
    methodName: "runCronjob6Hour",
  },
  {
    id: "twelve-hours-scheduler",
    pattern: "0 */12 * * *",
    methodName: "runCronjob12Hour",
  },
  {
    id: "three-minutes-scheduler",
    pattern: "*/3 * * * *",
    methodName: "runCronjob3",
  },
  {
    id: "commission-realtime-recovery-scheduler",
    pattern: "* * * * *",
    methodName: "runPendingRealtimeCommission",
  },
  {
    id: "daily-accumulation-scheduler",
    pattern: "0 7 * * *",
    methodName: "runDailyAccumulation",
  },
];

const schedulerQueue = new Queue("scheduler-queue", {
  prefix: redisConfig.prefix,
  connection: redisConfig,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 30000,
    },
  },
});
let worker: Worker;

const createWorkerProcessor = async (job: any) => {
  try {
    const { methodName } = job.data;
    if (methodName === "runPendingCommissionRepurchases") {
      await services.commissionRepurchaseService.runPending();
      return;
    }
    console.log(
      `${moment().format("YYYY-MM-DD HH:mm:ss")} running ${methodName}`,
    );
    // Mục 2, 3 và cộng hưởng Mục 5 chạy lúc 07:00; các mục realtime còn lại
    // được quét bù mỗi phút nếu xử lý sau IPN bị gián đoạn.
    if (methodName === "runDailyAccumulation") {
      await (services as any).commissionRunService.runDailyAccumulation();
      return;
    }
    if (methodName === "runPendingRealtimeCommission") {
      await (services as any).commissionRealtimeService.runPending();
      return;
    }
    const models = Prisma.dmmf.datamodel.models;
    for (const model of models) {
      const serviceName = `${model.name}Service`;
      if ((services as any)[serviceName]?.[methodName]) {
        await (services as any)[serviceName][methodName]().catch((err: any) => {
          console.error(`Error running ${methodName} for ${serviceName}:`, err);
        });
      }
    }
  } catch (error) {
    console.error(`Error in worker processor:`, error);
    throw error;
  }
};

const initialize = async () => {
  if (!worker) {
    worker = new Worker("scheduler-queue", createWorkerProcessor, {
      prefix: redisConfig.prefix,
      connection: redisConfig,
    });

    worker.on("failed", (job: any, err: any) => {
      console.error(`Job ${job?.id} failed:`, err);
    });

    worker.on("error", (err: any) => {
      console.error(`Worker error:`, err);
    });

    await worker.waitUntilReady();
  }
};

const upsertJobScheduler = async (schedulerId: string, pattern: string) => {
  const config = SCHEDULER_CONFIG.find((c) => c.id === schedulerId);
  if (!config) {
    throw new Error(`Unknown scheduler ID: ${schedulerId}`);
  }

  try {
    const existingSchedulers = await schedulerQueue.getJobSchedulers();
    for (const scheduler of existingSchedulers) {
      if (scheduler.id === schedulerId) {
        await schedulerQueue.removeJobScheduler(schedulerId);
        console.log(`Removed existing job scheduler: ${schedulerId}`);
        break;
      }
    }

    await schedulerQueue.upsertJobScheduler(
      schedulerId,
      {
        pattern,
        tz: "Asia/Ho_Chi_Minh",
      },
      {
        name: config.methodName,
        data: {
          methodName: config.methodName,
        },
      },
    );

    console.log(`Registered: ${schedulerId}`);
    return true;
  } catch (error) {
    console.error(`Error upserting job scheduler ${schedulerId}:`, error);
    throw error;
  }
};

export const scheduleService = {
  startScheduledTask: async () => {
    try {
      await initialize();

      // Xóa toàn bộ tên lịch hoa hồng cũ để không chạy song song sau deploy.
      await schedulerQueue.removeJobScheduler("daily-commission-scheduler");
      await schedulerQueue.removeJobScheduler(
        "daily-commission-policy-scheduler",
      );

      for (const config of SCHEDULER_CONFIG) {
        await upsertJobScheduler(config.id, config.pattern);
      }

      // BullMQ không phát lại một mốc cron đã bị bỏ lỡ khi backend tắt. Nếu
      // khởi động sau 07:00, đẩy một job bù; service sẽ tự bỏ qua ngày đã hoàn
      // tất và chạy tuần tự các ngày còn thiếu.
      const vietnamNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
      if (vietnamNow.getUTCHours() >= 7) {
        const date = vietnamNow.toISOString().slice(0, 10);
        await schedulerQueue.add(
          "runDailyAccumulation",
          { methodName: "runDailyAccumulation" },
          { jobId: `daily-accumulation-catch-up-${date}` },
        );
      }

      console.log("Schedulers started successfully");
    } catch (error) {
      console.error("Error starting scheduled tasks:", error);
      throw error;
    }
  },

  shutdown: async () => {
    try {
      if (worker) {
        await worker.close();
      }
      await schedulerQueue.close();
      console.log("BullMQ scheduler shut down gracefully");
    } catch (error) {
      console.error("Error shutting down scheduler:", error);
      throw error;
    }
  },
};
export default scheduleService;
