-- Cho phép admin giảm phần quỹ đã cộng trong cùng ngày. API giữ tổng thuần
-- không âm; ngày đã bắt đầu quyết toán không nhận thêm điều chỉnh.
ALTER TABLE "accumulationPoolTopup"
  DROP CONSTRAINT "accumulationPoolTopup_amount_check";

ALTER TABLE "accumulationPoolTopup"
  ADD CONSTRAINT "accumulationPoolTopup_amount_check" CHECK ("amount" <> 0);
