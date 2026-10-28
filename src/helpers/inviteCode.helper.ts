import { generateInviteCode } from "./func.helper";

const INVITE_CODE_LENGTH = 9;
const MAX_GENERATION_ATTEMPTS = 100;

// Sinh mã mời riêng cho customer. Unique constraint trong PostgreSQL là lớp
// bảo vệ cuối cùng trước các request đồng thời; bước kiểm tra này giúp tránh
// phần lớn collision trước khi INSERT.
export async function generateUniqueCustomerInviteCode(
  dbClient: any,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const inviteCode = generateInviteCode(INVITE_CODE_LENGTH);
    const existing = await dbClient.customer.findFirst({
      where: { inviteCode },
      select: { id: true },
    });
    if (!existing) return inviteCode;
  }
  throw new Error("e_cannot_generate_invite_code");
}
