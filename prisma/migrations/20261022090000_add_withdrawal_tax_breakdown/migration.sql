-- Bổ sung hai cột; migration kế tiếp điền 10% cho các yêu cầu cũ.
-- Yêu cầu mới lưu tỷ lệ thuế và số thực nhận ngay lúc tạo.
ALTER TABLE "commissionWithdrawal"
  ADD COLUMN "taxPercent" INTEGER,
  ADD COLUMN "receivedAmount" BIGINT;

ALTER TABLE "commissionWithdrawal"
  ADD CONSTRAINT "commissionWithdrawal_tax_breakdown_check"
  CHECK (
    ("taxPercent" IS NULL AND "receivedAmount" IS NULL)
    OR (
      "taxPercent" BETWEEN 0 AND 100
      AND "receivedAmount" BETWEEN 0 AND "amount"
      AND "receivedAmount" = "amount" -
        FLOOR(("amount"::NUMERIC * "taxPercent" + 50) / 100)::BIGINT
    )
  );
