-- Mục 1: tỷ lệ điểm tiêu dùng tách riêng khỏi hoa hồng tiền mặt.
ALTER TABLE "commissionPolicy"
  ADD COLUMN "directConsumptionPointRateBps" INTEGER NOT NULL DEFAULT 0;

-- Ảnh chụp số điểm tiêu dùng áp dụng cho đơn. Không tái sử dụng các trường
-- mpoint cũ vì chúng thuộc luồng tích hợp MExchange.
ALTER TABLE "order"
  ADD COLUMN "consumptionPointUsed" BIGINT DEFAULT 0;

ALTER TABLE "ordership"
  ADD COLUMN "consumptionPointUsed" BIGINT DEFAULT 0;

CREATE TABLE "consumptionPointTransaction" (
  "id" BIGSERIAL PRIMARY KEY,
  "idempotencyKey" VARCHAR(255) NOT NULL UNIQUE,
  "calculationDate" VARCHAR(10) NOT NULL,
  "type" VARCHAR(64) NOT NULL,
  "direction" VARCHAR(16) NOT NULL,
  "customerId" INTEGER NOT NULL,
  "sourceCustomerId" INTEGER,
  "sourceOrderId" BIGINT,
  "policyId" INTEGER,
  "policyVersion" INTEGER,
  "rateBps" INTEGER,
  "amount" BIGINT NOT NULL,
  "metadata" JSON NOT NULL DEFAULT '{}',
  "createdAt" BIGINT NOT NULL,
  CONSTRAINT "consumptionPointTransaction_direction_check"
    CHECK ("direction" IN ('credit', 'debit')),
  CONSTRAINT "consumptionPointTransaction_amount_check"
    CHECK ("amount" > 0)
);

CREATE INDEX "consumptionPointTransaction_customerId_createdAt_idx"
  ON "consumptionPointTransaction" ("customerId", "createdAt");
CREATE INDEX "consumptionPointTransaction_customerId_calculationDate_idx"
  ON "consumptionPointTransaction" ("customerId", "calculationDate");
CREATE INDEX "consumptionPointTransaction_type_calculationDate_idx"
  ON "consumptionPointTransaction" ("type", "calculationDate");

CREATE TABLE "consumptionPointReservation" (
  "id" BIGSERIAL PRIMARY KEY,
  "orderId" INTEGER NOT NULL UNIQUE,
  "customerId" INTEGER NOT NULL,
  "amount" BIGINT NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  CONSTRAINT "consumptionPointReservation_amount_check"
    CHECK ("amount" > 0),
  CONSTRAINT "consumptionPointReservation_status_check"
    CHECK ("status" IN ('pending', 'consumed', 'released'))
);

CREATE INDEX "consumptionPointReservation_customerId_status_idx"
  ON "consumptionPointReservation" ("customerId", "status");
