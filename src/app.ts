import fastify from "fastify";
import "dotenv/config";
import chalk from "chalk";
import fastifyRequestLogger from "@mgcrea/fastify-request-logger";
import loader from "./loader";
import common from "./utils/common";
import { ZodError } from "zod";
(BigInt.prototype as any).toJSON = function () {
  const int = Number.parseInt(this.toString());
  return int ?? this.toString();
};
process.on("uncaughtException", (err) => {
  console.error(chalk.redBright("Error system", err.stack || err.message));
});
//
const FASTIFY_PORT = Number(process.env.PORT) || 1337;

const app = fastify({
  // Logger only for production
  logger: {
    level: "debug",
    enabled: process.env.NODE_ENV === "production" ? false : true,
    transport: {
      target: "@mgcrea/pino-pretty-compact",
      options: {
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
        ignore: "pid,hostname",
        singleLine: true,
      },
    },
  },
  disableRequestLogging: true,
  pluginTimeout: 60000,
  trustProxy: true,
});
app.register(fastifyRequestLogger);
app.register(loader);
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) {
    const errorsMessage = common.generateMessageErrorZod(error);
    return reply.status(200).send({
      code: 422,
      message: errorsMessage[0].message,
      issues: errorsMessage,
    });
  }
  return reply.send(error);
});

const start = async () => {
  try {
    await app.listen({ port: FASTIFY_PORT, host: "0.0.0.0" });
    const addr = app.server.address();
    const addrStr =
      typeof addr === "string" ? addr : `${addr?.address}:${addr?.port}`;
    console.log(
      chalk.bold.green(`🚀 Server running on port ${chalk.yellow(addrStr)}`)
    );
  } catch (err) {
    console.error("🚀 ~ start ~ err:", err);
    process.exit(1);
  }
};
start();
