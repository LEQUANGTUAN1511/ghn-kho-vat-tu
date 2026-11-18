/* =============================================================
 * CẤU HÌNH ỨNG DỤNG – sửa API_URL sau khi triển khai Apps Script
 * ============================================================= */
window.APP_CONFIG = {
  // Dán URL Web App của Apps Script vào đây (dạng https://script.google.com/macros/s/XXXX/exec)
  // Có thể để trống và nhập trong mục "Cài đặt" của web.
  API_URL: 'https://script.google.com/macros/s/AKfycbwHv4zowDXpSGhep-lh9CKWjBMZbt6QcynQYGF02pNvBmQ8UfJT6qMrDABFloNScW57lA/exec',
  SHEET_ID: '1SalSle0FPpD5KpBh3gb1ZQK3rKp1wglhaKAlHagUIaY',
  APP_NAME: 'Kho Vật Tư Cụm M12',
  POLL_SECONDS: 10,        // kiểm tra thay đổi từ Google Sheet mỗi 10 giây (chỉ tải lại tab đã đổi)
  KHO: [
    { code: 'HCM20', name: 'Kho Trung Chuyển HCM20', short: 'HCM20', color: '#14a394', cal: 'LICH_CV_HCM20' },
    { code: 'ST', name: 'Kho Chuyển Tiếp Sóng Thần', short: 'Sóng Thần', color: '#3b82f6', cal: 'LICH_CV_ST' },
    { code: 'TK', name: 'Kho Trung Chuyển Tân Kim', short: 'Tân Kim', color: '#f59e0b', cal: 'LICH_CV_TK' }
  ]
};

/* Nhóm menu */
window.NAV_GROUPS = [
  { id: 'ql', title: 'Dành cho Quản lý' },
  { id: 'dm', title: 'Danh mục (GĐ1)' },
  { id: 'nx', title: 'Nhập – Xuất – Tồn (GĐ2)' },
  { id: 'kh', title: 'Định mức & Kế hoạch (GĐ3)' },
  { id: 'cc', title: 'CCDC – Tuổi thọ (GĐ4)' },
  { id: 'ev', title: 'Event (GĐ5)' },
  { id: 'tb', title: 'Thiết bị & Lịch CV' },
  { id: 'other', title: 'Khác' }
];

/* Mô tả từng tab của Google Sheet.
 * headerRow/dataStart: dòng tiêu đề / dòng dữ liệu đầu tiên
 * khoCol: cột chứa mã kho (để lọc theo kho)
 * khoGroups: các cột riêng từng kho (TON_KHO, DINH_MUC)
 * lookup: cột nhập mã tra cứu danh mục (NVL / CCDC / KHO)
 * params: ô tham số phía trên bảng · summary: ô kết quả tự tính
 * side: bảng phụ bên phải sheet
 */
window.SCHEMA = {
  // Dành cho Quản lý – tab do web tạo trên Sheet (always: hiện trong menu kể cả khi Sheet chưa có tab)
  QL_TASK: { title: 'Task', icon: 'task', group: 'ql', type: 'task', headerRow: 4, dataStart: 5, khoCol: 'D', addRow: true, always: true },
  DV_MUA_NGOAI: { title: 'Dịch vụ mua ngoài', icon: 'service', group: 'ql', type: 'dv', headerRow: 4, dataStart: 5, khoCol: 'C', addRow: true, always: true, after: 'QL_TASK' },

  HUONG_DAN: { title: 'Hướng dẫn sử dụng', icon: 'book', group: 'other', type: 'doc' },
  DASHBOARD: { title: 'Dashboard (Sheet)', icon: 'chart', group: 'other', type: 'report', headerRow: 4, dataStart: 5 },

  DM_KHO: { title: 'Danh mục Kho', icon: 'home', group: 'dm', type: 'table', headerRow: 4, dataStart: 5, khoCol: 'A', addRow: true, addCol: true },
  DM_NVL: { title: 'Danh mục NVL', icon: 'box', group: 'dm', type: 'table', headerRow: 4, dataStart: 5, addRow: true, addCol: true,
    autoCode: { col: 'A', from: 'C', prefix: 'NVL', map: { 'Bao bì - đóng gói': 'BB', 'Niêm phong - tem nhãn': 'NP', 'Văn phòng phẩm': 'VP', 'Vệ sinh - hóa chất': 'VS', 'Mực in - vật tư máy in': 'MI' } } },
  DM_CCDC: { title: 'Danh mục CCDC', icon: 'tool', group: 'dm', type: 'table', headerRow: 4, dataStart: 5, addRow: true, addCol: true,
    autoCode: { col: 'A', from: 'C', prefix: 'CCDC', map: { 'Quạt': 'QT', 'Bình chữa cháy': 'PC', 'Thiết bị văn phòng - IT': 'TB', 'Dụng cụ vận hành': 'VH' } } },

  // price: khi chọn mã, tự điền Đơn giá từ danh mục (nếu ô còn trống)
  SO_NHAP_XUAT: { title: 'Sổ Nhập – Xuất NVL', icon: 'swap', group: 'nx', type: 'table', headerRow: 4, dataStart: 5, khoCol: 'C', lookup: { E: 'NVL' }, addRow: true, addCol: true, newestFirst: true,
    price: { code: 'E', to: 'N', kind: 'NVL' }, totals: true },
  // khoGroups: mỗi kho có thể gồm nhiều vùng cột [từ, đến]
  TON_KHO: { title: 'Tồn kho NVL', icon: 'layers', group: 'nx', type: 'table', headerRow: 4, dataStart: 5, groupRow: 3, totals: true,
    khoGroups: { HCM20: [['D', 'I'], ['W', 'W']], ST: [['J', 'O'], ['X', 'X']], TK: [['P', 'U'], ['Y', 'Y']] } },
  SO_NX_CCDC: { title: 'Sổ Nhập – Xuất CCDC', icon: 'swap', group: 'nx', type: 'table', headerRow: 4, dataStart: 5, khoCol: 'C', lookup: { E: 'CCDC' }, addRow: true, addCol: true, newestFirst: true,
    price: { code: 'E', to: 'N', kind: 'CCDC' }, totals: true, always: true, after: 'TON_KHO' },
  TON_KHO_CCDC: { title: 'Tồn kho CCDC', icon: 'layers', group: 'nx', type: 'table', headerRow: 4, dataStart: 5, groupRow: 3, totals: true, always: true, after: 'SO_NX_CCDC',
    khoGroups: { HCM20: [['D', 'G'], ['Q', 'Q']], ST: [['H', 'K'], ['R', 'R']], TK: [['L', 'O'], ['S', 'S']] } },
  KIEM_KE: { title: 'Kiểm kê định kỳ', icon: 'check', group: 'nx', type: 'table', headerRow: 4, dataStart: 5, khoCol: 'C', lookup: { D: 'NVL' }, addRow: true, addCol: true, newestFirst: true },

  DINH_MUC: { title: 'Định mức Min / Max', icon: 'gauge', group: 'kh', type: 'table', headerRow: 4, dataStart: 5,
    khoGroups: { HCM20: ['C', 'D'], ST: ['E', 'F'], TK: ['G', 'H'] } },
  KH_NVL_THANG: { title: 'Kế hoạch NVL theo tháng', icon: 'cart', group: 'kh', type: 'table', headerRow: 9, dataStart: 10,
    params: ['B3', 'B4', 'B5', 'B6', 'B7'], summary: ['F3', 'F4'], paramKho: 'B3', onlyNonZero: 'K' },
  KH_CCDC_QUY: { title: 'Kế hoạch CCDC theo quý', icon: 'cart', group: 'kh', type: 'table', headerRow: 9, dataStart: 10,
    params: ['B3', 'B4', 'B5', 'B6', 'B7'], summary: ['G3'], paramKho: 'B3' },

  TAI_SAN_CCDC: { title: 'Sổ tài sản CCDC', icon: 'tag', group: 'cc', type: 'table', headerRow: 4, dataStart: 5, khoCol: 'D', lookup: { B: 'CCDC' }, addRow: true, addCol: true },
  HU_HONG: { title: 'Nhật ký hư hỏng', icon: 'alert', group: 'cc', type: 'table', headerRow: 4, dataStart: 5, khoCol: 'E', lookup: { F: 'CCDC' }, addRow: true, addCol: true, newestFirst: true },
  BC_HU_HONG: { title: 'Báo cáo hư hỏng', icon: 'chart', group: 'cc', type: 'table', headerRow: 9, dataStart: 10, cols: 'A:G',
    params: ['B3', 'B4', 'B5', 'B6', 'B7'], paramKho: 'B3', side: [{ title: 'Theo nguyên nhân', from: 'I', to: 'L', headerRow: 9 }] },
  THANH_LY: { title: 'Thanh lý CCDC theo quý', icon: 'trash', group: 'cc', type: 'table', headerRow: 4, dataStart: 5, cols: 'A:L', khoCol: 'C', lookup: { D: 'CCDC' }, addRow: true,
    side: [{ title: 'Tổng hợp theo quý', from: 'N', to: 'P', headerRow: 4 }] },

  LICH_EVENT: { title: 'Lịch Event & mốc chuẩn bị', icon: 'calendar', group: 'ev', type: 'table', headerRow: 4, dataStart: 5, addRow: true, addCol: true },
  CHECKLIST_EVENT: { title: 'Checklist chuẩn bị Event', icon: 'list', group: 'ev', type: 'table', headerRow: 7, dataStart: 8,
    params: ['B3', 'B4'], summary: ['B5', 'C5'], paramList: { B3: { sheet: 'LICH_EVENT', col: 'A', from: 5 } }, addRow: true },

  THONG_KE_PDA: { title: 'Thống kê PDA', icon: 'phone', group: 'tb', type: 'table', headerRow: 4, dataStart: 5, cols: 'A:J', khoCol: 'B', addRow: true,
    params: ['M3'], paramKho: 'M3', side: [{ title: 'Bảng tổng hợp PDA (theo ô M3)', from: 'L', to: 'auto', headerRow: 4, rows: 6 }, { title: 'So sánh 3 kho', from: 'M', to: 'P', headerRow: 17, rows: 3 }] },
  CAP_PHAT_PDA: { title: 'Cấp phát PDA hằng ngày', icon: 'phone', group: 'tb', type: 'table', headerRow: 4, dataStart: 5, khoCol: 'C', lookup: { D: 'PDA' }, addRow: true, addCol: true, newestFirst: true,
    always: true, after: 'THONG_KE_PDA', pda: true },
  LICH_CV_HCM20: { title: 'Lịch CV – HCM20', icon: 'clock', group: 'tb', type: 'calendar', kho: 'HCM20' },
  LICH_CV_ST: { title: 'Lịch CV – Sóng Thần', icon: 'clock', group: 'tb', type: 'calendar', kho: 'ST' },
  LICH_CV_TK: { title: 'Lịch CV – Tân Kim', icon: 'clock', group: 'tb', type: 'calendar', kho: 'TK' }
};

/* Cấu trúc chung các tab lịch công việc */
window.CAL_DEF = {
  headerRow: 4, dataStart: 6, dataEnd: 36, params: ['B3', 'D3'], summary: ['F3'],
  headers: ['Ngày', 'Thứ', 'Công việc – Sáng', 'Công việc – Tối', 'Tiến độ – Sáng', 'Tiến độ – Tối', 'Ghi chú'],
  progressList: ['Hoàn Thành', 'Chưa Hoàn Thành']
};

/* Các tab hệ thống do web tạo – không hiện trong menu */
window.HIDDEN_SHEETS = ['WEB_HINH_ANH', 'WEB_NHAT_KY'];

/* Tab do web tạo trên Sheet (Apps Script AUTO_SHEETS / setupV2). Khi Sheet chưa có tab,
 * web dựng bản trống theo khai báo này để vẫn xem / nhập được (tự đồng bộ khi tab được tạo).
 * f: các cột công thức (Sheet tự tính) · dv: dropdown · g: dòng nhóm (dòng 3) */
window.AUTO_LOCAL = {
  DV_MUA_NGOAI: {
    title: 'DỊCH VỤ MUA NGOÀI – CỤM M12',
    sub: 'Mua CCDC ngoài hệ thống kho hoặc dịch vụ nhà cung cấp. Tab sẽ được tạo trên Google Sheet khi có yêu cầu đầu tiên (hoặc chạy setupV3).',
    headers: ['Mã yêu cầu', 'Ngày yêu cầu', 'Kho', 'Loại yêu cầu', 'Mức độ', 'Nội dung yêu cầu', 'Chi tiết / số lượng', 'Bộ phận yêu cầu', 'Người yêu cầu', 'Người thực hiện', 'Người duyệt yêu cầu', 'Tiến độ', 'Ngày duyệt', 'Bắt đầu dự kiến', 'Hoàn thành dự kiến', 'Hoàn thành thực tế', 'Nhà cung cấp', 'Chi phí dự kiến (VNĐ)', 'Chi phí thực tế (VNĐ)', 'Giải trình', 'Chứng từ / số phiếu', 'Tình trạng hạn', 'Cập nhật lần cuối'],
    f: 'V',
    dv: { C: ['Chung', 'HCM20', 'ST', 'TK'], D: ['Dịch vụ', 'CCDC ngoài hệ thống', 'Sửa chữa', 'Khác'], E: ['Khẩn cấp', 'Cao', 'Bình thường'], L: ['Đang báo giá', 'Chờ duyệt', 'Đã duyệt', 'Đang thực hiện', 'Chờ nghiệm thu', 'Hoàn thành', 'Từ chối', 'Hủy'] }
  },
  SO_NX_CCDC: {
    title: 'SỔ NHẬP – XUẤT – ĐIỀU CHUYỂN CCDC (3 KHO)',
    sub: 'Mỗi dòng = 1 giao dịch của 1 mã CCDC ở 1 kho. "Thu hồi nhập kho" = CCDC đã cấp phát được trả về kho. Đơn giá để trống = lấy theo DM_CCDC.',
    headers: ['Ngày', 'Số phiếu', 'Kho', 'Loại giao dịch', 'Mã CCDC', 'Tên CCDC', 'ĐVT', 'Số lượng', 'Bộ phận / kho đối ứng', 'Người nhận / giao', 'MSNV', 'Ghi chú', 'Kiểm tra', 'Đơn giá (VNĐ)', 'Thành tiền (VNĐ)'],
    f: 'FGMO',
    dv: { C: ['HCM20', 'ST', 'TK'], D: ['Nhập', 'Xuất', 'Điều chuyển đi', 'Điều chuyển đến', 'Xuất hủy / hao hụt', 'Thu hồi nhập kho'] }
  },
  TON_KHO_CCDC: {
    title: 'TỒN KHO CCDC (3 KHO)',
    sub: 'Tự tính từ SO_NX_CCDC. Chỉ nhập "Tồn đầu" một lần. Bảng sẽ hiện đủ mã CCDC sau khi chạy setupV2 trong Apps Script.',
    headers: ['Mã CCDC', 'Tên CCDC', 'ĐVT', 'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối', 'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối', 'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối', 'Đơn giá (VNĐ)', 'Giá trị tồn HCM20', 'Giá trị tồn ST', 'Giá trị tồn TK', 'Tổng giá trị tồn', 'Đang sử dụng (sổ tài sản)'],
    f: 'ABCEFGIJKMNOPQRSTU', g: { D: 'HCM20', H: 'ST', L: 'TK', P: 'GIÁ TRỊ TỒN' }
  },
  CAP_PHAT_PDA: {
    title: 'CẤP PHÁT PDA HẰNG NGÀY',
    sub: 'Mỗi lượt mượn = 1 dòng. Khi trả ghi Giờ trả + Tình trạng khi trả. IMEI lấy theo tab THONG_KE_PDA.',
    headers: ['Ngày', 'Ca', 'Kho', 'IMEI', 'Tên thiết bị', 'Người nhận', 'MSNV', 'Bộ phận / công việc', 'Giờ cấp', 'Giờ trả', 'Tình trạng khi trả', 'Ghi chú', 'Trạng thái'],
    f: 'EM',
    dv: { B: ['Ca 1', 'Ca 2', 'Ca 3', 'Hành chính'], C: ['HCM20', 'ST', 'TK'], K: ['Bình thường', 'Hư màn hình', 'Hư pin / sạc', 'Lỗi phần mềm', 'Rơi vỡ', 'Mất máy', 'Khác'] }
  }
};
