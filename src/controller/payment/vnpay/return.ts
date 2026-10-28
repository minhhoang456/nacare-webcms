import vnpayHelper from "@root/src/helpers/vnpay.helper";
import Conf from "@src/services/conf";
import { FastifyInstance } from "fastify";

export default async (fastify: FastifyInstance) => {
  fastify.get("/return", async (req, res) => {
    const query = req.query as any;

    const frontendUrl = Conf.get("FRONTEND_URL", "https://nacare.mediaone.dev");

    const redirectToResult = (
      paymentStatus: "success" | "failed",
      amount: number | string = 0,
      vnpTxnRef?: string,
      vnpPayDate?: string,
    ) => {
      const searchParams = new URLSearchParams({
        paymentstatus: paymentStatus,
        amount: String(amount),
      });
      if (vnpTxnRef) searchParams.append("vnp_TxnRef", vnpTxnRef);
      if (vnpPayDate) searchParams.append("vnp_PayDate", vnpPayDate);

      return res.redirect(
        `${frontendUrl}/ket-qua-thanh-toan?${searchParams.toString()}`,
      );
    };

    try {
      const isValid = await vnpayHelper.verifySignature({ ...query });
      const responseCode = query["vnp_ResponseCode"];
      const amount = query["vnp_Amount"]
        ? Number(query["vnp_Amount"]) / 100
        : query.amount || 0;
      const vnpTxnRef = query["vnp_TxnRef"];
      const vnpPayDate = query["vnp_PayDate"];

      return redirectToResult(
        responseCode === "00" && isValid ? "success" : "failed",
        amount,
        vnpTxnRef,
        vnpPayDate,
      );
    } catch (e) {
      return redirectToResult(
        "failed",
        query?.amount || 0,
        query?.["vnp_TxnRef"],
        query?.["vnp_PayDate"],
      );
    }
  });
};
