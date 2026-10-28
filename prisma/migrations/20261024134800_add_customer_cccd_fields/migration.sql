-- Add CCCD fields (identification number, front image, back image) to customer table
ALTER TABLE "customer"
ADD COLUMN IF NOT EXISTS "cccd" VARCHAR(20),
ADD COLUMN IF NOT EXISTS "cccdFrontImage" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "cccdBackImage" VARCHAR(255);