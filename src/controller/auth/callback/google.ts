import { prismaClient } from "@root/src/utils/prisma";
import redis from "@root/src/utils/redis";
import Conf from "@src/services/conf";
import customerService from "@src/services/customer.service";
import request from "@src/utils/request";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  locale: string;
  phone?: string;
}

const PEOPLE_API_URL = "https://people.googleapis.com/v1/people/me";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/google`,
    schema: {
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { token } =
          await fastify.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(
            req,
          );

        const userInfo: GoogleUserInfo = await request({
          url: Conf.get(
            "GOOGLE_USER_INFO_URL",
            "https://www.googleapis.com/oauth2/v2/userinfo",
          ),
          method: "GET",
          headers: {
            Authorization: `Bearer ${token.access_token}`,
          },
          validateStatus: (status) => {
            return status >= 200 && status < 300;
          },
        });

        const peopleInfo = await request({
          url: Conf.get(
            "GOOGLE_PEOPLE_API_URL",
            `${PEOPLE_API_URL}?personFields=phoneNumbers`,
          ),
          method: "GET",
          headers: {
            Authorization: `Bearer ${token.access_token}`,
          },
          validateStatus: (status) => {
            return status >= 200 && status < 300;
          },
        });

        const phone = peopleInfo.phoneNumbers?.[0]?.value || null;

        if (!userInfo || !userInfo.id || !userInfo.email) {
          throw new Error("Invalid response from Google");
        }

        if (!userInfo.verified_email) {
          throw new Error("Email not verified with Google");
        }

        let customer = await prismaClient.customer.findFirst({
          where: {
            OR: [{ email: userInfo.email }, { googleId: userInfo.id }],
          },
        });

        if (!customer) {
          const customerData = {
            email: userInfo.email,
            name: userInfo.name,
            googleId: userInfo.id,
            avatar: userInfo.picture,
            phone: phone,
          };

          customer = await customerService.createCustomer(customerData);
        } else {
          await prismaClient.customer.update({
            where: { id: customer.id },
            data: {
              googleId: userInfo.id,
              avatar: userInfo.picture,
              name: userInfo.name,
              email: userInfo.email,
              phone: phone || customer.phone,
            },
          });
        }

        const accessToken = customerService.createToken(customer.id);
        await redis.del(customerService.getCustomerKey(customer.id));

        const frontendUrl = Conf.get(
          "FRONTEND_URL",
          "https://nacare-product-api.mediaone.dev",
        );

        return res.redirect(
          `${frontendUrl}/dang-nhap/google?token=${accessToken}`,
        );
      } catch (error: any) {
        console.error("Google callback error:", error);
        const frontendUrl = Conf.get(
          "FRONTEND_URL",
          "https://nacare-product-api.mediaone.dev",
        );
        // if (Conf.get('NODE_ENV', 'development') === 'development') {
        //   return {
        //     message: error.message,
        //     error
        //   }
        // }
        return res.redirect(
          `${frontendUrl}/auth/error?message=${encodeURIComponent(error.message)}`,
        );
      }
    },
  });
};
