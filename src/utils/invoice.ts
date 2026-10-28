import ono from "@jsdevtools/ono";
import { InvoiceStatus } from "@prisma/client";
import { prismaClient } from "@root/src/utils/prisma";
import Conf from "@src/services/conf";
import { AxiosRequestConfig } from "axios";
import moment from "moment";
import { DataCreateInvoice, InvoiceCustomer } from "../types/invoice";
import request from "./request";
const invoiceUtils = {
  createInvoice: async (orderId: number) => {
    try {
      const invoiceInfo = await prismaClient.invoiceOrder.findFirst({
        where: {
          orderId,
          status: InvoiceStatus.pending,
        },
      });
      if (!invoiceInfo) {
        return;
      }
      const orderInfo = await prismaClient.order.findFirst({
        where: {
          id: orderId,
        },
      });
      const orderItems = await prismaClient.orderitem.findMany({
        where: {
          orderId,
        },
      });
      const invSubTotal = Math.floor(
        ((orderInfo?.moneyPaid || 0) * 100) /
          (100 + (invoiceInfo.vatRate || Conf.get("PERCENT_TAX_NUMBER", 10))),
      );
      const dataInvoiceSendToCQT: DataCreateInvoice = {
        invNumber: "*",
        invDate: moment().format("YYYY-MM-DD"),
        invCustomer:
          invoiceInfo.type === "customer"
            ? InvoiceCustomer.customer
            : InvoiceCustomer.company,
        invRef: `Nacare-${invoiceInfo.orderId}`,
        invRefDate: moment(Number(invoiceInfo.createdAt)).format("YYYY-MM-DD"),
        invSubTotal: invSubTotal,
        invTotalAmount: orderInfo?.moneyPaid || 0,
        invVatAmount: (orderInfo?.moneyPaid || 0) - invSubTotal,
        invVatRate: invoiceInfo.vatRate || Conf.get("PERCENT_TAX_NUMBER", 10),
        buyerName: invoiceInfo.type === "customer" ? invoiceInfo.name : "",
        buyerAddress: invoiceInfo.address || "",
        buyerEmail: invoiceInfo.email,
        buyerTax: invoiceInfo.taxCode || "",
        buyerCompany: invoiceInfo.type === "customer" ? "" : invoiceInfo.name,
        invDscnAmnt: 0,
        items: orderItems.map((item, index) => {
          const itemPriceNoVat = Math.floor(
            ((item.itemPrice || 0) * 100) /
              (100 +
                (invoiceInfo.vatRate || Conf.get("PERCENT_TAX_NUMBER", 10))),
          );
          const totalAmountNoVat = itemPriceNoVat * (item.quantity || 0);
          return {
            itemNo: (index + 1).toString().padStart(4, "0"),
            itemCode: String(item.typeId),
            itemName: item.name || "",
            itemQuantity: item.quantity || 0,
            itemPrice: itemPriceNoVat,
            itemVatRate:
              invoiceInfo.vatRate || Conf.get("PERCENT_TAX_NUMBER", 10),
            itemVatAmnt: (item.totalPrice || 0) - totalAmountNoVat,
            itemAmountNoVat: totalAmountNoVat,
            itemDscnAmnt: 0,
            itemNote: "",
            itemPromo: "0",
          };
        }),
      };
      const dataAxios: AxiosRequestConfig = {
        method: "POST",
        url: Conf.get(
          "INVOICE_API_URL",
          "https://invoice-gateway.mediaone.dev/api/partner/invoice/create-invoice",
        ),
        data: dataInvoiceSendToCQT,
        headers: {
          "Content-Type": "application/json",
        },
        auth: {
          username: Conf.get("INVOICE_API_USERNAME", "part8ad9854470a342b8537"),
          password: Conf.get(
            "INVOICE_API_PASSWORD",
            "55f057b7-0478-4a29-9e6f-45b127a19de8",
          ),
        },
      };
      const response = await request(dataAxios);
      if (response.isSuccess) {
        await prismaClient.invoiceOrder.update({
          where: {
            id: invoiceInfo.id,
          },
          data: {
            invCode: response.data.invCode,
            invSign: response.data.invSign,
            link: response.data.link,
            status: InvoiceStatus.sendToCQT,
            oid: response.data.oid,
          },
        });
      } else {
        throw ono({
          code: "e_invoice_create_failed",
          message: "Tạo hóa đơn thất bại",
        });
      }
    } catch (err) {
      console.error(err);
    }
  },
};

export default invoiceUtils;
