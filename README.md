# GHN · Kho Vật Tư Cụm M12

Trang web quản lý kho vật tư cho 3 kho: **HCM20 · Sóng Thần (ST) · Tân Kim (TK)**. Dữ liệu đọc và ghi trực tiếp vào Google Sheet
[QUẢN LÝ KHO VẬT TƯ CỤM M12](https://docs.google.com/spreadsheets/d/1SalSle0FPpD5KpBh3gb1ZQK3rKp1wglhaKAlHagUIaY/edit).

## Tính năng

| Nhóm | Chi tiết |
|---|---|
| **Đủ 21 tab của Sheet** | HUONG_DAN, DASHBOARD, THONG_KE_PDA, DM_KHO, DM_NVL, DM_CCDC, SO_NHAP_XUAT, TON_KHO, DINH_MUC, KH_NVL_THANG, KH_CCDC_QUY, TAI_SAN_CCDC, HU_HONG, BC_HU_HONG, THANH_LY, KIEM_KE, LICH_EVENT, CHECKLIST_EVENT, LICH_CV_HCM20, LICH_CV_ST, LICH_CV_TK. Tab mới thêm vào Sheet sau này cũng tự hiện trong menu. |
| **Sửa trực tiếp** | Bấm vào ô để sửa (Enter lưu, Esc hủy, Tab sang ô kế). Có dropdown giống trong Sheet, tra mã NVL/CCDC, chọn ngày. Ô công thức được khóa, Google Sheet tự tính lại. |
| **Nhập / xóa dữ liệu** | “＋ Thêm dòng” ghi vào dòng trống đầu tiên và tự kéo công thức. 🗑 xóa nội dung ô nhập nhưng giữ công thức. Mã NVL/CCDC mới được gợi ý tự động theo nhóm. |
| **Bổ sung hạng mục** | “＋ Hạng mục” thêm cột mới vào bên phải bảng trên Sheet. |
| **Hình ảnh** | 📷 ở từng dòng: tải nhiều ảnh, chụp từ điện thoại, ảnh tự nén. Ảnh lưu trong Google Drive, link ghi ở tab `WEB_HINH_ANH`. Có thư viện ảnh lọc theo kho. |
| **Theo dõi từng kho** | Trang riêng cho mỗi kho: chỉ số, biểu đồ nhập/xuất, top xuất 30 ngày, mã cần đặt, giao dịch gần đây, PDA, lịch công việc hôm nay, nút nhập nhanh. Bộ lọc kho ở góc trên lọc mọi bảng. |
| **Đồng bộ** | Thay đổi gửi lên Sheet ngay. Sửa trực tiếp trên Sheet thì web tự cập nhật sau khoảng 20 giây. Mất mạng thì thay đổi được giữ trên máy và tự gửi lại khi có mạng. |
| **Sao lưu tự động** | Bản sao cả file vào Google Drive lúc 23:00 hằng ngày (giữ 30 bản), nút “Sao lưu ngay”, tải bản `.json` hoặc `.xlsx`. Mọi thay đổi từ web ghi vào tab `WEB_NHAT_KY`. |
| **Khác** | Logo và tông màu GHN, giao diện sáng/tối, dùng tốt trên điện thoại, tìm kiếm, sắp xếp, lọc theo cột, phân trang, xuất Excel (CSV), in/PDF, mã truy cập chung. |

---

> **Đã chuyển sang Sheet mới (15/11/2026).** Web giờ trỏ vào Sheet `1SalSle0FPpD5KpBh3gb1ZQK3rKp1wglhaKAlHagUIaY`. `API_URL` cũ (Apps Script gắn với Sheet cũ) đã được gỡ để web không ghi nhầm vào Sheet cũ. Cần làm lại **Bước 1** trên Sheet mới, bằng tài khoản **có quyền chỉnh sửa** Sheet đó (ví dụ chủ sở hữu file), rồi dán URL mới ở **Bước 2**. Thông tin đã lưu trên từng máy (URL, mã truy cập, thay đổi chờ gửi) được tách riêng theo Sheet, nên mỗi máy cần nhập lại mã truy cập một lần.

## Bước 1 · Cài “cầu nối” Google Apps Script (bắt buộc để đồng bộ với Sheet)

Web là trang tĩnh, nên cần một Apps Script gắn vào Sheet để đọc/ghi dữ liệu.

1. Mở Google Sheet (bằng tài khoản có quyền chỉnh sửa) → menu **Tiện ích mở rộng → Apps Script**.
2. Xóa nội dung mặc định trong `Code.gs`, dán toàn bộ nội dung file [`apps-script/Code.gs`](apps-script/Code.gs), rồi bấm 💾 **Lưu**.
3. **Đặt mã truy cập**: trong code, tìm hàm `setPasscode` và đổi `'GHN-M12-2026'` thành mã của nhóm. Chọn hàm `setPasscode` ở thanh công cụ rồi bấm **▶ Chạy**. Lần đầu Google sẽ hỏi quyền: chọn tài khoản → *Nâng cao* → *Đi tới dự án (không an toàn)* → **Cho phép**.
4. **Bật sao lưu tự động**: chọn hàm `setupTriggers` rồi bấm **▶ Chạy**.
5. Bấm **Triển khai → Tùy chọn triển khai mới**. Ở bánh răng ⚙ chọn **Ứng dụng web**, rồi điền:
   - *Thực thi với tư cách*: **Tôi**
   - *Người có quyền truy cập*: **Bất kỳ ai**
6. Bấm **Triển khai** và sao chép **URL ứng dụng web** (dạng `https://script.google.com/macros/s/…/exec`).

> Khi sửa `Code.gs` về sau: **Triển khai → Quản lý tùy chọn triển khai → ✏️ → Phiên bản: Mới → Triển khai**. Cách này giữ nguyên URL.

## Bước 2 · Gắn URL vào web

Có 2 cách:
- **Cho cả nhóm (nên dùng)**: mở `assets/js/config.js`, dán URL vào `API_URL: ''`, rồi đưa code lên GitHub (bước 3).
- **Trên từng máy**: mở web → **Cài đặt & Sao lưu** → dán URL, nhập mã truy cập → **Lưu & kết nối**.

Chưa gắn URL thì web vẫn chạy ở **chế độ ngoại tuyến** với dữ liệu chụp từ Sheet (`assets/js/snapshot.js`). Thay đổi lúc này được lưu trên máy và tự đẩy lên Sheet sau khi kết nối.

---

## Bước 3 · Đưa mã nguồn lên GitHub

### Cách A – Không cần cài gì (kéo thả trên web)

1. Đăng nhập <https://github.com> (chưa có tài khoản thì **Sign up**).
2. Bấm **＋ → New repository**:
   - *Repository name*: `ghn-kho-vat-tu`
   - Chọn **Private** (khuyến nghị, vì dữ liệu nội bộ)
   - Bấm **Create repository**.
3. Ở trang repo mới, bấm **uploading an existing file**.
4. Mở thư mục `ghn-kho-vat-tu` trên máy, chọn **toàn bộ nội dung bên trong** (`index.html`, `assets`, `apps-script`, `README.md`, `vercel.json`, `.gitignore`), rồi kéo thả vào trang GitHub.
   > Kéo phần nội dung bên trong, không kéo cả thư mục `ghn-kho-vat-tu`, để `index.html` nằm ở gốc repo.
5. Bấm **Commit changes**.

### Cách B – Dùng Git (máy đã cài [Git](https://git-scm.com/download/win))

Mở PowerShell hoặc Git Bash trong thư mục `ghn-kho-vat-tu`, rồi chạy lần lượt:

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Khởi tạo web Kho Vật Tư Cụm M12"
```

```bash
git branch -M main
```

```bash
git remote add origin https://github.com/<tai-khoan-github>/ghn-kho-vat-tu.git
```

```bash
git push -u origin main
```

Các lần cập nhật sau:

```bash
git add . && git commit -m "Cập nhật" && git push
```

---

## Bước 4 · Tạo dự án Website trên Vercel

1. Vào <https://vercel.com> → **Sign Up / Log in** → **Continue with GitHub**, rồi cho phép Vercel truy cập repo `ghn-kho-vat-tu`.
2. Bấm **Add New… → Project**. Ở dòng `ghn-kho-vat-tu`, bấm **Import**.
3. Cấu hình:
   - *Framework Preset*: **Other**
   - *Root Directory*: `./`
   - *Build Command*, *Output Directory*: để trống (trang tĩnh, không cần build)
4. Bấm **Deploy**. Khoảng 30 giây sau, bạn có link dạng `https://ghn-kho-vat-tu.vercel.app`.
5. *(Tùy chọn)* Đổi tên miền: **Settings → Domains**, ví dụ `kho-m12.vercel.app` hoặc tên miền riêng.
6. Từ giờ, mỗi lần push lên nhánh `main` (hoặc upload file mới trên GitHub), Vercel tự triển khai lại.

> **Đã có dự án `ghn-kho-vat-tu` trên GitHub/Vercel từ trước?** Không cần tạo lại. Chỉ cần đưa các file đã đổi lên repo cũ: `assets/js/config.js`, `assets/js/app.js`, `assets/js/snapshot.js`, `apps-script/Code.gs`, `README.md` (Cách A: **Add file → Upload files**, kéo thả đúng vào thư mục tương ứng; Cách B: lệnh “Các lần cập nhật sau”). Vercel tự triển khai lại sau khoảng 30 giây.

> Repo private vẫn deploy được trên gói Hobby miễn phí. Ai có link web vẫn phải nhập **mã truy cập** mới xem hoặc sửa được dữ liệu.

---

## Sử dụng hằng ngày

| Việc | Làm ở đâu |
|---|---|
| Ghi nhập / xuất / điều chuyển | Trang kho → **＋ Phiếu nhập / xuất**, hoặc tab *Sổ Nhập – Xuất* → **＋ Thêm dòng** |
| Xem tồn và mã cần đặt | Trang kho, hoặc tab *Tồn kho NVL* (chọn kho ở góc trên để xem riêng) |
| Đặt Min/Max | Tab *Định mức Min / Max*: bấm vào ô Min/Max của kho để nhập |
| Lập kế hoạch đặt hàng | Tab *Kế hoạch NVL theo tháng*: chọn Kho, Tháng, Hệ số ở phần tham số |
| Cấp phát / hư hỏng / thanh lý CCDC | Các tab trong nhóm *CCDC – Tuổi thọ* |
| Lịch công việc từng kho | *Lịch CV – HCM20 / Sóng Thần / Tân Kim*: đổi Tháng/Năm, nhập việc Sáng/Tối, chọn tiến độ |
| Gắn ảnh hiện trường | 📷 ở cuối mỗi dòng |
| Xem ai đã sửa gì | **Nhật ký thay đổi** |

## Cập nhật dữ liệu chụp (không bắt buộc)

`assets/js/snapshot.js` chỉ dùng khi chưa kết nối Apps Script. Khi đã kết nối, web luôn đọc dữ liệu trực tiếp từ Sheet.

## Cấu trúc

```
index.html               # khung trang
assets/css/style.css     # giao diện (tông màu GHN, sáng/tối, responsive)
assets/js/config.js      # API_URL, danh sách kho, mô tả 21 tab
assets/js/app.js         # logic: đồng bộ, bảng sửa trực tiếp, trang kho, ảnh, sao lưu
assets/js/snapshot.js    # dữ liệu chụp từ Sheet (chế độ ngoại tuyến)
assets/img/ghn-logo.png  # logo
apps-script/Code.gs      # backend dán vào Google Apps Script
vercel.json              # cấu hình Vercel
```

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| “Phản hồi không hợp lệ từ Apps Script” | Kiểm tra lúc triển khai đã chọn *Người có quyền truy cập: Bất kỳ ai*, và URL kết thúc bằng `/exec`. |
| Không thấy menu *Tiện ích mở rộng → Apps Script* hoặc không lưu được | Tài khoản đang mở chỉ có quyền xem. Nhờ chủ sở hữu Sheet cấp quyền **Người chỉnh sửa**, hoặc nhờ họ làm Bước 1. |
| URL dạng `script.google.com/a/macros/ghn.vn/...` | Script triển khai trong tài khoản công ty thường chỉ cho người đăng nhập @ghn.vn dùng. Muốn ai có link cũng dùng được thì triển khai từ tài khoản cá nhân sở hữu Sheet (URL dạng `script.google.com/macros/s/...`). |
| “Sai mã truy cập” | Nhập đúng mã đã đặt trong `setPasscode`. Có thể đổi mã bằng cách sửa và chạy lại hàm này. |
| Sửa trên Sheet nhưng web chưa đổi | Bấm ⟳ ở góc trên, hoặc chờ khoảng 20 giây. |
| Ảnh không hiện | Ảnh phải ở chế độ “Bất kỳ ai có đường liên kết”. Script tự đặt chế độ này; nếu Drive của công ty chặn chia sẻ ra ngoài, nhờ IT cho phép. |
| Đã sửa `Code.gs` nhưng web không nhận | Phải triển khai **phiên bản mới** (xem ghi chú ở Bước 1). |

## Làm mới dữ liệu chụp từ Sheet (cho người quản trị)

1. Mở Sheet → **Tệp → Tải xuống → Microsoft Excel (.xlsx)**.
2. Giải nén file `.xlsx` (đổi đuôi thành `.zip` rồi *Extract All*) vào một thư mục, ví dụ `C:\tam\xlsx`.
3. Mở PowerShell trong thư mục `ghn-kho-vat-tu` và chạy:

```bash
powershell -ExecutionPolicy Bypass -File tools/snapshot.ps1 -Dir C:\tam\xlsx -Out assets/js/snapshot.js
```
