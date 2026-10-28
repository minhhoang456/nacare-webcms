-- Tối ưu API lịch sử hoa hồng của customer theo thời điểm phát sinh mới nhất.
CREATE INDEX "commissionTransaction_customerId_createdAt_idx"
ON "commissionTransaction"("customerId", "createdAt");
