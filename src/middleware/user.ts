import { FastifyReply, FastifyRequest } from "fastify";
import UserService from "../services/user.service";
import { prismaClient } from "@src/utils/prisma";

export default async function userMidlleware(
  req: FastifyRequest & {
    query?: {
      accesstoken?: string;
    };
    userId?: number;
    roleId?: number;
    roleSpecial?: string;
    storeId?: number;
    user?: any;
  },
  res: FastifyReply,
) {
  try {
    const auth =
      req.headers.authorization || `Bearer ${req?.query?.accesstoken}`;
    const token = auth.split(" ")[1];
    const { newToken, data } = await UserService.verifyUserToken(token);
    const userId = Number(data.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new Error("Invalid admin user ID");
    }
    let roleSpecial = data.roleSpecial;
    if (!roleSpecial) {
      const user = await prismaClient.user.findUnique({
        where: { id: userId },
        select: { roleSpecial: true },
      });
      if (!user) throw new Error("Admin user does not exist");
      roleSpecial = user.roleSpecial ?? undefined;
    }
    req.userId = userId;
    req.roleId = data.roleId;
    req.roleSpecial = roleSpecial;
    req.storeId = data.storeId;
    req.user = {
      id: userId,
      role: data.roleId,
      roleSpecial,
      storeId: data.storeId,
    };
    res.header("accesstoken", newToken);
    res.header("Access-Control-Expose-Headers", "accesstoken");
  } catch (error) {
    return res.code(403).send({
      code: 403,
      message: "Lỗi xác thực",
    });
  }
}
