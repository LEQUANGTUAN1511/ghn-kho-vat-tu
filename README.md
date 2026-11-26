# GHN · Kho Vật Tư Cụm M12

Trang web quản lý kho vật tư cho 3 kho: **HCM20 · Sóng Thần (ST) · Tân Kim (TK)**. Dữ liệu đọc và ghi trực tiếp vào Google Sheet
[QUẢN LÝ KHO VẬT TƯ CỤM M12](https://docs.google.com/spreadsheets/d/1SalSle0FPpD5KpBh3gb1ZQK3rKp1wglhaKAlHagUIaY/edit).

## Tính năng

| Nhóm | Chi tiết |
|---|---|
| **Đủ các tab của Sheet** | HUONG_DAN, DASHBOARD, QL_TASK, DV_MUA_NGOAI, THONG_KE_PDA, CAP_PHAT_PDA, DM_KHO, DM_NVL, DM_CCDC, SO_NHAP_XUAT, TON_KHO, SO_NX_CCDC, TON_KHO_CCDC, DINH_MUC, KH_NVL_THANG, KH_CCDC_QUY, TAI_SAN_CCDC, HU_HONG, BC_HU_HONG, THANH_LY, KIEM_KE, LICH_EVENT, CHECKLIST_EVENT, LICH_CV_HCM20, LICH_CV_ST, LICH_CV_TK. Tab mới thêm vào Sheet sau này cũng tự hiện trong menu. |
| **Sửa trực tiếp** | Bấm vào ô để sửa (Enter lưu, Esc hủy, Tab sang ô kế). Có dropdown giống trong Sheet, tra mã NVL/CCDC, chọn ngày. Ô công thức được khóa, Google Sheet tự tính lại. |
| **Nhập / xóa dữ liệu** | “＋ Thêm dòng” ghi vào dòng trống đầu tiên và tự kéo công thức. 🗑 xóa nội dung ô nhập nhưng giữ công thức. Mã NVL/CCDC mới được gợi ý tự động theo nhóm. |
| **Bổ sung hạng mục** | “＋ Hạng mục” thêm cột mới vào bên phải bảng trên Sheet. |
| **Hình ảnh** | 📷 ở từng dòng: tải nhiều ảnh, chụp từ điện thoại, ảnh tự nén. Ảnh lưu trong Google Drive, link ghi ở tab `WEB_HINH_ANH`. Có thư viện ảnh lọc theo kho. |
| **Theo dõi từng kho** | Trang riêng cho mỗi kho: chỉ số, biểu đồ nhập/xuất, top xuất 30 ngày, mã cần đặt, giao dịch gần đây, PDA, lịch công việc hôm nay, nút nhập nhanh. Bộ lọc kho ở góc trên lọc mọi bảng. |
| **Đồng bộ** | Thay đổi gửi lên Sheet ngay. Người khác (hoặc ai sửa trực tiếp trên Sheet) thấy sau khoảng 10–20 giây: web hỏi mỗi 10 giây và chỉ tải lại các tab vừa đổi cùng các tab có công thức phụ thuộc. Mất mạng thì thay đổi được giữ trên máy và tự gửi lại khi có mạng. |
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

> **Cập nhật tăng tốc đồng bộ (15/11/2026):** dán lại toàn bộ `Code.gs` mới vào Apps Script → 💾 Lưu → **Triển khai → Quản lý tùy chọn triển khai → ✏️ → Phiên bản: Mới → Triển khai** (giữ nguyên URL). Không cần chạy lại `setPasscode` hay `setupTriggers`. Nếu chưa cập nhật `Code.gs`, web vẫn chạy bình thường nhưng tải lại toàn bộ 22 tab như trước (chậm hơn).

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

## Bản cập nhật V8 (26/11/2026)

**Cách cập nhật (làm 1 lần):**
1. Dán lại `Code.gs` → 💾 Lưu.
2. Chọn hàm **`setupV8`** → ▶ Chạy (tạo tab `NHAP_PDA`, `GANG_TAY`; nếu chưa chạy setupV7 thì tự chạy luôn).
3. **Triển khai → Quản lý tùy chọn triển khai → ✏️ → Phiên bản mới**.
4. Tải lên GitHub: `assets/js/app.js`, `assets/js/config.js`, `assets/css/style.css`, `apps-script/Code.gs`, `README.md`.
5. Kiểm tra: trang *Phân quyền truy cập* → 🔎 *Kiểm tra phiên bản* phải báo **V8**.

| Mục | Thay đổi |
|---|---|
| **Thống kê PDA** | Tab lọc theo tình trạng: **Tốt · Mới hư · Hư** (gồm chờ sửa / đang sửa) **· Thanh lý**. “＋ Thêm dòng” có thêm phần *Nhập máy*: ngày nhập máy + MSNV người nhập (tên lấy từ Danh sách nhân viên; MSNV mới điền tên lần đầu) → lưu ở tab `NHAP_PDA` (*Nhật ký nhập máy PDA*). |
| **Cấp phát PDA** | Danh sách máy lấy thẳng từ Thống kê PDA, chỉ máy tình trạng **Tốt** (đã có từ V7; nay bỏ qua khoảng trắng thừa trong ô tình trạng). |
| **Găng tay bảo hộ** (mới, dưới Nón & áo) | Tab `GANG_TAY`. Cấp phát ban đầu theo bộ phận (1 đôi / người), đổi găng có / không có găng cũ (xanh / đỏ), truy thu bắt buộc khi không có găng cũ, ảnh minh chứng, “Đã cấp x / y” theo bộ phận, cảnh báo **quá 3 tuần chưa đổi** (menu, Tổng quan, trang kho), nhập kho kèm đơn giá, kiểm kê tháng với chênh lệch sổ sách. |
| **Đồng bộ** | Khi dữ liệu mới về, web không còn nhảy về đầu trang / đầu bảng / đầu menu; đang gõ dở, đang tích chọn hoặc đang mở hộp thoại thì chờ xong mới cập nhật. |

## Bản cập nhật V7 (25/11/2026)

**Cách cập nhật (làm 1 lần):**
1. Dán lại `Code.gs` → 💾 Lưu.
2. Chọn hàm **`setupV7`** → ▶ Chạy → xem *Nhật ký thực thi* (tạo tab `DS_NHAN_VIEN`, nạp sẵn những người đã có trong Cấp phát PDA / nón áo).
3. **Triển khai → Quản lý tùy chọn triển khai → ✏️ → Phiên bản mới**.
4. Tải lên GitHub: `assets/js/app.js`, `assets/js/config.js`, `assets/css/style.css`, `apps-script/Code.gs`, `README.md`.
5. Kiểm tra: trang *Phân quyền truy cập* → 🔎 *Kiểm tra phiên bản* phải báo **V7**.

| Mục | Thay đổi |
|---|---|
| **Danh sách nhân viên** (Danh mục) | Tab `DS_NHAN_VIEN`: Họ tên, MSNV, Bộ phận, Kho, SĐT, Trạng thái. Ban đầu trống cũng được – cấp PDA cho người mới thì web tự lưu; lần sau gõ MSNV / tên là chọn. Có “Thêm nhiều” (dán từ Excel), xuất Excel, cột *Đang giữ PDA* và *Lượt PDA 30 ngày*. |
| **Cấp phát PDA dạng danh sách** | Chỉ hiện máy **TỐT**, chia *Đã cấp phát* / *Trong kho*. Gõ MSNV vào ô Người nhận → Enter là cấp. Trả nhanh “✓ Trả”, “⚠ Trả có lỗi”, hoặc tích chọn nhiều máy để nhận lại cuối ca. Bảng gốc vẫn xem được qua “⚙ Bảng gốc”. |
| **Lịch sử & tần suất** | Mỗi lượt cấp vẫn là 1 dòng ở `CAP_PHAT_PDA` (lịch sử). Tab *Lịch sử cấp PDA* (lọc tuần / tháng / bộ phận, xuất Excel) và *Tần suất theo bộ phận*: lượt lấy PDA của **Sort** và **In/out** theo tuần / tháng, trung bình / ngày, biểu đồ theo ngày, top nhân viên, sao chép báo cáo. |

## Bản cập nhật V6 (22/11/2026)

**Cách cập nhật (làm 1 lần):**
1. Dán lại `Code.gs` → 💾 Lưu.
2. Chọn hàm **`setupV6`** → ▶ Chạy → xem *Nhật ký thực thi*. Dòng đầu cho biết Sheet dùng dấu `,` hay `;`.
3. **Triển khai → Quản lý tùy chọn triển khai → ✏️ → Phiên bản mới**.
4. Tải lên GitHub: `assets/js/app.js`, `assets/js/config.js`, `assets/css/style.css`, `apps-script/Code.gs`, `README.md`.
5. Kiểm tra: trang *Phân quyền truy cập* → 🔎 *Kiểm tra phiên bản* phải báo **V6**.

**Nội dung:**

| Mục | Thay đổi |
|---|---|
| **Sửa #ERROR!** | Nguyên nhân thật: Sheet đặt vùng Việt Nam nên công thức phải ngăn cách bằng `;`. Apps Script giờ tự thử dấu ngăn cách của Sheet rồi ghi lại mọi công thức do web tạo: Tồn kho NVL, Sổ / Tồn kho CCDC, Cấp phát PDA, Dịch vụ mua ngoài. Web cũng không còn hiện các dòng trống chỉ chứa lỗi công thức. |
| **Thống kê PDA** | Thêm cột K **Dự kiến sửa xong**. Tình trạng thêm **CHỜ THANH LÝ / ĐÃ THANH LÝ** (giữ các lựa chọn cũ). |
| **Báo cáo PDA** | Mỗi máy hư / đang sửa hiện **ngày hư, ngày gửi sửa, dự kiến sửa xong** (trễ thì tô đỏ, có đếm ở ô chỉ số). Thêm **Danh mục thanh lý PDA**: Máy hư → *Đề xuất thanh lý* → *Đã thanh lý* (có *Hủy đề xuất*), có nút *Sao chép danh mục*. Máy đã thanh lý không tính vào tổng. |
| **Nón bảo hộ & áo phản quang** | Đổi sang dạng **danh sách** (tab `DS_BHLD`): mỗi chiếc 1 dòng, mã tự đánh khi thêm hàng loạt (NON-20-001, AO-ST-001…). Nhân viên nhận → **chỉ cần gõ tên** (hoặc MSNV) vào ô *Người đang giữ*; MSNV và ngày nhận tự điền. Thu hồi = nút *Thu hồi*. Đổi tình trạng Tốt / Cũ / Hư / Mất ngay trên dòng. Tab cấp phát theo lượt cũ: xóa nếu chưa có dữ liệu, nếu có thì giữ ở tab ẩn `CAP_PHAT_BHLD_CU`. |

## Bản cập nhật V5 (20/11/2026)

**Cách cập nhật (làm 1 lần):**
1. Dán lại `Code.gs` → 💾 Lưu.
2. Chọn hàm **`setupV5`** → ▶ Chạy → xem *Nhật ký thực thi*. Chạy lại nhiều lần vẫn an toàn.
3. **Triển khai → Quản lý tùy chọn triển khai → ✏️ → Phiên bản mới**.
4. Tải lên GitHub: `assets/js/app.js`, `assets/js/config.js`, `assets/css/style.css`, `apps-script/Code.gs`, `README.md`.
5. Kiểm tra: trang *Phân quyền truy cập* → 🔎 *Kiểm tra phiên bản* phải báo **V5**.

`setupV5` làm các việc sau:
- **Sửa ô #ERROR!** ở Tồn kho NVL (Đơn giá, Giá trị tồn), Cấp phát PDA (Tên thiết bị), Sổ / Tồn kho CCDC, Dịch vụ mua ngoài. Nguyên nhân: công thức bản trước viết dạng R1C1, nay đã đổi sang dạng A1 thông thường.
- **Sổ Nhập – Xuất NVL / CCDC:** cột Đơn giá thành công thức, luôn lấy theo danh mục. Cột "Bộ phận / kho đối ứng" thành dropdown thêm / bớt được trên web.
- **Thống kê PDA:** cột A (STT) đổi thành **Số máy PDA**. Máy chưa có số được điền sẵn theo kho (PDA-20-01…, PDA-ST-01…, PDA-TK-01…), **cần sửa lại theo nhãn thật dán trên máy** nếu khác.
- **Cấp phát PDA:** bỏ giờ cấp / giờ trả, thêm *Tình trạng khi cấp*, MSNV đứng trước Người nhận. Dữ liệu cũ được chuyển sang; bản cũ giữ ở tab ẩn `CAP_PHAT_PDA_CU`.
- **Tạo tab `CAP_PHAT_BHLD`:** theo dõi nón bảo hộ & áo phản quang.

**Thay đổi trên web:**

| Mục | Nội dung |
|---|---|
| Menu | Theo dõi từng kho → Dành cho Quản lý → Danh mục (GĐ1) → Nhập – Xuất – Tồn (GĐ2) → CCDC – Tuổi thọ (GĐ3) → **Công việc hàng ngày (GĐ4)** → Thiết bị (GĐ5) → Định mức & Kế hoạch (GĐ6) → Event (GĐ7) → Hệ thống. Bỏ *Danh mục Kho* và nhóm *Khác*; *Hướng dẫn sử dụng* chuyển vào Danh mục và được viết lại. |
| Tồn kho NVL / CCDC | **Tồn đầu** (chốt 7:00) · **Nhập trong tháng** (+ nhập hôm nay) · **Xuất hôm nay** · **Xuất trong tháng** · **Tồn cuối** = Tồn đầu + Nhập hôm nay − Xuất hôm nay · Tồn min · Trạng thái · Giá trị tồn. Có tab lọc Cần đặt / Có xuất hôm nay / Hết hàng; bảng gốc (nhập Tồn đầu kỳ) mở bằng "⚙ Bảng gốc". |
| Sổ Nhập – Xuất | Bỏ Số phiếu và ô Đơn giá khỏi form. Ngày tự điền hôm nay. Nhập MSNV thì tên người nhận tự điền và ngược lại; người mới được ghi nhớ sau lần lưu đầu. |
| Công việc hàng ngày | Lịch CV 3 kho + **Nón bảo hộ & áo phản quang** (cấp – nhận lại, cảnh báo chưa trả). |
| Thiết bị | Thống kê PDA hiện **Số máy PDA** thay cột #. Cấp phát nhập số máy hoặc IMEI. Thêm trang **Báo cáo PDA** (theo kho, nút *Sao chép báo cáo* để gửi nhóm). |

## Bản cập nhật V2: Đơn giá – Thành tiền · CCDC · Cấp phát PDA

### Cách cập nhật (làm 1 lần)
1. Apps Script: dán lại toàn bộ `Code.gs` → 💾 **Lưu**.
2. Ở thanh công cụ, chọn hàm **`setupV2`** → **▶ Chạy**. Xem kết quả ở *Nhật ký thực thi*. Chạy lại nhiều lần vẫn an toàn: phần nào đã có thì bỏ qua, ô tiêu đề nào đang có dữ liệu khác thì không ghi đè. Hàm này:
   - thêm cột **Đơn giá (N)** và **Thành tiền (O)** vào `SO_NHAP_XUAT`;
   - thêm **Đơn giá + Giá trị tồn từng kho + Tổng giá trị tồn (V–Z)** vào `TON_KHO`;
   - tạo tab `SO_NX_CCDC`, `TON_KHO_CCDC`, `CAP_PHAT_PDA` (và `QL_TASK` nếu chưa có), kèm công thức và dropdown;
   - bổ sung mục mới vào tab `HUONG_DAN`.
3. **Triển khai → Quản lý tùy chọn triển khai → ✏️ → Phiên bản: Mới → Triển khai**.
4. Tải lên GitHub: `assets/js/app.js`, `assets/js/config.js`, `assets/css/style.css`, `apps-script/Code.gs`, `README.md`. Mở web, nhấn **Ctrl + F5**.

### Nội dung
| Hạng mục | Chi tiết |
|---|---|
| **Đơn giá – Thành tiền (NVL)** | Chọn mã xong, web tự điền Đơn giá theo DM_NVL (sửa được). Để trống thì Sheet lấy giá danh mục. Thành tiền = SL × Đơn giá. Cuối bảng có tổng Thành tiền theo bộ lọc đang xem. |
| **Giá trị tồn (NVL)** | Tồn kho NVL có thêm Đơn giá, Giá trị tồn từng kho (hiện theo bộ lọc kho) và Tổng. |
| **Sổ Nhập – Xuất CCDC** | Cách ghi giống sổ NVL, thêm loại **Thu hồi nhập kho**. Có kiểm tra thiếu dữ liệu / sai mã, Đơn giá – Thành tiền. |
| **Tồn kho CCDC** | Tự tính theo từng kho từ sổ CCDC. Chỉ nhập *Tồn đầu*. Có Giá trị tồn và cột *Đang sử dụng* (lấy từ Sổ tài sản CCDC). |
| **Cấp phát PDA hằng ngày** | Menu *Thiết bị & Lịch CV*. Có các chỉ số trong ngày; danh sách máy đang mượn với nút **↩ Trả máy**; **＋ Cấp máy** tự điền ngày, ca, giờ; cảnh báo khi máy đang được người khác mượn hoặc không ở tình trạng TỐT; khi trả máy hư, có thể cập nhật Thống kê PDA thành MỚI HƯ; máy quá hạn trả được cảnh báo ở Tổng quan và trang kho. |
| **Hướng dẫn** | Trang *Hướng dẫn sử dụng* trên web có thêm 3 mục: Nhập – Xuất – Tồn NVL/CCDC, Cấp phát PDA, Task. Tab HUONG_DAN trên Sheet được bổ sung khi chạy `setupV2`. |

Lưu ý:
- **Danh mục NVL và CCDC hiện chưa có đơn giá** (cột *Đơn giá (VNĐ)* đang trống), nên Thành tiền và Giá trị tồn sẽ bằng 0 cho tới khi nhập giá vào danh mục hoặc nhập đơn giá trên từng phiếu.
- Giá trị tồn tính theo **đơn giá danh mục hiện tại**, không phải bình quân gia quyền / FIFO.
- Cột *Trạng thái* trong `CAP_PHAT_PDA` dùng công thức `TODAY()`. Trang web tự tính lại trạng thái quá hạn mỗi lần mở, nên luôn đúng theo ngày.
- Để tra được IMEI khi cấp máy, mỗi máy phải khai báo trước ở **Thống kê PDA** (kho, IMEI, tên thiết bị, tình trạng).

### Bổ sung V3: Bảng tổng hợp PDA tự thêm thiết bị (18/11/2026)
- **Vấn đề cũ:** Bảng tổng hợp PDA trên Sheet (vùng L4:P10) chỉ có 2 cột cố định là Seuic Autoid Q9 và Honeywell EDA51, nên thiết bị mới (ví dụ DT50S) không được đếm.
- **Cách cập nhật:** dán lại `Code.gs` → 💾 Lưu → chọn hàm **`setupV3`** → ▶ Chạy → triển khai **Phiên bản mới**. Hàm này:
  - thêm cột cho mọi thiết bị có trong dropdown "Tên thiết bị" hoặc đã nhập ở bảng chính, và chép công thức từ cột bên cạnh;
  - sửa dòng "Số lượng thiết bị (theo kho chọn)" để cộng đủ tất cả các cột;
  - cho cột Tên thiết bị ở CAP_PHAT_PDA nhận IMEI có hoặc không có chữ "IMEI:" phía trước.
- **Về sau:** mỗi lần thêm thiết bị mới qua web (dropdown hoặc nhập dòng), cột tổng hợp được thêm tự động. Nếu thêm thiết bị bằng cách sửa trực tiếp trên Sheet, chạy lại `setupV3`.
- **Giao diện:** bảng dùng chữ số đều nhau; số và tiêu đề cột số cùng căn phải; cột tự tính chỉ có nền xám (bỏ chữ nghiêng); mũi tên sắp xếp chỉ hiện khi rê chuột; dòng TỔNG in đậm.

## Dành cho Quản lý · Task

Menu **Dành cho Quản lý → Task**. Dữ liệu nằm ở tab `QL_TASK` của Google Sheet. Apps Script tự tạo tab này khi có task đầu tiên; muốn tạo sẵn thì chạy hàm `setupTaskSheet` một lần.

**Cập nhật lên web đang chạy:** dán lại `Code.gs` → 💾 Lưu → triển khai **Phiên bản mới**, rồi tải lên GitHub: `assets/js/app.js`, `assets/js/config.js`, `assets/css/style.css`, `apps-script/Code.gs`.

| Tính năng | Chi tiết |
|---|---|
| Bắt buộc 3 thông tin | Tiêu đề, **Người phụ trách**, **Hạn chót**. Thiếu thì web không cho lưu. Task nhập thẳng trên Sheet mà thiếu thì bị đánh dấu “Dễ bị sót”. |
| Xếp theo hạn | Quá hạn → Hôm nay → Ngày mai → 7 ngày tới → Sau đó → Chưa có hạn → Đã xong. Có thể nhóm theo người phụ trách, kho, trạng thái, ưu tiên. |
| Cảnh báo | Số task quá hạn + đến hạn hôm nay hiện ở menu; dải cảnh báo ở **Tổng quan** và **trang từng kho**. |
| Checklist con | Mỗi task chia thành các bước, tick từng bước, % hoàn thành hiện ngay ở danh sách. Hoàn thành khi còn bước chưa xong sẽ được hỏi lại. |
| Hoàn thành nhanh | Bấm vòng tròn ở đầu task. Tự ghi ngày hoàn thành; tỷ lệ đúng hạn tính theo tháng. |
| Bằng chứng | Mỗi task có phần ảnh (chụp từ điện thoại), lưu Google Drive như các tab khác. |
| Lọc | Cần làm · Của tôi (theo tên đăng nhập) · Quá hạn · Hôm nay · 7 ngày tới · Đã xong · Tất cả; tìm cả trong checklist; bộ lọc kho ở góc trên (task “Chung” luôn hiện). |

### Thói quen để không bỏ sót task
1. **Việc gì cũng thành task**, kể cả việc giao miệng hay qua Zalo: nhập ngay lúc nhận, chưa rõ hạn thì đặt tạm “+3 ngày”.
2. **Một task chỉ một người phụ trách.** Nhiều người cùng làm thì chia thành checklist hoặc nhiều task.
3. **Hạn chót là ngày phải xong**, không phải ngày bắt đầu. Việc lớn thì chia thành các bước trong checklist.
4. **Đầu ngày (5 phút):** mở tab *Quá hạn* và *Hôm nay*, xử lý hoặc dời hạn kèm ghi chú lý do. Đừng để task quá hạn mà không ai biết.
5. **Cuối tuần (15 phút):** nhóm theo *Người phụ trách*, rà tab *7 ngày tới* và mục *Dễ bị sót*; đóng hoặc hủy task không còn cần.
6. **“Chờ duyệt”** dùng khi người làm đã xong và đang chờ quản lý kiểm tra; quản lý duyệt xong mới chuyển sang **Hoàn thành**.

## Dành cho Quản lý · Dịch vụ mua ngoài

Dùng để mua CCDC không có trong hệ thống kho, hoặc thuê dịch vụ nhà cung cấp (vệ sinh máy lạnh, xịt côn trùng, sửa chữa nhà vệ sinh…). Dữ liệu nằm ở tab `DV_MUA_NGOAI`, tab này được tạo khi có yêu cầu đầu tiên hoặc khi chạy `setupV3`.

**Cập nhật lên web đang chạy:** dán lại `Code.gs` → 💾 Lưu → chạy **`setupV3`** (tạo tab và thêm mục vào HUONG_DAN) → triển khai **Phiên bản mới**. Sau đó tải lên GitHub: `assets/js/app.js`, `assets/js/config.js`, `assets/css/style.css`, `apps-script/Code.gs`.

| Phần (thứ tự hiển thị) | Thông tin |
|---|---|
| ① Thông tin yêu cầu | Mã (tự sinh DV26-001…), ngày yêu cầu, kho, loại (Dịch vụ / CCDC ngoài hệ thống / Sửa chữa / Khác), mức độ, **nội dung**, chi tiết / số lượng, **bộ phận yêu cầu**, người yêu cầu |
| ② Người thực hiện & tiến độ | **Người thực hiện**, tiến độ hiện tại, nút chuyển bước |
| ③ Timeline dự kiến | Bắt đầu dự kiến, **hoàn thành dự kiến**, hoàn thành thực tế |
| ④ Nhà cung cấp & chi phí | Nhà cung cấp, chi phí dự kiến, chi phí thực tế, chứng từ / số phiếu |
| ⑤ Giải trình | Bắt buộc khi quá hạn, xong trễ, vượt chi phí, từ chối hoặc hủy |

**Tiến độ:** Đang báo giá → Chờ duyệt → Đã duyệt → Đang thực hiện → Chờ nghiệm thu → Hoàn thành (hoặc dừng ở Từ chối / Hủy).
- Trong chi tiết yêu cầu có nút chuyển sang bước kế tiếp.
- Duyệt / Từ chối tự ghi ngày duyệt và người duyệt; Bắt đầu thực hiện tự ghi ngày bắt đầu; Nghiệm thu tự ghi ngày hoàn thành.
- Từ bước *Chờ duyệt* trở đi bắt buộc có người duyệt.

**Theo dõi:**
- Chỉ số: đang xử lý (tổng giá trị), chờ duyệt, quá hạn timeline, thiếu giải trình, hoàn thành trong tháng (% đúng hạn, chi phí).
- Tab lọc nhanh; nhóm theo tiến độ / kho / bộ phận / người xử lý / loại; đính kèm ảnh báo giá, hiện trường, nghiệm thu.
- Menu và trang Tổng quan / trang kho báo số yêu cầu quá hạn và chờ duyệt.
- Cột *Tình trạng hạn* trên Sheet tự tính (Trong hạn / Sắp đến hạn / QUÁ HẠN n ngày / Đúng hạn / Trễ n ngày).

## Hệ thống · Phân quyền truy cập (V4)

**Cập nhật (làm 1 lần):** dán lại `Code.gs` → 💾 Lưu → chọn hàm **`setupV4`** → ▶ Chạy → triển khai **Phiên bản mới**. Sau đó tải lên GitHub: `index.html`, `assets/js/app.js`, `assets/js/config.js`, `assets/css/style.css`, `apps-script/Code.gs`.

`setupV4` làm 2 việc:
- tạo tab ẩn `WEB_PHAN_QUYEN` (danh sách tài khoản);
- đổi tên cột ở `DV_MUA_NGOAI`: "Người xử lý" → **Người thực hiện**, "Người duyệt" → **Người duyệt yêu cầu**.

**Cấp quyền:** đăng nhập bằng mã chung (Quản trị) → menu **Hệ thống → Phân quyền truy cập** → **＋ Thêm tài khoản**. Nhập họ tên, bộ phận, chọn vai trò, đánh dấu *Người duyệt yêu cầu* nếu cần → **Lưu** → gửi mã truy cập riêng cho từng người.

| Quyền | Người xem | Người chỉnh sửa | Người duyệt yêu cầu* | Quản trị |
|---|:-:|:-:|:-:|:-:|
| Xem dữ liệu, báo cáo, tải Excel | ✓ | ✓ | ✓ | ✓ |
| Thêm / sửa / xóa dữ liệu, tải ảnh | — | ✓ | — | ✓ |
| Sửa dropdown, thêm mã NVL / CCDC | — | ✓ | — | ✓ |
| Tạo, cập nhật Task và Dịch vụ mua ngoài | — | ✓ | — | ✓ |
| Duyệt / Từ chối (Dành cho Quản lý) | — | — | ✓ | ✓ |
| Sao lưu ngay | — | ✓ | — | ✓ |
| Quản lý phân quyền | — | — | — | ✓ |

\* *Người duyệt yêu cầu* là quyền **cộng thêm**, gắn cho tài khoản Người xem hoặc Người chỉnh sửa.

**Lưu ý:**
- **Kiểm tra ở máy chủ:** Apps Script kiểm tra quyền trên máy chủ, nên sửa giao diện cũng không vượt quyền được.
- **Mã không lộ ra ngoài:** tab `WEB_PHAN_QUYEN` được ẩn và không bao giờ gửi về web, trừ cho Quản trị ở trang Phân quyền.
- **Nhật ký đúng người:** tên ghi trong Nhật ký thay đổi lấy theo tài khoản, không theo tên tự gõ.
- **Giữ kín mã chung:** sau khi cấp mã riêng cho mọi người, nên đổi mã chung (sửa và chạy lại `setPasscode`) và chỉ Quản trị giữ.
- **Người đang dùng mã chung:** vẫn đăng nhập được với quyền Quản trị cho tới khi bạn đổi mã chung.

### Dịch vụ mua ngoài: tách Người thực hiện và Người duyệt
Form chi tiết giờ có 6 phần: ① Thông tin yêu cầu · ② **Người thực hiện & tiến độ** · ③ Timeline · ④ Nhà cung cấp & chi phí · ⑤ **Phê duyệt** · ⑥ Giải trình.

- **Người thực hiện** dùng các nút trong phần ②: Gửi duyệt → (sau khi được duyệt) Bắt đầu thực hiện → Bàn giao – chờ nghiệm thu → Nghiệm thu – Hoàn thành; Hủy / Mở lại.
- **Người duyệt yêu cầu** dùng nút ✓ Duyệt / ✕ Từ chối trong phần ⑤. Nút này chỉ hiện với tài khoản có quyền duyệt; người khác thấy dòng "Đang chờ … duyệt". Ngày duyệt được ghi tự động.
- Bị từ chối thì người thực hiện có nút **Gửi duyệt lại**.
- Task đang "Chờ duyệt" cũng chỉ Người duyệt yêu cầu mới bấm **Duyệt hoàn thành** được.

## Thêm / bớt lựa chọn dropdown và mã NVL, CCDC

**Cập nhật lên web đang chạy:** dán lại `Code.gs` → 💾 Lưu → triển khai **Phiên bản mới**, rồi tải lên GitHub `assets/js/app.js` và `assets/css/style.css`.

| Ở đâu | Cách dùng |
|---|---|
| Mọi dropdown lấy từ Sheet (Tên thiết bị, Tình trạng, Loại giao dịch, Trạng thái checklist…) | Mở dropdown → cuối danh sách có **＋ Thêm lựa chọn mới…** và **⚙ Sửa / xóa danh sách…** (đổi thứ tự, bỏ lựa chọn). Dùng được cả trong form “Thêm dòng” lẫn khi sửa trực tiếp trong ô. Apps Script cập nhật dropdown của cột đó trên Google Sheet, máy khác thấy sau ~10–20 giây. |
| Ô **Mã NVL / Mã CCDC** trong các phiếu | Nút **＋ Mã NVL (CCDC) mới**: chọn nhóm → mã tự sinh → nhập tên, ĐVT, đơn giá → ghi vào DM_NVL / DM_CCDC và điền luôn vào phiếu. Nút **⚙ Danh mục**: đánh dấu **Ngừng dùng / Dùng lại**. |
| Trang **Danh mục NVL / CCDC** | Nút **⚙ Đang dùng / Ngừng dùng** trên thanh công cụ. |

Lưu ý:
- **Bỏ lựa chọn không xóa dữ liệu:** các dòng đã nhập giá trị cũ vẫn giữ nguyên (Google Sheet sẽ hiện tam giác cảnh báo ở ô đó).
- **Mã NVL/CCDC không xóa hẳn mà chuyển "Ngừng dùng"**, vì Tồn kho, Định mức, Kế hoạch và lịch sử nhập/xuất đều tham chiếu theo mã. Mã ngừng dùng bị ẩn khỏi gợi ý khi nhập phiếu, nhưng vẫn có trong báo cáo. Lần đầu dùng, web tự thêm cột **"Trạng thái sử dụng"** vào DM_NVL / DM_CCDC.
- **Cột mã kho** (HCM20/ST/TK) không cho sửa danh sách, vì mã kho dùng xuyên suốt các công thức.
- **Bảng tổng hợp có công thức theo tên** (ví dụ cột *Seuic Autoid Q9 / Honeywell EDA51* trong bảng tổng hợp PDA) không tự thêm cột cho lựa chọn mới. Cần thêm cột công thức trên Sheet nếu muốn thống kê riêng thiết bị mới.
- **Giới hạn số mã:** Tồn kho / Định mức / Kế hoạch NVL hiện có công thức sẵn đến khoảng dòng 154 (khoảng 150 mã NVL). Vượt mức đó thì kéo công thức các tab này xuống thêm trên Sheet.

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
| Sửa trên Sheet nhưng web chưa đổi | Bấm ⟳ ở góc trên, hoặc chờ khoảng 10–20 giây. |
| Ảnh không hiện | Ảnh phải ở chế độ “Bất kỳ ai có đường liên kết”. Script tự đặt chế độ này; nếu Drive của công ty chặn chia sẻ ra ngoài, nhờ IT cho phép. |
| Đã sửa `Code.gs` nhưng web không nhận | Phải triển khai **phiên bản mới** (xem ghi chú ở Bước 1). |

## Làm mới dữ liệu chụp từ Sheet (cho người quản trị)

1. Mở Sheet → **Tệp → Tải xuống → Microsoft Excel (.xlsx)**.
2. Giải nén file `.xlsx` (đổi đuôi thành `.zip` rồi *Extract All*) vào một thư mục, ví dụ `C:\tam\xlsx`.
3. Mở PowerShell trong thư mục `ghn-kho-vat-tu` và chạy:

```bash
powershell -ExecutionPolicy Bypass -File tools/snapshot.ps1 -Dir C:\tam\xlsx -Out assets/js/snapshot.js
```
