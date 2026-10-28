-- Yêu cầu rút tiền hoa hồng chỉ ghi nhận thông tin ngân hàng và trạng thái xử lý.
CREATE TABLE "commissionWithdrawal" (
    "id" BIGSERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "bankName" VARCHAR(255) NOT NULL,
    "bankCode" VARCHAR(64) NOT NULL,
    "bankAccountNumber" VARCHAR(64) NOT NULL,
    "phoneNumber" VARCHAR(32) NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    CONSTRAINT "commissionWithdrawal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "commissionWithdrawal_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "commissionWithdrawal_status_check"
        CHECK ("status" IN ('pending', 'completed', 'rejected'))
);

CREATE INDEX "commissionWithdrawal_customerId_createdAt_idx"
ON "commissionWithdrawal"("customerId", "createdAt");

CREATE INDEX "commissionWithdrawal_status_createdAt_idx"
ON "commissionWithdrawal"("status", "createdAt");

-- Bút toán rút tiền do admin tạo, không thuộc một lần chạy cron hoa hồng.
ALTER TABLE "commissionTransaction"
ALTER COLUMN "runId" DROP NOT NULL;
