import messagequeueService from "./../services/messagequeue";
import { Prisma } from "@prisma/client";
import { FastifyReply } from "fastify";

const excludes = [
  "/api/file/upload-file-large/get-multipart-upload-id",
  "/api/file/upload-file-large/upload-part",
  "/api/file/upload-file-large/complete-upload",
];

export default async function requestLogMidlleware(
  this: any,
  _req: any,
  _res: FastifyReply,
  payload: any,
) {
  if (
    _req.routeOptions &&
    _req.routeOptions.url &&
    _req?.routeOptions?.url.includes("/api") &&
    !_req.autoGenerateModel &&
    !_req.notSaveRequestLog &&
    !excludes.includes(_req.routeOptions.url)
  ) {
    let ip: string = _req.ip;
    if (
      _req.headers["cf-connecting-ip"] ||
      _req.headers["x-original-forwarded-for"]
    ) {
      ip =
        (
          _req.headers["cf-connecting-ip"] ||
          _req.headers["x-original-forwarded-for"]
        )?.toString() || _req.ip;
    }
    const data: Prisma.requestlogCreateInput = {
      api: _req.routeOptions.url,
      code: payload?.code ? payload.code : 0,
      dur: Math.floor(_res.elapsedTime),
      header: JSON.stringify(_req.headers),
      ip: ip,
      merchantId: 0,
      request: JSON.stringify((_req.body as any) || (_req.query as any)),
      response: payload && typeof payload === "string" ? payload : null,
    };
    data.response =
      typeof data.response === "string"
        ? data.response.slice(0, 20000)
        : data.response;
    messagequeueService.addDbItem({
      model: "requestlog",
      action: "create",
      data,
    });
  }
  _res.header("Connection", "keep-alive");
  _res.header("Keep-Alive", "timeout=5, max=1000");
  return payload;
}
