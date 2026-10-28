-- Ví hoa hồng: ví tổng là tiền đã ghi sổ; reservedAmount là khoản Mục 2
-- đang giữ nên chưa được rút. Ví theo mục chỉ phân bổ tiền từ các nguồn thu.
CREATE TABLE "commissionWallet" (
  "customerId" INTEGER NOT NULL,
  "walletType" VARCHAR(64) NOT NULL,
  "balance" BIGINT NOT NULL DEFAULT 0,
  "reservedAmount" BIGINT NOT NULL DEFAULT 0,
  "entitlementAmount" BIGINT NOT NULL DEFAULT 0,
  "receivedAmount" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" BIGINT NOT NULL,
  CONSTRAINT "commissionWallet_pkey" PRIMARY KEY ("customerId", "walletType")
);

-- Backend chỉ đọc số dư; trigger SECURITY DEFINER tự đồng bộ ví khi sổ cái đổi.
GRANT SELECT ON TABLE "commissionWallet" TO "nacare_dev";

-- Tính lại số dư từ sổ cái trong cùng transaction đã thay đổi sổ.
-- Phân bổ khoản trừ theo tỷ lệ số tiền của các ví nguồn để ví mục không âm.
CREATE OR REPLACE FUNCTION refresh_commission_wallet(p_customer_id INTEGER)
RETURNS VOID AS $$
DECLARE
  total_credit NUMERIC := 0;
  total_debit NUMERIC := 0;
  pending_reserve NUMERIC := 0;
  distributable NUMERIC := 0;
  distributed NUMERIC := 0;
  share_amount NUMERIC := 0;
  remaining NUMERIC := 0;
  wallet RECORD;
  accumulated_entitlement NUMERIC := 0;
  accumulated_received NUMERIC := 0;
  manual_accumulation_received NUMERIC := 0;
  now_ms BIGINT := FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
BEGIN
  -- Các lần cập nhật cùng customer phải tuần tự để không mất lần ghi cuối.
  PERFORM pg_advisory_xact_lock(170614, p_customer_id);

  SELECT
    COALESCE(SUM("amount"::NUMERIC) FILTER (WHERE "direction" = 'credit'), 0),
    COALESCE(SUM("amount"::NUMERIC) FILTER (WHERE "direction" = 'debit'), 0)
  INTO total_credit, total_debit
  FROM "commissionTransaction"
  WHERE "customerId" = p_customer_id;

  SELECT COALESCE(SUM(("reservedAmount" - "settledAmount")::NUMERIC), 0)
  INTO pending_reserve
  FROM "commissionIncomeReserveDaily"
  WHERE "customerId" = p_customer_id AND "status" = 'pending';

  DELETE FROM "commissionWallet" WHERE "customerId" = p_customer_id;

  INSERT INTO "commissionWallet" ("customerId", "walletType", "balance", "reservedAmount", "updatedAt")
  SELECT p_customer_id,
    CASE
      WHEN "type" = 'income_contribution' OR "type" = 'accumulation' THEN 'accumulation'
      WHEN "type" IN ('positive_contribution', 'positive_upline_reward') THEN 'positive'
      WHEN "type" IN ('agency_revenue', 'agency_same_tier') THEN 'agency'
      WHEN "type" = 'manual_adjustment' THEN COALESCE(NULLIF("metadata"->>'walletType', ''), 'other')
      WHEN "type" IN ('direct', 'small_branch', 'resonance') THEN "type"
      ELSE 'other'
    END AS "walletType",
    SUM("amount"::NUMERIC)::BIGINT, 0, now_ms
  FROM "commissionTransaction"
  WHERE "customerId" = p_customer_id AND "direction" = 'credit' AND "amount" > 0
  GROUP BY 2;

  -- Rút tiền và các khoản trích được lấy từ nguồn đã nhận, không ghi âm
  -- một ví Mục 2/4/6 chưa từng được trả thưởng.
  distributable := LEAST(total_debit, total_credit);
  IF distributable > 0 AND total_credit > 0 THEN
    distributed := 0;
    FOR wallet IN
      SELECT "walletType", "balance" FROM "commissionWallet"
      WHERE "customerId" = p_customer_id ORDER BY "walletType"
    LOOP
      share_amount := FLOOR(wallet."balance"::NUMERIC * distributable / total_credit);
      UPDATE "commissionWallet" SET "balance" = "balance" - share_amount::BIGINT
      WHERE "customerId" = p_customer_id AND "walletType" = wallet."walletType";
      distributed := distributed + share_amount;
    END LOOP;
    remaining := distributable - distributed;
    FOR wallet IN
      SELECT "walletType" FROM "commissionWallet"
      WHERE "customerId" = p_customer_id AND "balance" > 0 ORDER BY "walletType"
    LOOP
      EXIT WHEN remaining = 0;
      UPDATE "commissionWallet" SET "balance" = "balance" - 1
      WHERE "customerId" = p_customer_id AND "walletType" = wallet."walletType";
      remaining := remaining - 1;
    END LOOP;
  END IF;

  -- Dữ liệu cũ nếu đã âm vẫn phải giữ nguyên số tổng thay vì chặn luồng cũ.
  IF total_debit > total_credit THEN
    INSERT INTO "commissionWallet" ("customerId", "walletType", "balance", "reservedAmount", "updatedAt")
    VALUES (p_customer_id, 'unfunded', (total_credit - total_debit)::BIGINT, 0, now_ms);
  END IF;

  -- Khoản giữ Mục 2 giảm tiền có thể rút ngay nhưng chưa ghi nợ sổ cái.
  distributable := LEAST(pending_reserve, GREATEST(total_credit - total_debit, 0));
  IF distributable > 0 THEN
    distributed := 0;
    FOR wallet IN
      SELECT "walletType", "balance" FROM "commissionWallet"
      WHERE "customerId" = p_customer_id AND "balance" > 0 ORDER BY "walletType"
    LOOP
      share_amount := FLOOR(wallet."balance"::NUMERIC * distributable /
        GREATEST(total_credit - total_debit, 1));
      UPDATE "commissionWallet" SET "reservedAmount" = share_amount::BIGINT
      WHERE "customerId" = p_customer_id AND "walletType" = wallet."walletType";
      distributed := distributed + share_amount;
    END LOOP;
    remaining := distributable - distributed;
    FOR wallet IN
      SELECT "walletType" FROM "commissionWallet"
      WHERE "customerId" = p_customer_id AND "balance" > "reservedAmount"
      ORDER BY "walletType"
    LOOP
      EXIT WHEN remaining = 0;
      UPDATE "commissionWallet" SET "reservedAmount" = "reservedAmount" + 1
      WHERE "customerId" = p_customer_id AND "walletType" = wallet."walletType";
      remaining := remaining - 1;
    END LOOP;
  END IF;

  -- Nếu dữ liệu cũ có khoản giữ vượt tiền đã nhận, giữ phần chênh lệch ở
  -- unfunded để tổng các ví nguồn vẫn khớp với ví tổng, không che mất nợ.
  IF pending_reserve > distributable THEN
    INSERT INTO "commissionWallet" ("customerId", "walletType", "balance", "reservedAmount", "updatedAt")
    VALUES (p_customer_id, 'unfunded', 0,
      (pending_reserve - distributable)::BIGINT, now_ms)
    ON CONFLICT ("customerId", "walletType") DO UPDATE
    SET "reservedAmount" = EXCLUDED."reservedAmount",
      "updatedAt" = EXCLUDED."updatedAt";
  END IF;

  INSERT INTO "commissionWallet" ("customerId", "walletType", "balance", "reservedAmount", "updatedAt")
  VALUES (p_customer_id, 'total', (total_credit - total_debit)::BIGINT,
    pending_reserve::BIGINT, now_ms);

  -- Mục 2 - Hạn mức và tiền đã nhận là hai số tích lũy độc lập với số dư
  -- còn rút được. Dùng nguồn dữ liệu hiện tại để giữ nguyên kết quả API cũ.
  SELECT COALESCE(SUM("maximumAmount"::NUMERIC), 0),
    COALESCE(SUM("receivedAmount"::NUMERIC), 0)
  INTO accumulated_entitlement, accumulated_received
  FROM "accumulationEntitlement"
  WHERE "customerId" = p_customer_id;

  -- Khoản admin cộng thủ công vào ví tích sản cũng là tiền đã nhận, nhưng
  -- không tự nâng hạn mức của các đơn đã mua.
  SELECT COALESCE(SUM("amount"::NUMERIC), 0)
  INTO manual_accumulation_received
  FROM "commissionTransaction"
  WHERE "customerId" = p_customer_id AND "direction" = 'credit'
    AND "type" = 'manual_adjustment'
    AND "metadata"->>'walletType' = 'accumulation';
  accumulated_received := accumulated_received + manual_accumulation_received;

  INSERT INTO "commissionWallet"
    ("customerId", "walletType", "balance", "reservedAmount",
      "entitlementAmount", "receivedAmount", "updatedAt")
  VALUES (p_customer_id, 'accumulation', 0, 0,
    accumulated_entitlement::BIGINT, accumulated_received::BIGINT, now_ms)
  ON CONFLICT ("customerId", "walletType") DO UPDATE
  SET "entitlementAmount" = EXCLUDED."entitlementAmount",
    "receivedAmount" = EXCLUDED."receivedAmount",
    "updatedAt" = EXCLUDED."updatedAt";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Chỉ trigger nội bộ được phép đồng bộ ví, không mở hàm ghi cho API DB role.
REVOKE ALL ON FUNCTION refresh_commission_wallet(INTEGER) FROM PUBLIC;

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

REVOKE ALL ON FUNCTION sync_commission_wallet_from_ledger() FROM PUBLIC;

CREATE TRIGGER commission_wallet_ledger_changed
AFTER INSERT OR UPDATE OR DELETE ON "commissionTransaction"
FOR EACH ROW EXECUTE FUNCTION sync_commission_wallet_from_ledger();

CREATE TRIGGER commission_wallet_reserve_changed
AFTER INSERT OR UPDATE OR DELETE ON "commissionIncomeReserveDaily"
FOR EACH ROW EXECUTE FUNCTION sync_commission_wallet_from_ledger();

CREATE TRIGGER commission_wallet_entitlement_changed
AFTER INSERT OR UPDATE OF "customerId", "maximumAmount", "receivedAmount" OR DELETE
ON "accumulationEntitlement"
FOR EACH ROW EXECUTE FUNCTION sync_commission_wallet_from_ledger();

-- Khởi tạo ví cho các tài khoản đã có giao dịch trước migration.
SELECT refresh_commission_wallet("customerId")
FROM (
  SELECT "customerId" FROM "commissionTransaction"
  UNION
  SELECT "customerId" FROM "commissionIncomeReserveDaily"
  UNION
  SELECT "customerId" FROM "accumulationEntitlement"
) AS customers;
