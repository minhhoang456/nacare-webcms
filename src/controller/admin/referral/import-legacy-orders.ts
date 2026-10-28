import { Client } from "pg";
import xlsx from "node-xlsx";
import { RoleSpecial } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import {
  businessDateFromTimestamp,
  LEGACY_ACCUMULATION_ORDER_SOURCE,
} from "@src/services/commissionRun.service";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const REQUEST_PREFIX = "legacy-accumulation:";
const HEADERS = [
  "STT",
  "ID đơn hàng",
  "Chi tiết sản phẩm",
  "Tài khoản hưởng HH",
  "Nguồn đơn",
  "Số điện thoại",
  "Giá trị đơn hàng",
  "Hoa hồng",
  "Hình thức thanh toán",
  "Mã phương thức",
  "Ngày tạo",
  "Trạng thái",
];

type LegacyOrder = {
  line: number;
  oldOrderId: number;
  buyerUsername: string;
  phone: string | null;
  amount: number;
};

class ImportInputError extends Error {}
class ImportConflictError extends Error {}

function cell(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function parseLegacyOrders(buffer: Buffer): LegacyOrder[] {
  let sheets: ReturnType<typeof xlsx.parse>;
  try {
    sheets = xlsx.parse(buffer);
  } catch {
    throw new ImportInputError("Không đọc được file Excel .xlsx");
  }
  if (sheets.length !== 1) {
    throw new ImportInputError("File đơn hàng phải có đúng một sheet");
  }
  const data = sheets[0].data as unknown[][];
  if (HEADERS.some((header, index) => cell(data[0]?.[index]) !== header)) {
    throw new ImportInputError("Các cột Excel không đúng mẫu đơn hàng cũ");
  }

  const seenIds = new Set<number>();
  const orders: LegacyOrder[] = [];
  for (let index = 1; index < data.length; index++) {
    const row = data[index] || [];
    if (!row.some((value) => cell(value))) continue;
    const oldOrderId = Number(row[1]);
    const amount = Number(row[6]);
    const buyerUsername = cell(row[4]);
    if (!Number.isSafeInteger(oldOrderId) || oldOrderId <= 0 || seenIds.has(oldOrderId)) {
      throw new ImportInputError(`Dòng ${index + 1}: ID đơn trống, trùng hoặc không hợp lệ`);
    }
    if (!buyerUsername) {
      throw new ImportInputError(`Dòng ${index + 1}: Nguồn đơn (username người mua) trống`);
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ImportInputError(`Dòng ${index + 1}: giá trị đơn không hợp lệ`);
    }
    if (cell(row[11]) !== "Hoàn thành") {
      throw new ImportInputError(`Dòng ${index + 1}: chỉ import đơn hoàn thành`);
    }
    if (!/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(cell(row[10]))) {
      throw new ImportInputError(`Dòng ${index + 1}: ngày tạo gốc không hợp lệ`);
    }
    seenIds.add(oldOrderId);
    orders.push({
      line: index + 1,
      oldOrderId,
      buyerUsername,
      phone: cell(row[5]) || null,
      amount,
    });
    if (orders.length > MAX_ROWS) {
      throw new ImportInputError(`File vượt quá ${MAX_ROWS} đơn`);
    }
  }
  if (orders.length === 0) throw new ImportInputError("File không có đơn hàng");
  return orders;
}

export async function importLegacyOrders(
  orders: LegacyOrder[],
  dryRun = false,
) {
  if (!process.env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock(170616, 1)");

    const now = Date.now();
    const calculationDate = businessDateFromTimestamp(now);
    // Cùng khóa claim run với cron: import phải xong trước snapshot ngày này.
    await client.query("SELECT pg_advisory_xact_lock(170615, $1)", [
      Number(calculationDate.replaceAll("-", "")),
    ]);
    const run = await client.query(
      'SELECT id FROM "commissionRun" WHERE "calculationDate" = $1',
      [calculationDate],
    );
    if (run.rowCount) {
      throw new ImportConflictError(`Kỳ tích sản ${calculationDate} đã bắt đầu chạy; không import thêm đơn`);
    }
    const outstandingManual = await client.query<{ customerId: number }>(
      'SELECT "customerId" FROM "accumulationManualEntitlement" GROUP BY "customerId" HAVING SUM("maximumAmount") <> 0 LIMIT 1',
    );
    if (outstandingManual.rowCount) {
      throw new ImportConflictError("Còn hạn mức admin cấp tay chưa reset về 0");
    }

    const usernames = [...new Set(orders.map((order) => order.buyerUsername.toLowerCase()))];
    const customers = await client.query<{
      id: number;
      username: string;
      isBlock: boolean | null;
    }>(
      'SELECT id, username, "isBlock" FROM customer WHERE lower(username) = ANY($1::text[])',
      [usernames],
    );
    const customerByUsername = new Map<string, (typeof customers.rows)[number]>();
    for (const customer of customers.rows) {
      const key = customer.username.toLowerCase();
      if (customerByUsername.has(key)) {
        throw new ImportConflictError(`Username ${customer.username} có nhiều customer; không tự chọn`);
      }
      customerByUsername.set(key, customer);
    }
    for (const order of orders) {
      const buyer = customerByUsername.get(order.buyerUsername.toLowerCase());
      if (!buyer || buyer.isBlock === true) {
        throw new ImportConflictError(`Dòng ${order.line}: username người mua không tồn tại hoặc bị khóa`);
      }
    }

    const requestIds = orders.map((order) => `${REQUEST_PREFIX}${order.oldOrderId}`);
    const existing = await client.query<{ requestId: string }>(
      'SELECT "requestId" FROM "order" WHERE "requestId" = ANY($1::text[])',
      [requestIds],
    );
    if (existing.rowCount) {
      throw new ImportConflictError(`Đã có đơn cũ được import (${existing.rows[0].requestId}); không import trùng`);
    }

    let totalAmount = 0;
    let totalEntitlement = 0;
    const inserts = orders.map((order) => {
      const buyer = customerByUsername.get(order.buyerUsername.toLowerCase())!;
      const multiplier = order.amount < 50_000_000 ? 2 : 3;
      const maximumAmount = order.amount * multiplier;
      if (!Number.isSafeInteger(maximumAmount)) {
        throw new ImportInputError(`Dòng ${order.line}: hạn mức vượt giới hạn số nguyên`);
      }
      totalAmount += order.amount;
      totalEntitlement += maximumAmount;
      return {
        customerId: buyer.id,
        requestId: `${REQUEST_PREFIX}${order.oldOrderId}`,
        amount: order.amount,
        phone: order.phone,
        note: `Đơn hệ thống cũ #${order.oldOrderId}; import để tính tích sản`,
        groupName: order.amount < 50_000_000 ? "under_50m" : "from_50m",
        multiplier,
        maximumAmount,
      };
    });
    if (!Number.isSafeInteger(totalAmount) || !Number.isSafeInteger(totalEntitlement)) {
      throw new ImportInputError("Tổng giá trị đơn hoặc hạn mức vượt giới hạn số nguyên");
    }
    const inserted = await client.query<{ id: number; requestId: string }>(
      `INSERT INTO "order" (
        "customerId", "totalMoney", "moneyPaid", "shipMoney",
        "paymentStatus", "methodPayment", "sourceOrder", "typeOrder",
        "requestId", "orderUniqueId", "receivePhone", "note",
        "createdAt", "updatedAt", "timeCompletedOrder"
      )
      SELECT item."customerId", item.amount, item.amount, 0,
        'completed', 'online', $2, 'customer', item."requestId",
        item."requestId", item.phone, item.note, $3::bigint, $3::bigint, $3::bigint
      FROM jsonb_to_recordset($1::jsonb) AS item(
        "customerId" int, "requestId" text, amount bigint, phone text, note text
      ) RETURNING id, "requestId"`,
      [JSON.stringify(inserts), LEGACY_ACCUMULATION_ORDER_SOURCE, now],
    );
    if (inserted.rowCount !== orders.length) {
      throw new Error("Số đơn tạo ra không khớp file Excel");
    }
    const idByRequestId = new Map(
      inserted.rows.map((row) => [row.requestId, row.id]),
    );
    const entitlementRows = inserts.map((item) => ({
      customerId: item.customerId,
      orderId: idByRequestId.get(item.requestId),
      groupName: item.groupName,
      orderAmount: item.amount,
      multiplier: item.multiplier,
      maximumAmount: item.maximumAmount,
    }));
    if (entitlementRows.some((row) => !row.orderId)) {
      throw new Error("Không tìm thấy ID đơn vừa tạo để cấp hạn mức");
    }
    const entitlements = await client.query(
      `INSERT INTO "accumulationEntitlement" (
        "customerId", "orderId", "groupName", "orderAmount",
        "multiplier", "maximumAmount", "receivedAmount",
        "remainingAmount", "entitlementVersion", "completed",
        "sourceCreatedAt", "createdAt", "updatedAt"
      )
      SELECT item."customerId", item."orderId", item."groupName",
        item."orderAmount", item.multiplier, item."maximumAmount",
        0, item."maximumAmount", 1, FALSE, $2::bigint, $2::bigint, $2::bigint
      FROM jsonb_to_recordset($1::jsonb) AS item(
        "customerId" int, "orderId" bigint, "groupName" text,
        "orderAmount" bigint, multiplier bigint, "maximumAmount" bigint
      )`,
      [JSON.stringify(entitlementRows), now],
    );
    if (entitlements.rowCount !== orders.length) {
      throw new Error("Số hạn mức tạo ra không khớp file Excel");
    }
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
    transactionOpen = false;
    return {
      calculationDate,
      importedOrders: orders.length,
      customers: usernames.length,
      totalOrderAmount: totalAmount,
      totalEntitlementAmount: totalEntitlement,
      dryRun,
    };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/import-legacy-orders",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Import đơn hệ thống cũ để cấp hạn mức tích sản",
      querystring: z.object({ dryRun: z.enum(["true"]).optional() }),
      body: z.object({ file: z.any() }),
      response: {},
    },
    handler: async (req: any, res) => {
      req.notSaveRequestLog = true;
      if (req.roleSpecial !== RoleSpecial.ROOT && req.roleSpecial !== RoleSpecial.ADMIN) {
        return res.code(403).send({ code: 1, message: "Không có quyền truy cập" });
      }
      const file = req.body?.file;
      if (
        !file || Array.isArray(file) || typeof file.toBuffer !== "function" ||
        !String(file.filename || "").toLowerCase().endsWith(".xlsx")
      ) {
        return res.code(400).send({ code: 1, message: "Cần gửi một file .xlsx trong trường file" });
      }
      try {
        const buffer: Buffer = await file.toBuffer();
        if (buffer.length > MAX_FILE_SIZE) {
          return res.code(413).send({ code: 1, message: "File vượt quá 5 MB" });
        }
        const result = await importLegacyOrders(
          parseLegacyOrders(buffer),
          req.query?.dryRun === "true",
        );
        return res.send({ code: 0, message: "Import đơn tích sản thành công", data: result });
      } catch (error) {
        if (error instanceof ImportInputError) {
          return res.code(400).send({ code: 1, message: error.message });
        }
        if (error instanceof ImportConflictError) {
          return res.code(409).send({ code: 1, message: error.message });
        }
        fastify.log.error({ err: error }, "Legacy accumulation order import failed");
        return res.code(500).send({ code: 1, message: "Không thể import đơn tích sản" });
      }
    },
  });
};
