-- Ghi nội dung cho các bút toán rút cũ sau khi đã backfill thuế.
-- Chỉ cập nhật metadata; không sửa amount, ví hoặc bút toán hoàn tiền.
UPDATE "commissionTransaction" AS t
SET "metadata" = (
  COALESCE(t."metadata"::jsonb, '{}'::jsonb) ||
  jsonb_build_object(
    'content',
    'Rút ' || REPLACE(TO_CHAR(t."amount"::numeric,
      'FM999,999,999,999,999,999,999'), ',', '.') ||
    'đ tiền hoa hồng; thuế TNCN ' || w."taxPercent"::text || '%: ' ||
    REPLACE(TO_CHAR((t."amount" - w."receivedAmount")::numeric,
      'FM999,999,999,999,999,999,999'), ',', '.') ||
    'đ; thực nhận ' || REPLACE(TO_CHAR(w."receivedAmount"::numeric,
      'FM999,999,999,999,999,999,999'), ',', '.') || 'đ'
  )
)::json
FROM "commissionWithdrawal" AS w
WHERE t."type" = 'withdrawal'
  AND t."direction" = 'debit'
  AND t."customerId" = w."customerId"
  AND t."idempotencyKey" = 'withdrawal:' || w."id"::text
  AND t."amount" = w."amount"
  AND w."taxPercent" IS NOT NULL
  AND w."receivedAmount" IS NOT NULL;
