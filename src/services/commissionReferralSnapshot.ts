import { DailyCommissionRequest } from '../types/commission.type'

// Khi tính lại hoa hồng trong ngày, giữ các cạnh đã có trong snapshot đầu kỳ.
// Thành viên đăng ký mới trong ngày vẫn được thêm vào cây để nhận thưởng.
export function referralsForDailySnapshot(
  current: DailyCommissionRequest['referrals'],
  snapshot?: DailyCommissionRequest['referrals'],
): DailyCommissionRequest['referrals'] {
  if (!snapshot) return current
  const byChild = new Map(
    snapshot.map((edge) => [edge.referredCustomerId, edge]),
  )
  for (const edge of current) {
    if (!byChild.has(edge.referredCustomerId)) {
      byChild.set(edge.referredCustomerId, edge)
    }
  }
  return [...byChild.values()].sort((left, right) => left.id - right.id)
}
