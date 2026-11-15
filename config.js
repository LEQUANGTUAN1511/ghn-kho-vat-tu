/* =============================================================
 * CẤU HÌNH ỨNG DỤNG – sửa API_URL sau khi triển khai Apps Script
 * ============================================================= */
window.APP_CONFIG = {
  // Dán URL Web App của Apps Script vào đây (dạng https://script.google.com/macros/s/XXXX/exec)
  // Có thể để trống và nhập trong mục "Cài đặt" của web.
  API_URL: 'https://script.google.com/macros/s/AKfycbwHv4zowDXpSGhep-lh9CKWjBMZbt6QcynQYGF02pNvBmQ8UfJT6qMrDABFloNScW57lA/exec',
  SHEET_ID: '1SalSle0FPpD5KpBh3gb1ZQK3rKp1wglhaKAlHagUIaY',
  APP_NAME: 'Kho Vật Tư Cụm M12',
  POLL_SECONDS: 20,        // kiểm tra thay đổi từ Google Sheet mỗi 20 giây
  KHO: [
    { code: 'HCM20', name: 'Kho Trung Chuyển HCM20', short: 'HCM20', color: '#14a394', cal: 'LICH_CV_HCM20' },
    { code: 'ST', name: 'Kho Chuyển Tiếp Sóng Thần', short: 'Sóng Thần', color: '#3b82f6', cal: 'LICH_CV_ST' },
    { code: 'TK', name: 'Kho Trung Chuyển Tân Kim', short: 'Tân Kim', color: '#f59e0b', cal: 'LICH_CV_TK' }
  ]
};

/* Nhóm menu */
window.NAV_GROUPS = [
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
  HUONG_DAN: { title: 'Hướng dẫn sử dụng', icon: 'book', group: 'other', type: 'doc' },
  DASHBOARD: { title: 'Dashboard (Sheet)', icon: 'chart', group: 'other', type: 'report', headerRow: 4, dataStart: 5 },

  DM_KHO: { title: 'Danh mục Kho', icon: 'home', group: 'dm', type: 'table', headerRow: 4, dataStart: 5, khoCol: 'A', addRow: true, addCol: true },
  DM_NVL: { title: 'Danh mục NVL', icon: 'box', group: 'dm', type: 'table', headerRow: 4, dataStart: 5, addRow: true, addCol: true,
    autoCode: { col: 'A', from: 'C', prefix: 'NVL', map: { 'Bao bì - đóng gói': 'BB', 'Niêm phong - tem nhãn': 'NP', 'Văn phòng phẩm': 'VP', 'Vệ sinh - hóa chất': 'VS', 'Mực in - vật tư máy in': 'MI' } } },
  DM_CCDC: { title: 'Danh mục CCDC', icon: 'tool', group: 'dm', type: 'table', headerRow: 4, dataStart: 5, addRow: true, addCol: true,
    autoCode: { col: 'A', from: 'C', prefix: 'CCDC', map: { 'Quạt': 'QT', 'Bình chữa cháy': 'PC', 'Thiết bị văn phòng - IT': 'TB', 'Dụng cụ vận hành': 'VH' } } },

  SO_NHAP_XUAT: { title: 'Sổ Nhập – Xuất – Điều chuyển', icon: 'swap', group: 'nx', type: 'table', headerRow: 4, dataStart: 5, khoCol: 'C', lookup: { E: 'NVL' }, addRow: true, addCol: true, newestFirst: true },
  TON_KHO: { title: 'Tồn kho NVL', icon: 'layers', group: 'nx', type: 'table', headerRow: 4, dataStart: 5, groupRow: 3,
    khoGroups: { HCM20: ['D', 'I'], ST: ['J', 'O'], TK: ['P', 'U'] } },
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
    params: ['M3'], paramKho: 'M3', side: [{ title: 'Bảng tổng hợp PDA (theo ô M3)', from: 'L', to: 'P', headerRow: 4, rows: 6 }, { title: 'So sánh 3 kho', from: 'M', to: 'P', headerRow: 17, rows: 3 }] },
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
