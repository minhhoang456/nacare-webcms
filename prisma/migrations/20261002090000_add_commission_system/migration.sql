-- Cây giới thiệu đa nhánh: một người có tối đa một cha.
CREATE TABLE "referral" (
    "id" BIGSERIAL NOT NULL,
    "referrerCustomerId" INTEGER NOT NULL,
    "referredCustomerId" INTEGER NOT NULL,
    "inviteCode" VARCHAR(255) NOT NULL,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    CONSTRAINT "referral_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "referral_referredCustomerId_key" ON "referral"("referredCustomerId");
CREATE INDEX "referral_referrerCustomerId_idx" ON "referral"("referrerCustomerId");

-- Cấu hình CMS có version, không sửa ngược policy đã được dùng để tính.
-- Lịch chạy mặc định lúc 07:00 theo múi giờ Asia/Ho_Chi_Minh.
CREATE TABLE "commissionPolicy" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(255),
    "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "effectiveFrom" BIGINT NOT NULL,
    "effectiveTo" BIGINT,
    "dailyRunEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyRunHour" INTEGER NOT NULL DEFAULT 7,
    "dailyRunMinute" INTEGER NOT NULL DEFAULT 0,
    "directCommissionRateBps" INTEGER NOT NULL,
    "accumulationRevenueRateBps" INTEGER NOT NULL,
    "accumulationIncomeRateBps" INTEGER NOT NULL,
    "smallBranchRateBps" INTEGER NOT NULL,
    "smallBranchWeeklyLimit" BIGINT NOT NULL,
    "positiveIncomeRateBps" INTEGER NOT NULL,
    "positiveRepurchaseAmount" BIGINT NOT NULL,
    "positiveUplineRewardRateBps" INTEGER NOT NULL,
    "resonanceRateBps" INTEGER NOT NULL,
    "resonanceMinimumOrderAmount" BIGINT NOT NULL,
    "restructureIncomeAmount" BIGINT NOT NULL,
    "restructureRepurchaseAmount" BIGINT NOT NULL,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    CONSTRAINT "commissionPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "commissionPolicy_version_key" ON "commissionPolicy"("version");
CREATE INDEX "commissionPolicy_status_effectiveFrom_effectiveTo_idx" ON "commissionPolicy"("status", "effectiveFrom", "effectiveTo");

CREATE TABLE "commissionAgencyTier" (
    "id" SERIAL NOT NULL,
    "policyId" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "personalRevenueRequired" BIGINT NOT NULL,
    "smallBranchRevenueRequired" BIGINT NOT NULL,
    "systemRevenueRateBps" INTEGER NOT NULL,
    "sameTierRateBps" INTEGER NOT NULL,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    CONSTRAINT "commissionAgencyTier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "commissionAgencyTier_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "commissionPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "commissionAgencyTier_policyId_level_key" ON "commissionAgencyTier"("policyId", "level");

-- Một calculationDate chỉ có một lần tính chính thức; snapshot phục vụ đối soát.
CREATE TABLE "commissionRun" (
    "id" BIGSERIAL NOT NULL,
    "calculationDate" VARCHAR(10) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "policyId" INTEGER,
    "policyVersion" INTEGER,
    "systemRevenue" BIGINT,
    "requestSnapshot" JSON,
    "responseSnapshot" JSON,
    "errorMessage" TEXT,
    "startedAt" BIGINT,
    "completedAt" BIGINT,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    CONSTRAINT "commissionRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "commissionRun_calculationDate_key" ON "commissionRun"("calculationDate");

-- Sổ giao dịch chung của Mục 1-7. idempotencyKey chống ghi trùng khi retry.
CREATE TABLE "commissionTransaction" (
    "id" BIGSERIAL NOT NULL,
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "runId" BIGINT NOT NULL,
    "calculationDate" VARCHAR(10) NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "direction" VARCHAR(16) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "sourceCustomerId" INTEGER,
    "sourceOrderId" BIGINT,
    "rateBps" INTEGER,
    "grossAmount" BIGINT NOT NULL DEFAULT 0,
    "deductionAmount" BIGINT NOT NULL DEFAULT 0,
    "netAmount" BIGINT NOT NULL DEFAULT 0,
    "amount" BIGINT NOT NULL,
    "metadata" JSON DEFAULT '{}',
    "createdAt" BIGINT,
    CONSTRAINT "commissionTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "commissionTransaction_idempotencyKey_key" ON "commissionTransaction"("idempotencyKey");
CREATE INDEX "commissionTransaction_runId_idx" ON "commissionTransaction"("runId");
CREATE INDEX "commissionTransaction_customerId_calculationDate_idx" ON "commissionTransaction"("customerId", "calculationDate");
CREATE INDEX "commissionTransaction_type_calculationDate_idx" ON "commissionTransaction"("type", "calculationDate");

CREATE TABLE "accumulationEntitlement" (
    "id" BIGSERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "orderId" BIGINT NOT NULL,
    "groupName" VARCHAR(64) NOT NULL,
    "orderAmount" BIGINT NOT NULL,
    "multiplier" BIGINT NOT NULL,
    "maximumAmount" BIGINT NOT NULL,
    "receivedAmount" BIGINT NOT NULL,
    "remainingAmount" BIGINT NOT NULL,
    "entitlementVersion" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "sourceCreatedAt" BIGINT NOT NULL,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    CONSTRAINT "accumulationEntitlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accumulationEntitlement_orderId_key" ON "accumulationEntitlement"("orderId");
CREATE INDEX "accumulationEntitlement_customerId_completed_idx" ON "accumulationEntitlement"("customerId", "completed");

CREATE TABLE "accumulationPoolDaily" (
    "id" BIGSERIAL NOT NULL,
    "runId" BIGINT NOT NULL,
    "calculationDate" VARCHAR(10) NOT NULL,
    "groupName" VARCHAR(64) NOT NULL,
    "allocationRateBps" INTEGER NOT NULL,
    "availableAmount" BIGINT NOT NULL,
    "distributedAmount" BIGINT NOT NULL,
    "unallocatedAmount" BIGINT NOT NULL,
    "eligibleCustomerCount" INTEGER NOT NULL,
    "createdAt" BIGINT,
    CONSTRAINT "accumulationPoolDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accumulationPoolDaily_calculationDate_groupName_key" ON "accumulationPoolDaily"("calculationDate", "groupName");
CREATE INDEX "accumulationPoolDaily_runId_idx" ON "accumulationPoolDaily"("runId");

CREATE TABLE "positiveBalance" (
    "customerId" INTEGER NOT NULL,
    "balance" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    CONSTRAINT "positiveBalance_pkey" PRIMARY KEY ("customerId")
);

CREATE TABLE "restructureState" (
    "customerId" INTEGER NOT NULL,
    "cycleProgress" BIGINT NOT NULL,
    "reservedAmount" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" BIGINT NOT NULL,
    CONSTRAINT "restructureState_pkey" PRIMARY KEY ("customerId")
);

CREATE TABLE "deferredCommissionIncome" (
    "id" BIGSERIAL NOT NULL,
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "sourceRunId" BIGINT NOT NULL,
    "consumedRunId" BIGINT,
    "customerId" INTEGER NOT NULL,
    "sourceCustomerId" INTEGER,
    "sourceType" VARCHAR(64) NOT NULL,
    "amount" BIGINT NOT NULL,
    "availableDate" VARCHAR(10) NOT NULL,
    "createdAt" BIGINT,
    "consumedAt" BIGINT,
    CONSTRAINT "deferredCommissionIncome_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "deferredCommissionIncome_idempotencyKey_key" ON "deferredCommissionIncome"("idempotencyKey");
CREATE INDEX "deferredCommissionIncome_availableDate_consumedRunId_idx" ON "deferredCommissionIncome"("availableDate", "consumedRunId");
CREATE INDEX "deferredCommissionIncome_customerId_availableDate_idx" ON "deferredCommissionIncome"("customerId", "availableDate");

CREATE TABLE "agencyQualificationDaily" (
    "id" BIGSERIAL NOT NULL,
    "runId" BIGINT NOT NULL,
    "calculationDate" VARCHAR(10) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "tierLevel" INTEGER NOT NULL,
    "tierName" VARCHAR(255) NOT NULL,
    "personalRevenue" BIGINT NOT NULL,
    "smallBranchRevenue" BIGINT NOT NULL,
    "systemRateBps" INTEGER NOT NULL,
    "sameTierRateBps" INTEGER NOT NULL,
    "createdAt" BIGINT,
    CONSTRAINT "agencyQualificationDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agencyQualificationDaily_calculationDate_customerId_key" ON "agencyQualificationDaily"("calculationDate", "customerId");
CREATE INDEX "agencyQualificationDaily_runId_idx" ON "agencyQualificationDaily"("runId");

-- Outbox đơn tái mua. Worker fulfillment sẽ xử lý khi đã cấu hình sản phẩm.
CREATE TABLE "commissionRepurchase" (
    "id" BIGSERIAL NOT NULL,
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "runId" BIGINT NOT NULL,
    "calculationDate" VARCHAR(10) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "ruleType" VARCHAR(32) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "orderId" INTEGER,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" BIGINT,
    "updatedAt" BIGINT,
    CONSTRAINT "commissionRepurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "commissionRepurchase_idempotencyKey_key" ON "commissionRepurchase"("idempotencyKey");
CREATE INDEX "commissionRepurchase_status_createdAt_idx" ON "commissionRepurchase"("status", "createdAt");
CREATE INDEX "commissionRepurchase_runId_idx" ON "commissionRepurchase"("runId");

-- Policy mặc định theo chính sách kinh doanh ban đầu.
-- Cron được tắt để môi trường test chỉ chạy khi chủ động bật dailyRunEnabled.
INSERT INTO "commissionPolicy" (
    "version",
    "name",
    "status",
    "effectiveFrom",
    "effectiveTo",
    "dailyRunEnabled",
    "dailyRunHour",
    "dailyRunMinute",
    "directCommissionRateBps",
    "accumulationRevenueRateBps",
    "accumulationIncomeRateBps",
    "smallBranchRateBps",
    "smallBranchWeeklyLimit",
    "positiveIncomeRateBps",
    "positiveRepurchaseAmount",
    "positiveUplineRewardRateBps",
    "resonanceRateBps",
    "resonanceMinimumOrderAmount",
    "restructureIncomeAmount",
    "restructureRepurchaseAmount"
) VALUES (
    1,
    'Chính sách mặc định Mục 1-7',
    'active',
    0,
    NULL,
    false,
    7,
    0,
    2000,       -- Mục 1: hoa hồng trực tiếp 20%
    500,        -- Mục 2: trích 5% doanh số hệ thống
    500,        -- Mục 2: trích 5% thu nhập thành viên
    800,        -- Mục 3: thưởng nhóm nhỏ 8%
    100000000,  -- Mục 3: tối đa 100 triệu/tuần
    500,        -- Mục 4: trích 5% thu nhập
    3500000,    -- Mục 4: đủ 3,5 triệu thì tái mua
    200,        -- Mục 4: mỗi TVBT nhận 2% giá trị tái mua
    500,        -- Mục 5: thưởng cộng hưởng 5%
    30000000,   -- Mục 5: điều kiện một đơn cá nhân từ 30 triệu
    300000000,  -- Mục 6: mốc thu nhập 300 triệu
    30000000    -- Mục 6: tái mua sản phẩm 30 triệu
);

-- Mục 7: ba cấp đại lý theo ảnh chính sách ban đầu.
INSERT INTO "commissionAgencyTier" (
    "policyId",
    "level",
    "name",
    "personalRevenueRequired",
    "smallBranchRevenueRequired",
    "systemRevenueRateBps",
    "sameTierRateBps"
)
SELECT
    policy."id",
    tier."level",
    tier."name",
    tier."personalRevenueRequired",
    tier."smallBranchRevenueRequired",
    tier."systemRevenueRateBps",
    tier."sameTierRateBps"
FROM "commissionPolicy" AS policy
CROSS JOIN (
    VALUES
        (1, 'Nhóm tích cực', 50000000::BIGINT, 100000000::BIGINT, 300, 500),
        (2, 'Nhóm tăng tốc', 100000000::BIGINT, 500000000::BIGINT, 400, 500),
        (3, 'Nhóm tinh hoa', 200000000::BIGINT, 1000000000::BIGINT, 500, 500)
) AS tier(
    "level",
    "name",
    "personalRevenueRequired",
    "smallBranchRevenueRequired",
    "systemRevenueRateBps",
    "sameTierRateBps"
)
WHERE policy."version" = 1;
