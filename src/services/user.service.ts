import { prismaClient, Prisma } from "@src/utils/prisma";
import cryptUtil from "../utils/crypt";
import Conf from "./conf";
import ono from "@jsdevtools/ono";
export const userService = {
  beforeCreate: async (user: any) => {
    try {
      const roleSpecial = await prismaClient.role.findFirst({
        where: {
          id: user.roleId,
        },
      });
      user.roleSpecial = roleSpecial?.special;
    } catch (error) {
      console.error("Error beforeCreate user", error);
    }
    return user;
  },

  // beforeUpdate: async (user: any) => {
  //   try {
  //     const roleSpecial = await prismaClient.role.findFirst({
  //       where: {
  //         id: user.roleId,
  //       },
  //     });
  //     user.roleSpecial = roleSpecial?.special;
  //   } catch (error) {
  //     console.error("Error beforeUpdate user", error);
  //   }
  //   return user;
  // },
  /**
   * Xác thức token user admin
   * @param token string
   * @returns
   */
  async verifyUserToken(token: string) {
    const { newToken, payload } = await cryptUtil.verifyJwtV2(token);
    if (payload.scope !== "user") throw new Error("e_invalid_scope");
    return {
      newToken,
      data: payload,
    };
  },
  /**
   * Tạo token
   * @param userId number
   * @param roleId number
   * @param storeId number
   * @returns
   */
  async createToken({
    userId,
    roleId,
    roleSpecial,
    storeId,
  }: {
    userId: number;
    roleId?: number;
    roleSpecial?: string;
    storeId?: number;
  }) {
    const input = { userId, roleId, roleSpecial, storeId, scope: "user" };
    const token = cryptUtil.signJwtV2(
      input,
      Conf.get("ADMIN_TOKEN_TTL", 86400),
      Conf.get("ADMIN_REFRESH_TOKEN_TTL", 86400 * 10),
    );
    return token;
  },
  /**
   *
   * @param options Thông tin user
   * @returns
   */
  async createUserAccount(options: Prisma.userCreateInput) {
    const { username } = options;
    //check username
    let userInfo = await prismaClient.user.findFirst({
      where: {
        username,
      },
    });
    if (userInfo)
      throw ono({
        code: "e_user_exist",
      });
    //create user
    userInfo = await prismaClient.user.create({
      data: options,
    });
    return userInfo;
  },
};
export default userService;
