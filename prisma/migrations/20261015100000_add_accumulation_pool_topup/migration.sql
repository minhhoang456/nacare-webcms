-- Admin cộng tiền vào quỹ tích sản của ngày hiện tại; cron 07:00 hôm sau
-- đọc tổng này cùng doanh số hệ thống và khoản trích thu nhập.
CREATE TABLE "accumulationPoolTopup" (
  "id" UUID NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "calculationDate" VARCHAR(10) NOT NULL,
  "amount" BIGINT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "adminUserId" INTEGER,
  "createdAt" BIGINT NOT NULL,
  CONSTRAINT "accumulationPoolTopup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accumulationPoolTopup_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "accumulationPoolTopup_idempotencyKey_key"
  ON "accumulationPoolTopup"("idempotencyKey");
CREATE INDEX "accumulationPoolTopup_calculationDate_createdAt_idx"
  ON "accumulationPoolTopup"("calculationDate", "createdAt");

-- Backend runtime dùng nacare_dev; UUID do API tạo nên không cần quyền sequence.
GRANT SELECT, INSERT ON TABLE "accumulationPoolTopup" TO "nacare_dev";
