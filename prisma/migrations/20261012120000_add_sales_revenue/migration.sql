-- Doanh thu bán hàng cá nhân lấy từ file cây affiliate.
-- Chỉ dùng để hiển thị, không tạo đơn hàng hoặc tham gia tính hoa hồng.
ALTER TABLE customer
  ADD COLUMN "salesRevenue" BIGINT;

ALTER TABLE customer
  ADD CONSTRAINT "customer_salesRevenue_nonnegative"
  CHECK ("salesRevenue" IS NULL OR "salesRevenue" >= 0);
