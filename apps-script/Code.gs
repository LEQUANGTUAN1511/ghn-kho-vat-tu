/**
 * GHN – QUẢN LÝ KHO VẬT TƯ CỤM M12 · Backend Google Apps Script
 * -------------------------------------------------------------
 * Gắn script này vào chính file Google Sheet (Tiện ích mở rộng → Apps Script),
 * rồi Triển khai → Ứng dụng web (Execute as: Me · Who has access: Anyone).
 *
 * Web đọc/ghi trực tiếp vào các tab của Sheet:
 *  - Ô có công thức KHÔNG bao giờ bị ghi đè (trừ ô tham số được phép).
 *  - Thêm dòng: điền vào dòng trống đầu tiên, tự kéo công thức từ dòng trên.
 *  - Xóa dòng: chỉ xóa nội dung các ô nhập, giữ công thức.
 *  - Hình ảnh: lưu vào thư mục Google Drive, link ghi ở tab WEB_HINH_ANH.
 *  - Nhật ký: mọi thay đổi ghi ở tab WEB_NHAT_KY.
 *  - Sao lưu: tạo bản sao file vào thư mục Drive (tự động hằng ngày nếu chạy setupTriggers).
 */

var CFG = {
  SPREADSHEET_ID: '1SalSle0FPpD5KpBh3gb1ZQK3rKp1wglhaKAlHagUIaY',
  IMAGE_FOLDER: 'GHN Kho Vat Tu - Hinh anh',
  BACKUP_FOLDER: 'GHN Kho Vat Tu - Sao luu',
  BACKUP_KEEP: 30,          // giữ 30 bản sao lưu gần nhất
  IMG_SHEET: 'WEB_HINH_ANH',
  LOG_SHEET: 'WEB_NHAT_KY',
  DV_ROWS: 60,              // đọc dropdown trong 60 dòng đầu mỗi tab
  TZ: 'Asia/Ho_Chi_Minh'
};

// Ô tham số có công thức mặc định nhưng người dùng được phép ghi đè (ví dụ "Tháng kế hoạch")
var PARAM_OVERRIDE = {
  KH_NVL_THANG: ['B4'],
  KH_CCDC_QUY: ['B4']
};

/* ============================ HTTP ============================ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  return handle_(p.action || 'all', p);
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out_({ ok: false, error: 'JSON không hợp lệ' }); }
  return handle_(body.action, body);
}

/* Thao tác ghi (người xem bị chặn) và thao tác chỉ dành cho Quản trị */
var WRITE_ACTIONS = ['update', 'append', 'appendMany', 'clearRow', 'addColumn', 'upload', 'deleteImage', 'setList', 'backup'];
var ADMIN_ACTIONS = ['users', 'saveUser', 'deleteUser'];

var SERVER_VERSION = 'V8';   // web dùng để kiểm tra đã "Triển khai phiên bản mới" chưa

function handle_(action, p) {
  try {
    // Kiểm tra phiên bản – không cần mã truy cập, không trả dữ liệu nào khác
    if (action === 'version') return out_({ ok: true, server: SERVER_VERSION });
    var me = auth_(p.key, p.user);
    p.user = me.name || p.user;           // nhật ký ghi theo tên tài khoản (không tự khai)
    p._me = me;
    if (WRITE_ACTIONS.indexOf(action) >= 0 && me.role === 'viewer' && !approvalOnly_(action, p, me))
      throw new Error('PERM: Tài khoản của bạn chỉ có quyền xem');
    if (ADMIN_ACTIONS.indexOf(action) >= 0 && me.role !== 'admin')
      throw new Error('PERM: Chỉ Quản trị mới quản lý phân quyền truy cập');
    var res;
    switch (action) {
      case 'whoami': res = { ok: true }; break;
      case 'users': res = { ok: true, users: listUsers_() }; break;
      case 'saveUser': res = userLock_(function () { return saveUser_(p); }); break;
      case 'deleteUser': res = userLock_(function () { return deleteUser_(p); }); break;
      case 'ping': res = { ok: true, rev: rev_(), title: ss_().getName() }; break;
      // since = số phiên bản web đang có → trả thêm danh sách tab cần tải lại (null = tải lại toàn bộ)
      case 'rev':
        var ch = p.since ? changedSince_(p.since) : null;
        res = { ok: true, rev: rev_(), sheets: ch ? ch.sheets : null, dvSheets: ch ? ch.dv : [] };
        break;
      case 'setList': res = withLock_(function () { return setList_(p); }, p.sheet + '|dv'); break;
      case 'all': res = getAll_(p.sheets, p.nodv === '1' || p.nodv === 1 || p.nodv === true); break;
      case 'update': res = withLock_(function () { return update_(p); }, p.sheet); break;
      case 'append': res = withLock_(function () { return append_(p); }, p.sheet); break;
      case 'appendMany': res = withLock_(function () { return appendMany_(p); }, p.sheet); break;
      case 'clearRow': res = withLock_(function () { return clearRow_(p); }, p.sheet); break;
      case 'addColumn': res = withLock_(function () { return addColumn_(p); }, p.sheet); break;
      case 'upload': res = withLock_(function () { return upload_(p); }, CFG.IMG_SHEET); break;
      case 'deleteImage': res = withLock_(function () { return deleteImage_(p); }, CFG.IMG_SHEET); break;
      case 'backup': res = { ok: true, backup: backupNow() }; break;
      case 'backups': res = { ok: true, backups: listBackups_() }; break;
      case 'log': res = { ok: true, log: readLog_(Number(p.limit) || 300) }; break;
      default: res = { ok: false, error: 'Hành động không hợp lệ: ' + action };
    }
    if (res && typeof res === 'object') { res.me = { name: me.name, role: me.role, approver: !!me.approver, master: !!me.master }; res.server = SERVER_VERSION; }
    return out_(res);
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* Bộ nhớ đệm của script: web hỏi "có gì mới không" mỗi 10 giây, nên đọc từ đây
 * thay vì PropertiesService (có hạn mức đọc/ghi mỗi ngày). */
var CACHE_TTL = 21600; // 6 giờ – tối đa cho phép
function cache_() { return CacheService.getScriptCache(); }

/* ============================ PHÂN QUYỀN TRUY CẬP ============================
 * - Mã chung (APP_PASSCODE, đặt bằng setPasscode) = Quản trị: toàn quyền + phân quyền.
 * - Mỗi người có Mã truy cập riêng ở tab WEB_PHAN_QUYEN (tab ẩn, web không tải về):
 *     Vai trò: Người xem / Người chỉnh sửa / Quản trị
 *     Người duyệt yêu cầu (Quản lý): Có / Không → được Duyệt / Từ chối ở mục Dành cho Quản lý
 * - Kiểm tra quyền ở đây (máy chủ), không phụ thuộc giao diện web. */
var USERS_SHEET = 'WEB_PHAN_QUYEN';
var USER_HEAD = ['Họ tên', 'Bộ phận', 'Mã truy cập', 'Vai trò', 'Người duyệt yêu cầu (Quản lý)', 'Trạng thái', 'Ghi chú', 'Cập nhật lần cuối'];
var ROLE_NAMES = { viewer: 'Người xem', editor: 'Người chỉnh sửa', admin: 'Quản trị' };
// Cột được phép ghi khi duyệt (dành cho Người duyệt có vai trò Người xem)
var APPROVAL_COLS = { DV_MUA_NGOAI: [11, 12, 13, 20, 23], QL_TASK: [10, 12, 13, 14] };

function masterPass_() {
  var c = cache_(), pass = c.get('PASS');
  if (pass === null) { pass = PropertiesService.getScriptProperties().getProperty('APP_PASSCODE') || ''; c.put('PASS', pass, 600); }
  return pass;
}

function roleKey_(s) {
  s = String(s || '').toLowerCase();
  if (/quản trị|admin/.test(s)) return 'admin';
  if (/chỉnh sửa|sửa|edit/.test(s)) return 'editor';
  return 'viewer';
}

/** Bảng mã → tài khoản (lưu đệm 5 phút) */
function usersMap_() {
  var c = cache_(), s = c.get('USERS');
  if (s) { try { return JSON.parse(s); } catch (e) {} }
  var map = {}, sh = ss_().getSheetByName(USERS_SHEET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, USER_HEAD.length).getValues().forEach(function (r) {
      var pin = String(r[2] || '').trim().toUpperCase();
      if (!pin || !String(r[0]).trim()) return;
      map[pin] = { name: String(r[0]).trim(), dept: String(r[1] || ''), role: roleKey_(r[3]),
        approver: /^(có|x|yes|true|✓)$/i.test(String(r[4]).trim()), active: !/khóa|khoá|ngừng/i.test(String(r[5])) };
    });
  }
  c.put('USERS', JSON.stringify(map), 300);
  return map;
}

function auth_(key, typedName) {
  key = String(key || '').trim();
  var pass = masterPass_();
  if (pass && key === pass) return { name: String(typedName || '').trim() || 'Quản trị', role: 'admin', approver: true, master: true };
  var u = key ? usersMap_()[key.toUpperCase()] : null;
  if (u) {
    if (!u.active) throw new Error('AUTH: Tài khoản đã bị khóa – liên hệ Quản trị');
    return { name: u.name, role: u.role, approver: u.approver, dept: u.dept };
  }
  if (!pass) return { name: String(typedName || '').trim(), role: 'admin', approver: true, master: true };   // chưa đặt mã chung
  throw new Error('AUTH: Sai mã truy cập');
}

/** Người duyệt có vai trò Người xem: chỉ cho phép thao tác duyệt / từ chối (đúng cột duyệt) */
function approvalOnly_(action, p, me) {
  if (!me.approver || action !== 'update') return false;
  var allow = APPROVAL_COLS[p.sheet]; if (!allow) return false;
  var ch = p.changes || [];
  return ch.length > 0 && ch.every(function (c) { return allow.indexOf(Number(c.col)) >= 0; }) &&
    ch.some(function (c) { return isApprovalChange_(p.sheet, c, null); });
}

/** Thay đổi này có phải hành động duyệt không? (cur: giá trị hiện tại của ô, nếu biết) */
function isApprovalChange_(sheet, c, cur) {
  var v = String(c.value || '');
  if (sheet === 'DV_MUA_NGOAI') return Number(c.col) === 12 && (v === 'Đã duyệt' || v === 'Từ chối');
  if (sheet === 'QL_TASK') return Number(c.col) === 10 && v === 'Hoàn thành' && (cur === null || String(cur) === 'Chờ duyệt');
  return false;
}

/** Chặn duyệt / từ chối nếu tài khoản không phải Người duyệt yêu cầu */
function checkApproval_(sh, changes, me) {
  var name = sh.getName();
  if (!me || !APPROVAL_COLS[name]) return;
  var anyAppr = false;
  changes.forEach(function (c) {
    var cur = c.row ? sh.getRange(Number(c.row), Number(c.col)).getValue() : '';
    if (!isApprovalChange_(name, c, cur)) return;
    anyAppr = true;
    if (!me.approver) throw new Error('PERM: Chỉ Người duyệt yêu cầu mới được duyệt / từ chối');
  });
  // Người duyệt có vai trò Người xem: lần ghi này phải đúng là 1 thao tác duyệt
  if (me.role === 'viewer' && !anyAppr) throw new Error('PERM: Tài khoản của bạn chỉ có quyền xem');
}

function usersSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(USERS_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(USERS_SHEET);
  sh.getRange(1, 1, 1, USER_HEAD.length).setValues([USER_HEAD]).setFontWeight('bold').setBackground('#0f3d3a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  var list = function (vals) { return SpreadsheetApp.newDataValidation().requireValueInList(vals, true).build(); };
  sh.getRange('D2:D500').setDataValidation(list(['Người xem', 'Người chỉnh sửa', 'Quản trị']));
  sh.getRange('E2:E500').setDataValidation(list(['Có', 'Không']));
  sh.getRange('F2:F500').setDataValidation(list(['Hoạt động', 'Khóa']));
  sh.getRange('C2:C500').setNumberFormat('@');
  sh.setColumnWidth(1, 180); sh.setColumnWidth(5, 190); sh.setColumnWidth(7, 220); sh.setColumnWidth(8, 170);
  try { sh.hideSheet(); } catch (e) {}
  return sh;
}

function listUsers_() {
  var sh = ss_().getSheetByName(USERS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, USER_HEAD.length).getValues().map(function (r, i) {
    return { row: i + 2, name: String(r[0]), dept: String(r[1]), pin: String(r[2]), role: roleKey_(r[3]), approver: /^(có|x|yes|true|✓)$/i.test(String(r[4]).trim()),
      active: !/khóa|khoá|ngừng/i.test(String(r[5])), note: String(r[6]), upd: r[7] instanceof Date ? fmtDT_(r[7]) : String(r[7]) };
  }).filter(function (u) { return u.name.trim(); });
}

function genPin_() {
  var abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 8; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return s;
}

function userLock_(fn) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { var r = fn(); SpreadsheetApp.flush(); cache_().remove('USERS'); return r; } finally { lock.releaseLock(); }
}

function saveUser_(p) {
  var sh = usersSheet_(), name = String(p.name || '').trim();
  if (!name) throw new Error('Thiếu họ tên');
  var pin = String(p.pin || '').trim().toUpperCase() || genPin_();
  if (pin.length < 6) throw new Error('Mã truy cập cần ít nhất 6 ký tự');
  if (pin === String(masterPass_()).toUpperCase()) throw new Error('Mã truy cập trùng mã chung – chọn mã khác');
  var row = Number(p.row) || 0;
  listUsers_().forEach(function (u) { if (u.row !== row && u.pin.toUpperCase() === pin) throw new Error('Mã truy cập đã được dùng cho ' + u.name); });
  var vals = [[name, String(p.dept || ''), pin, ROLE_NAMES[p.role] || 'Người xem', p.approver ? 'Có' : 'Không', p.active === false ? 'Khóa' : 'Hoạt động', String(p.note || ''), new Date()]];
  if (!row) row = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(row, 1, 1, USER_HEAD.length).setValues(vals);
  sh.getRange(row, 8).setNumberFormat('dd/mm/yyyy HH:mm');
  log_(p, p.row ? 'Sửa quyền' : 'Thêm tài khoản', USERS_SHEET, name, '', (ROLE_NAMES[p.role] || 'Người xem') + (p.approver ? ' + Người duyệt' : '') + (p.active === false ? ' (Khóa)' : ''));
  return { ok: true, row: row, pin: pin };
}

function deleteUser_(p) {
  var sh = usersSheet_(), row = Number(p.row);
  if (!row || row < 2 || row > sh.getLastRow()) throw new Error('Không tìm thấy tài khoản');
  var name = String(sh.getRange(row, 1).getValue());
  if (p.name && name !== p.name) throw new Error('Danh sách đã thay đổi – tải lại trang rồi thử lại');
  sh.deleteRow(row);
  log_(p, 'Xóa tài khoản', USERS_SHEET, name, '', '');
  return { ok: true };
}

function withLock_(fn, sheetName) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { var r = fn(); SpreadsheetApp.flush(); bumpRev_(sheetName); return r; }
  finally { lock.releaseLock(); }
}

function ss_() {
  try { var a = SpreadsheetApp.getActiveSpreadsheet(); if (a) return a; } catch (e) {}
  return SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
}

/* ---------- Số phiên bản (REV) + nhật ký tab vừa đổi ----------
 * Mỗi lần ghi, REV tăng 1 và ghi lại [REV, tên tab] vào bộ nhớ đệm 'CHG'.
 * Web gửi REV nó đang có → nhận đúng các tab cần tải lại, thay vì cả 22 tab. */
function rev_() {
  var c = cache_(), v = c.get('REV');
  if (v === null) {
    v = PropertiesService.getScriptProperties().getProperty('REV') || '1';
    c.put('REV', v, CACHE_TTL);
  }
  return Number(v);
}

function bumpRev_(sheetName) {
  var c = cache_(), n = rev_() + 1;
  c.put('REV', String(n), CACHE_TTL);
  PropertiesService.getScriptProperties().setProperty('REV', String(n));
  var log = [];
  try { log = JSON.parse(c.get('CHG') || '[]'); } catch (e) { log = []; }
  log.push([n, sheetName || '*']);
  if (log.length > 300) log = log.slice(-300);
  c.put('CHG', JSON.stringify(log), CACHE_TTL);
  return n;
}

/** Các tab đã đổi sau phiên bản `since` (kèm tab có công thức phụ thuộc).
 *  Trả null khi không chắc chắn (nhật ký thiếu/hết hạn) → web tải lại toàn bộ. */
function changedSince_(since) {
  since = Number(since);
  var cur = rev_();
  if (!since || since > cur) return null;
  if (since === cur) return { sheets: [], dv: [] };
  var log = [];
  try { log = JSON.parse(cache_().get('CHG') || '[]'); } catch (e) { return null; }
  var rel = log.filter(function (e) { return e[0] > since; }).sort(function (a, b) { return a[0] - b[0]; });
  var names = {}, dv = {}, expect = since + 1;
  for (var i = 0; i < rel.length; i++) {
    if (rel[i][0] !== expect) return null;   // thiếu hoặc trùng số → không tin được
    if (rel[i][1] === '*') return null;
    var parts = String(rel[i][1]).split('|');  // "TEN_TAB|dv" = tab đổi danh sách dropdown
    names[parts[0]] = true;
    if (parts[1] === 'dv') dv[parts[0]] = true;
    expect++;
  }
  if (expect !== cur + 1) return null;
  return { sheets: withDependents_(Object.keys(names)), dv: Object.keys(dv) };
}

/** Bản đồ phụ thuộc: tab nguồn → các tab có công thức tham chiếu tới nó.
 *  Quét công thức 60 dòng đầu mỗi tab, lưu đệm 6 giờ. */
function depMap_() {
  var c = cache_(), s = c.get('DEPS');
  if (s) { try { return JSON.parse(s); } catch (e) {} }
  var sheets = ss_().getSheets(), names = sheets.map(function (x) { return x.getName(); }), map = {};
  sheets.forEach(function (sh) {
    var n = sh.getName(), lr = Math.min(sh.getLastRow(), 60), lc = sh.getLastColumn();
    if (lr < 1 || lc < 1) return;
    var txt = sh.getRange(1, 1, lr, lc).getFormulas().map(function (r) { return r.join('\n'); }).join('\n');
    if (!txt.replace(/\s/g, '')) return;
    names.forEach(function (src) {
      if (src === n) return;
      if (txt.indexOf(src + '!') >= 0 || txt.indexOf("'" + src + "'!") >= 0) (map[src] = map[src] || []).push(n);
    });
  });
  c.put('DEPS', JSON.stringify(map), CACHE_TTL);
  return map;
}

function withDependents_(list) {
  var map = depMap_(), seen = {}, queue = list.slice();
  while (queue.length) {
    var n = queue.shift();
    if (seen[n]) continue;
    seen[n] = true;
    (map[n] || []).forEach(function (d) { if (!seen[d]) queue.push(d); });
  }
  return Object.keys(seen);
}

/** Trigger đơn giản: khi sửa trực tiếp trên Google Sheet, web sẽ biết tab nào cần tải lại. */
function onEdit(e) {
  try { bumpRev_(e && e.range ? e.range.getSheet().getName() : '*'); } catch (err) {}
}

/* ============================ ĐỌC ============================ */

function getAll_(only, noDv) {
  var ss = ss_();
  var rev = rev_(); // đọc phiên bản TRƯỚC khi đọc dữ liệu, để không bỏ sót thay đổi xảy ra trong lúc đọc
  var want = only ? String(only).split(',') : null;
  var sheets = {}, order = [];
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name === CFG.LOG_SHEET || name === USERS_SHEET) return;   // tab phân quyền chứa mã truy cập: không gửi về web
    if (want && want.indexOf(name) < 0) return;
    order.push(name);
    sheets[name] = readSheet_(sh, noDv);
  });
  return { ok: true, rev: rev, partial: !!want, title: ss.getName(), url: ss.getUrl(), generatedAt: fmtDT_(new Date()), sheets: sheets, order: order, images: readImages_() };
}

function readSheet_(sh, noDv) {
  var lastR = sh.getLastRow(), lastC = sh.getLastColumn();
  if (lastR < 1 || lastC < 1) return { v: [], fm: [], dv: {} };
  var rng = sh.getRange(1, 1, lastR, lastC);
  var vals = rng.getValues(), fmts = rng.getNumberFormats(), forms = rng.getFormulas();
  // Cắt bỏ các dòng cuối rỗng (chỉ có công thức trả về "")
  var maxR = 0, maxC = 0;
  for (var r = 0; r < lastR; r++) for (var c = 0; c < lastC; c++) {
    var v = vals[r][c];
    if (v !== '' && v !== null) { if (r + 1 > maxR) maxR = r + 1; if (c + 1 > maxC) maxC = c + 1; }
  }
  for (var c2 = 0; c2 < lastC; c2++) for (var r2 = 0; r2 < Math.min(lastR, 10); r2++) if (forms[r2][c2] && c2 + 1 > maxC) maxC = c2 + 1;
  var v = [], fm = [];
  for (var i = 0; i < maxR; i++) {
    var row = [];
    for (var j = 0; j < maxC; j++) row.push(enc_(vals[i][j], fmts[i][j]));
    while (row.length && row[row.length - 1] === '') row.pop();
    v.push(row);
  }
  var fmRows = Math.min(lastR, maxR + 3);
  for (var k = 0; k < fmRows; k++) {
    var s = '';
    for (var m = 0; m < maxC; m++) s += forms[k][m] ? '1' : '0';
    fm.push(s.replace(/0+$/, ''));
  }
  // noDv: lần tải lại nhanh bỏ qua dropdown (ít khi đổi, web giữ bản cũ)
  return { v: v, fm: fm, dv: noDv ? null : readDV_(sh, Math.min(lastR, CFG.DV_ROWS), maxC) };
}

function enc_(v, fmt) {
  if (v === '' || v === null) return '';
  if (v instanceof Date) {
    // Ô chỉ có giờ (VD 07:30 gõ trên Sheet) → Google trả về ngày 30/12/1899 → gửi dạng "HH:mm"
    if (v.getFullYear() < 1901) return Utilities.formatDate(v, CFG.TZ, 'HH:mm');
    return 'D:' + Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd');
  }
  if (typeof v === 'number') { if (fmt && fmt.indexOf('%') >= 0) return 'P:' + v; return v; }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function readDV_(sh, rows, cols) {
  var out = {};
  if (rows < 1 || cols < 1) return out;
  var dvs = sh.getRange(1, 1, rows, cols).getDataValidations();
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
    var dv = dvs[r][c]; if (!dv) continue;
    var t = dv.getCriteriaType(), a = dv.getCriteriaValues(), list = null;
    if (t === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) list = a[0];
    else if (t === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
      list = []; a[0].getDisplayValues().forEach(function (row) { row.forEach(function (x) { if (x !== '') list.push(x); }); });
    }
    if (list) out[colLetter_(c + 1) + (r + 1)] = list;
  }
  return out;
}

/* ============================ GHI ============================ */

/* ---------- Các tab do web quản lý ----------
 * Tự tạo trên Sheet ở lần ghi đầu tiên, hoặc chạy setupV5() để tạo sẵn / sửa lại.
 * formulas: công thức dạng A1 thông thường, {r} = số dòng (VD: '=IF(E{r}="","",H{r}*2)').
 * (Bản trước dùng dạng R1C1 "RC5" – Google Sheets báo #ERROR!, nên đã bỏ.) */
var KHO_LIST = ['HCM20', 'ST', 'TK'];
var LOAI_GD = ['Nhập', 'Xuất', 'Điều chuyển đi', 'Điều chuyển đến', 'Xuất hủy / hao hụt'];
var CCDC_IN = ['Nhập', 'Điều chuyển đến', 'Thu hồi nhập kho'];
var CCDC_OUT = ['Xuất', 'Điều chuyển đi', 'Xuất hủy / hao hụt'];
var CA_LIST = ['Ca 1', 'Ca 2', 'Ca 3', 'Hành chính'];
var BO_PHAN_DEFAULT = ['Sort ca 01', 'Sort ca 02', 'Inout ca 01', 'Inout ca 02', 'Bảo Trì', 'Cleaner', 'Security', 'Văn Phòng', 'IT', 'Vật tư'];

// Tổng SL trong sổ CCDC theo kho (ô DM_KHO!A{khoRow}) + mã ở cột A cùng dòng + các loại giao dịch
function sumCcdc_(khoRow, types) {
  return types.map(function (t) {
    return 'SUMIFS(SO_NX_CCDC!$H:$H,SO_NX_CCDC!$C:$C,DM_KHO!$A$' + khoRow + ',SO_NX_CCDC!$E:$E,$A{r},SO_NX_CCDC!$D:$D,"' + t + '")';
  }).join('+');
}
// Trạng thái lượt mượn (PDA / nón, áo): trả = đã ghi "Tình trạng khi trả" (cột J)
var LOAN_STATUS = '=IF(AND(D{r}="",G{r}=""),"",IF(J{r}="",IF(AND(A{r}<>"",A{r}<TODAY()),"QUÁ HẠN TRẢ","Đang mượn"),IF(J{r}="Bình thường","Đã trả","Đã trả – có lỗi")))';

var AUTO_SHEETS = {
  QL_TASK: {
    title: 'QUẢN LÝ TASK – CỤM M12',
    sub: 'Dành cho Quản lý · Mỗi dòng 1 task. Bắt buộc có Người phụ trách và Hạn chót. Checklist: mỗi dòng 1 bước, "[x]" = xong, "[ ]" = chưa.',
    headers: ['Mã task', 'Tiêu đề', 'Mô tả', 'Kho', 'Người phụ trách', 'Người giao', 'Ưu tiên', 'Ngày giao', 'Hạn chót',
      'Trạng thái', 'Checklist', 'Ngày hoàn thành', 'Kết quả / ghi chú', 'Cập nhật lần cuối'],
    lists: { D: ['Chung', 'HCM20', 'ST', 'TK'], G: ['Gấp', 'Cao', 'Trung bình', 'Thấp'],
      J: ['Chưa làm', 'Đang làm', 'Chờ duyệt', 'Tạm hoãn', 'Hoàn thành', 'Hủy'] },
    dates: ['H', 'I', 'L'],
    widths: { A: 90, B: 260, C: 260, K: 260, M: 220, N: 170 }
  },

  // Dành cho Quản lý · mua CCDC ngoài hệ thống kho / dịch vụ nhà cung cấp
  DV_MUA_NGOAI: {
    after: 'QL_TASK', rows: 1000,
    title: 'DỊCH VỤ MUA NGOÀI – CỤM M12',
    sub: 'Mua CCDC ngoài hệ thống kho hoặc dịch vụ nhà cung cấp. Thứ tự: Yêu cầu → Người thực hiện & tiến độ → Timeline → Chi phí → Phê duyệt → Giải trình. Chỉ Người duyệt yêu cầu (tab Phân quyền) mới được Duyệt / Từ chối. Tiến độ: Đang báo giá → Chờ duyệt → Đã duyệt → Đang thực hiện → Chờ nghiệm thu → Hoàn thành.',
    headers: ['Mã yêu cầu', 'Ngày yêu cầu', 'Kho', 'Loại yêu cầu', 'Mức độ', 'Nội dung yêu cầu', 'Chi tiết / số lượng',
      'Bộ phận yêu cầu', 'Người yêu cầu', 'Người thực hiện', 'Người duyệt yêu cầu',
      'Tiến độ', 'Ngày duyệt', 'Bắt đầu dự kiến', 'Hoàn thành dự kiến', 'Hoàn thành thực tế',
      'Nhà cung cấp', 'Chi phí dự kiến (VNĐ)', 'Chi phí thực tế (VNĐ)', 'Giải trình', 'Chứng từ / số phiếu',
      'Tình trạng hạn', 'Cập nhật lần cuối'],
    lists: { C: ['Chung', 'HCM20', 'ST', 'TK'], D: ['Dịch vụ', 'CCDC ngoài hệ thống', 'Sửa chữa', 'Khác'],
      E: ['Khẩn cấp', 'Cao', 'Bình thường'],
      L: ['Đang báo giá', 'Chờ duyệt', 'Đã duyệt', 'Đang thực hiện', 'Chờ nghiệm thu', 'Hoàn thành', 'Từ chối', 'Hủy'] },
    dates: ['B', 'M', 'N', 'O', 'P'], money: ['R', 'S'], texts: ['A', 'U'],
    formulas: {
      // Tình trạng hạn: so Hoàn thành dự kiến (O) với hôm nay / ngày hoàn thành thực tế (P)
      V: '=IF(F{r}="","",IF(L{r}="Hoàn thành",IF(AND(P{r}<>"",O{r}<>"",P{r}>O{r}),"Trễ "&(P{r}-O{r})&" ngày","Đúng hạn"),IF(OR(L{r}="Từ chối",L{r}="Hủy"),"",IF(O{r}="","Chưa có timeline",IF(O{r}<TODAY(),"QUÁ HẠN "&(TODAY()-O{r})&" ngày",IF(O{r}-TODAY()<=3,"Sắp đến hạn","Trong hạn"))))))'
    },
    widths: { A: 95, F: 260, G: 200, H: 140, J: 140, K: 140, L: 130, Q: 160, T: 260, U: 140, V: 130, W: 170 }
  },

  SO_NX_CCDC: {
    after: 'TON_KHO', rows: 2000,
    title: 'SỔ NHẬP – XUẤT – ĐIỀU CHUYỂN CCDC (3 KHO)',
    sub: 'Mỗi dòng = 1 giao dịch của 1 mã CCDC ở 1 kho. Điều chuyển: ghi 2 dòng. "Thu hồi nhập kho" = CCDC đã cấp phát được trả về kho. Đơn giá tự lấy theo DM_CCDC.',
    headers: ['Ngày', 'Số phiếu', 'Kho', 'Loại giao dịch', 'Mã CCDC', 'Tên CCDC', 'ĐVT', 'Số lượng', 'Bộ phận / kho đối ứng',
      'Người nhận / giao', 'MSNV', 'Ghi chú', 'Kiểm tra', 'Đơn giá (VNĐ)', 'Thành tiền (VNĐ)'],
    lists: { C: KHO_LIST, D: LOAI_GD.concat(['Thu hồi nhập kho']), I: KHO_LIST.concat(BO_PHAN_DEFAULT) },
    dates: ['A'], money: ['N', 'O'], texts: ['B', 'K'],
    formulas: {
      F: '=IF(E{r}="","",IFERROR(INDEX(DM_CCDC!$B$5:$B$154,MATCH(E{r},DM_CCDC!$A$5:$A$154,0)),"Mã sai"))',
      G: '=IF(E{r}="","",IFERROR(INDEX(DM_CCDC!$D$5:$D$154,MATCH(E{r},DM_CCDC!$A$5:$A$154,0)),""))',
      M: '=IF(E{r}="","",IF(F{r}="Mã sai","Mã sai",IF(OR(A{r}="",C{r}="",D{r}="",H{r}=""),"Thiếu dữ liệu",IF(AND(OR(D{r}="Điều chuyển đi",D{r}="Điều chuyển đến"),I{r}=""),"Thiếu kho đối ứng",IF(AND(D{r}="Xuất",J{r}=""),"Thiếu người nhận","OK")))))',
      N: '=IF(E{r}="","",IFERROR(INDEX(DM_CCDC!$E$5:$E$154,MATCH(E{r},DM_CCDC!$A$5:$A$154,0)),""))',
      O: '=IF(OR(E{r}="",H{r}=""),"",H{r}*N(N{r}))'
    },
    widths: { E: 110, F: 220, I: 150, J: 150, L: 220 }
  },

  TON_KHO_CCDC: {
    after: 'SO_NX_CCDC', rows: 150,
    title: 'TỒN KHO CCDC (3 KHO)',
    sub: 'Tự tính từ SO_NX_CCDC. Chỉ nhập "Tồn đầu" một lần (số kiểm kê ngày bắt đầu). Giá trị tồn theo đơn giá DM_CCDC. "Đang sử dụng" lấy từ TAI_SAN_CCDC (chưa thanh lý).',
    headers: ['Mã CCDC', 'Tên CCDC', 'ĐVT',
      'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối', 'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối', 'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối',
      'Đơn giá (VNĐ)', 'Giá trị tồn HCM20', 'Giá trị tồn ST', 'Giá trị tồn TK', 'Tổng giá trị tồn', 'Đang sử dụng (sổ tài sản)'],
    groupRow: { D: '=DM_KHO!A5&" – "&DM_KHO!B5', H: '=DM_KHO!A6&" – "&DM_KHO!B6', L: '=DM_KHO!A7&" – "&DM_KHO!B7', P: 'GIÁ TRỊ TỒN (theo đơn giá danh mục)' },
    money: ['P', 'Q', 'R', 'S', 'T'],
    formulas: {
      A: '=IF(DM_CCDC!A{r}="","",DM_CCDC!A{r})',
      B: '=IF(A{r}="","",DM_CCDC!B{r})',
      C: '=IF(A{r}="","",DM_CCDC!D{r})',
      E: '=IF(A{r}="","",' + sumCcdc_(5, CCDC_IN) + ')',
      F: '=IF(A{r}="","",' + sumCcdc_(5, CCDC_OUT) + ')',
      G: '=IF(A{r}="","",N(D{r})+E{r}-F{r})',
      I: '=IF(A{r}="","",' + sumCcdc_(6, CCDC_IN) + ')',
      J: '=IF(A{r}="","",' + sumCcdc_(6, CCDC_OUT) + ')',
      K: '=IF(A{r}="","",N(H{r})+I{r}-J{r})',
      M: '=IF(A{r}="","",' + sumCcdc_(7, CCDC_IN) + ')',
      N: '=IF(A{r}="","",' + sumCcdc_(7, CCDC_OUT) + ')',
      O: '=IF(A{r}="","",N(L{r})+M{r}-N{r})',
      P: '=IF(A{r}="","",N(DM_CCDC!E{r}))',
      Q: '=IF(A{r}="","",G{r}*P{r})',
      R: '=IF(A{r}="","",K{r}*P{r})',
      S: '=IF(A{r}="","",O{r}*P{r})',
      T: '=IF(A{r}="","",Q{r}+R{r}+S{r})',
      U: '=IF(A{r}="","",SUMIFS(TAI_SAN_CCDC!$E:$E,TAI_SAN_CCDC!$B:$B,A{r},TAI_SAN_CCDC!$I:$I,"<>Đã thanh lý"))'
    },
    widths: { B: 220 }
  },

  // Thiết bị · cấp phát PDA hằng ngày (không ghi giờ; trả = ghi "Tình trạng khi trả")
  CAP_PHAT_PDA: {
    after: 'THONG_KE_PDA', rows: 2000,
    title: 'CẤP PHÁT PDA HẰNG NGÀY',
    sub: 'Mỗi lượt mượn = 1 dòng. Nhập Số máy PDA (VD: PDA-20-07) hoặc IMEI – tên máy tự hiện theo tab THONG_KE_PDA. Nhập MSNV – tên người nhận tự điền. Khi trả ghi "Tình trạng khi trả".',
    headers: ['Ngày', 'Ca', 'Kho', 'Số máy PDA / IMEI', 'Tên thiết bị', 'MSNV', 'Người nhận', 'Bộ phận',
      'Tình trạng khi cấp', 'Tình trạng khi trả', 'Ghi chú', 'Trạng thái'],
    lists: { B: CA_LIST, C: KHO_LIST, H: BO_PHAN_DEFAULT,
      I: ['Bình thường', 'Trầy xước', 'Pin yếu', 'Lỗi nhẹ'],
      J: ['Bình thường', 'Hư màn hình', 'Hư pin / sạc', 'Lỗi phần mềm', 'Rơi vỡ', 'Mất máy', 'Khác'] },
    dates: ['A'], texts: ['D', 'F'],
    formulas: {
      E: '=IF(D{r}="","",IFERROR(INDEX(THONG_KE_PDA!$D$5:$D$204,MATCH(D{r}&"",ARRAYFORMULA(THONG_KE_PDA!$A$5:$A$204&""),0)),IF(LEN(REGEXREPLACE(D{r}&"","[^0-9]",""))<8,"Chưa khai báo",IFERROR(INDEX(THONG_KE_PDA!$D$5:$D$204,MATCH("*"&REGEXREPLACE(D{r}&"","[^0-9]",""),ARRAYFORMULA(THONG_KE_PDA!$C$5:$C$204&""),0)),"Chưa khai báo"))))',
      L: LOAN_STATUS
    },
    widths: { D: 160, E: 150, G: 170, H: 140, K: 220 }
  },

  // Công việc hằng ngày · DANH SÁCH nón bảo hộ & áo phản quang: mỗi chiếc 1 dòng,
  // nhân viên nào nhận thì chỉ cần điền tên vào "Người đang giữ" (thu hồi = xóa tên). Mọi thay đổi có trong Nhật ký.
  DS_BHLD: {
    after: 'LICH_CV_ST', rows: 1000,
    title: 'DANH SÁCH NÓN BẢO HỘ & ÁO PHẢN QUANG',
    sub: 'Mỗi chiếc nón / áo 1 dòng. Nhân viên nhận → điền tên vào "Người đang giữ" (MSNV, ngày nhận tự điền trên web). Thu hồi về kho → xóa tên. Lịch sử giao – nhận xem ở Nhật ký thay đổi.',
    headers: ['Mã số', 'Loại', 'Kho', 'Người đang giữ', 'MSNV', 'Bộ phận', 'Ngày nhận', 'Tình trạng', 'Ghi chú'],
    lists: { B: ['Nón bảo hộ', 'Áo phản quang'], C: KHO_LIST, F: BO_PHAN_DEFAULT, H: ['Tốt', 'Cũ', 'Hư', 'Mất'] },
    dates: ['G'], texts: ['A', 'E'],
    widths: { A: 120, B: 130, D: 190, F: 140, I: 240 }
  },

  // Danh mục · DANH SÁCH NHÂN VIÊN: web tự thêm người mới ở lần cấp phát đầu tiên, các lần sau chỉ cần chọn
  DS_NHAN_VIEN: {
    after: 'DM_CCDC', rows: 1500,
    title: 'DANH SÁCH NHÂN VIÊN – CỤM M12',
    sub: 'Mỗi nhân viên 1 dòng, MSNV không trùng. Web tự thêm người mới khi cấp PDA lần đầu; các lần sau chỉ cần gõ MSNV / tên để chọn. Bộ phận dùng để thống kê tần suất lấy PDA (Sort, In/out…).',
    headers: ['Họ tên', 'MSNV', 'Bộ phận', 'Kho', 'SĐT', 'Trạng thái', 'Ngày thêm', 'Ghi chú'],
    lists: { C: BO_PHAN_DEFAULT, D: KHO_LIST, F: ['Đang làm', 'Nghỉ việc'] },
    dates: ['G'], texts: ['B', 'E'],
    widths: { A: 200, B: 100, C: 140, E: 120, H: 240 }
  },

  // Thiết bị · NHẬT KÝ NHẬP MÁY PDA: mỗi máy mới khai báo ở Thống kê PDA ghi kèm ngày nhập + người nhập (lấy từ Danh sách nhân viên)
  NHAP_PDA: {
    after: 'CAP_PHAT_PDA', rows: 1000,
    title: 'NHẬT KÝ NHẬP MÁY PDA',
    sub: 'Web tự ghi khi thêm máy ở Thống kê PDA: ngày nhập máy, số máy, IMEI, người nhập (MSNV → tên theo Danh sách nhân viên).',
    headers: ['Ngày nhập máy', 'Số máy PDA', 'IMEI', 'Kho', 'Tên thiết bị', 'MSNV người nhập', 'Người nhập', 'Ghi chú', 'Ghi lúc'],
    lists: { D: KHO_LIST },
    dates: ['A'], texts: ['B', 'C', 'F'],
    widths: { B: 120, C: 170, E: 130, G: 180, H: 240, I: 150 }
  },

  // Công việc hằng ngày · SỔ GĂNG TAY BẢO HỘ: mỗi dòng 1 giao dịch (cấp lần đầu, đổi mới, nhập kho, kiểm kê)
  GANG_TAY: {
    after: 'DS_BHLD', rows: 3000,
    title: 'SỔ GĂNG TAY BẢO HỘ',
    sub: 'Cấp lần đầu: vật tư cấp 1 đôi cho mỗi nhân viên. Đổi mới: mang găng cũ đến đổi (Găng cũ = Có → xanh); không có găng cũ (Không → đỏ) thì truy thu = số lượng × đơn giá và chụp ảnh minh chứng. Nhập kho ghi đơn giá; Kiểm kê ghi số đếm thực tế. Quá 3 tuần chưa đổi → web cảnh báo.',
    headers: ['Ngày', 'Kho', 'Loại giao dịch', 'MSNV', 'Họ tên', 'Bộ phận', 'Vị trí', 'Số lượng (đôi)', 'Găng cũ', 'Đơn giá (VNĐ)', 'Truy thu (VNĐ)', 'Ghi chú', 'Người thực hiện'],
    lists: { B: KHO_LIST, C: ['Cấp lần đầu', 'Đổi mới', 'Nhập kho', 'Kiểm kê'], F: BO_PHAN_DEFAULT, I: ['Có', 'Không'] },
    dates: ['A'], money: ['J', 'K'], texts: ['D'],
    widths: { C: 120, E: 190, F: 130, G: 130, L: 240, M: 150 }
  }
};

function ensureRows_(sh, n) { if (sh.getMaxRows() < n) sh.insertRowsAfter(sh.getMaxRows(), n - sh.getMaxRows()); }

/** Ghi công thức A1 cho cột L từ dòng `first` tới `last` ({r} = số dòng) */
function fillFormulas_(sh, L, first, last, tpl) {
  if (last < first) return;
  var arr = [], t = localizeF_(tpl);
  for (var r = first; r <= last; r++) arr.push([t.replace(/\{r\}/g, r)]);
  sh.getRange(L + first + ':' + L + last).setFormulas(arr).setFontColor('#5d706e');
}

/* ---------- Dấu ngăn cách đối số trong công thức ----------
 * Sheet đặt vùng Việt Nam (số thập phân dùng dấu phẩy) thì công thức phải ngăn cách bằng ";" –
 * ghi bằng "," sẽ ra #ERROR!. Thử trực tiếp 1 lần trên Sheet rồi ghi nhớ. */
function formulaSep_() {
  var p = PropertiesService.getScriptProperties(), s = p.getProperty('FSEP');
  if (s === ',' || s === ';') return s;
  var ss = ss_(), tmp = ss.insertSheet('_TMP_KIEM_TRA_' + Date.now());
  try {
    var c = tmp.getRange('A1');
    c.setFormula('=IF(1=1,7,0)'); SpreadsheetApp.flush();
    if (Number(c.getValue()) === 7) s = ',';
    else { c.setFormula('=IF(1=1;7;0)'); SpreadsheetApp.flush(); s = Number(c.getValue()) === 7 ? ';' : ','; }
  } finally { ss.deleteSheet(tmp); }
  p.setProperty('FSEP', s);
  return s;
}
/** Đổi "," → ";" (ngoài chuỗi trong ngoặc kép) nếu Sheet dùng dấu ";" */
function localizeF_(f) {
  if (formulaSep_() === ',') return f;
  var out = '', q = false;
  for (var i = 0; i < f.length; i++) { var ch = f.charAt(i); if (ch === '"') q = !q; out += (!q && ch === ',') ? ';' : ch; }
  return out;
}

function listRule_(vals) { return SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(true).build(); }

function createAutoSheet_(name) {
  var d = AUTO_SHEETS[name], ss = ss_(), n = d.headers.length, rows = d.rows || 996, last = 4 + rows;
  var after = d.after && ss.getSheetByName(d.after);
  var sh = after ? ss.insertSheet(name, after.getIndex()) : ss.insertSheet(name);
  ensureRows_(sh, last);
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  sh.getRange('A1').setValue(d.title).setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue(d.sub).setFontColor('#5d706e');
  sh.getRange(4, 1, 1, n).setValues([d.headers]).setFontWeight('bold').setBackground('#0f3d3a').setFontColor('#ffffff').setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(4);
  applyAutoRules_(sh, d, last);
  sh.getRange('A5:' + colLetter_(n) + last).setVerticalAlignment('top');
  Object.keys(d.widths || {}).forEach(function (L) { sh.setColumnWidth(colNum_(L), d.widths[L]); });
  try { cache_().remove('DEPS'); } catch (e) {}
  return sh;
}

/** Dòng nhóm, dropdown, định dạng, công thức theo khai báo (dùng khi tạo mới và khi sửa lại) */
function applyAutoRules_(sh, d, last) {
  Object.keys(d.groupRow || {}).forEach(function (L) {
    var c = sh.getRange(L + '3'), v = d.groupRow[L];
    if (v.charAt(0) === '=') c.setFormula(localizeF_(v)); else c.setValue(v);
    c.setFontWeight('bold').setFontColor('#0e8578');
  });
  Object.keys(d.lists || {}).forEach(function (L) { sh.getRange(L + '5:' + L + last).setDataValidation(listRule_(d.lists[L])); });
  (d.dates || []).forEach(function (L) { sh.getRange(L + '5:' + L + last).setNumberFormat('dd/mm/yyyy'); });
  (d.money || []).forEach(function (L) { sh.getRange(L + '5:' + L + last).setNumberFormat('#,##0'); });
  (d.texts || []).forEach(function (L) { sh.getRange(L + '5:' + L + last).setNumberFormat('@'); });
  Object.keys(d.formulas || {}).forEach(function (L) { fillFormulas_(sh, L, 5, last, d.formulas[L]); });
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh && AUTO_SHEETS[name]) sh = createAutoSheet_(name);
  if (!sh) throw new Error('Không tìm thấy tab ' + name);
  return sh;
}

/** Chạy tay (tùy chọn): tạo sẵn tab QL_TASK trên Sheet. */
function setupTaskSheet() {
  sheet_('QL_TASK');
  return 'Đã có tab QL_TASK';
}

/** Thêm cột vào tab có sẵn – chỉ khi ô tiêu đề còn trống, nên chạy lại nhiều lần vẫn an toàn. */
function addCols_(sh, specs, last, out) {
  var needCol = Math.max.apply(null, specs.map(function (s) { return colNum_(s.L); }));
  if (sh.getMaxColumns() < needCol) sh.insertColumnsAfter(sh.getMaxColumns(), needCol - sh.getMaxColumns());
  ensureRows_(sh, last);
  specs.forEach(function (s) {
    var head = sh.getRange(s.L + '4');
    var cur = String(head.getValue()).trim();
    if (cur && cur !== s.h) { out.push(sh.getName() + '!' + s.L + ': BỎ QUA – ô tiêu đề đang là "' + cur + '"'); return; }
    if (!cur) {
      sh.getRange(colLetter_(colNum_(s.L) - 1) + '4').copyTo(head, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      head.setValue(s.h);
    }
    // Luôn ghi lại công thức (sửa các ô #ERROR! của bản trước)
    if (s.f) fillFormulas_(sh, s.L, 5, last, s.f);
    if (s.fmt) sh.getRange(s.L + '5:' + s.L + last).setNumberFormat(s.fmt);
    if (s.g) sh.getRange(s.L + '3').setValue(s.g).setFontWeight('bold');
    out.push(sh.getName() + '!' + s.L + ': ' + (cur ? 'đã cập nhật công thức' : 'đã thêm') + ' "' + s.h + '"');
  });
}

// Cột Đơn giá / Thành tiền của SO_NHAP_XUAT (đơn giá luôn lấy theo DM_NVL) và giá trị tồn của TON_KHO
var NX_PRICE_COLS = [
  { L: 'N', h: 'Đơn giá (VNĐ)', fmt: '#,##0', f: '=IF(E{r}="","",IFERROR(INDEX(DM_NVL!$E$5:$E$154,MATCH(E{r},DM_NVL!$A$5:$A$154,0)),""))' },
  { L: 'O', h: 'Thành tiền (VNĐ)', fmt: '#,##0', f: '=IF(OR(E{r}="",H{r}=""),"",H{r}*N(N{r}))' }
];
var TK_VALUE_COLS = [
  { L: 'V', h: 'Đơn giá (VNĐ)', fmt: '#,##0', g: 'GIÁ TRỊ TỒN (theo đơn giá danh mục)', f: '=IF(A{r}="","",N(DM_NVL!E{r}))' },
  { L: 'W', h: 'Giá trị tồn HCM20', fmt: '#,##0', f: '=IF(A{r}="","",G{r}*V{r})' },
  { L: 'X', h: 'Giá trị tồn ST', fmt: '#,##0', f: '=IF(A{r}="","",M{r}*V{r})' },
  { L: 'Y', h: 'Giá trị tồn TK', fmt: '#,##0', f: '=IF(A{r}="","",S{r}*V{r})' },
  { L: 'Z', h: 'Tổng giá trị tồn', fmt: '#,##0', f: '=IF(A{r}="","",W{r}+X{r}+Y{r})' }
];

/** Bản cũ – giữ để chạy lại được; nay đã gồm trong setupV5 */
function setupV2() {
  var ss = ss_(), out = [];
  ['SO_NX_CCDC', 'TON_KHO_CCDC', 'CAP_PHAT_PDA', 'QL_TASK', 'DV_MUA_NGOAI'].forEach(function (n) {
    if (ss.getSheetByName(n)) out.push(n + ': đã có'); else { createAutoSheet_(n); out.push(n + ': đã tạo'); }
  });
  var nx = ss.getSheetByName('SO_NHAP_XUAT');
  if (nx) addCols_(nx, NX_PRICE_COLS, Math.max(nx.getMaxRows(), 2504), out);
  var tk = ss.getSheetByName('TON_KHO');
  if (tk) addCols_(tk, TK_VALUE_COLS, 154, out);
  var hd = ss.getSheetByName('HUONG_DAN');
  if (hd) {
    var colA = hd.getRange(1, 1, Math.max(hd.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]); });
    if (colA.indexOf(GUIDE_V2[0][0]) >= 0) out.push('HUONG_DAN: đã có mục bổ sung');
    else {
      var start = hd.getLastRow() + 2;
      hd.getRange(start, 1, GUIDE_V2.length, 3).setValues(GUIDE_V2.map(function (r) { return [r[0] || '', r[1] || '', r[2] || '']; }));
      hd.getRange(start, 1).setFontWeight('bold');
      hd.getRange(start, 3, GUIDE_V2.length, 1).setWrap(true);
      out.push('HUONG_DAN: đã thêm ' + (GUIDE_V2.length - 1) + ' dòng');
    }
  }
  try { cache_().remove('DEPS'); } catch (e) {}
  bumpRev_('*');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/** Giá trị đang có trong 1 cột (theo số lần dùng nhiều → ít), dùng làm danh sách dropdown */
function distinctValues_(sh, L, first) {
  if (!sh || sh.getLastRow() < first) return [];
  var cnt = {};
  sh.getRange(L + first + ':' + L + sh.getLastRow()).getValues().forEach(function (r) {
    var v = String(r[0]).trim(); if (v) cnt[v] = (cnt[v] || 0) + 1;
  });
  return Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
}
function mergeList_(a, b) { var seen = {}, out = []; a.concat(b).forEach(function (x) { var k = String(x).trim(); if (k && !seen[k.toLowerCase()]) { seen[k.toLowerCase()] = 1; out.push(k); } }); return out; }

/**
 * CHẠY 1 LẦN cho bản V5 (chọn hàm setupV5 → ▶ Chạy, rồi Triển khai phiên bản mới). Chạy lại vẫn an toàn.
 *  1. Sửa toàn bộ ô #ERROR! do công thức dạng R1C1 của bản trước (TON_KHO, SO_NX_CCDC, TON_KHO_CCDC, DV_MUA_NGOAI…)
 *  2. Đơn giá ở Sổ nhập – xuất NVL / CCDC tự lấy theo danh mục (cột N thành công thức)
 *  3. Cột "Bộ phận / kho đối ứng" thành dropdown sửa được (thêm / bớt trên web)
 *  4. THONG_KE_PDA: cột A (STT) → "Số máy PDA" (PDA-20-01, PDA-ST-01, PDA-TK-01 … – sửa lại theo nhãn thật nếu khác)
 *  5. CAP_PHAT_PDA: bỏ giờ cấp / giờ trả, thêm Tình trạng khi cấp, MSNV trước Người nhận (dữ liệu cũ được chuyển sang)
 *  6. Tạo tab CAP_PHAT_BHLD (nón bảo hộ & áo phản quang)
 */
function setupV5() {
  var ss = ss_(), out = [];
  // 1–2. Sổ NVL + Tồn kho NVL
  var nx = ss.getSheetByName('SO_NHAP_XUAT'), nxLast = nx ? Math.max(nx.getMaxRows(), 2504) : 0;
  if (nx) addCols_(nx, NX_PRICE_COLS, nxLast, out);
  var tk = ss.getSheetByName('TON_KHO');
  if (tk) addCols_(tk, TK_VALUE_COLS, 154, out);
  // 3. Danh sách bộ phận dùng chung (từ dữ liệu đã nhập + mặc định)
  var bp = mergeList_(mergeList_(KHO_LIST, distinctValues_(nx, 'I', 5)), BO_PHAN_DEFAULT).slice(0, 400);
  if (nx) { nx.getRange('I5:I' + nxLast).setDataValidation(listRule_(bp)); out.push('SO_NHAP_XUAT!I: dropdown bộ phận (' + bp.length + ' lựa chọn)'); }
  // Các tab do web tạo: tạo nếu chưa có, ghi lại công thức / dropdown
  ['QL_TASK', 'DV_MUA_NGOAI', 'SO_NX_CCDC', 'TON_KHO_CCDC'].forEach(function (n) {
    var sh = ss.getSheetByName(n), d = AUTO_SHEETS[n];
    if (!sh) { createAutoSheet_(n); out.push(n + ': đã tạo'); return; }
    var lists = d.lists;
    if (n === 'SO_NX_CCDC') { d.lists = JSON.parse(JSON.stringify(lists)); d.lists.I = mergeList_(bp, distinctValues_(sh, 'I', 5)); }
    if (sh.getMaxColumns() < d.headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), d.headers.length - sh.getMaxColumns());
    applyAutoRules_(sh, d, 4 + (d.rows || 996));
    d.lists = lists;
    out.push(n + ': đã ghi lại công thức');
  });
  // 4. Số máy PDA
  out.push(setupPdaCodes_());
  // 5. Cấp phát PDA (cấu trúc mới)
  out.push(migrateLoanSheet_('CAP_PHAT_PDA', bp));
  // 6. Nón bảo hộ & áo phản quang
  out.push(setupBhld_(bp));
  out.push(syncPdaSummary_());
  try { cache_().remove('DEPS'); } catch (e) {}
  bumpRev_('*');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/** THONG_KE_PDA cột A: STT tự đánh → "Số máy PDA" nhập được; điền sẵn mã theo kho cho máy chưa có mã */
function setupPdaCodes_() {
  var sh = ss_().getSheetByName(PDA_SHEET); if (!sh) return 'THONG_KE_PDA: không có tab';
  var n = 200, rng = sh.getRange('A5:C' + (4 + n)), vals = rng.getValues(), forms = sh.getRange('A5:A' + (4 + n)).getFormulas();
  var prefix = { HCM20: 'PDA-20-', ST: 'PDA-ST-', TK: 'PDA-TK-' }, seq = {}, used = {}, filled = 0;
  // Mã đã nhập tay (không phải công thức) giữ nguyên
  vals.forEach(function (r, i) { if (!forms[i][0] && String(r[0]).trim()) used[String(r[0]).trim().toUpperCase()] = 1; });
  var outA = vals.map(function (r, i) {
    var cur = forms[i][0] ? '' : String(r[0]).trim();
    if (cur) return [cur];
    if (!String(r[2]).trim()) return [''];                    // chưa có IMEI → để trống
    var k = String(r[1]).trim(), p = prefix[k] || ('PDA-' + (k || 'X') + '-'), code;
    do { seq[p] = (seq[p] || 0) + 1; code = p + (seq[p] < 10 ? '0' : '') + seq[p]; } while (used[code.toUpperCase()]);
    used[code.toUpperCase()] = 1; filled++;
    return [code];
  });
  sh.getRange('A5:A' + (4 + n)).clearContent().setNumberFormat('@').setValues(outA);
  sh.getRange('A4').setValue('Số máy PDA');
  return 'THONG_KE_PDA: cột A → "Số máy PDA" (điền sẵn ' + filled + ' mã – sửa lại theo nhãn thật trên máy nếu khác)';
}

/** Chuyển tab cấp phát sang cấu trúc mới (bỏ giờ, thêm tình trạng khi cấp), giữ dữ liệu cũ */
function migrateLoanSheet_(name, bp) {
  var ss = ss_(), sh = ss.getSheetByName(name), d = AUTO_SHEETS[name];
  d.lists = JSON.parse(JSON.stringify(d.lists)); d.lists.H = bp;
  if (!sh) { createAutoSheet_(name); return name + ': đã tạo'; }
  var head = sh.getRange(4, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(function (x) { return String(x).trim(); });
  if (head.indexOf('Giờ cấp') < 0) {   // đã là cấu trúc mới → chỉ ghi lại công thức / dropdown
    reapplyAuto_(sh, name);   // giữ lựa chọn dropdown đã thêm
    return name + ': đã ghi lại công thức';
  }
  // Cấu trúc cũ: Ngày, Ca, Kho, IMEI, Tên, Người nhận, MSNV, Bộ phận, Giờ cấp, Giờ trả, TT trả, Ghi chú, Trạng thái
  var rows = [];
  if (sh.getLastRow() >= 5) sh.getRange(5, 1, sh.getLastRow() - 4, 13).getValues().forEach(function (r) {
    if (!String(r[3]).trim() && !String(r[5]).trim()) return;
    var note = [r[11], r[8] ? 'Giờ cấp ' + fmtTime_(r[8]) : '', r[9] ? 'Giờ trả ' + fmtTime_(r[9]) : ''].filter(String).join(' · ');
    var condIn = r[10] || (r[9] ? 'Bình thường' : '');
    rows.push([r[0], r[1], r[2], r[3], '', r[6], r[5], r[7], 'Bình thường', condIn, note]);
  });
  var backup = name + '_CU';
  if (ss.getSheetByName(backup)) ss.deleteSheet(ss.getSheetByName(backup));
  sh.setName(backup); try { sh.hideSheet(); } catch (e) {}
  var nsh = createAutoSheet_(name);
  if (rows.length) {
    rows.forEach(function (r, i) {
      var row = 5 + i;
      nsh.getRange(row, 1, 1, 4).setValues([r.slice(0, 4)]);
      nsh.getRange(row, 6, 1, 6).setValues([r.slice(5, 11)]);
    });
  }
  return name + ': đã chuyển sang cấu trúc mới (' + rows.length + ' dòng; bản cũ lưu ở tab ẩn ' + backup + ')';
}
function fmtTime_(v) { return v instanceof Date ? Utilities.formatDate(v, CFG.TZ, 'HH:mm') : String(v); }

var GUIDE_V2 = [
  ['BỔ SUNG TRÊN WEB (11/2026)'],
  ['', 'SO_NHAP_XUAT', 'Thêm cột Đơn giá (để trống = lấy đơn giá trong DM_NVL; web tự điền khi chọn mã) và Thành tiền = Số lượng × Đơn giá (tự tính).'],
  ['', 'TON_KHO', 'Thêm Đơn giá và Giá trị tồn từng kho + Tổng giá trị tồn (tính theo đơn giá DM_NVL).'],
  ['', 'SO_NX_CCDC', 'Sổ nhập / xuất / điều chuyển CCDC cho 3 kho, cách ghi giống sổ NVL, có Đơn giá – Thành tiền. "Thu hồi nhập kho" = CCDC đã cấp phát được trả lại kho.'],
  ['', 'TON_KHO_CCDC', 'Tồn kho CCDC từng kho, tự tính từ SO_NX_CCDC; chỉ nhập "Tồn đầu" một lần. Có giá trị tồn và số đang sử dụng (từ TAI_SAN_CCDC).'],
  ['', 'CAP_PHAT_PDA', 'Cấp phát PDA hằng ngày: mỗi lượt mượn 1 dòng (ngày, ca, kho, IMEI, người nhận, giờ cấp). Khi trả ghi giờ trả và tình trạng. Trạng thái tự tính: Đang mượn / QUÁ HẠN TRẢ / Đã trả.'],
  ['', 'QL_TASK', 'Task dành cho quản lý: bắt buộc người phụ trách và hạn chót, có checklist từng bước, cảnh báo quá hạn.'],
  ['', 'WEB_HINH_ANH', 'Do web tự ghi: link ảnh đính kèm theo từng dòng. Không sửa tay.'],
  ['', 'WEB_NHAT_KY', 'Do web tự ghi: nhật ký mọi thay đổi (ai, lúc nào, ô nào, giá trị cũ / mới). Không sửa tay.']
];

function dec_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') return v;
  var m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (/^P:/.test(v)) return Number(v.slice(2));
  if (/^-?\d+([.,]\d+)?$/.test(v) && v.length < 15 && !/^0\d/.test(v)) return Number(v.replace(',', '.'));
  return v;
}

function canWrite_(sh, cell) {
  if (!cell.getFormula()) return true;
  var allow = PARAM_OVERRIDE[sh.getName()] || [];
  return allow.indexOf(cell.getA1Notation()) >= 0;
}

/** p.changes = [{row, col, value}] (col là số, bắt đầu từ 1) */
function update_(p) {
  var sh = sheet_(p.sheet), changes = p.changes || [], done = 0, skipped = [];
  checkApproval_(sh, changes, p._me);
  changes.forEach(function (ch) {
    var cell = sh.getRange(Number(ch.row), Number(ch.col));
    if (!canWrite_(sh, cell)) { skipped.push(cell.getA1Notation()); return; }
    var old = cell.getDisplayValue();
    var nv = dec_(ch.value);
    if (nv instanceof Date && !/[dy]/i.test(cell.getNumberFormat())) cell.setNumberFormat('dd/mm/yyyy');
    cell.setValue(nv);
    log_(p, 'Sửa', sh.getName(), cell.getA1Notation(), old, String(ch.value));
    done++;
  });
  if (sh.getName() === PDA_SHEET) { try { syncPdaSummary_(sh); } catch (e) {} }
  return { ok: true, updated: done, skipped: skipped };
}

/** Thêm dòng: p.values = {colNumber: value}, p.dataStart, p.lastCol */
function append_(p) {
  var sh = sheet_(p.sheet);
  checkApproval_(sh, Object.keys(p.values || {}).map(function (c) { return { col: Number(c), value: p.values[c] }; }), p._me);
  var start = Number(p.dataStart) || 5, lastCol = Number(p.lastCol) || sh.getLastColumn();
  var keys = Object.keys(p.values || {}).map(Number);
  var maxR = Math.max(sh.getMaxRows(), start);
  var height = maxR - start + 1;
  var rng = sh.getRange(start, 1, height, lastCol);
  var vals = rng.getValues(), forms = rng.getFormulas();
  var target = -1;
  for (var r = 0; r < height; r++) {
    var empty = true;
    for (var c = 0; c < lastCol; c++) { if (!forms[r][c] && vals[r][c] !== '' && vals[r][c] !== null) { empty = false; break; } }
    if (empty) { target = start + r; break; }
  }
  if (target < 0) { sh.insertRowsAfter(maxR, 50); target = maxR + 1; }
  // Kéo công thức từ dòng trên xuống nếu dòng mới chưa có
  if (target > start) {
    var prev = sh.getRange(target - 1, 1, 1, lastCol).getFormulasR1C1()[0];
    var cur = sh.getRange(target, 1, 1, lastCol).getFormulas()[0];
    for (var j = 0; j < lastCol; j++) if (prev[j] && !cur[j]) sh.getRange(target, j + 1).setFormulaR1C1(prev[j]);
    sh.getRange(target - 1, 1, 1, lastCol).copyTo(sh.getRange(target, 1, 1, lastCol), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  keys.forEach(function (col) {
    var cell = sh.getRange(target, col);
    if (cell.getFormula()) return;
    var nv = dec_(p.values[col]);
    if (nv instanceof Date && !/[dy]/i.test(cell.getNumberFormat())) cell.setNumberFormat('dd/mm/yyyy');
    cell.setValue(nv);
  });
  log_(p, 'Thêm dòng', sh.getName(), 'Dòng ' + target, '', JSON.stringify(p.values));
  if (sh.getName() === PDA_SHEET) { try { syncPdaSummary_(sh); } catch (e) {} }
  return { ok: true, row: target };
}

/** Xóa dòng = xóa nội dung các ô nhập (giữ công thức) */
function clearRow_(p) {
  var sh = sheet_(p.sheet), row = Number(p.row), lastCol = Number(p.lastCol) || sh.getLastColumn();
  var rng = sh.getRange(row, 1, 1, lastCol), forms = rng.getFormulas()[0], vals = rng.getDisplayValues()[0];
  for (var c = 0; c < lastCol; c++) if (!forms[c]) sh.getRange(row, c + 1).clearContent();
  log_(p, 'Xóa dòng', sh.getName(), 'Dòng ' + row, vals.join(' | '), '');
  return { ok: true };
}

/** Sửa danh sách lựa chọn của dropdown 1 cột (thêm / bớt lựa chọn).
 *  Chỉ thay quy tắc ở những ô đang có dropdown dạng danh sách → giữ đúng phạm vi cũ.
 *  Ô đã nhập giá trị cũ vẫn giữ nguyên (không xóa dữ liệu). */
function setList_(p) {
  var sh = sheet_(p.sheet), c = colNum_(String(p.col)), start = Number(p.dataStart) || 5;
  var seen = {}, values = [];
  (p.values || []).forEach(function (v) { v = String(v).trim(); if (v && !seen[v]) { seen[v] = true; values.push(v); } });
  if (!values.length) throw new Error('Danh sách phải còn ít nhất 1 lựa chọn');
  if (values.join(',').length > 9000) throw new Error('Danh sách quá dài');
  var n = Math.max(sh.getMaxRows() - start + 1, 1);
  var rng = sh.getRange(start, c, n, 1), rules = rng.getDataValidations();
  var T = SpreadsheetApp.DataValidationCriteria, base = null, ranged = false;
  for (var r = 0; r < n; r++) {
    var dv = rules[r][0]; if (!dv) continue;
    var t = dv.getCriteriaType();
    if (t === T.VALUE_IN_LIST && !base) base = dv;
    if (t === T.VALUE_IN_RANGE) ranged = true;
  }
  if (!base) {
    if (ranged) throw new Error('Dropdown cột ' + p.col + ' lấy từ một vùng trên Sheet – hãy sửa trực tiếp vùng đó');
    throw new Error('Cột ' + p.col + ' chưa có dropdown');
  }
  var nr = base.copy().requireValueInList(values, true).build(), count = 0;
  for (var k = 0; k < n; k++) {
    var x = rules[k][0];
    if (x && x.getCriteriaType() === T.VALUE_IN_LIST) { rules[k][0] = nr; count++; }
  }
  rng.setDataValidations(rules);
  log_(p, 'Sửa danh sách', sh.getName(), 'Cột ' + p.col, '', values.join(', '));
  if (sh.getName() === PDA_SHEET) { try { syncPdaSummary_(sh); } catch (e) {} }
  return { ok: true, cells: count, values: values };
}

/* ---------- Bảng tổng hợp PDA (THONG_KE_PDA, vùng L4:…10) ----------
 * Mỗi thiết bị 1 cột (tiêu đề dòng 4 = tên thiết bị), cột cuối là "Ngày cập nhật".
 * Tự thêm cột cho thiết bị mới (có trong dropdown cột D hoặc đã nhập ở bảng chính),
 * chép công thức từ cột thiết bị bên trái, và sửa dòng "Số lượng thiết bị" cộng đủ các cột. */
var PDA_SHEET = 'THONG_KE_PDA', PDA_SUM_FIRST = 14 /* N */, PDA_SUM_ROWS = [4, 10];

function syncPdaSummary_(sh) {
  sh = sh || ss_().getSheetByName(PDA_SHEET);
  if (!sh) return 'Không có tab ' + PDA_SHEET;
  var lastC = sh.getMaxColumns(), head = sh.getRange(4, PDA_SUM_FIRST, 1, lastC - PDA_SUM_FIRST + 1).getValues()[0];
  var dateIdx = -1;
  for (var i = 0; i < head.length; i++) if (/^ngày cập nhật$/i.test(String(head[i]).trim())) { dateIdx = i; break; }
  if (dateIdx < 1) return 'Không tìm thấy cột "Ngày cập nhật" ở dòng 4 – bỏ qua';
  var have = head.slice(0, dateIdx).map(function (x) { return String(x).trim(); });
  // Thiết bị cần có: theo thứ tự dropdown cột D, rồi các tên đã nhập ở bảng chính
  var want = [], seen = {};
  var add = function (x) { x = String(x || '').trim(); if (x && !seen[x.toLowerCase()]) { seen[x.toLowerCase()] = true; want.push(x); } };
  try {
    var dv = sh.getRange('D5').getDataValidation();
    if (dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) dv.getCriteriaValues()[0].forEach(add);
  } catch (e) {}
  sh.getRange('D5:D204').getValues().forEach(function (r) { add(r[0]); });
  var lower = have.map(function (x) { return x.toLowerCase(); });
  var missing = want.filter(function (x) { return lower.indexOf(x.toLowerCase()) < 0; });
  var nRows = PDA_SUM_ROWS[1] - PDA_SUM_ROWS[0] + 1, added = [];
  missing.forEach(function (name) {
    var dateCol = PDA_SUM_FIRST + have.length;          // cột "Ngày cập nhật" hiện tại
    var newCol = sh.getRange(PDA_SUM_ROWS[0], dateCol, nRows, 1);
    newCol.insertCells(SpreadsheetApp.Dimension.COLUMNS);   // chỉ đẩy vùng dòng 4–10 sang phải
    if (sh.getMaxColumns() < dateCol + 1) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    var src = sh.getRange(PDA_SUM_ROWS[0], dateCol - 1, nRows, 1), dst = sh.getRange(PDA_SUM_ROWS[0], dateCol, nRows, 1);
    src.copyTo(dst);                                          // công thức tự đổi N$4 → cột mới
    dst.getCell(1, 1).setValue(name);
    have.push(name); added.push(name);
  });
  // Dòng "Số lượng thiết bị (theo kho chọn)": Tốt (dòng 13) và Hư (dòng 14) cộng đủ các cột thiết bị
  var lastDev = colLetter_(PDA_SUM_FIRST + have.length - 1);
  var fix = function (label, cell, f) {
    if (!label.test(String(sh.getRange('M' + cell.slice(1)).getValue()).trim())) return;
    var c = sh.getRange(cell);
    if (c.getFormula().replace(/\s/g, '').toUpperCase() !== f.toUpperCase()) c.setFormula(f);
  };
  fix(/^tốt$/i, 'N13', '=SUM(N5:' + lastDev + '5)');
  fix(/^hư/i, 'N14', '=SUM(N6:' + lastDev + '8)');
  return added.length ? 'Bảng tổng hợp PDA: đã thêm cột ' + added.join(', ') : 'Bảng tổng hợp PDA: đủ cột (' + have.join(', ') + ')';
}

/** Chạy tay 1 lần (hoặc bất cứ lúc nào): bổ sung cột thiết bị còn thiếu vào Bảng tổng hợp PDA,
 *  và cho cột Tên thiết bị ở CAP_PHAT_PDA nhận IMEI có/không có chữ "IMEI:" phía trước. */
function setupV3() {
  var out = [syncPdaSummary_()], ss = ss_();
  // Dành cho Quản lý · Dịch vụ mua ngoài
  if (ss.getSheetByName('DV_MUA_NGOAI')) out.push('DV_MUA_NGOAI: đã có'); else { createAutoSheet_('DV_MUA_NGOAI'); out.push('DV_MUA_NGOAI: đã tạo'); }
  var hd = ss.getSheetByName('HUONG_DAN');
  if (hd) {
    var colB = hd.getRange(1, 2, Math.max(hd.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]); });
    if (colB.indexOf('DV_MUA_NGOAI') < 0) {
      hd.getRange(hd.getLastRow() + 1, 1, 1, 3).setValues([['', 'DV_MUA_NGOAI', 'Dịch vụ mua ngoài (dành cho Quản lý): mua CCDC ngoài hệ thống kho hoặc dịch vụ nhà cung cấp. Ghi yêu cầu → người xử lý, người duyệt → tiến độ & timeline dự kiến → chi phí → giải trình (bắt buộc khi trễ hạn, vượt chi phí, từ chối hoặc hủy).']]).setWrap(true);
      out.push('HUONG_DAN: đã thêm mục DV_MUA_NGOAI');
    }
  }
  // Công thức Tên thiết bị ở CAP_PHAT_PDA: nay do setupV5 ghi (dạng A1)
  bumpRev_('*');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/** Bổ sung hạng mục (cột mới) ở bên phải bảng */
function addColumn_(p) {
  var sh = sheet_(p.sheet), headerRow = Number(p.headerRow) || 4, col = Number(p.col);
  var title = String(p.title || '').trim();
  if (!title) throw new Error('Thiếu tên cột');
  var check = sh.getRange(headerRow, col, Math.max(sh.getLastRow() - headerRow + 1, 1), 1).getValues();
  for (var i = 0; i < check.length; i++) if (check[i][0] !== '') throw new Error('Cột ' + colLetter_(col) + ' đang có dữ liệu, không thể thêm');
  var head = sh.getRange(headerRow, col);
  if (col > 1) sh.getRange(headerRow, col - 1).copyTo(head, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  head.setValue(title);
  log_(p, 'Thêm cột', sh.getName(), colLetter_(col) + headerRow, '', title);
  return { ok: true, col: col };
}

/* ============================ HÌNH ẢNH ============================ */

function folder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function imgSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(CFG.IMG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CFG.IMG_SHEET);
    sh.getRange(1, 1, 1, 9).setValues([['Thời gian', 'Tab', 'Dòng', 'Kho', 'Mô tả dòng', 'Tên file', 'Link ảnh', 'File ID', 'Người tải']]).setFontWeight('bold').setBackground('#0f3d3a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function upload_(p) {
  if (!p.data) throw new Error('Thiếu dữ liệu ảnh');
  var bytes = Utilities.base64Decode(String(p.data).replace(/^data:[^,]+,/, ''));
  var blob = Utilities.newBlob(bytes, p.mime || 'image/jpeg', p.name || ('anh-' + Date.now() + '.jpg'));
  var sub = folder_(CFG.IMAGE_FOLDER);
  var file = sub.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600';
  imgSheet_().appendRow([new Date(), p.sheet, Number(p.row), p.kho || '', p.label || '', file.getName(), url, file.getId(), p.user || '']);
  log_(p, 'Tải ảnh', p.sheet, 'Dòng ' + p.row, '', file.getName());
  return { ok: true, image: { id: file.getId(), url: url, name: file.getName() } };
}

function deleteImage_(p) {
  var sh = imgSheet_(), vals = sh.getDataRange().getValues();
  for (var r = vals.length - 1; r >= 1; r--) {
    if (vals[r][7] === p.id) {
      try { DriveApp.getFileById(p.id).setTrashed(true); } catch (e) {}
      sh.deleteRow(r + 1);
      log_(p, 'Xóa ảnh', vals[r][1], 'Dòng ' + vals[r][2], vals[r][5], '');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Không tìm thấy ảnh' };
}

function readImages_() {
  var sh = ss_().getSheetByName(CFG.IMG_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues().map(function (r) {
    return { time: r[0] instanceof Date ? fmtDT_(r[0]) : String(r[0]), sheet: r[1], row: Number(r[2]), kho: r[3], label: r[4], name: r[5], url: r[6], id: r[7], user: r[8] };
  });
}

/* ============================ NHẬT KÝ ============================ */

function log_(p, act, sheet, where, oldV, newV) {
  var ss = ss_(), sh = ss.getSheetByName(CFG.LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CFG.LOG_SHEET);
    sh.getRange(1, 1, 1, 7).setValues([['Thời gian', 'Người dùng', 'Hành động', 'Tab', 'Vị trí', 'Giá trị cũ', 'Giá trị mới']]).setFontWeight('bold').setBackground('#0f3d3a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), p.user || '', act, sheet, where, String(oldV).slice(0, 500), String(newV).slice(0, 500)]);
}

function readLog_(limit) {
  var sh = ss_().getSheetByName(CFG.LOG_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var n = Math.min(limit, sh.getLastRow() - 1);
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, 7).getValues().reverse().map(function (r) {
    return { time: r[0] instanceof Date ? fmtDT_(r[0]) : String(r[0]), user: r[1], action: r[2], sheet: r[3], where: r[4], oldV: r[5], newV: r[6] };
  });
}

/* ============================ SAO LƯU ============================ */

function backupNow() {
  var ss = ss_(), folder = folder_(CFG.BACKUP_FOLDER);
  var name = ss.getName() + ' - Sao lưu ' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm');
  var copy = DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  // Giữ lại BACKUP_KEEP bản mới nhất
  var files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(CFG.BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });
  return { name: name, url: copy.getUrl(), time: fmtDT_(new Date()) };
}

function listBackups_() {
  var folder = folder_(CFG.BACKUP_FOLDER), it = folder.getFiles(), out = [];
  while (it.hasNext()) { var f = it.next(); out.push({ name: f.getName(), url: f.getUrl(), time: fmtDT_(f.getDateCreated()), ts: f.getDateCreated().getTime() }); }
  out.sort(function (a, b) { return b.ts - a.ts; });
  return out;
}

/** Chạy 1 lần trong trình soạn Apps Script: tạo lịch sao lưu tự động lúc 23h hằng ngày. */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backupNow') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(23).inTimezone(CFG.TZ).create();
  imgSheet_();
  return 'Đã bật sao lưu tự động hằng ngày lúc 23:00';
}

/** Chạy 1 lần để đặt mã truy cập chung cho web (đổi chuỗi bên dưới trước khi chạy). */
function setPasscode() {
  PropertiesService.getScriptProperties().setProperty('APP_PASSCODE', 'GHN-M12-2026');
  cache_().remove('PASS'); // mã mới có hiệu lực ngay
  return 'Đã đặt mã truy cập';
}

/* ============================ TIỆN ÍCH ============================ */

function colNum_(L) { var n = 0; for (var i = 0; i < L.length; i++) n = n * 26 + L.charCodeAt(i) - 64; return n; }
function colLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function fmtDT_(d) { return Utilities.formatDate(d, CFG.TZ, 'dd/MM/yyyy HH:mm'); }

/**
 * CHẠY 1 LẦN cho bản Phân quyền (chọn hàm setupV4 → ▶ Chạy). Chạy lại vẫn an toàn.
 *  - Tạo tab ẩn WEB_PHAN_QUYEN (danh sách tài khoản, mã truy cập riêng, vai trò)
 *  - DV_MUA_NGOAI: đổi tên cột "Người xử lý" → "Người thực hiện", "Người duyệt" → "Người duyệt yêu cầu"
 */
function setupV4() {
  var out = [], ss = ss_();
  usersSheet_(); cache_().remove('USERS');
  out.push(USERS_SHEET + ': sẵn sàng (tab ẩn – quản lý trên web, mục Hệ thống → Phân quyền truy cập)');
  var dv = ss.getSheetByName('DV_MUA_NGOAI');
  if (!dv) { createAutoSheet_('DV_MUA_NGOAI'); out.push('DV_MUA_NGOAI: đã tạo'); }
  else {
    [['J4', 'Người xử lý', 'Người thực hiện'], ['K4', 'Người duyệt', 'Người duyệt yêu cầu']].forEach(function (x) {
      var c = dv.getRange(x[0]);
      if (String(c.getValue()).trim() === x[1]) { c.setValue(x[2]); out.push('DV_MUA_NGOAI!' + x[0] + ': đổi thành "' + x[2] + '"'); }
    });
    dv.getRange('A2').setValue(AUTO_SHEETS.DV_MUA_NGOAI.sub);
  }
  bumpRev_('*');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/** Thêm nhiều dòng trong 1 lần gọi (VD: thêm 30 nón bảo hộ vào danh sách) */
function appendMany_(p) {
  var rows = p.rows || [], out = [];
  if (rows.length > 300) throw new Error('Tối đa 300 dòng mỗi lần');
  rows.forEach(function (values) {
    out.push(append_({ sheet: p.sheet, values: values, dataStart: p.dataStart, lastCol: p.lastCol, user: p.user, _me: p._me }).row);
  });
  return { ok: true, rows: out };
}

/** Danh sách lựa chọn hiện có của dropdown ô L5 (để giữ các lựa chọn người dùng đã thêm) */
function currentList_(sh, L) {
  try {
    var dv = sh.getRange(L + '5').getDataValidation();
    if (dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return dv.getCriteriaValues()[0].map(String);
  } catch (e) {}
  return [];
}
/** Ghi lại quy tắc / công thức của tab do web tạo, giữ các lựa chọn dropdown đã thêm */
function reapplyAuto_(sh, name) {
  var d = AUTO_SHEETS[name], copy = {};
  Object.keys(d).forEach(function (k) { copy[k] = d[k]; });
  copy.lists = {};
  Object.keys(d.lists || {}).forEach(function (L) { copy.lists[L] = mergeList_(currentList_(sh, L), d.lists[L]); });
  if (sh.getMaxColumns() < d.headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), d.headers.length - sh.getMaxColumns());
  applyAutoRules_(sh, copy, 4 + (d.rows || 996));
}

/** Nón / áo: thay tab cấp phát theo lượt (CAP_PHAT_BHLD) bằng danh sách DS_BHLD */
function setupBhld_(bp) {
  var ss = ss_(), out = [], old = ss.getSheetByName('CAP_PHAT_BHLD');
  if (old) {
    var hasData = old.getLastRow() >= 5 && old.getRange(5, 4, old.getLastRow() - 4, 4).getValues().some(function (r) { return String(r[0]).trim() || String(r[3]).trim(); });
    if (hasData) { var bk = 'CAP_PHAT_BHLD_CU'; if (ss.getSheetByName(bk)) ss.deleteSheet(ss.getSheetByName(bk)); old.setName(bk); try { old.hideSheet(); } catch (e) {} out.push('CAP_PHAT_BHLD: đổi tên thành tab ẩn ' + bk + ' (có dữ liệu cũ)'); }
    else { ss.deleteSheet(old); out.push('CAP_PHAT_BHLD: đã xóa (chưa có dữ liệu)'); }
  }
  var sh = ss.getSheetByName('DS_BHLD');
  if (!sh) { var d = AUTO_SHEETS.DS_BHLD; d.lists = JSON.parse(JSON.stringify(d.lists)); if (bp) d.lists.F = bp; createAutoSheet_('DS_BHLD'); out.push('DS_BHLD: đã tạo danh sách nón / áo'); }
  else { reapplyAuto_(sh, 'DS_BHLD'); out.push('DS_BHLD: đã có'); }
  return out.join(' · ');
}

/**
 * CHẠY 1 LẦN cho bản V6 (chọn setupV6 → ▶ Chạy, rồi Triển khai phiên bản mới). Chạy lại vẫn an toàn.
 *  1. Tự nhận dấu ngăn cách công thức của Sheet ("," hay ";") rồi ghi lại MỌI công thức do web tạo → hết #ERROR!
 *  2. THONG_KE_PDA: thêm cột K "Dự kiến sửa xong"; thêm tình trạng CHỜ THANH LÝ / ĐÃ THANH LÝ
 *  3. Nón bảo hộ & áo phản quang: chuyển sang dạng danh sách (DS_BHLD) – ai nhận chỉ cần điền tên
 */
function setupV6() {
  var ss = ss_(), out = [];
  PropertiesService.getScriptProperties().deleteProperty('FSEP');
  out.push('Dấu ngăn cách công thức của Sheet: "' + formulaSep_() + '"');
  // 1. Ghi lại công thức
  var nx = ss.getSheetByName('SO_NHAP_XUAT');
  if (nx) addCols_(nx, NX_PRICE_COLS, Math.max(nx.getMaxRows(), 2504), out);
  var tk = ss.getSheetByName('TON_KHO');
  if (tk) addCols_(tk, TK_VALUE_COLS, 154, out);
  var bp = mergeList_(mergeList_(KHO_LIST, nx ? currentList_(nx, 'I') : []), BO_PHAN_DEFAULT);
  ['DV_MUA_NGOAI', 'SO_NX_CCDC', 'TON_KHO_CCDC'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (!sh) { createAutoSheet_(n); out.push(n + ': đã tạo'); }
    else { reapplyAuto_(sh, n); out.push(n + ': đã ghi lại công thức'); }
  });
  out.push(migrateLoanSheet_('CAP_PHAT_PDA', mergeList_(currentList_(ss.getSheetByName('CAP_PHAT_PDA') || nx, 'H'), bp)));
  // 2. Thống kê PDA
  var pd = ss.getSheetByName(PDA_SHEET);
  if (pd) {
    var k4 = pd.getRange('K4');
    if (!String(k4.getValue()).trim()) {
      pd.getRange('J4').copyTo(k4, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      k4.setValue('Dự kiến sửa xong');
    }
    pd.getRange('K5:K204').setNumberFormat('dd/mm/yyyy');
    var st = mergeList_(currentList_(pd, 'E'), ['TỐT', 'HƯ', 'MỚI HƯ', 'CHỜ SỬA', 'ĐÃ GỬI SỬA', 'LƯU TRỮ', 'CHỜ THANH LÝ', 'ĐÃ THANH LÝ']);
    pd.getRange('E5:E204').setDataValidation(listRule_(st));
    out.push('THONG_KE_PDA: cột K "Dự kiến sửa xong", tình trạng thêm CHỜ THANH LÝ / ĐÃ THANH LÝ');
    out.push(setupPdaCodes_());
  }
  // 3. Nón / áo
  out.push(setupBhld_(bp));
  out.push(syncPdaSummary_());
  try { cache_().remove('DEPS'); } catch (e) {}
  bumpRev_('*');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/** Thêm nhân viên chưa có vào DS_NHAN_VIEN từ các tab đã có MSNV + tên (cấp phát PDA, nón / áo) */
function seedStaff_(sh) {
  var ss = ss_(), have = {}, add = [], today = new Date();
  if (sh.getLastRow() >= 5) sh.getRange(5, 2, sh.getLastRow() - 4, 1).getValues().forEach(function (r) { var m = String(r[0]).trim().toUpperCase(); if (m) have[m] = 1; });
  // [tab, cột tên, cột MSNV, cột bộ phận, cột kho] (số cột, bắt đầu từ 1)
  [['CAP_PHAT_PDA', 7, 6, 8, 3], ['DS_BHLD', 4, 5, 6, 3]].forEach(function (src) {
    var s = ss.getSheetByName(src[0]); if (!s || s.getLastRow() < 5) return;
    var vals = s.getRange(5, 1, s.getLastRow() - 4, Math.max(src[1], src[2], src[3], src[4])).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {   // dòng mới nhất trước → lấy bộ phận gần nhất
      var r = vals[i], nm = String(r[src[1] - 1]).trim(), m = String(r[src[2] - 1]).trim();
      if (!nm || !m || /dữ liệu cũ/i.test(nm) || have[m.toUpperCase()]) continue;
      have[m.toUpperCase()] = 1;
      add.push([nm, m, String(r[src[3] - 1]).trim(), String(r[src[4] - 1]).trim(), '', 'Đang làm', today, 'Tự thêm từ ' + src[0]]);
    }
  });
  if (!add.length) return 0;
  var first = 5;
  if (sh.getLastRow() >= 5) {
    var a = sh.getRange(5, 1, sh.getLastRow() - 4, 2).getValues(), lastUsed = 4;
    a.forEach(function (r, i) { if (String(r[0]).trim() || String(r[1]).trim()) lastUsed = 5 + i; });
    first = lastUsed + 1;
  }
  ensureRows_(sh, first + add.length);
  sh.getRange(first, 1, add.length, 8).setValues(add);
  return add.length;
}

/**
 * CHẠY 1 LẦN cho bản V7 (chọn setupV7 → ▶ Chạy, rồi Triển khai phiên bản mới). Chạy lại vẫn an toàn.
 *  1. Tạo tab DS_NHAN_VIEN (Danh sách nhân viên) – nạp sẵn người đã có trong Cấp phát PDA / nón áo
 *  2. Ghi lại dropdown Bộ phận của Cấp phát PDA (giữ lựa chọn đã thêm)
 */
function setupV7() {
  var ss = ss_(), out = [];
  out.push('Dấu ngăn cách công thức của Sheet: "' + formulaSep_() + '"');
  var cp = ss.getSheetByName('CAP_PHAT_PDA');
  var bp = mergeList_(cp ? currentList_(cp, 'H') : [], BO_PHAN_DEFAULT);
  var sh = ss.getSheetByName('DS_NHAN_VIEN');
  var d = AUTO_SHEETS.DS_NHAN_VIEN; d.lists = JSON.parse(JSON.stringify(d.lists)); d.lists.C = bp;
  if (!sh) { sh = createAutoSheet_('DS_NHAN_VIEN'); out.push('DS_NHAN_VIEN: đã tạo'); }
  else { reapplyAuto_(sh, 'DS_NHAN_VIEN'); out.push('DS_NHAN_VIEN: đã có'); }
  out.push('DS_NHAN_VIEN: nạp sẵn ' + seedStaff_(sh) + ' nhân viên từ dữ liệu cũ');
  if (cp) { reapplyAuto_(cp, 'CAP_PHAT_PDA'); out.push('CAP_PHAT_PDA: đã ghi lại dropdown / công thức'); }
  try { cache_().remove('DEPS'); } catch (e) {}
  bumpRev_('*');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/**
 * CHẠY 1 LẦN cho bản V8 (chọn setupV8 → ▶ Chạy, rồi Triển khai phiên bản mới). Chạy lại vẫn an toàn.
 *  1. Tạo tab NHAP_PDA (nhật ký nhập máy PDA: ngày nhập + người nhập)
 *  2. Tạo tab GANG_TAY (sổ găng tay bảo hộ: cấp lần đầu, đổi mới, nhập kho, kiểm kê)
 *  3. Thống kê PDA: tình trạng gom về 4 nhóm Tốt / Mới hư / Hư / Thanh lý (giữ các lựa chọn cũ)
 */
function setupV8() {
  var ss = ss_(), out = [];
  out.push('Dấu ngăn cách công thức của Sheet: "' + formulaSep_() + '"');
  if (!ss.getSheetByName('DS_NHAN_VIEN')) out.push(setupV7());
  var nv = ss.getSheetByName('DS_NHAN_VIEN');
  var bp = mergeList_(nv ? currentList_(nv, 'C') : [], BO_PHAN_DEFAULT);
  ['NHAP_PDA', 'GANG_TAY'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (n === 'GANG_TAY') { var d = AUTO_SHEETS.GANG_TAY; d.lists = JSON.parse(JSON.stringify(d.lists)); d.lists.F = bp; }
    if (!sh) { createAutoSheet_(n); out.push(n + ': đã tạo'); }
    else { reapplyAuto_(sh, n); out.push(n + ': đã có'); }
  });
  var pd = ss.getSheetByName(PDA_SHEET);
  if (pd) {
    var st = mergeList_(['TỐT', 'MỚI HƯ', 'HƯ', 'CHỜ SỬA', 'ĐÃ GỬI SỬA', 'CHỜ THANH LÝ', 'ĐÃ THANH LÝ'], currentList_(pd, 'E'));
    pd.getRange('E5:E204').setDataValidation(listRule_(st));
    out.push('THONG_KE_PDA: dropdown tình trạng ' + st.join(' / '));
  }
  try { cache_().remove('DEPS'); } catch (e) {}
  bumpRev_('*');
  Logger.log(out.join('\n'));
  return out.join('\n');
}
