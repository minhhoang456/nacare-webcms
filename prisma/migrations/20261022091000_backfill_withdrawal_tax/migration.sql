-- Dev có cả yêu cầu completed/rejected; prod hiện chỉ có pending.
-- Backfill tất cả yêu cầu cũ chưa có dữ liệu thuế, không sửa bút toán hoa hồng
-- hoặc số dư ví. Với đơn rejected, đây là số tiền thực nhận dự kiến nếu được duyệt.
UPDATE "commissionWithdrawal"
SET "taxPercent" = 10,
    "receivedAmount" = "amount" -
      FLOOR(("amount"::NUMERIC * 10 + 50) / 100)::BIGINT
WHERE "taxPercent" IS NULL
  AND "receivedAmount" IS NULL;
