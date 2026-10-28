-- DropForeignKey
ALTER TABLE "code" DROP CONSTRAINT "code_voucherId_fkey";

-- AddForeignKey
ALTER TABLE "code" ADD CONSTRAINT "code_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "voucher"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
