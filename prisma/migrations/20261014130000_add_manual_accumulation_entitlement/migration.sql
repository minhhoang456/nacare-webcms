-- Mục 2 - Hạn mức admin cấp trực tiếp. Chưa tham gia cron phân phối và
-- chưa tạo giao dịch tiền mặt; chỉ tăng tổng hạn mức trong ví tích sản.
CREATE TABLE "accumulationManualEntitlement" (
  "id" UUID NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "customerId" INTEGER NOT NULL,
  "groupName" VARCHAR(64) NOT NULL,
  "maximumAmount" BIGINT NOT NULL,
  "receivedAmount" BIGINT NOT NULL DEFAULT 0,
  "remainingAmount" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "adminUserId" INTEGER,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  CONSTRAINT "accumulationManualEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accumulationManualEntitlement_amount_check"
    CHECK ("maximumAmount" > 0 AND "receivedAmount" >= 0
      AND "remainingAmount" >= 0
      AND "remainingAmount" = "maximumAmount" - "receivedAmount"),
  CONSTRAINT "accumulationManualEntitlement_group_check"
    CHECK ("groupName" IN ('under_or_equal_10m', 'over_10m_under_50m', 'from_50m'))
);
CREATE UNIQUE INDEX "accumulationManualEntitlement_idempotencyKey_key"
  ON "accumulationManualEntitlement"("idempotencyKey");
CREATE INDEX "accumulationManualEntitlement_customerId_createdAt_idx"
  ON "accumulationManualEntitlement"("customerId", "createdAt");

-- Giữ nguyên thuật toán tiền mặt của migration ví trước đó. Bọc hàm cũ để
-- cộng thêm hạn mức thủ công sau mỗi lần ví được tính lại từ sổ giao dịch.
ALTER FUNCTION refresh_commission_wallet(INTEGER)
  RENAME TO refresh_commission_wallet_base;

CREATE FUNCTION refresh_commission_wallet(p_customer_id INTEGER)
RETURNS VOID AS $$
DECLARE
  manual_entitlement NUMERIC := 0;
  manual_received NUMERIC := 0;
BEGIN
  PERFORM refresh_commission_wallet_base(p_customer_id);

  SELECT COALESCE(SUM("maximumAmount"::NUMERIC), 0),
    COALESCE(SUM("receivedAmount"::NUMERIC), 0)
  INTO manual_entitlement, manual_received
  FROM "accumulationManualEntitlement"
  WHERE "customerId" = p_customer_id;

  UPDATE "commissionWallet"
  SET "entitlementAmount" = "entitlementAmount" + manual_entitlement::BIGINT,
    "receivedAmount" = "receivedAmount" + manual_received::BIGINT,
    "updatedAt" = FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
  WHERE "customerId" = p_customer_id AND "walletType" = 'accumulation';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION refresh_commission_wallet(INTEGER) FROM PUBLIC;

-- Làm mới mã trigger để các kết nối DB gọi lớp đồng bộ ví mới.
CREATE OR REPLACE FUNCTION sync_commission_wallet_from_ledger()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_commission_wallet(OLD."customerId");
  ELSE
    PERFORM refresh_commission_wallet(NEW."customerId");
    IF TG_OP = 'UPDATE' THEN
      IF OLD."customerId" <> NEW."customerId" THEN
        PERFORM refresh_commission_wallet(OLD."customerId");
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER commission_wallet_manual_entitlement_changed
AFTER INSERT OR UPDATE OF "customerId", "maximumAmount", "receivedAmount" OR DELETE
ON "accumulationManualEntitlement"
FOR EACH ROW EXECUTE FUNCTION sync_commission_wallet_from_ledger();

-- API admin thêm hạn mức; API khách đọc lịch sử. Trigger tự cập nhật ví.
GRANT SELECT, INSERT ON TABLE "accumulationManualEntitlement" TO "nacare_dev";
