ALTER TABLE "order"
  ADD COLUMN "commissionWalletUsed" BIGINT DEFAULT 0;

ALTER TABLE "ordership"
  ADD COLUMN "commissionWalletUsed" BIGINT DEFAULT 0;

CREATE TABLE "commissionWalletOrderReservation" (
  "id" BIGSERIAL PRIMARY KEY,
  "orderId" INTEGER NOT NULL UNIQUE,
  "customerId" INTEGER NOT NULL,
  "amount" BIGINT NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  CONSTRAINT "commissionWalletOrderReservation_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "commissionWalletOrderReservation_status_check"
    CHECK ("status" IN ('pending', 'consumed', 'released'))
);

CREATE INDEX "commissionWalletOrderReservation_customerId_status_idx"
  ON "commissionWalletOrderReservation" ("customerId", "status");

GRANT SELECT, INSERT, UPDATE ON TABLE "commissionWalletOrderReservation" TO "nacare_dev";
GRANT USAGE, SELECT ON SEQUENCE "commissionWalletOrderReservation_id_seq" TO "nacare_dev";
GRANT SELECT ("commissionWalletUsed"), INSERT ("commissionWalletUsed"),
  UPDATE ("commissionWalletUsed") ON TABLE "order" TO "nacare_dev";
GRANT SELECT ("commissionWalletUsed"), INSERT ("commissionWalletUsed"),
  UPDATE ("commissionWalletUsed") ON TABLE "ordership" TO "nacare_dev";
