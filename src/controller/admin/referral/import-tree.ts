import { Client } from "pg";
import xlsx from "node-xlsx";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const REFERRAL_TREE_LOCK_ID = "724656337252656101";
const HEADER = [
  "Cấp",
  "Username",
  "Họ tên",
  "Email",
  "Mã giới thiệu",
  "Cấp bậc",
  "Doanh thu",
  "Trạng thái",
  "Username người giới thiệu",
  "Họ tên người giới thiệu",
  "Mã giới thiệu của người giới thiệu",
  "Số F1 trực tiếp",
];

type ImportRow = {
  line: number;
  level: string;
  username: string;
  name: string | null;
  email: string | null;
  inviteCode: string;
  salesRevenue: number;
  parentInviteCode: string | null;
  expectedDirectCount: number;
};

class ImportInputError extends Error {}
class ImportConflictError extends Error {}

// Các bảng nghiệp vụ phần lớn không có khóa ngoại tới customer; phải tự kiểm tra
// trước khi xoá user không còn trong file mới để tránh mất lịch sử giao dịch.
async function assertNoCustomerReferences(
  client: Client,
  customerIds: number[],
) {
  if (customerIds.length === 0) return;
  const columns = await client.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_schema, table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND column_name IN ('customerId', 'sourceCustomerId',
                           'referrerCustomerId', 'referredCustomerId')
       AND table_name NOT IN ('customer', 'referral')`,
  );
  const ids = customerIds.map(String);
  for (const column of columns.rows) {
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const table = `${quote(column.table_schema)}.${quote(column.table_name)}`;
    const field = quote(column.column_name);
    const result = await client.query<{ has_rows: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM ${table} WHERE ${field}::text = ANY($1::text[])) AS has_rows`,
      [ids],
    );
    if (result.rows[0]?.has_rows) {
      throw new ImportConflictError(
        `User cần xoá đã có dữ liệu ở bảng ${column.table_name}; không thể thay cây tự động`,
      );
    }
  }
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

// Doanh thu trong file là số bán hàng cá nhân lịch sử, chỉ lưu để hiển thị.
// Không biến khoản này thành đơn hàng hoặc doanh số tính hoa hồng.
export function parseAffiliateTree(buffer: Buffer): {
  rows: ImportRow[];
  roots: number;
} {
  let sheets: ReturnType<typeof xlsx.parse>;
  try {
    sheets = xlsx.parse(buffer);
  } catch {
    throw new ImportInputError("Không đọc được file Excel .xlsx");
  }
  if (sheets.length !== 1)
    throw new ImportInputError("File phải có đúng một sheet cây giới thiệu");
  const data = sheets[0].data as unknown[][];
  if (HEADER.some((header, index) => text(data[0]?.[index]) !== header)) {
    throw new ImportInputError("Các cột Excel không đúng mẫu cây affiliate");
  }

  const rows: ImportRow[] = [];
  const byCode = new Map<string, ImportRow>();
  const byEmail = new Set<string>();
  for (let index = 1; index < data.length; index++) {
    const cells = data[index] || [];
    if (!cells.some((cell) => text(cell))) continue;
    const row: ImportRow = {
      line: index + 1,
      level: text(cells[0]),
      username: text(cells[1]),
      name: text(cells[2]) || null,
      email: text(cells[3]).toLowerCase() || null,
      inviteCode: text(cells[4]),
      salesRevenue: Number(cells[6]),
      parentInviteCode: text(cells[10]) || null,
      expectedDirectCount: Number(cells[11]),
    };
    if (text(cells[7]) !== "Hoạt động") {
      throw new ImportInputError(`Dòng ${row.line}: trạng thái chưa hỗ trợ`);
    }
    if (!row.username) {
      throw new ImportInputError(`Dòng ${row.line}: username trống`);
    }
    const codeKey = row.inviteCode.toUpperCase();
    if (!row.inviteCode || byCode.has(codeKey)) {
      throw new ImportInputError(
        `Dòng ${row.line}: mã giới thiệu trống hoặc trùng`,
      );
    }
    if (row.email && byEmail.has(row.email)) {
      throw new ImportInputError(`Dòng ${row.line}: email bị trùng`);
    }
    if (
      text(cells[6]) === "" ||
      !Number.isSafeInteger(row.salesRevenue) ||
      row.salesRevenue < 0
    ) {
      throw new ImportInputError(
        `Dòng ${row.line}: doanh thu bán hàng không hợp lệ`,
      );
    }
    if (
      !Number.isSafeInteger(row.expectedDirectCount) ||
      row.expectedDirectCount < 0
    ) {
      throw new ImportInputError(
        `Dòng ${row.line}: số F1 trực tiếp không hợp lệ`,
      );
    }
    rows.push(row);
    byCode.set(codeKey, row);
    if (row.email) byEmail.add(row.email);
    if (rows.length > MAX_ROWS)
      throw new ImportInputError(`File vượt quá ${MAX_ROWS} user`);
  }
  if (rows.length === 0) throw new ImportInputError("File không có user");

  let roots = 0;
  const directCount = new Map<string, number>();
  for (const row of rows) {
    if (!row.parentInviteCode) {
      if (row.level !== "F1")
        throw new ImportInputError(`Dòng ${row.line}: gốc phải là F1`);
      roots++;
      continue;
    }
    const parent = byCode.get(row.parentInviteCode.toUpperCase());
    if (!parent || parent === row) {
      throw new ImportInputError(
        `Dòng ${row.line}: mã người giới thiệu không hợp lệ`,
      );
    }
    const childLevel = /^F(\d+)$/.exec(row.level);
    const parentLevel = /^F(\d+)$/.exec(parent.level);
    if (
      !childLevel ||
      !parentLevel ||
      Number(childLevel[1]) !== Number(parentLevel[1]) + 1
    ) {
      throw new ImportInputError(
        `Dòng ${row.line}: cấp không khớp với người giới thiệu`,
      );
    }
    // Parent có thể được viết khác hoa/thường trong Excel; dùng đúng mã của cha.
    row.parentInviteCode = parent.inviteCode;
    directCount.set(
      parent.inviteCode,
      (directCount.get(parent.inviteCode) || 0) + 1,
    );
  }
  for (const row of rows) {
    if (row.expectedDirectCount !== (directCount.get(row.inviteCode) || 0)) {
      throw new ImportInputError(
        `Dòng ${row.line}: số F1 trực tiếp không khớp cây`,
      );
    }
  }
  return { rows, roots };
}

export async function importAffiliateTree(
  source: {
    rows: ImportRow[];
    roots: number;
  },
  replace = false,
  dryRun = false,
) {
  if (!process.env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const finishTransaction = async () => {
      await client.query(dryRun ? "ROLLBACK" : "COMMIT");
      transactionOpen = false;
    };
    // Khóa cùng cây với service Go, tránh ghi quan hệ giới thiệu song song.
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      REFERRAL_TREE_LOCK_ID,
    ]);

    const emails = source.rows.flatMap((row) => (row.email ? [row.email] : []));
    const existing = await client.query<{
      id: number;
      email: string | null;
      inviteCode: string;
      username: string | null;
      merchantRef: string | null;
      salesRevenue: string | null;
      createdAt: string | null;
    }>(
      `SELECT id, email, "inviteCode", "username", "merchantRef",
              "salesRevenue"::text AS "salesRevenue", "createdAt"::text AS "createdAt"
       FROM customer
       WHERE upper("inviteCode") = ANY($1::text[])
          OR lower(email) = ANY($2::text[])
          OR lower("merchantRef") = ANY($2::text[])
       FOR UPDATE`,
      [source.rows.map((row) => row.inviteCode.toUpperCase()), emails],
    );
    const byCode = new Map(
      source.rows.map((row) => [row.inviteCode.toUpperCase(), row]),
    );
    const existingByCode = new Map<string, (typeof existing.rows)[number]>();
    for (const customer of existing.rows) {
      const key = customer.inviteCode.toUpperCase();
      const input = byCode.get(key);
      if (!input || existingByCode.has(key)) {
        throw new ImportConflictError(
          "Email hoặc merchantRef đã thuộc về user khác; không thể import lại",
        );
      }
      if ((customer.email?.toLowerCase() ?? null) !== input.email) {
        throw new ImportConflictError(
          `Dòng ${input.line}: email trong DB không khớp file`,
        );
      }
      existingByCode.set(key, customer);
    }

    let currentTreeMatches = false;
    if (existingByCode.size === source.rows.length) {
      const ids = source.rows.map(
        (row) => existingByCode.get(row.inviteCode.toUpperCase())!.id,
      );
      const relations = await client.query<{
        referredCustomerId: number;
        referrerCustomerId: number;
        inviteCode: string;
      }>(
        `SELECT "referredCustomerId", "referrerCustomerId", "inviteCode"
         FROM referral WHERE "referredCustomerId" = ANY($1::int[])`,
        [ids],
      );
      const parentByChild = new Map(
        relations.rows.map((edge) => [edge.referredCustomerId, edge]),
      );
      currentTreeMatches =
        relations.rows.length === source.rows.length - source.roots &&
        source.rows.every((row) => {
          const childId = existingByCode.get(row.inviteCode.toUpperCase())!.id;
          const actual = parentByChild.get(childId);
          const expectedParentId = row.parentInviteCode
            ? existingByCode.get(row.parentInviteCode.toUpperCase())?.id
            : null;
          return (
            (actual?.referrerCustomerId ?? null) === expectedParentId &&
            (!actual || actual.inviteCode === row.parentInviteCode)
          );
        });
    }

    // Thay lô Excel cũ bằng file mới, giữ ID của user trùng mã mời.
    // Chỉ chạy khi người gọi chủ động truyền replace=true; mọi kiểm tra và ghi
    // đều nằm trong một transaction nên một lỗi sẽ hoàn tác toàn bộ cây.
    if (existingByCode.size > 0 && !currentTreeMatches) {
      if (!replace) {
        throw new ImportConflictError(
          "Cây đã thay đổi; truyền replace=true để xác nhận thay dữ liệu import cũ",
        );
      }
      const added = source.rows.filter(
        (row) => !existingByCode.has(row.inviteCode.toUpperCase()),
      );
      const importedAts = [...new Set(existing.rows.map((row) => row.createdAt))];
      if (importedAts.some((createdAt) => !createdAt)) {
        throw new ImportConflictError(
          "Không xác định được thời điểm tạo của customer trong cây cũ",
        );
      }
      const previous = await client.query<{
        id: number;
        inviteCode: string;
      }>(
        `SELECT id, "inviteCode" FROM customer
         WHERE "createdAt"::text = ANY($1::text[]) FOR UPDATE`,
        [importedAts],
      );
      const previousByCode = new Map(
        previous.rows.map((row) => [row.inviteCode.toUpperCase(), row]),
      );
      const previousIdSet = new Set(previous.rows.map((row) => row.id));
      const retainedIdSet = new Set(
        [...existingByCode.values()].map((row) => row.id),
      );
      if (
        previous.rows.length < existingByCode.size ||
        previousByCode.size !== previous.rows.length ||
        [...retainedIdSet].some((id) => !previousIdSet.has(id))
      ) {
        throw new ImportConflictError(
          "Không xác định được đầy đủ lô import cũ",
        );
      }
      const previousIds = previous.rows.map((row) => row.id);
      const removed = previous.rows.filter(
        (row) => !retainedIdSet.has(row.id),
      );
      const removedIds = removed.map((row) => row.id);
      const edges = await client.query<{
        referrerCustomerId: number;
        referredCustomerId: number;
      }>(
        `SELECT "referrerCustomerId", "referredCustomerId" FROM referral
         WHERE "referrerCustomerId" = ANY($1::int[])
            OR "referredCustomerId" = ANY($1::int[])
         FOR UPDATE`,
        [previousIds],
      );
      const removedIdSet = new Set(removedIds);
      if (
        edges.rows.some(
          (edge) =>
            // Không tự thay cha bên ngoài lô import cho một user trong file.
            (previousIdSet.has(edge.referredCustomerId) &&
              !previousIdSet.has(edge.referrerCustomerId)) ||
            // Không xoá tài khoản vẫn đang giới thiệu một user ngoài file.
            (removedIdSet.has(edge.referrerCustomerId) &&
              !previousIdSet.has(edge.referredCustomerId)),
        )
      ) {
        throw new ImportConflictError(
          "Có quan hệ giới thiệu ngoài lô import không thể thay an toàn",
        );
      }
      await assertNoCustomerReferences(client, removedIds);

      const now = Date.now();
      const inserted = await client.query<{ id: number; inviteCode: string }>(
        `INSERT INTO customer (name, "username", email, "merchantRef", "inviteCode", "salesRevenue", "isBlock", "createdAt", "updatedAt")
         SELECT item.name, item.username, item.email, item.email, item."inviteCode", item."salesRevenue", FALSE, $2::bigint, $2::bigint
         FROM jsonb_to_recordset($1::jsonb) AS item(name text, username text, email text, "inviteCode" text, "salesRevenue" bigint)
         RETURNING id, "inviteCode"`,
        [
          JSON.stringify(
            added.map((row) => ({
              name: row.name,
              username: row.username,
              email: row.email,
              inviteCode: row.inviteCode,
              salesRevenue: row.salesRevenue,
            })),
          ),
          now,
        ],
      );
      if (inserted.rowCount !== added.length) {
        throw new Error("Số user mới tạo không khớp file Excel");
      }
      const idByCode = new Map([
        ...[...existingByCode.entries()].map(([code, row]) => [code, row.id] as const),
        ...inserted.rows.map((row) => [row.inviteCode.toUpperCase(), row.id] as const),
      ]);
      const deletedEdges = await client.query(
        `DELETE FROM referral WHERE "referredCustomerId" = ANY($1::int[])`,
        [previousIds],
      );
      const previousEdgesCount = edges.rows.filter((edge) =>
        previousIdSet.has(edge.referredCustomerId),
      ).length;
      if (deletedEdges.rowCount !== previousEdgesCount) {
        throw new Error("Số quan hệ giới thiệu cũ không khớp");
      }
      const updated = await client.query(
        `UPDATE customer AS c
         SET name = item.name, "username" = item.username, email = item.email,
             "merchantRef" = COALESCE(c."merchantRef", item.email),
             "salesRevenue" = item.revenue, "updatedAt" = $2::bigint
         FROM jsonb_to_recordset($1::jsonb) AS item(id int, name text, username text, email text, revenue bigint)
         WHERE c.id = item.id`,
        [
          JSON.stringify(
            source.rows.flatMap((row) => {
              const current = existingByCode.get(row.inviteCode.toUpperCase());
              return current
                ? [
                    {
                      id: current.id,
                      name: row.name,
                      username: row.username,
                      email: row.email,
                      revenue: row.salesRevenue,
                    },
                  ]
                : [];
            }),
          ),
          now,
        ],
      );
      if (updated.rowCount !== existingByCode.size) {
        throw new Error("Số user cập nhật không khớp file Excel");
      }
      const deletedCustomers = await client.query(
        `DELETE FROM customer WHERE id = ANY($1::int[])`,
        [removedIds],
      );
      if (deletedCustomers.rowCount !== removedIds.length) {
        throw new Error("Số user cũ cần xoá không khớp");
      }
      const newEdges = source.rows.flatMap((row) => {
        if (!row.parentInviteCode) return [];
        const parentId = idByCode.get(row.parentInviteCode.toUpperCase());
        const childId = idByCode.get(row.inviteCode.toUpperCase());
        if (!parentId || !childId || parentId === childId) {
          throw new Error(
            `Dòng ${row.line}: không map được quan hệ giới thiệu`,
          );
        }
        return [{ parentId, childId, parentCode: row.parentInviteCode }];
      });
      const insertedEdges = await client.query(
        `INSERT INTO referral ("referrerCustomerId", "referredCustomerId", "inviteCode", "createdAt", "updatedAt")
         SELECT item."parentId", item."childId", item."parentCode", $2::bigint, $2::bigint
         FROM jsonb_to_recordset($1::jsonb) AS item("parentId" int, "childId" int, "parentCode" text)`,
        [JSON.stringify(newEdges), now],
      );
      if (insertedEdges.rowCount !== newEdges.length) {
        throw new Error("Số quan hệ giới thiệu mới không khớp file Excel");
      }
      await finishTransaction();
      return {
        mode: "replaced",
        customers: source.rows.length,
        roots: source.roots,
        referrals: newEdges.length,
        addedCustomers: added.length,
        removedCustomers: removedIds.length,
        updatedCustomers: existingByCode.size,
        dryRun,
      };
    }

    // File đã import: cập nhật username và doanh thu lịch sử; giữ nguyên cây.
    // merchantRef đang dùng số điện thoại để đăng nhập thì phải giữ nguyên.
    if (existingByCode.size > 0) {
      if (existingByCode.size !== source.rows.length) {
        throw new ImportConflictError(
          "Dữ liệu đã import một phần; không tự thêm user để tránh sai cây",
        );
      }
      const ids = source.rows.map(
        (row) => existingByCode.get(row.inviteCode.toUpperCase())!.id,
      );
      const relations = await client.query<{
        referredCustomerId: number;
        referrerCustomerId: number;
        inviteCode: string;
      }>(
        `SELECT "referredCustomerId", "referrerCustomerId", "inviteCode"
         FROM referral WHERE "referredCustomerId" = ANY($1::int[])`,
        [ids],
      );
      const parentByChild = new Map(
        relations.rows.map((edge) => [edge.referredCustomerId, edge]),
      );
      for (const row of source.rows) {
        const childId = existingByCode.get(row.inviteCode.toUpperCase())!.id;
        const actual = parentByChild.get(childId);
        const expectedParentId = row.parentInviteCode
          ? existingByCode.get(row.parentInviteCode.toUpperCase())!.id
          : null;
        if (
          (actual?.referrerCustomerId ?? null) !== expectedParentId ||
          (actual && actual.inviteCode !== row.parentInviteCode)
        ) {
          throw new ImportConflictError(
            `Dòng ${row.line}: cây giới thiệu trong DB không khớp file`,
          );
        }
      }
      const updatedMerchantRefs = source.rows.filter((row) => {
        const current = existingByCode.get(row.inviteCode.toUpperCase())!;
        return row.email && !current.merchantRef;
      }).length;
      const updatedSalesRevenues = source.rows.filter((row) => {
        const current = existingByCode.get(row.inviteCode.toUpperCase())!;
        return current.salesRevenue !== String(row.salesRevenue);
      }).length;
      const updatedUsernames = source.rows.filter((row) => {
        const current = existingByCode.get(row.inviteCode.toUpperCase())!;
        return current.username !== row.username;
      }).length;
      const toUpdate = source.rows.filter((row) => {
        const current = existingByCode.get(row.inviteCode.toUpperCase())!;
        return (
          (row.email && !current.merchantRef) ||
          current.salesRevenue !== String(row.salesRevenue) ||
          current.username !== row.username
        );
      });
      if (toUpdate.length) {
        const updated = await client.query(
          `UPDATE customer AS c
           SET "merchantRef" = COALESCE(c."merchantRef", item.email),
               "username" = item.username,
               "salesRevenue" = item.revenue,
               "updatedAt" = $2::bigint
           FROM jsonb_to_recordset($1::jsonb) AS item(id int, username text, email text, revenue bigint)
           WHERE c.id = item.id
             AND ((c."merchantRef" IS NULL AND item.email IS NOT NULL)
               OR c."salesRevenue" IS DISTINCT FROM item.revenue
               OR c."username" IS DISTINCT FROM item.username)`,
          [
            JSON.stringify(
              toUpdate.map((row) => ({
                id: existingByCode.get(row.inviteCode.toUpperCase())!.id,
                username: row.username,
                email: row.email,
                revenue: row.salesRevenue,
              })),
            ),
            Date.now(),
          ],
        );
        if (updated.rowCount !== toUpdate.length) {
          throw new Error("Số user cập nhật không khớp file Excel");
        }
      }
      await finishTransaction();
      return {
        mode: "updated",
        customers: source.rows.length,
        roots: source.roots,
        referrals: source.rows.length - source.roots,
        updatedMerchantRefs,
        updatedSalesRevenues,
        updatedUsernames,
        missingEmail: source.rows.length - emails.length,
        dryRun,
      };
    }

    const now = Date.now();
    // Mỗi user mới nhận ngày tham gia là thời điểm import. Không tự tạo phone,
    // secure hoặc đơn hàng từ các cột không có dữ liệu nguồn phù hợp.
    const customers = source.rows.map((row) => ({
      name: row.name,
      username: row.username,
      email: row.email,
      inviteCode: row.inviteCode,
      salesRevenue: row.salesRevenue,
    }));
    const inserted = await client.query<{ id: number; inviteCode: string }>(
      `INSERT INTO customer (name, "username", email, "merchantRef", "inviteCode", "salesRevenue", "isBlock", "createdAt", "updatedAt")
       SELECT item.name, item.username, item.email, item.email, item."inviteCode", item."salesRevenue", FALSE, $2::bigint, $2::bigint
       FROM jsonb_to_recordset($1::jsonb) AS item(name text, username text, email text, "inviteCode" text, "salesRevenue" bigint)
       RETURNING id, "inviteCode"`,
      [JSON.stringify(customers), now],
    );
    if (inserted.rowCount !== source.rows.length) {
      throw new Error("Số user tạo ra không khớp file Excel");
    }
    const idByCode = new Map(
      inserted.rows.map((row) => [row.inviteCode, row.id]),
    );
    const edges = source.rows.flatMap((row) => {
      if (!row.parentInviteCode) return [];
      const parentId = idByCode.get(row.parentInviteCode);
      const childId = idByCode.get(row.inviteCode);
      if (!parentId || !childId || parentId === childId) {
        throw new Error(
          `Dòng ${row.line}: không map được ID quan hệ giới thiệu`,
        );
      }
      return [{ parentId, childId, parentCode: row.parentInviteCode }];
    });
    if (edges.length) {
      const insertedEdges = await client.query(
        `INSERT INTO referral ("referrerCustomerId", "referredCustomerId", "inviteCode", "createdAt", "updatedAt")
         SELECT item."parentId", item."childId", item."parentCode", $2::bigint, $2::bigint
         FROM jsonb_to_recordset($1::jsonb) AS item("parentId" int, "childId" int, "parentCode" text)`,
        [JSON.stringify(edges), now],
      );
      if (insertedEdges.rowCount !== edges.length) {
        throw new Error("Số quan hệ giới thiệu tạo ra không khớp file Excel");
      }
    }
    await finishTransaction();
    return {
      mode: "created",
      customers: source.rows.length,
      roots: source.roots,
      referrals: edges.length,
      updatedMerchantRefs: 0,
      updatedSalesRevenues: source.rows.length,
      missingEmail: source.rows.length - emails.length,
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
    url: "/import-tree",
    schema: {
      tags: ["Admin"],
      summary: "Import hoặc cập nhật user và cây giới thiệu từ Excel",
      querystring: z.object({ replace: z.enum(["true"]).optional() }),
      body: z.object({ file: z.any() }),
      response: {},
    },
    handler: async (req: any, res) => {
      req.notSaveRequestLog = true;
      const file = req.body?.file;
      if (
        !file ||
        Array.isArray(file) ||
        typeof file.toBuffer !== "function" ||
        !String(file.filename || "")
          .toLowerCase()
          .endsWith(".xlsx")
      ) {
        return res.code(400).send({
          code: 1,
          message: "Cần gửi một file .xlsx trong trường file",
        });
      }
      try {
        const buffer: Buffer = await file.toBuffer();
        if (buffer.length > MAX_FILE_SIZE) {
          return res.code(413).send({ code: 1, message: "File vượt quá 5 MB" });
        }
        const result = await importAffiliateTree(
          parseAffiliateTree(buffer),
          req.query?.replace === "true",
        );
        fastify.log.info(result, "Affiliate tree imported");
        return res.send({
          code: 0,
          message: "Import cây giới thiệu thành công",
          data: result,
        });
      } catch (error) {
        if (error instanceof ImportInputError) {
          return res.code(400).send({ code: 1, message: error.message });
        }
        if (error instanceof ImportConflictError) {
          return res.code(409).send({ code: 1, message: error.message });
        }
        fastify.log.error({ err: error }, "Affiliate tree import failed");
        return res
          .code(500)
          .send({ code: 1, message: "Không thể import cây giới thiệu" });
      }
    },
  });
};
