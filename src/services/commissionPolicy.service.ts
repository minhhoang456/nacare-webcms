import ono from "@jsdevtools/ono";

const RATE_FIELDS = [
  "directCommissionRateBps",
  "directConsumptionPointRateBps",
  "accumulationRevenueRateBps",
  "accumulationIncomeRateBps",
  "accumulationBelow50MRateBps",
  "accumulationFrom50MRateBps",
  "smallBranchRateBps",
  "positiveIncomeRateBps",
  "positiveUplineRewardRateBps",
  "resonanceRateBps",
  "systemRevenueRateBps",
  "sameTierRateBps",
];

function validateRates(data: Record<string, unknown>): void {
  for (const field of RATE_FIELDS) {
    if (data[field] === undefined) continue;
    const value = Number(data[field]);
    if (!Number.isInteger(value) || value < 0 || value > 10000) {
      throw ono(`${field} must be an integer from 0 to 10000 BPS`);
    }
  }
  const directCash = Number(data.directCommissionRateBps || 0);
  const directPoint = Number(data.directConsumptionPointRateBps || 0);
  if (directCash + directPoint > 10000) {
    throw ono(
      "direct cash and consumption-point rates cannot exceed 10000 BPS in total",
    );
  }
  if (data.accumulationBelow50MRateBps !== undefined ||
      data.accumulationFrom50MRateBps !== undefined) {
    const below = Number(data.accumulationBelow50MRateBps);
    const from = Number(data.accumulationFrom50MRateBps);
    if (!Number.isInteger(below) || !Number.isInteger(from) || below + from !== 10000) {
      throw ono("accumulation group rates must total 10000 BPS");
    }
  }
}

function validateNonNegativeAmounts(
  data: Record<string, unknown>,
  fields: string[],
): void {
  for (const field of fields) {
    if (data[field] === undefined) continue;
    const value = Number(data[field]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw ono(`${field} must be a non-negative integer VND value`);
    }
  }
}

export const commissionPolicyService = {
  // Cấu hình dùng chung cho Mục 1-6: tỷ lệ dùng BPS, tiền dùng số nguyên VND.
  validateData: async (data: Record<string, unknown>) => {
    validateRates(data);
    validateNonNegativeAmounts(data, [
      "smallBranchWeeklyLimit",
      "positiveRepurchaseAmount",
      "resonanceMinimumOrderAmount",
    ]);
    if (
      data.version !== undefined &&
      (!Number.isInteger(Number(data.version)) || Number(data.version) <= 0)
    ) {
      throw ono("commission policy version must be a positive integer");
    }
    if (
      data.status !== undefined &&
      !["draft", "active", "expired"].includes(String(data.status))
    ) {
      throw ono("commission policy status is invalid");
    }
  },
};

export const commissionAgencyTierService = {
  // Mục 6 - Thưởng đại lý: kiểm tra ngưỡng doanh số và tỷ lệ từng cấp.
  validateData: async (data: Record<string, unknown>) => {
    validateRates(data);
    validateNonNegativeAmounts(data, [
      "personalRevenueRequired",
      "smallBranchRevenueRequired",
    ]);
    if (
      data.level !== undefined &&
      (!Number.isInteger(Number(data.level)) || Number(data.level) <= 0)
    ) {
      throw ono("agency tier level must be a positive integer");
    }
  },
};

export default commissionPolicyService;
