import type { FastifyCookieOptions } from "@fastify/cookie";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import OAuth2, { FastifyOAuth2Options } from "@fastify/oauth2";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import staticFile from "@fastify/static";
import { createAdapter } from "@socket.io/redis-adapter";
import requestLogMiddleware from "@src/middleware/requestlog";
import Conf from "@src/services/conf";
import { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import path from "path";
import { Server } from "socket.io";
import bootstrap from "./config/bootstrap";
import router from "./router";
import { connectWithRetryPrisma } from "./utils/prisma";
import redis from "./utils/redis";
import redisClientOm from "./utils/redisOm";
// import { connectMongoDB } from "./utils/mongo";
import { ChatSocketService } from "./services/ChatSocket.service";

export default async function loader(app: FastifyInstance) {
  // ************** Register core middleware for all request****************************
  app.register(cors, {
    // allowedHeaders: "content-type,Authorization,accept-language",
    origin: "*",
    methods: "GET,HEAD,PUT,POST,DELETE,PATCH",
    preflightContinue: false,
    optionsSuccessStatus: 204,
    allowedHeaders: "*",
    exposedHeaders: "*",
  });
  app.register(helmet, { global: true, contentSecurityPolicy: false });
  app.register(cookie, {
    secret: "my-secret", // for cookies signature
    parseOptions: {}, // options for parsing cookies
  } as FastifyCookieOptions);
  app.register(multipart, {
    attachFieldsToBody: true,
    limits: {
      fileSize: 50 * 1024 * 1024,
    },
    throwFileSizeLimit: true,
  });
  if (process.env.ENABLE_ZIPKIN === "true") {
    console.log("AAAAAAAAAAA");
    app.register(await import("@fastify/zipkin"), {
      serviceName: process.env.ZIPKIN_NAME || "vds-service",
      httpReporterUrl:
        process.env.ZIPKIN_URL || "https://vds-zipkin.mpoint.vn/api/v2/spans",
      servicePort: Number(process.env.PORT) || 7879,
    });
  }
  app.register(formbody);
  app.register(sensible);
  app.register(staticFile, {
    root: path.join(__dirname, "../assets"),
    prefix: "/", // optional: default '/'
    // constraints: {},
  });
  // Rate limit
  if (process.env.IS_RATE_LIMIT === "true") {
    app.register(rateLimit, {
      global: false,
      keyGenerator: (request) => {
        if (
          request.headers["cf-connecting-ip"] ||
          request.headers["x-original-forwarded-for"]
        ) {
          return (
            (
              request.headers["cf-connecting-ip"] ||
              request.headers["x-original-forwarded-for"]
            )?.toString() || request.ip
          );
        }
        return request.ip;
      },
      allowList: (request, _key) => {
        const listIpConfig = Conf.get("ALLOW_LIST_RATE_LIMIT") || "";
        const allowListIps = listIpConfig.replace(/\s+/g, "").split(",");
        if (allowListIps.includes(request.ip)) {
          return true;
        }
        return false;
      },
      addHeadersOnExceeding: {
        "x-ratelimit-limit": true,
        "x-ratelimit-remaining": true,
        "x-ratelimit-reset": true,
      },
      addHeaders: {
        "x-ratelimit-limit": true,
        "x-ratelimit-remaining": true,
        "x-ratelimit-reset": true,
        "retry-after": true,
      },
      redis,
    });
  }
  const authenticateBasicAuth = { realm: "Westeros" };
  app.register(await import("@fastify/basic-auth"), {
    async validate(username, password, _req, _reply, _done) {
      let result = true;
      const validUsername = process.env.USERNAME_SWAGGER || "1";
      const validPassword = process.env.PASSWORD_SWAGGER || "1";
      result = compare(username, validUsername) && result;
      result = compare(password, validPassword) && result;
      if (result) {
        return;
      } else {
        return new Error("Access denied");
      }
    },
    authenticate: authenticateBasicAuth,
  });

  // Google OAuth2
  app.register(OAuth2, {
    name: "googleOAuth2",
    scope: [
      "openid",
      "profile",
      "email",
      "https://www.googleapis.com/auth/user.phonenumbers.read",
    ],
    credentials: {
      client: {
        id: process.env.GOOGLE_CLIENT_ID!,
        secret: process.env.GOOGLE_CLIENT_SECRET!,
      },
      auth: OAuth2.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: "/api/auth/login/google",
    callbackUri: process.env.GOOGLE_CALLBACK_URL! || "",
    pkce: "S256",
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
    callbackUriParams: {
      access_type: "offline",
      prompt: "consent",
    },
  } as FastifyOAuth2Options);

  app.register(OAuth2, {
    name: "facebookOAuth2",
    scope: ["email", "public_profile"],
    credentials: {
      client: {
        id: process.env.FACEBOOK_CLIENT_ID!,
        secret: process.env.FACEBOOK_CLIENT_SECRET!,
      },
      auth: OAuth2.FACEBOOK_CONFIGURATION,
    },
    startRedirectPath: "/api/auth/login/facebook",
    callbackUri: process.env.FACEBOOK_CALLBACK_URL! || "",
    tags: ["facebook"],
    schema: {
      tags: ["facebook"],
      summary: "Facebook OAuth2",
      description: "Facebook OAuth2",
    },
  });
  // ***************RequestLog ************************************************
  app.addHook("onRequest", (request: any, _reply: any, done: any) => {
    request.requestTime = new Date();
    done();
  });

  app.addHook("onSend", requestLogMiddleware);
  // ***************End RequestLog ************************************************

  // ************** End core middleware for all request****************************

  // ************** Router ******************************
  app.register(await import("fastify-healthcheck"), {
    healthcheckUrl: "/api/healthcheck",
  });
  app.register(router);

  // **************** Check connection *******************
  await connectWithRetryPrisma();
  console.log("🚀 Database ===> Ok!");

  // **************** Loading bootstrap ****************
  await bootstrap();
  console.log("🚀 Bootstrap ===> Ok!");

  // await connectMongoDB();

  // ************** Socket *******************************
  const server = app.server;
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });
  const subClient = redisClientOm.duplicate();
  try {
    io.adapter(createAdapter(redisClientOm, subClient));
    ChatSocketService.getInstance(io);
    subClient.on("error", (err: any) => console.log("subClient Error", err));
  } catch (error) {
    console.error("subClient redis ===> Error :", error);
  }
}

function compare(a: any, b: any) {
  a = Buffer.from(a);
  b = Buffer.from(b);
  if (a.length !== b.length) {
    // Delay return with cryptographically secure timing check.
    crypto.timingSafeEqual(a, a);
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}
