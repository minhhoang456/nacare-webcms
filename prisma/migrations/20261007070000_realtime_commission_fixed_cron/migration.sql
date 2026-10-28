-- Mục 2 chạy theo lịch cố định 07:00 nên không còn cấu hình lịch trên policy.
ALTER TABLE "commissionPolicy"
  DROP COLUMN IF EXISTS "dailyRunEnabled",
  DROP COLUMN IF EXISTS "dailyRunHour",
  DROP COLUMN IF EXISTS "dailyRunMinute";

-- Lưu ảnh chụp đầu ngày để có thể tính lại kết quả cộng dồn Mục 1, 3-7 sau
-- mỗi đơn mà không cộng lặp số dư Mục 4/Mục 6.
CREATE TABLE "commissionRealtimeRun" (
  "id" BIGSERIAL PRIMARY KEY,
  "calculationDate" VARCHAR(10) NOT NULL UNIQUE,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "policyId" INTEGER,
  "policyVersion" INTEGER,
  "requestSnapshot" JSONB,
  "responseSnapshot" JSONB,
  "errorMessage" TEXT,
  "lastOrderCompletedAt" BIGINT,
  "startedAt" BIGINT,
  "completedAt" BIGINT,
  "createdAt" BIGINT,
  "updatedAt" BIGINT,
  CONSTRAINT "commissionRealtimeRun_status_check"
    CHECK ("status" IN ('pending', 'calculating', 'completed', 'failed'))
);

-- Khoản Mục 2 được giữ ngay lúc hoa hồng phát sinh và quyết toán lúc 07:00.
CREATE TABLE "commissionIncomeReserveDaily" (
  "id" BIGSERIAL PRIMARY KEY,
  "calculationDate" VARCHAR(10) NOT NULL,
  "customerId" INTEGER NOT NULL,
  "grossIncome" BIGINT NOT NULL DEFAULT 0,
  "reservedAmount" BIGINT NOT NULL DEFAULT 0,
  "settledAmount" BIGINT NOT NULL DEFAULT 0,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "settledRunId" BIGINT,
  "createdAt" BIGINT,
  "updatedAt" BIGINT,
  CONSTRAINT "commissionIncomeReserveDaily_calculationDate_customerId_key"
    UNIQUE ("calculationDate", "customerId"),
  CONSTRAINT "commissionIncomeReserveDaily_amount_check"
    CHECK ("grossIncome" >= 0 AND "reservedAmount" >= 0 AND "settledAmount" >= 0),
  CONSTRAINT "commissionIncomeReserveDaily_status_check"
    CHECK ("status" IN ('pending', 'settled'))
);

CREATE INDEX "commissionIncomeReserveDaily_customerId_status_idx"
  ON "commissionIncomeReserveDaily" ("customerId", "status");
CREATE INDEX "commissionIncomeReserveDaily_calculationDate_status_idx"
  ON "commissionIncomeReserveDaily" ("calculationDate", "status");

-- Tái mua có thể phát sinh realtime, không bắt buộc thuộc run Mục 2.
ALTER TABLE "commissionRepurchase" ALTER COLUMN "runId" DROP NOT NULL;
ALTER TABLE "agencyQualificationDaily" ALTER COLUMN "runId" DROP NOT NULL;
