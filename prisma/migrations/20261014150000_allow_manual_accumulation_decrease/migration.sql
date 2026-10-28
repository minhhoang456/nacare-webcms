-- Điều chỉnh hạn mức thủ công: số âm là khoản trừ, không thu hồi tiền đã nhận.
-- Trigger hiện có tự cộng tổng maximumAmount (có dấu) vào ví tích sản.
ALTER TABLE "accumulationManualEntitlement"
  DROP CONSTRAINT "accumulationManualEntitlement_amount_check";

ALTER TABLE "accumulationManualEntitlement"
  ADD CONSTRAINT "accumulationManualEntitlement_amount_check"
  CHECK (
    ("maximumAmount" > 0 AND "receivedAmount" >= 0
      AND "remainingAmount" = "maximumAmount" - "receivedAmount"
      AND "remainingAmount" >= 0)
    OR
    ("maximumAmount" < 0 AND "receivedAmount" = 0
      AND "remainingAmount" = "maximumAmount")
  );

-- Không tạo bảng mới hoặc thay đổi quyền của nacare_dev.
