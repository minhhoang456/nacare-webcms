-- Mục 2 - admin chỉ tăng hạn mức, chưa chọn nhóm chia quỹ ở giai đoạn này.
-- Tách migration để cả môi trường đã chạy bản cấp hạn mức trước đó vẫn nâng cấp được.
ALTER TABLE "accumulationManualEntitlement"
  ALTER COLUMN "groupName" DROP NOT NULL;
