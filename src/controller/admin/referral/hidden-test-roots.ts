// Các cây test chỉ bị ẩn khỏi CMS; không thay đổi dữ liệu hay việc tính thưởng.
// ID đã được đối chiếu trên cả DB dev và prod.
export const HIDDEN_TEST_ROOT_IDS = [98, 103, 104, 105, 106, 1140];

export function isHiddenTestRoot(id: number): boolean {
  return HIDDEN_TEST_ROOT_IDS.includes(id);
}
