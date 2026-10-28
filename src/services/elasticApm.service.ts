import _ from "lodash";
import axios, { RawAxiosRequestConfig } from "axios";
import { Prisma } from "@prisma/client";
const allowRequestLog = [
  "/api/customer/get-token",
  "/api/voucher/create-order",
  "/api/voucher/pay-order",
  "/api/code/lock-code",
  "/api/code/unlock-code",
  "/api/code/use-code",
  "/api/pay/ipn",
  "/api/pay/verify-data",
];

export const elasticApmService = {
  apmRequestLog: async (params: {
    api: string;
    request: string;
    response: string;
    code: number;
    header: string;
    dur: number;
    ip: string;
    requestTime: string;
    responseTime: string;
  }) => {
    if (process.env.APM_LOG === "true") {
      try {
        const {
          api,
          request,
          response,
          code,
          header,
          dur,
          ip,
          requestTime,
          responseTime,
        } = params;
        const isValid =
          ((api && api.match(new RegExp("/", "g"))) || []).length > 2;
        if (isValid) {
          if (_.includes(allowRequestLog, api)) {
            const data = {
              "restful.logs.service":
                process.env.APM_SERVICE_NAME || "vds-service-dev",
              environment: process.env.APM_ENVIRONMENT
                ? process.env.APM_ENVIRONMENT
                : "development",
              "restful.logs.type": "incoming",
              "restful.logs.api": api,
              "restful.logs.requestTime": requestTime,
              "restful.logs.responseTime": responseTime,
              "restful.logs.req": request,
              "restful.logs.res":
                response &&
                typeof response === "string" &&
                response.length > 2000
                  ? response.slice(0, 2000)
                  : response,
              "restful.logs.code": code,
              "restful.logs.header": header,
              "restful.logs.dur": dur,
              "restful.logs.ip": ip,
            };
            const options: RawAxiosRequestConfig = {
              method: "POST",
              url:
                process.env.APM_LOG_URL || "http://logs-endpoint.mediaone.dev",
              headers: {
                "content-type": "application/json",
                authorization: `Basic ${Buffer.from(
                  `logstash_m1:Mediaone@@123`,
                  "utf8"
                ).toString("base64")}`,
              },
              data,
              timeout: 3000,
            };
            axios(options);
          }
        }
      } catch (error) {
        console.log("🚀 ~ file: elasticApm.service.ts:69 ~ error:", error);
      }
    }
  },
  addOutgoingLog: async (params: Prisma.outgoingCreateInput) => {
    if (process.env.APM_LOG === "true") {
      try {
        const { host, req, res, dur, error } = params;
        const data = {
          "restful.logs.service":
            process.env.APM_SERVICE_NAME || "vds-service-dev",
          environment: process.env.APM_ENVIRONMENT
            ? process.env.APM_ENVIRONMENT
            : "development",
          "restful.logs.type": "outgoing",
          "restful.logs.host": host,
          "restful.logs.req": req,
          "restful.logs.res":
            typeof res === "string" && res.length > 2000
              ? res.slice(0, 2000)
              : res,
          "restful.logs.dur": dur,
          "restful.logs.code": error,
        };
        const options: RawAxiosRequestConfig = {
          method: "POST",
          url: process.env.APM_LOG_URL || "http://logs-endpoint.mediaone.dev",
          headers: {
            "content-type": "application/json",
            authorization: `Basic ${Buffer.from(
              `logstash_m1:Mediaone@@123`,
              "utf8"
            ).toString("base64")}`,
          },
          data,
          timeout: 3000,
        };
        axios(options);
      } catch (error) {
        console.log(
          "🚀 ~ file: elasticApm.service.ts:97 ~ addOutgoingLog: ~ error:",
          error
        );
      }
    }
  },
};
export default elasticApmService;
