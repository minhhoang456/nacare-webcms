# Tái mua Mục 4 và Mục 6

- Mục 4 dùng số tiền đã trích vào tích lũy tích cực; Mục 6 dùng tiền đã giữ trong chu kỳ tái cấu trúc. Không ghi nợ ví lần nữa.
- Mỗi yêu cầu mua một sản phẩm, số lượng 1, `paymentCash` bằng chính `commissionRepurchase.amount` đã chốt khi tính thưởng (không lấy lại ngưỡng policy mới).
- Sản phẩm phải đang bán, chưa xóa, thanh toán tiền mặt, không yêu cầu điểm; loại sản phẩm đã duyệt/hoạt động và cửa hàng hoạt động. Không có hoặc nhiều sản phẩm cùng giá thì báo lỗi, không tự chọn.
- Tạo đủ `order`, `ordership`, `orderitem`, cùng trạng thái `completed`, không vận chuyển, không gọi IPN/cổng thanh toán, không sử dụng mpoint/điểm tiêu dùng. Tổng giá trị đơn là giá trị tái mua; tiền mặt phải trả thêm bằng 0.
- Dùng cơ chế giữ hàng hiện có; tăng `item.purchased` cùng transaction. Lỗi transaction thì hoàn giữ hàng Redis. Không dùng callback IPN để tránh cập nhật tồn/hoa hồng lặp.
- Đơn có `sourceOrder` là `commission_positive_repurchase` hoặc `commission_restructure_repurchase`; bộ lấy doanh số hoa hồng đã loại trừ hai nguồn này. Không phát sinh thêm hạn mức tích sản/hoa hồng thông thường từ đơn tái mua.
- Khóa yêu cầu bằng `SELECT FOR UPDATE`. Tạo đơn và cập nhật `orderId`, `status=completed` trong cùng transaction; gọi lại không tạo trùng.
- Yêu cầu mới được xử lý ngay trong transaction lưu kết quả realtime/cron. Mục 4 chỉ commit thưởng tuyến trên khi đơn cũng tạo thành công. Nếu lỗi, toàn bộ lần lưu rollback, run ghi lỗi và được cơ chế tính lại hiện có thử lại.
- Scheduler mỗi phút xử lý tối đa 100 yêu cầu cũ `pending`/`failed`; lưu lỗi và số lần thử. Các yêu cầu cũ đã ghi thưởng trước triển khai không được trả thưởng lần nữa. Khi deploy, scheduler này sẽ xử lý cả backlog cũ.
- Không cần migration mới. Dùng các bảng/cột hiện có. Tài khoản DB cần quyền đọc sản phẩm/khách/cửa hàng, tạo đơn/chi tiết đơn và cập nhật item/yêu cầu tái mua, cùng quyền sequence tương ứng.

## Kiểm thử an toàn

`node --test tests/commissionRepurchase.test.cjs`

Test chỉ import core thuần với DB/giữ hàng giả lập trong bộ nhớ, không nạp `.env`, không gọi DB/Redis/cổng thanh toán thật. Kiểm tra hai loại tái mua, chống gọi lặp, khóa mô phỏng, lỗi thiếu/trùng giá, hết hàng, rollback và retry. Đây không thay thế kiểm thử tích hợp PostgreSQL/Redis thực tế trên môi trường cô lập.

Lưu ý: việc giữ hàng dùng cơ chế Redis sẵn có nên trường hợp tiến trình chết đột ngột giữa giữ hàng và rollback vẫn cần đối soát giữ hàng, giống luồng đơn thường. Không tự chạy đối soát hoặc chỉnh tồn kho trong lần triển khai này.
