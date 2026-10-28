-- Username từ cây affiliate cũ chỉ dùng để đối chiếu dữ liệu import,
-- không phải tên đăng nhập và không có ràng buộc duy nhất.
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "username" VARCHAR(255);
