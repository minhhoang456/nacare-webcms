/** Interface for creating an invoice */
export type DataCreateInvoice = {
  /** Số hóa đơn */
  invNumber?: string;
  /** Ngày hóa đơn (format: YYYY-MM-DD) */
  invDate: string;
  /** NẾU XUẤT CHO KHÁCH CÁ NHÂN = 1, NGƯỢC LẠI CÔNG TY HOẶC TỔ CHỨC KHÁC = 0 */
  invCustomer: InvoiceCustomer;
  /** Số phiếu bán xuất hóa đơn. BẮT BUỘC(ĐÂY LÀ KEY ĐỂ KIỂM TRA TẠO MỚI HAY UPDATE HÓA ĐƠN) */
  invRef: string;
  /** Ngày phiếu bán (format: YYYY-MM-DD) */
  invRefDate: string;
  /** Tên khách hàng */
  buyerName?: string;
  /** Tên công ty */
  buyerCompany?: string;
  /** Email */
  buyerEmail?: string;
  /** Mã số thuế */
  buyerTax?: string;
  /** Mã khách hàng */
  buyerCode?: string;
  /** Địa chỉ */
  buyerAddress?: string;
  /** STK ngân hàng */
  buyerAccount?: string;
  /** Tên ngân hàng */
  buyerBank?: string;
  /** Số điện thoại */
  buyerPhone?: string;
  /** Fax */
  buyerFax?: string;
  /** TỔNG TIỀN HÀNG (CHƯA VAT) (CHƯA CHIẾT KHẤU) */
  invSubTotal: number;
  /** THUẾ SUẤT TRÊN HÓA ĐƠN. -1: Không chịu thuế, -2: Không kê khai nộp thuế */
  invVatRate: InvoiceVatRate;
  /** Tổng tiền thuế */
  invVatAmount: number;
  /** Tổng giảm giá/tiền chiết khấu */
  invDscnAmnt?: number;
  /** TỔNG CỘNG(TIỀN HÀNG + TIỀN VAT) */
  invTotalAmount: number;
  /** Hình thức thanh toán. Mặc định TM/CK */
  invPayment?: string;
  /** Ghi chú */
  note?: string;
  /** Danh sách các mặt hàng */
  items: DataCreateInvoiceItem[];
};

/** Loại khách hàng */
export enum InvoiceCustomer {
  /** Khách hàng cá nhân */
  customer = "1",
  /** Công ty hoặc tổ chức */
  company = "0",
}

/** Loại thuế suất */
enum InvoiceVatRate {
  /** Không chịu thuế */
  TAX_FREE = -1,
  /** Không kê khai nộp thuế */
  NON_DECLARATION_OF_TAX = -2,
}

/** Chi tiết mặt hàng trong hóa đơn */
type DataCreateInvoiceItem = {
  /** Số thứ tự (tối đa 4 ký tự) */
  itemNo: string;
  /** Mã hàng (tối đa 50 ký tự) */
  itemCode: string;
  /** Tên hàng (tối đa 500 ký tự) */
  itemName: string;
  /** Số lượng */
  itemQuantity: number;
  /** Giá chưa VAT */
  itemPrice: number;
  /** VAT */
  itemVatRate: number;
  /** Tiền VAT */
  itemVatAmnt: number;
  /** Thành tiền chưa thuế */
  itemAmountNoVat: number;
  /** Tiền giảm giá */
  itemDscnAmnt: number;
  /** Ghi chú */
  itemNote: string;
  /** Sản phẩm khuyến mại(0: bình thường, 1: không thu tiền) */
  itemPromo: string;
  /** Điều chỉnh giá/số lượng (PRICE/QTTY) */
  adjustType?: "PRICE" | "QTTY";
};
