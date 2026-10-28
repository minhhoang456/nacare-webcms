import { OAuth2Namespace } from "@fastify/oauth2";
import { prismaClient } from "@root/src/utils/prisma";
import redis from "@root/src/utils/redis";
import Conf from "@src/services/conf";
import customerService from "@src/services/customer.service";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

interface FacebookUserInfo {
  id: string;
  email?: string;
  name: string;
  picture?: {
    data: {
      url: string;
    };
  };
}

declare module "fastify" {
  interface FastifyInstance {
    facebookOAuth2: OAuth2Namespace;
  }
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/facebook`,
    schema: {
      querystring: z.object({
        code: z.string(),
        state: z.string().optional(),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const token =
          await fastify.facebookOAuth2.getAccessTokenFromAuthorizationCodeFlow(
            req,
          );

        // Fetch user profile from Facebook
        const userResponse = await fetch(
          "https://graph.facebook.com/me?fields=id,name,email,picture",
          {
            headers: {
              Authorization: `Bearer ${token.token.access_token}`,
            },
          },
        );
        console.log(userResponse, "userResponse");

        if (!userResponse.ok) {
          throw new Error("Failed to fetch user info");
        }

        const userInfo: FacebookUserInfo = await userResponse.json();
        console.log(userInfo, "userInfo");
        let customer = await prismaClient.customer.findFirst({
          where: {
            OR: [{ email: userInfo.email }, { facebookId: userInfo.id }],
          },
        });

        if (!customer) {
          const customerData = {
            email: userInfo.email,
            name: userInfo.name,
            facebookId: userInfo.id,
            avatar: userInfo.picture?.data?.url,
            provider: "FACEBOOK",
            isVerified: true,
          };

          customer = await customerService.createCustomer(customerData);
        } else {
          await prismaClient.customer.update({
            where: { id: customer.id },
            data: {
              facebookId: userInfo.id,
              avatar: userInfo.picture?.data?.url,
              name: userInfo.name,
              email: userInfo.email,
            },
          });
        }

        const accessToken = customerService.createToken(customer.id);

        // Xóa cache để cập nhật thông tin mới nhất
        await redis.del(customerService.getCustomerKey(customer.id));

        // return {
        //   code: 0,
        //   message: 'Thành công!',
        //   token: accessToken
        // };
        const frontendUrl = Conf.get(
          "FRONTEND_URL",
          "https://nacare-product-api.mediaone.dev",
        );

        return res.redirect(
          `${frontendUrl}/dang-nhap/facebook?token=${accessToken}`,
        );
      } catch (error: any) {
        console.error("Facebook authentication error:", error);
        const frontendUrl = Conf.get(
          "FRONTEND_URL",
          "https://nacare-product-api.mediaone.dev",
        );
        return res.redirect(
          `${frontendUrl}/auth/error?message=${encodeURIComponent(error.message)}`,
        );
      }
    },
  });
};
