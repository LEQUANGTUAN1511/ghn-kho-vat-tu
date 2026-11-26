/* GHN · Kho Vật Tư Cụm M12 — ứng dụng web đồng bộ Google Sheet */
(() => {
  'use strict';
  const C = window.APP_CONFIG, S = window.SCHEMA, CAL = window.CAL_DEF;
  const KHO = C.KHO, KHO_CODES = KHO.map(k => k.code);

  /* ------------------------------------------------------------------ storage */
  // Khóa lưu trên máy gắn với từng Sheet: đổi SHEET_ID thì URL, mã truy cập và
  // hàng đợi thay đổi của Sheet cũ không bị đẩy nhầm sang Sheet mới.
  const LS_NS = 'kvt:' + String(C.SHEET_ID || '').slice(0, 10) + ':';
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(LS_NS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(LS_NS + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(LS_NS + k); } catch (e) {} }
  };

  const state = {
    data: null, images: [], rev: 0, mode: 'snapshot',
    kho: LS.get('kho', 'ALL'),
    queue: LS.get('queue', []),
    apiUrl: LS.get('apiUrl', '') || C.API_URL || '',
    key: LS.get('key', ''), user: LS.get('user', ''), me: LS.get('me', null),
    syncing: false, online: true, lastSync: null,
    views: {}, charts: [], editing: false, pendingRender: false
  };

  /* ------------------------------------------------------------------ utils */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const colNum = L => [...L].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const colLet = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const ref = A1 => { const m = /^([A-Z]+)(\d+)$/.exec(A1); return { c: colNum(m[1]), r: +m[2], L: m[1] }; };
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const serialToISO = n => { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const dmy = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const DATE_HINT = /ngày|hạn |hạn kiểm|đặt chậm|đầu quý|cuối quý|đầu tuần|đầu tháng|tháng kế hoạch/i;
  const RAW_HINT = /imei|msnv|^năm$|stt|số phiếu|^tháng$|số biên bản|mã tài sản/i;
  const CODE_COL = /^(mã|imei|msnv|số phiếu|số biên bản)/i;   // cột mã: chữ số đều nhau, dễ dò
  function toDate(v, hint) {
    if (typeof v === 'string' && v.startsWith('D:')) { const [y, m, d] = v.slice(2).split('-').map(Number); return new Date(y, m - 1, d); }
    if (typeof v === 'number' && v > 30000 && v < 80000 && (hint === true || (hint && DATE_HINT.test(hint)))) { const [y, m, d] = serialToISO(v).split('-').map(Number); return new Date(y, m - 1, d); }
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
    return null;
  }
  function fmt(v, hint) {
    if (v === '' || v == null) return '';
    if (typeof v === 'string') {
      if (v.startsWith('D:')) return dmy(v.slice(2));
      if (v.startsWith('P:')) return (Number(v.slice(2)) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%';
      return v;
    }
    if (typeof v === 'number') {
      if (hint && DATE_HINT.test(hint) && v > 30000 && v < 80000) return dmy(serialToISO(v));
      if (hint && RAW_HINT.test(hint)) return String(v);
      return v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
    }
    return String(v);
  }
  const num = v => typeof v === 'number' ? v : (typeof v === 'string' && v.startsWith('P:') ? Number(v.slice(2)) : (Number(String(v).replace(/\./g, '').replace(',', '.')) || 0));
  const plain = v => (typeof v === 'string' && /^[DP]:/.test(v)) ? v.slice(2) : (v == null ? '' : String(v));
  function chipClass(s) {
    const t = String(s).trim().toUpperCase();
    if (!t || t.length > 32) return null;
    if (/^(CẦN ĐẶT|QUÁ HẠN|TRỄ|LỆCH|MÃ SAI|THIẾU|HƯ|MỚI HƯ|CHƯA HOÀN THÀNH|NGỪNG DÙNG|ĐÃ TRẢ – CÓ LỖI)/.test(t)) return 'red';
    if (t === 'ĐANG DÙNG' || t === 'ĐÃ TRẢ') return 'green';
    if (/^(SẮP|GẤP|DƯ$|CHƯA ĐẶT ĐM|CHỜ|ĐANG|ĐÃ THU HỒI|ĐÃ GỬI SỬA|CHƯA KIỂM TRA|CHƯA LÀM)/.test(t)) return 'amber';
    if (/^(OK|KHỚP|XONG|HOÀN THÀNH|TỐT|ĐÃ DUYỆT|ĐÃ DIỄN RA)$/.test(t)) return 'green';
    if (/^(ĐÃ THANH LÝ|LƯU TRỮ|CHƯA BẮT ĐẦU|KHO \(DỰ PHÒNG\))/.test(t)) return 'blue';
    return null;
  }
  const STATUS_COL = /trạng thái|tình trạng|cảnh báo|kiểm tra$|tiến độ|^tình/i;
  const khoInfo = code => KHO.find(k => k.code === code) || { code, name: code, short: code, color: '#17a99a' };
  // So khớp IMEI theo phần số: "IMEI: 8689…", "8689…" (quét mã vạch) là cùng 1 máy
  // IMEI chuẩn 15 chữ số → lấy 15 số cuối (bỏ số dính từ tiền tố như "IMEI1: …")
  const imeiKey = s => String(s == null ? '' : s).replace(/\D/g, '').slice(-15);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type; el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'err' ? 6000 : 3200);
  }

  /* ------------------------------------------------------------------ icons */
  const IC = {
    grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
    book: '<path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 4v16"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    home: '<path d="M3 11 12 4l9 7v9H3z"/><path d="M9 20v-6h6v6"/>',
    box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    tool: '<path d="M14 6a4 4 0 0 0 5 5l-9 9a2 2 0 0 1-3-3l9-9a4 4 0 0 0-2-2z"/>',
    swap: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
    layers: '<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    gauge: '<path d="M12 14l4-4"/><path d="M3 18a9 9 0 1 1 18 0"/>',
    cart: '<path d="M3 4h2l2 12h11l2-8H6"/><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/>',
    tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
    glove: '<path d="M8 21v-5l-3.2-4.3a1.6 1.6 0 0 1 2.5-2L9 11.5V5a1.5 1.5 0 0 1 3 0v5V3.8a1.5 1.5 0 0 1 3 0V10V5.2a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-2 4.5V21"/>',
    helmet: '<path d="M3 17h18M5 17a7 7 0 0 1 14 0"/><path d="M12 6v4M9 7.5l1 3M15 7.5l-1 3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="16" r="1.3"/>',
    file: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/>',
    task: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l1.5 1.5L12 7M8 14l1.5 1.5L12 13M14 8.5h3M14 14.5h3"/>',
    service: '<path d="M4 7h11v13H4z"/><path d="M7 11h5M7 15h3"/><path d="M15 9l3.5-3.5a2 2 0 0 1 3 3L18 12"/><path d="M15 12l3-3"/>'
  };
  const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[n] || IC.file}</svg>`;

  /* ------------------------------------------------------------------ data access */
  const sh = n => state.data && state.data.sheets && state.data.sheets[n];
  const val = (n, r, c) => { const s = sh(n); const row = s && s.v[r - 1]; return row && row[c - 1] != null ? row[c - 1] : ''; };
  const valA = (n, A1) => { const p = ref(A1); return val(n, p.r, p.c); };
  const isF = (n, r, c) => { const s = sh(n); const f = s && s.fm && s.fm[r - 1]; return !!f && f[c - 1] === '1'; };
  const OVERRIDE = { KH_NVL_THANG: ['B4'], KH_CCDC_QUY: ['B4'] };
  const canEditCell = (n, r, c) => canEdit() && (!isF(n, r, c) || (OVERRIDE[n] || []).includes(colLet(c) + r));
  function colComputed(n, c, start) {
    const s = sh(n); if (!s || !s.fm) return false;
    for (let r = start - 1; r < s.fm.length; r++) if (s.fm[r] && s.fm[r][c - 1] === '1') return true;
    return false;
  }
  function setLocal(n, r, c, v) {
    const s = sh(n); if (!s) return;
    while (s.v.length < r) s.v.push([]);
    const row = s.v[r - 1]; while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  function encLocal(v) {
    if (v == null) return '';
    if (typeof v === 'number') return v;
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'D:' + s;
    if (/^-?\d+([.,]\d+)?$/.test(s) && s.length < 15 && !/^0\d/.test(s)) return Number(s.replace(',', '.'));
    return s;
  }
  function dvFor(n, L, r, dataStart) {
    const s = sh(n); if (!s || !s.dv) return null;
    return s.dv[L + r] || (dataStart ? s.dv[L + dataStart] : null) || null;
  }
  function sheetOrder() {
    const order = (state.data && state.data.order) || Object.keys(S);
    return order.filter(n => !window.HIDDEN_SHEETS.includes(n));
  }
  /* Cột "Trạng thái sử dụng" trong DM_NVL / DM_CCDC: "Ngừng dùng" = ẩn khỏi gợi ý nhưng giữ lịch sử */
  const USE_COL_TITLE = 'Trạng thái sử dụng';
  const USE_STOP = 'Ngừng dùng', USE_ON = 'Đang dùng';
  const catSheet = kind => kind === 'NVL' ? 'DM_NVL' : 'DM_CCDC';
  function useCol(name) {
    const row = (sh(name) && sh(name).v[3]) || [];
    const i = row.findIndex(h => String(h).trim().toLowerCase() === USE_COL_TITLE.toLowerCase());
    return i >= 0 ? i + 1 : 0;
  }
  const isStopped = (name, r, uc) => uc > 0 && /^ngừng/i.test(String(val(name, r, uc)).trim());
  /** Danh sách mã. all = true: gồm cả mã đã ngừng dùng (để tra tên cho dữ liệu cũ) */
  function codes(kind, all) {
    if (kind === 'KHO') return KHO_CODES.map(c => ({ v: c, l: khoInfo(c).name }));
    if (kind === 'PDA') {   // THONG_KE_PDA: A = Số máy PDA, B = kho, C = IMEI, D = tên máy, E = tình trạng
      const out = [], n = 'THONG_KE_PDA', s = sh(n); if (!s) return out;
      for (let r = 5; r <= s.v.length; r++) {
        const imei = plain(val(n, r, 3)), a = plain(val(n, r, 1));
        const code = /^\d+$/.test(a) ? '' : a;            // cột A cũ là STT (số) → chưa có số máy
        if (!imei && !code) continue;
        out.push({ v: code || imei, code, imei, l: [code ? imei : '', plain(val(n, r, 4)), plain(val(n, r, 2)), plain(val(n, r, 5))].filter(Boolean).join(' · '),
          name: plain(val(n, r, 4)), kho: plain(val(n, r, 2)).trim(), st: plain(val(n, r, 5)).trim(), desc: plain(val(n, r, 6)), errAt: toDate(val(n, r, 7), true),
          sentAt: toDate(val(n, r, 9), true), backAt: toDate(val(n, r, 10), true), repairDue: toDate(val(n, r, 11), true), r });
      }
      return out;
    }
    const name = catSheet(kind), s = sh(name), out = [];
    if (!s) return out;
    const uc = useCol(name);
    for (let r = 5; r <= s.v.length; r++) {
      const a = val(name, r, 1); if (!a) continue;
      const stop = isStopped(name, r, uc);
      if (stop && !all) continue;
      out.push({ v: a, l: val(name, r, 2), u: val(name, r, 4), g: val(name, r, 3), p: val(name, r, 5), r, stop });
    }
    return out;
  }
  function fillDatalists() {
    ['NVL', 'CCDC', 'KHO', 'PDA'].forEach(k => {
      let dl = $('#dl-' + k);
      if (!dl) { dl = document.createElement('datalist'); dl.id = 'dl-' + k; document.body.appendChild(dl); }
      dl.innerHTML = codes(k).map(o => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('');
    });
  }

  /* ------------------------------------------------------------------ table definition */
  function autoSchema(name) {
    const s = sh(name); let hr = 1;
    if (s) for (let r = 1; r <= Math.min(s.v.length, 15); r++) { if ((s.v[r - 1] || []).filter(x => x !== '').length >= 2) { hr = r; break; } }
    return { title: name, icon: 'file', group: 'other', type: 'table', headerRow: hr, dataStart: hr + 1, addRow: true, addCol: true, auto: true };
  }
  const schemaOf = name => S[name] || autoSchema(name);
  function tableDef(name) {
    const sc = schemaOf(name), s = sh(name);
    if (sc.type === 'calendar') {
      return { ...sc, name, headerRow: CAL.headerRow, dataStart: CAL.dataStart, dataEnd: CAL.dataEnd, params: CAL.params, summary: CAL.summary,
        cols: CAL.headers.map((h, i) => ({ c: i + 1, L: colLet(i + 1), h, computed: i < 2 })), lastCol: 7, addRow: false };
    }
    const hr = sc.headerRow;
    let c1 = 1, c2 = 0;
    if (sc.cols) { [c1, c2] = sc.cols.split(':').map(colNum); }
    else if (s) { c2 = Math.max((s.v[hr - 1] || []).length, 1); }
    const cols = [];
    for (let c = c1; c <= c2; c++) {
      const h = String(val(name, hr, c) || '').trim();
      if (!h || (sc.hideCols || []).includes(colLet(c))) continue;   // hideCols: cột giữ trên Sheet nhưng ẩn trên web
      let kho = null;
      if (sc.khoGroups) for (const k in sc.khoGroups) {
        const g = sc.khoGroups[k], ranges = Array.isArray(g[0]) ? g : [g];   // [từ, đến] hoặc [[từ, đến], …]
        if (ranges.some(([x, y]) => c >= colNum(x) && c <= colNum(y))) kho = k;
      }
      cols.push({ c, L: colLet(c), h, computed: colComputed(name, c, sc.dataStart), kho });
    }
    const lastCol = cols.length ? Math.max(...cols.map(x => x.c)) : c2;
    return { ...sc, name, cols, lastCol };
  }
  function tableRows(def) {
    const s = sh(def.name); if (!s) return [];
    const out = [], end = def.dataEnd ? Math.min(def.dataEnd, s.v.length) : s.v.length;
    for (let r = def.dataStart; r <= end; r++) {
      const row = s.v[r - 1] || [];
      if (def.type === 'calendar') { if (row[0] !== '' && row[0] != null) out.push(r); continue; }
      // Bỏ dòng trống chỉ có kết quả lỗi của công thức (#ERROR!, #N/A…) – không phải dữ liệu thật
      if (def.cols.some(col => { const v = row[col.c - 1]; return v !== '' && v != null && !(typeof v === 'string' && /^#[A-Z/0!?]+!?$/.test(v)); })) out.push(r);
    }
    return out;
  }
  function rowKho(def, r) {
    if (def.kho) return def.kho;
    if (def.khoCol) return String(val(def.name, r, colNum(def.khoCol)) || '');
    return '';
  }
  function rowLabel(def, r) {
    const parts = [];
    for (const col of def.cols) {
      const v = val(def.name, r, col.c);
      if (v !== '' && typeof v === 'string' && !/^[DP]:/.test(v) && v.length < 60) parts.push(v);
      if (parts.length >= 3) break;
    }
    if (def.type === 'calendar') return fmt(val(def.name, r, 1)) + ' · ' + val(def.name, r, 2);
    return parts.join(' · ') || ('Dòng ' + r);
  }
  function fieldType(def, col, r) {
    const n = def.name, h = col.h;
    if (def.type === 'calendar') return col.c >= 5 && col.c <= 6 ? { t: 'select', list: CAL.progressList } : { t: col.c === 7 ? 'textarea' : 'textarea' };
    const list = dvFor(n, col.L, r, def.dataStart);
    if (list) {
      // Cho phép thêm/bớt lựa chọn, trừ cột mã kho (dùng xuyên suốt các công thức)
      const isKhoList = list.every(x => KHO_CODES.includes(String(x)) || String(x) === 'Tất cả');
      return { t: 'select', list, manage: !isKhoList && def.khoCol !== col.L && r >= def.dataStart, L: col.L };
    }
    if (def.khoCol === col.L) return { t: 'select', list: KHO_CODES };
    if (def.lookup && def.lookup[col.L]) return { t: 'lookup', dl: 'dl-' + def.lookup[col.L] };
    const s = sh(n);
    let dates = 0, nums = 0, total = 0;
    for (let rr = def.dataStart; rr <= Math.min(s.v.length, def.dataStart + 300); rr++) {
      const v = val(n, rr, col.c); if (v === '') continue; total++;
      if (typeof v === 'string' && v.startsWith('D:')) dates++; else if (typeof v === 'number') nums++;
    }
    if (dates > 0 || /^ngày|ngày /i.test(h)) return { t: 'date' };
    if ((total && nums / total > .6) || /^(sl|số lượng|đơn giá|tồn|min|max|lead|tuổi thọ|chu kỳ|hệ số|giá trị|t-$)|\(vnđ\)|moq|– min|– max|sl /i.test(h)) {
      if (!RAW_HINT.test(h)) return { t: 'number' };
    }
    if (/ghi chú|mô tả|lý do|nguyên nhân|hạng mục|công việc|note|xử lý/i.test(h)) return { t: 'textarea' };
    // gợi ý các giá trị đã có (nếu ít)
    const distinct = new Set();
    for (let rr = def.dataStart; rr <= s.v.length && distinct.size <= 25; rr++) { const v = val(n, rr, col.c); if (typeof v === 'string' && v && v.length < 50) distinct.add(v); }
    if (distinct.size > 0 && distinct.size <= 25 && total > 6) return { t: 'suggest', list: [...distinct] };
    return { t: 'text' };
  }
  function inputValue(v, ft) {
    if (ft.t === 'date') { const d = toDate(v, true); return d ? isoOf(d) : ''; }
    if (typeof v === 'string' && v.startsWith('P:')) return String(Number(v.slice(2)));
    return plain(v);
  }

  /* ------------------------------------------------------------------ API + queue */
  async function api(action, payload = {}) {
    if (!state.apiUrl) throw new Error('Chưa cấu hình API_URL');
    let res;
    if (action === 'all' || action === 'rev' || action === 'ping' || action === 'log' || action === 'backups') {
      const qs = new URLSearchParams({ action, key: state.key, ...payload, t: Date.now() });
      res = await fetch(state.apiUrl + (state.apiUrl.includes('?') ? '&' : '?') + qs.toString(), { method: 'GET', redirect: 'follow' });
    } else {
      res = await fetch(state.apiUrl, { method: 'POST', redirect: 'follow', body: JSON.stringify({ ...payload, action, key: state.key, user: state.user }) });
    }
    let j;
    try { j = await res.json(); } catch (e) { throw Object.assign(new Error('Phản hồi không hợp lệ từ Apps Script (kiểm tra quyền truy cập "Anyone")'), { net: true }); }
    if (!j.ok) {
      if (String(j.error).startsWith('AUTH')) { state.authFail = true; showLogin(true, String(j.error).replace(/^AUTH:\s*/, '')); throw Object.assign(new Error('Sai mã truy cập'), { auth: true }); }
      if (String(j.error).startsWith('PERM')) throw Object.assign(new Error(String(j.error).replace(/^PERM:\s*/, '')), { perm: true });
      throw new Error(j.error || 'Lỗi không xác định');
    }
    if (j.me) setMe(j.me);
    stripPrivate(j);
    return j;
  }
  /** Bỏ tab chứa mã truy cập khỏi dữ liệu nhận về / bộ nhớ đệm */
  function stripPrivate(d) {
    if (!d) return d;
    (window.PRIVATE_SHEETS || []).forEach(n => {
      if (d.sheets) delete d.sheets[n];
      if (Array.isArray(d.order)) d.order = d.order.filter(x => x !== n);
    });
    return d;
  }
  /** Apps Script đang chạy bản cũ (chưa "Triển khai phiên bản mới") */
  const isOldServer = e => /Hành động không hợp lệ/i.test(String(e && e.message));
  const OLD_SERVER_MSG = 'Apps Script trên web đang chạy bản CŨ. Vào Apps Script → Triển khai → Quản lý tùy chọn triển khai → ✏️ → Phiên bản: Mới → Triển khai, rồi tải lại trang.';

  /* ------------------------------------------------------------------ quyền truy cập
   * me = { name, role: viewer | editor | admin, approver, master } do Apps Script trả về.
   * Apps Script bản cũ không trả `me` → coi như toàn quyền (giữ cách cũ). Máy chủ mới tự kiểm tra lại quyền. */
  const ROLE_LABEL = { viewer: 'Người xem', editor: 'Người chỉnh sửa', admin: 'Quản trị' };
  const canEdit = () => !state.me || state.me.role !== 'viewer';
  const canApprove = () => !state.me || !!state.me.approver;
  const isAdmin = () => !state.me || state.me.role === 'admin';
  function applyRoleUi() {
    document.documentElement.classList.toggle('ro', !canEdit());
    document.documentElement.classList.toggle('no-approve', !canApprove());
    const b = $('#roleBadge');
    if (b) { b.hidden = !state.me; if (state.me) { b.textContent = canEdit() ? (state.me.approver && state.me.role !== 'admin' ? '✓ Người duyệt' : ROLE_LABEL[state.me.role]) : (state.me.approver ? '👁 Xem + duyệt' : '👁 Chỉ xem'); b.className = 'role-badge ' + state.me.role; b.title = `${state.me.name || ''} · ${ROLE_LABEL[state.me.role]}${state.me.approver ? ' · Người duyệt yêu cầu' : ''}`; } }
  }
  function setMe(me) {
    const before = JSON.stringify(state.me || null);
    state.me = me; LS.set('me', me);
    if (me && me.name && !me.master) { state.user = me.name; LS.set('user', me.name); }
    applyRoleUi();
    if (before !== JSON.stringify(me) && state.data) { buildNav(); rerender(); }
  }

  function setSync(kind, text) {
    const b = $('#syncBadge'); b.className = 'sync ' + kind;
    const q = state.queue.length;
    let t = text;
    if (!t) {
      if (!state.apiUrl) t = 'Ngoại tuyến (chưa kết nối)';
      else if (state.authFail) { kind = 'off'; b.className = 'sync off'; t = 'Chưa đăng nhập' + (q ? ` · chờ ${q}` : ''); }
      else if (kind === 'busy') t = 'Đang đồng bộ…';
      else if (kind === 'off') t = 'Mất kết nối' + (q ? ` · chờ ${q}` : '');
      else t = q ? `Chờ đồng bộ ${q}` : ('Đã đồng bộ ' + (state.lastSync ? state.lastSync.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''));
    }
    $('em', b).textContent = t;
    b.title = t;
  }

  function saveQueue() { LS.set('queue', state.queue); }
  function saveCache() {
    if (state.mode !== 'live') return;
    LS.set('cache', { data: state.data, images: state.images, rev: state.rev, at: Date.now() });
  }

  function enqueue(action, payload) {
    const op = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), action, payload, t: Date.now() };
    applyLocal(op);
    state.queue.push(op); saveQueue();
    setSync(state.apiUrl ? 'busy' : '', undefined);
    flush();
    return op;
  }

  function applyLocal(op) {
    const p = op.payload, n = p.sheet; if (!sh(n)) return;
    if (op.action === 'update') p.changes.forEach(ch => setLocal(n, ch.row, ch.col, encLocal(ch.value)));
    else if (op.action === 'append' || op.action === 'appendMany') {
      const s = sh(n);
      const one = values => {
        let target = 0;
        for (let r = p.dataStart; r <= s.v.length + 1; r++) {
          let empty = true;
          for (let c = 1; c <= p.lastCol; c++) { if (!isF(n, r, c) && val(n, r, c) !== '') { empty = false; break; } }
          if (empty) { target = r; break; }
        }
        if (!target) target = s.v.length + 1;
        Object.keys(values).forEach(c => setLocal(n, target, +c, encLocal(values[c])));
        return target;
      };
      if (op.action === 'append') p._row = one(p.values);
      else p._rows = (p.rows || []).map(one);
    } else if (op.action === 'clearRow') {
      for (let c = 1; c <= p.lastCol; c++) if (!isF(n, p.row, c)) setLocal(n, p.row, c, '');
    } else if (op.action === 'addColumn') setLocal(n, p.headerRow, p.col, p.title);
    else if (op.action === 'setList') setLocalList(n, p.col, p.dataStart, p.values);
  }
  /** Thay danh sách dropdown của 1 cột trong dữ liệu trên máy */
  function setLocalList(n, L, dataStart, values) {
    const s = sh(n); if (!s) return;
    s.dv = s.dv || {};
    const re = new RegExp('^' + L + '(\\d+)$');
    Object.keys(s.dv).forEach(k => { const m = re.exec(k); if (m && +m[1] >= dataStart) s.dv[k] = values.slice(); });
    s.dv[L + dataStart] = values.slice();
  }

  async function flush() {
    if (state.authFail) { setSync('off'); return; }
    if (!state.apiUrl || state.syncing || !state.queue.length) { if (!state.queue.length && state.apiUrl && !state.syncing) setSync(state.online ? 'ok' : 'off'); return; }
    state.syncing = true; setSync('busy');
    let changed = false;
    while (state.queue.length) {
      const op = state.queue[0];
      try {
        const { _row, _rows, ...payload } = op.payload;
        await api(op.action, payload);
        state.queue.shift(); saveQueue(); changed = true; state.online = true;
      } catch (e) {
        if (e.auth) break;
        if (e.net || e instanceof TypeError) { state.online = false; break; }
        toast((e.perm ? 'Không có quyền: ' : 'Không ghi được: ') + e.message, 'err');
        state.queue.shift(); saveQueue(); changed = true;
      }
    }
    state.syncing = false;
    setSync(state.online ? (state.queue.length ? 'busy' : 'ok') : 'off');
    if (changed) refreshSoon();
  }
  // Sau khi ghi xong: chỉ tải lại các tab vừa đổi (không tải lại cả file)
  const refreshSoon = debounce(() => checkChanges(true), 600);

  // Sau khi có dữ liệu mới: áp lại thay đổi chưa gửi, lưu đệm, vẽ lại
  function afterData(rev) {
    state.rev = rev; state.mode = 'live'; state.online = true; state.authFail = false; state.lastSync = new Date();
    ensureLocalSheets();
    state.queue.forEach(applyLocal);
    saveCache(); fillDatalists(); buildNav(); updateBanner();
    setSync(state.queue.length ? 'busy' : 'ok');
    rerender();
  }

  async function fetchAll(quiet) {
    if (!state.apiUrl) return;
    state.refreshing = true;
    try {
      setSync('busy', 'Đang tải dữ liệu…');
      const j = await api('all');
      state.data = { sheets: j.sheets, order: j.order, title: j.title, url: j.url, generatedAt: j.generatedAt };
      state.images = j.images || [];
      afterData(j.rev);
      if (!quiet) toast('Đã tải dữ liệu mới nhất từ Google Sheet');
    } catch (e) {
      if (!e.auth) state.online = false;
      setSync('off');
      if (!e.auth) toast('Không tải được dữ liệu: ' + e.message, 'err');
    } finally { state.refreshing = false; }
  }

  /** Tải lại một số tab. `rev` là phiên bản mà danh sách tab này ứng với. */
  async function fetchSheets(names, rev, withDv) {
    state.refreshing = true;
    try {
      setSync('busy', 'Đang cập nhật…');
      // withDv: có tab vừa đổi danh sách dropdown → lấy luôn dropdown mới
      const j = await api('all', { sheets: names.join(','), nodv: withDv ? 0 : 1 });
      if (!j.partial) {                    // Apps Script bản cũ bỏ qua tham số → đã trả về cả file
        state.data = { sheets: j.sheets, order: j.order, title: j.title, url: j.url, generatedAt: j.generatedAt };
      } else {
        Object.keys(j.sheets).forEach(n => {
          const s = j.sheets[n], old = state.data.sheets[n];
          if (!s.dv) s.dv = old ? old.dv : {};
          state.data.sheets[n] = s;
        });
        state.data.generatedAt = j.generatedAt;
      }
      state.images = j.images || state.images;
      afterData(j.partial ? rev : j.rev);
    } finally { state.refreshing = false; }
  }

  /** Hỏi máy chủ có gì mới; có thì chỉ tải lại phần đã đổi. */
  async function checkChanges(force) {
    if (!state.apiUrl || state.authFail || state.refreshing) return;
    if (!force && (document.hidden || state.syncing)) return;
    if (state.queue.length) { flush(); return; }
    try {
      const j = await api('rev', { since: state.rev || 0 });
      state.online = true;
      if (j.rev === state.rev) { setSync('ok'); return; }
      const list = Array.isArray(j.sheets) ? j.sheets : null;
      // Không có danh sách (Apps Script bản cũ / nhật ký hết hạn) hoặc có tab mới → tải lại toàn bộ
      if (!list || state.mode !== 'live' || !state.data || list.some(n => !state.data.sheets[n])) return await fetchAll(true);
      if (!list.length) { state.rev = j.rev; setSync('ok'); return; }
      await fetchSheets(list, j.rev, Array.isArray(j.dvSheets) && j.dvSheets.length > 0);
    } catch (e) {
      if (!e.auth) { state.online = false; setSync('off'); }
    }
  }
  const poll = () => checkChanges(false);

  /** Đồng bộ ngầm KHÔNG được làm mất việc đang làm: đang gõ dở, đang mở hộp thoại / ngăn kéo → chờ xong mới vẽ lại */
  function renderBlocked() {
    if (state.editing || $('#drawer').classList.contains('open') || document.querySelector('.modal-bg')) return true;
    const a = document.activeElement;
    if (a && a.closest && a.closest('#view') && !a.closest('.search') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    // Ô đã gõ / đã tích nhưng chưa lưu (ô tìm kiếm không tính – giá trị tìm kiếm được giữ khi vẽ lại)
    return $$('#view input, #view textarea').some(el => !el.closest('.search') && el.offsetParent !== null &&
      ((el.type === 'checkbox' || el.type === 'radio') ? el.checked !== el.defaultChecked : el.value !== el.defaultValue));
  }
  function rerender() {
    if (renderBlocked()) { state.pendingRender = true; return; }
    state.pendingRender = false;
    route(true);
  }
  // Xong việc (rời ô nhập / đóng hộp thoại) → vẽ lại phần dữ liệu đã đồng bộ trong lúc chờ
  document.addEventListener('focusout', () => setTimeout(() => { if (state.pendingRender && !renderBlocked()) rerender(); }, 400));

  /* ------------------------------------------------------------------ layout */
  function buildNav() {
    const cur = location.hash || '#/tong-quan';
    const a = (href, ic, label, extra = '') => `<a class="nav-item${cur === href ? ' active' : ''}" href="${href}">${ic}<span>${esc(label)}</span>${extra}</a>`;
    let h = a('#/tong-quan', icon('grid'), 'Tổng quan');
    h += '<div class="nav-sec">Theo dõi từng kho</div>';
    KHO.forEach(k => {
      const m = state.data ? quickAlerts(k.code) : 0;
      h += a('#/kho/' + k.code, `<i class="dot" style="background:${k.color}"></i>`, k.name, m ? `<span class="cnt" title="Cảnh báo">${m}</span>` : '');
    });
    const order = sheetOrder();
    window.NAV_GROUPS.forEach(g => {
      const items = order.filter(n => schemaOf(n).group === g.id);
      const extras = (window.NAV_EXTRA || {})[g.id] || [];
      if (!items.length && !extras.length) return;
      h += `<div class="nav-sec">${esc(g.title)}</div>`;
      const kk = state.kho === 'ALL' ? null : state.kho;
      const extraAfter = n => extras.filter(x => x.after === n).forEach(x => { h += a(x.href, icon(x.icon), x.title); });
      items.forEach(n => {
        const sc = schemaOf(n);
        let extra = '';
        if (sc.type === 'task' && state.data) { const c = taskCounts(kk); const m = c.overdue + c.today; if (m) extra = `<span class="cnt" title="Quá hạn + đến hạn hôm nay">${m}</span>`; }
        if (sc.type === 'dv' && state.data) { const c = dvCounts(kk); const m = c.late + c.wait; if (m) extra = `<span class="cnt" title="Quá hạn timeline + chờ duyệt">${m}</span>`; }
        if (sc.type === 'gloves' && state.data && sh(n)) { const m = glovePeople(gloveRows(), kk).filter(p => p.status === 'due').length; if (m) extra = `<span class="cnt" title="Quá 3 tuần chưa đổi găng">${m}</span>`; }
        if (sc.loan && state.data) { const m = loanCounts(LOANS[sc.loan], kk).late; if (m) extra = `<span class="cnt" title="Quá hạn trả">${m}</span>`; }
        h += a('#/sheet/' + encodeURIComponent(n), icon(sc.icon), sc.title, extra);
        extraAfter(n);
      });
      extras.filter(x => !x.after || !items.includes(x.after)).forEach(x => { h += a(x.href, icon(x.icon), x.title); });
    });
    h += '<div class="nav-sec">Hệ thống</div>';
    h += a('#/hinh-anh', icon('image'), 'Thư viện hình ảnh', state.images.length ? `<span class="cnt" style="background:#2b6f68">${state.images.length}</span>` : '');
    h += a('#/nhat-ky', icon('history'), 'Nhật ký thay đổi');
    h += a('#/phan-quyen', icon('lock'), 'Phân quyền truy cập');
    h += a('#/cai-dat', icon('gear'), 'Cài đặt & Sao lưu');
    const sb = $('#sidebar'), sy = sb ? sb.scrollTop : 0;
    $('#nav').innerHTML = h;
    if (sb) sb.scrollTop = sy;   // đồng bộ ngầm không làm menu nhảy về đầu
  }

  function updateBanner() {
    const b = $('#banner');
    if (!state.apiUrl) {
      b.hidden = false;
      b.innerHTML = `<b>Chế độ ngoại tuyến.</b> Đang hiển thị dữ liệu chụp từ Google Sheet lúc ${esc(window.SNAPSHOT.generatedAt)}. Mọi thay đổi được lưu tạm trên máy này và sẽ tự đẩy lên Sheet khi kết nối. <a href="#/cai-dat">Kết nối Google Sheet →</a>`;
    } else if (state.mode !== 'live') {
      b.hidden = false; b.innerHTML = 'Đang dùng dữ liệu lưu trên máy. Đang kết nối Google Sheet…';
    } else b.hidden = true;
  }

  function setCrumb(title, sub) { $('#crumb').innerHTML = esc(title) + (sub ? `<small>${esc(sub)}</small>` : ''); document.title = title + ' · GHN Kho Vật Tư'; }

  function destroyCharts() { state.charts.forEach(c => { try { c.destroy(); } catch (e) {} }); state.charts = []; }

  function route(keepScroll) {
    const h = decodeURIComponent(location.hash || '#/tong-quan');
    const y = window.scrollY;
    // Giữ vị trí cuộn của bảng / danh sách bên trong trang (VD bảng Thống kê PDA đang cuộn tới dòng 80)
    const SCROLLERS = '#view .tbl-wrap, #view .lm-list, #view .scroll-keep';
    const inner = keepScroll ? $$(SCROLLERS).map(el => [el.scrollTop, el.scrollLeft]) : [];
    const sideEl = $('#nav') && $('#nav').closest('aside, .side, .sidebar'), sideY = sideEl ? sideEl.scrollTop : 0;
    destroyCharts();
    buildNav();
    $('#app').classList.remove('nav-open');
    const view = $('#view');
    if (!state.data) { view.innerHTML = '<div class="empty">Đang tải…</div>'; return; }
    let m;
    if ((m = /^#\/kho\/(.+)$/.exec(h))) { renderKho(view, m[1]); loanAlerts(view, m[1]); gloveAlert(view, m[1]); dvAlert(view, m[1]); taskAlert(view, m[1]); }
    else if ((m = /^#\/sheet\/(.+)$/.exec(h))) renderSheet(view, m[1]);
    else if (h === '#/hinh-anh') renderGallery(view);
    else if (h === '#/nhat-ky') renderLog(view);
    else if (h === '#/cai-dat') renderSettings(view);
    else if (h === '#/phan-quyen') renderPerm(view);
    else if (h === '#/bao-cao-pda') renderPdaReport(view);
    else { const k = state.kho === 'ALL' ? null : state.kho; renderOverview(view); loanAlerts(view, k); gloveAlert(view, k); dvAlert(view, k); taskAlert(view, k); }
    if (keepScroll) {
      window.scrollTo(0, y);
      $$(SCROLLERS).forEach((el, i) => { if (inner[i]) { el.scrollTop = inner[i][0]; el.scrollLeft = inner[i][1]; } });
    } else window.scrollTo(0, 0);
    if (sideEl) sideEl.scrollTop = sideY;
  }

  /* ------------------------------------------------------------------ metrics */
  const STATUS_COLS = { HCM20: 9, ST: 15, TK: 21 };
  const TONCUOI_COLS = { HCM20: 7, ST: 13, TK: 19 };
  function scopeKhos(k) { return k === 'ALL' ? KHO_CODES : [k]; }
  function metrics(k) {
    const ks = scopeKhos(k), inK = x => ks.includes(String(x));
    const t0 = today0(), m0 = new Date(t0.getFullYear(), t0.getMonth(), 1);
    const w0 = new Date(t0); w0.setDate(t0.getDate() - ((t0.getDay() + 6) % 7));
    const q0 = new Date(t0.getFullYear(), Math.floor(t0.getMonth() / 3) * 3, 1);
    const M = { nvl: 0, need: [], status: { 'CẦN ĐẶT': 0, 'OK': 0, 'Dư': 0, 'Chưa đặt ĐM': 0 }, txMonth: 0, txErr: 0, recent: [], series: {}, topOut: {},
      ccdcUse: 0, ccdcBad: 0, ccdcOver: 0, ccdcSoon: 0, ccdcCheck: 0, ccdcAlerts: [], hwWeek: 0, hwMonth: 0, hwQuarter: 0, tlPending: 0,
      pda: {}, pdaTotal: 0, pdaBad: 0, nextEvent: null, checklistLate: 0, cal: {} };
    // NVL & tồn
    if (sh('DM_NVL')) for (let r = 5; r <= sh('DM_NVL').v.length; r++) if (val('DM_NVL', r, 1)) M.nvl++;
    if (sh('TON_KHO')) for (let r = 5; r <= sh('TON_KHO').v.length; r++) {
      const code = val('TON_KHO', r, 1); if (!code) continue;
      ks.forEach(kk => {
        const st = String(val('TON_KHO', r, STATUS_COLS[kk]) || '');
        if (st in M.status) M.status[st]++;
        if (st === 'CẦN ĐẶT') M.need.push({ kho: kk, code, name: val('TON_KHO', r, 2), unit: val('TON_KHO', r, 3), ton: val('TON_KHO', r, TONCUOI_COLS[kk]), min: val('TON_KHO', r, TONCUOI_COLS[kk] + 1) });
      });
    }
    // Sổ nhập xuất
    const months = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(t0.getFullYear(), t0.getMonth() - i, 1); const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; months.push(key); M.series[key] = { in: 0, out: 0 }; }
    M.months = months;
    const d30 = new Date(t0); d30.setDate(d30.getDate() - 30);
    const sx = sh('SO_NHAP_XUAT');
    if (sx) for (let r = 5; r <= sx.v.length; r++) {
      const kho = val('SO_NHAP_XUAT', r, 3); if (!inK(kho)) continue;
      const code = val('SO_NHAP_XUAT', r, 5); if (!code) continue;
      const d = toDate(val('SO_NHAP_XUAT', r, 1), true), type = String(val('SO_NHAP_XUAT', r, 4)), q = num(val('SO_NHAP_XUAT', r, 8));
      const chk = String(val('SO_NHAP_XUAT', r, 13));
      if (chk && chk !== 'OK') M.txErr++;
      if (d) {
        if (d >= m0) M.txMonth++;
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        if (M.series[key]) { if (/^Nhập|đến$/.test(type)) M.series[key].in++; else M.series[key].out++; }
        if (d >= d30 && /^Xuất/.test(type)) { const o = M.topOut[code] || (M.topOut[code] = { code, name: val('SO_NHAP_XUAT', r, 6), unit: val('SO_NHAP_XUAT', r, 7), q: 0 }); o.q += q; }
      }
      M.recent.push({ r, d, kho, type, code, name: val('SO_NHAP_XUAT', r, 6), q, unit: val('SO_NHAP_XUAT', r, 7), who: val('SO_NHAP_XUAT', r, 10) || val('SO_NHAP_XUAT', r, 9) });
    }
    M.recent.sort((a, b) => (b.d || 0) - (a.d || 0) || b.r - a.r); M.recent = M.recent.slice(0, 12);
    M.top = Object.values(M.topOut).sort((a, b) => b.q - a.q).slice(0, 8);
    // CCDC
    const ts = sh('TAI_SAN_CCDC');
    if (ts) for (let r = 5; r <= ts.v.length; r++) {
      if (!val('TAI_SAN_CCDC', r, 2) || !inK(val('TAI_SAN_CCDC', r, 4))) continue;
      const q = num(val('TAI_SAN_CCDC', r, 5)) || 0, st = String(val('TAI_SAN_CCDC', r, 9)), w = String(val('TAI_SAN_CCDC', r, 13)), kt = String(val('TAI_SAN_CCDC', r, 16));
      if (st !== 'Kho (dự phòng)' && st !== 'Đã thanh lý') M.ccdcUse += q;
      if (st === 'Hư hỏng' || st === 'Đang sửa') M.ccdcBad += q;
      if (w === 'QUÁ HẠN') M.ccdcOver += q;
      if (/^Sắp/.test(w)) M.ccdcSoon += q;
      if (kt === 'QUÁ HẠN KT' || kt === 'Chưa kiểm tra') M.ccdcCheck++;
      if (w === 'QUÁ HẠN' || /^Sắp/.test(w) || kt === 'QUÁ HẠN KT') M.ccdcAlerts.push({ r, name: val('TAI_SAN_CCDC', r, 3), kho: val('TAI_SAN_CCDC', r, 4), w: w !== 'OK' ? w : kt });
    }
    const hh = sh('HU_HONG');
    if (hh) for (let r = 5; r <= hh.v.length; r++) {
      if (!inK(val('HU_HONG', r, 5))) continue;
      const d = toDate(val('HU_HONG', r, 1), true); if (!d) continue;
      const q = num(val('HU_HONG', r, 9));
      if (d >= w0) M.hwWeek += q; if (d >= m0) M.hwMonth += q; if (d >= q0) M.hwQuarter += q;
    }
    const tl = sh('THANH_LY');
    if (tl) for (let r = 5; r <= tl.v.length; r++) {
      if (!inK(val('THANH_LY', r, 3))) continue;
      const st = String(val('THANH_LY', r, 12));
      if (st && st !== 'Đã thanh lý') M.tlPending += num(val('THANH_LY', r, 6));
    }
    const pd = sh('THONG_KE_PDA');
    if (pd) for (let r = 5; r <= pd.v.length; r++) {
      if (!val('THONG_KE_PDA', r, 3) && !val('THONG_KE_PDA', r, 4)) continue;
      if (!inK(val('THONG_KE_PDA', r, 2))) continue;
      const st = String(val('THONG_KE_PDA', r, 5) || 'Chưa rõ');
      M.pda[st] = (M.pda[st] || 0) + 1; M.pdaTotal++;
      if (/HƯ|SỬA/.test(st)) M.pdaBad++;
    }
    // Event
    const le = sh('LICH_EVENT');
    if (le) {
      let best = null;
      for (let r = 5; r <= le.v.length; r++) { const d = toDate(val('LICH_EVENT', r, 2), true); if (d && d >= t0 && (!best || d < best.d)) best = { d, name: val('LICH_EVENT', r, 1), r }; }
      if (best) best.days = Math.round((best.d - t0) / 86400000);
      M.nextEvent = best;
    }
    const ck = sh('CHECKLIST_EVENT');
    if (ck) for (let r = 8; r <= ck.v.length; r++) if (val('CHECKLIST_EVENT', r, 8) === 'TRỄ') M.checklistLate++;
    // Lịch công việc
    ks.forEach(kk => {
      const n = khoInfo(kk).cal, s = sh(n); if (!s) return;
      let total = 0, done = 0, todayRow = null;
      for (let r = 6; r <= 36; r++) {
        for (const [c, p] of [[3, 5], [4, 6]]) { if (val(n, r, c) !== '') { total++; if (val(n, r, p) === 'Hoàn Thành') done++; } }
        const d = toDate(val(n, r, 1), true); if (d && +d === +t0) todayRow = r;
      }
      M.cal[kk] = { total, done, pct: total ? done / total : 0, todayRow, sheet: n };
    });
    return M;
  }
  function quickAlerts(k) {
    let n = 0;
    if (sh('TON_KHO')) for (let r = 5; r <= sh('TON_KHO').v.length; r++) if (val('TON_KHO', r, STATUS_COLS[k]) === 'CẦN ĐẶT') n++;
    if (sh('THONG_KE_PDA')) for (let r = 5; r <= sh('THONG_KE_PDA').v.length; r++) if (val('THONG_KE_PDA', r, 2) === k && /^(HƯ|MỚI HƯ)$/.test(val('THONG_KE_PDA', r, 5))) n++;
    return n;
  }

  /* ------------------------------------------------------------------ charts */
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function chart(canvas, cfg) {
    if (!window.Chart || !canvas) return;
    Chart.defaults.font.family = "'Be Vietnam Pro', system-ui, sans-serif";
    Chart.defaults.color = cssVar('--muted');
    Chart.defaults.borderColor = cssVar('--line');
    state.charts.push(new Chart(canvas, cfg));
  }
  const monthLabel = key => { const [y, m] = key.split('-'); return `T${+m}/${y.slice(2)}`; };

  /* ------------------------------------------------------------------ overview */
  function kpi(label, value, hint, cls = '', go = '') {
    return `<div class="kpi ${cls}" ${go ? `data-go="${esc(go)}"` : ''}><div class="lbl">${esc(label)}</div><div class="val">${esc(value)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
  }
  function bindGo(root) { $$('[data-go]', root).forEach(el => el.addEventListener('click', () => { const g = el.dataset.go; if (g.startsWith('kho:')) { const [, k, url] = g.split('|'); setKho(k); location.hash = url; } else location.hash = g; })); }
  function kpiGrid(M, k) {
    const go = (sheet) => `kho:|${k}|#/sheet/${sheet}`;
    return `<div class="kpis">
      ${kpi('Mã NVL quản lý', M.nvl, 'Danh mục DM_NVL', '', '#/sheet/DM_NVL')}
      ${kpi('Mã dưới Min – CẦN ĐẶT', M.status['CẦN ĐẶT'], `Chưa đặt định mức: ${M.status['Chưa đặt ĐM']}`, M.status['CẦN ĐẶT'] ? 'red' : 'green', go('TON_KHO'))}
      ${kpi('Giao dịch trong tháng', M.txMonth.toLocaleString('vi-VN'), M.txErr ? `${M.txErr} dòng lỗi / thiếu dữ liệu` : 'Không có dòng lỗi', M.txErr ? 'amber' : 'blue', go('SO_NHAP_XUAT'))}
      ${kpi('CCDC đang sử dụng', M.ccdcUse.toLocaleString('vi-VN'), `Hư/đang sửa: ${M.ccdcBad} · Quá hạn: ${M.ccdcOver}`, M.ccdcOver ? 'red' : '', go('TAI_SAN_CCDC'))}
      ${kpi('Hư hỏng tuần / tháng / quý', `${M.hwWeek} / ${M.hwMonth} / ${M.hwQuarter}`, 'Từ nhật ký HU_HONG', M.hwWeek ? 'amber' : '', go('HU_HONG'))}
      ${kpi('CCDC chờ thanh lý (SL)', M.tlPending.toLocaleString('vi-VN'), 'Chờ duyệt / đã thu hồi', M.tlPending ? 'amber' : '', go('THANH_LY'))}
      ${kpi('PDA đang hư / chờ sửa', `${M.pdaBad} / ${M.pdaTotal}`, 'Tổng số máy đã khai báo', M.pdaBad ? 'red' : 'green', go('THONG_KE_PDA'))}
      ${kpi('Checklist event TRỄ', M.checklistLate, M.nextEvent ? `${M.nextEvent.name} – còn ${M.nextEvent.days} ngày` : '', M.checklistLate ? 'red' : 'green', '#/sheet/CHECKLIST_EVENT')}
    </div>`;
  }

  function renderOverview(view) {
    setCrumb('Tổng quan', 'Cụm M12 · 3 kho');
    const k = state.kho, M = metrics(k), ev = M.nextEvent;
    const per = KHO.map(x => ({ x, m: metrics(x.code) }));
    view.innerHTML = `
      <section class="hero"><div class="hero-row">
        <div><h1>Quản lý Kho Vật Tư – Cụm M12</h1>
          <p>${KHO.map(x => esc(x.name)).join(' · ')}</p>
          <p style="font-size:12.5px">Hôm nay ${dmy(isoOf(today0()))} · ${state.mode === 'live' ? 'Dữ liệu trực tiếp từ Google Sheet' : 'Dữ liệu chụp lúc ' + esc(window.SNAPSHOT.generatedAt)}${k !== 'ALL' ? ' · Đang lọc: ' + esc(khoInfo(k).name) : ''}</p></div>
        ${ev ? `<div class="hero-right"><div style="font-size:12px;color:#a8d9d2">Event kế tiếp</div><div style="font-weight:700;margin:4px 0">${esc(ev.name)} · ${dmy(isoOf(ev.d))}</div><div class="big">${ev.days} <span style="font-size:15px;font-weight:600">ngày</span></div></div>` : ''}
      </div></section>
      <div class="mt">${kpiGrid(M, k)}</div>
      <h3 class="mt" style="margin-top:22px;font-size:15px">Theo dõi riêng từng kho</h3>
      <div class="kho-cards mt">${per.map(({ x, m }) => `
        <div class="kho-card" style="--c:${x.color}" data-go="#/kho/${x.code}">
          <h3><span class="code">${x.code}</span>${esc(x.name)}</h3>
          <div class="rows">
            <span>Mã CẦN ĐẶT</span><b style="color:${m.status['CẦN ĐẶT'] ? 'var(--red)' : 'inherit'}">${m.status['CẦN ĐẶT']}</b>
            <span>Giao dịch tháng này</span><b>${m.txMonth}</b>
            <span>CCDC đang dùng / hư</span><b>${m.ccdcUse} / ${m.ccdcBad}</b>
            <span>PDA hư / tổng</span><b>${m.pdaBad} / ${m.pdaTotal}</b>
            <span>Chờ thanh lý</span><b>${m.tlPending}</b>
            <span>Lịch CV tháng (${m.cal[x.code] ? m.cal[x.code].done + '/' + m.cal[x.code].total : '0/0'})</span><b>${m.cal[x.code] ? Math.round(m.cal[x.code].pct * 100) : 0}%</b>
          </div>
          <div class="bar" style="margin-top:8px"><i style="width:${m.cal[x.code] ? Math.round(m.cal[x.code].pct * 100) : 0}%;background:${x.color}"></i></div>
        </div>`).join('')}</div>
      <div class="grid g2 mt">
        <div class="card"><div class="card-h"><h3>Giao dịch nhập / xuất 6 tháng</h3><span class="sub">số dòng giao dịch theo kho</span></div><div class="card-b"><div class="chart-box"><canvas id="chTx"></canvas></div></div></div>
        <div class="card"><div class="card-h"><h3>Trạng thái tồn kho NVL</h3><span class="sub">${k === 'ALL' ? 'cả cụm (mã × kho)' : esc(khoInfo(k).name)}</span></div><div class="card-b"><div class="chart-box"><canvas id="chSt"></canvas></div></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><div class="card-h"><h3>Mã cần đặt hàng</h3><span class="chip red">${M.need.length}</span><div class="right"><a class="btn sm" href="#/sheet/KH_NVL_THANG">Kế hoạch đặt NVL →</a></div></div>${needList(M.need)}</div>
        <div class="card"><div class="card-h"><h3>Cảnh báo & việc cần làm</h3></div>${alertList(M)}</div>
      </div>
      ${dashboardSheetCard()}`;
    bindGo(view);
    const txSets = per.map(({ x, m }) => ({ label: x.code, data: m.months.map(key => m.series[key].in + m.series[key].out), backgroundColor: x.color, borderRadius: 5, stack: 's' }));
    chart($('#chTx'), { type: 'bar', data: { labels: M.months.map(monthLabel), datasets: k === 'ALL' ? txSets : [
      { label: 'Nhập', data: M.months.map(key => M.series[key].in), backgroundColor: '#17a99a', borderRadius: 5 },
      { label: 'Xuất', data: M.months.map(key => M.series[key].out), backgroundColor: '#f59e0b', borderRadius: 5 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: k === 'ALL', grid: { display: false } }, y: { stacked: k === 'ALL', beginAtZero: true } } } });
    statusDonut($('#chSt'), M);
  }
  function statusDonut(canvas, M) {
    chart(canvas, { type: 'doughnut', data: { labels: ['CẦN ĐẶT', 'OK', 'Dư', 'Chưa đặt ĐM'], datasets: [{ data: [M.status['CẦN ĐẶT'], M.status.OK, M.status['Dư'], M.status['Chưa đặt ĐM']], backgroundColor: ['#dc3b3b', '#17a99a', '#3b82f6', '#c9d6d4'], borderWidth: 0 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right' } } } });
  }
  function needList(need) {
    if (!need.length) return '<div class="empty">Không có mã nào dưới mức Min 🎉<br><small>(Lưu ý: mã chưa đặt định mức sẽ không được cảnh báo – nhập Min/Max ở tab Định mức)</small></div>';
    return '<ul class="list">' + need.slice(0, 12).map(x => `<li><span class="chip" style="background:${khoInfo(x.kho).color};color:#fff;border:0">${x.kho}</span><div class="grow"><div class="t">${esc(x.name)}</div><div class="s">${esc(x.code)} · tồn ${fmt(x.ton)} / min ${fmt(x.min)} ${esc(x.unit)}</div></div><span class="chip red">CẦN ĐẶT</span></li>`).join('') + (need.length > 12 ? `<li class="muted">… và ${need.length - 12} mã khác</li>` : '') + '</ul>';
  }
  function alertList(M) {
    const items = [];
    if (M.checklistLate) items.push(['red', `${M.checklistLate} việc checklist event đang TRỄ`, '#/sheet/CHECKLIST_EVENT']);
    if (M.txErr) items.push(['amber', `${M.txErr} giao dịch lỗi / thiếu dữ liệu trong sổ nhập xuất`, '#/sheet/SO_NHAP_XUAT']);
    if (M.ccdcOver) items.push(['red', `${M.ccdcOver} CCDC đã QUÁ HẠN tuổi thọ`, '#/sheet/TAI_SAN_CCDC']);
    if (M.ccdcSoon) items.push(['amber', `${M.ccdcSoon} CCDC sắp hết tuổi thọ (≤ 90 ngày)`, '#/sheet/TAI_SAN_CCDC']);
    if (M.ccdcCheck) items.push(['amber', `${M.ccdcCheck} dòng tài sản quá hạn / chưa kiểm tra`, '#/sheet/TAI_SAN_CCDC']);
    if (M.pdaBad) items.push(['red', `${M.pdaBad} máy PDA đang hư / chờ sửa`, '#/sheet/THONG_KE_PDA']);
    if (M.tlPending) items.push(['amber', `${M.tlPending} CCDC đang chờ thanh lý`, '#/sheet/THANH_LY']);
    if (M.status['Chưa đặt ĐM']) items.push(['blue', `${M.status['Chưa đặt ĐM']} mã × kho chưa đặt định mức Min/Max`, '#/sheet/DINH_MUC']);
    if (M.nextEvent) items.push(['brand', `${M.nextEvent.name}: còn ${M.nextEvent.days} ngày (${dmy(isoOf(M.nextEvent.d))})`, '#/sheet/LICH_EVENT']);
    if (!items.length) return '<div class="empty">Không có cảnh báo.</div>';
    return '<ul class="list">' + items.map(([c, t, href]) => `<li><span class="chip ${c}">●</span><div class="grow"><div class="t" style="white-space:normal">${esc(t)}</div></div><a class="btn sm" href="${href}">Xem</a></li>`).join('') + '</ul>';
  }
  function dashboardSheetCard() {
    const n = 'DASHBOARD', s = sh(n); if (!s) return '';
    return `<div class="card mt"><div class="card-h"><h3>Bảng so sánh 3 kho</h3><span class="sub">số liệu tự tính trong tab DASHBOARD của Google Sheet</span><div class="right"><a class="btn sm" href="#/sheet/DASHBOARD">Xem tab</a></div></div>${reportTable(n, 4)}</div>`;
  }
  function reportTable(n, hr) {
    const s = sh(n); let h = '<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr>';
    const head = s.v[hr - 1] || [];
    head.forEach((x, i) => { h += `<th style="${i ? 'text-align:right' : ''}">${esc(x)}</th>`; });
    h += '</tr></thead><tbody>';
    for (let r = hr + 1; r <= s.v.length; r++) {
      const row = s.v[r - 1] || []; if (!row.length) continue;
      const filled = row.filter(x => x !== '').length;
      if (filled === 1 && row[0]) { h += `<tr><td colspan="${head.length}" style="background:var(--brand-soft);font-weight:700;color:var(--brand-strong)">${esc(row[0])}</td></tr>`; continue; }
      h += '<tr>' + head.map((_, i) => { const v = row[i] ?? ''; const isN = typeof v === 'number'; return `<td class="${i ? (isN ? 'num' : '') : 'wrap'}">${i ? esc(fmt(v, row[0])) : esc(v)}</td>`; }).join('') + '</tr>';
    }
    return h + '</tbody></table></div>';
  }

  /* ------------------------------------------------------------------ kho page */
  function renderKho(view, code) {
    const k = khoInfo(code); if (!KHO_CODES.includes(code)) { view.innerHTML = '<div class="empty">Không có kho này.</div>'; return; }
    setCrumb(k.name, 'Theo dõi riêng');
    const M = metrics(code);
    let dmRow = 0; if (sh('DM_KHO')) for (let r = 5; r <= sh('DM_KHO').v.length; r++) if (val('DM_KHO', r, 1) === code) dmRow = r;
    const info = dmRow ? { tk: val('DM_KHO', dmRow, 3), dc: val('DM_KHO', dmRow, 4), gc: val('DM_KHO', dmRow, 5) } : {};
    const cal = M.cal[code] || {};
    const go = sheet => `kho:|${code}|#/sheet/${sheet}`;
    const pdaChips = Object.entries(M.pda).map(([st, n]) => `<span class="chip ${chipClass(st) || ''}">${esc(st)}: ${n}</span>`).join(' ') || '<span class="muted">Chưa khai báo PDA cho kho này</span>';
    let todayHtml = '<div class="empty">Không có dòng lịch cho hôm nay (đổi Tháng/Năm ở tab lịch).</div>';
    if (cal.todayRow) {
      const n = cal.sheet, r = cal.todayRow;
      todayHtml = `<ul class="list">
        <li><span class="chip brand">Sáng</span><div class="grow"><div class="t" style="white-space:normal">${esc(val(n, r, 3)) || '<span class="muted">(chưa nhập)</span>'}</div></div>${val(n, r, 5) ? `<span class="chip ${chipClass(val(n, r, 5))}">${esc(val(n, r, 5))}</span>` : ''}</li>
        <li><span class="chip blue">Tối</span><div class="grow"><div class="t" style="white-space:normal">${esc(val(n, r, 4)) || '<span class="muted">(chưa nhập)</span>'}</div></div>${val(n, r, 6) ? `<span class="chip ${chipClass(val(n, r, 6))}">${esc(val(n, r, 6))}</span>` : ''}</li>
        ${val(n, r, 7) ? `<li><span class="chip">Note</span><div class="grow">${esc(val(n, r, 7))}</div></li>` : ''}</ul>`;
    }
    view.innerHTML = `
      <section class="hero" style="background:linear-gradient(135deg, color-mix(in srgb, ${k.color} 55%, #04201f) 0%, #04201f 65%, #021514 100%)"><div class="hero-row">
        <div><h1>${esc(k.name)}</h1>
          <p>Mã kho <b>${code}</b> · Thủ kho: <b>${esc(info.tk || '—')}</b> · Địa chỉ: ${esc(info.dc || '—')}</p>
          ${info.gc ? `<p>${esc(info.gc)}</p>` : ''}
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            ${dmRow ? `<button class="btn sm" id="editKho">✎ Sửa thông tin kho</button>` : ''}
            <button class="btn sm primary" data-new="SO_NHAP_XUAT">＋ Phiếu nhập / xuất</button>
            <button class="btn sm" data-new="KIEM_KE">＋ Kiểm kê</button>
            <button class="btn sm" data-new="HU_HONG">＋ Ghi hư hỏng</button>
            <button class="btn sm" data-new="TAI_SAN_CCDC">＋ Cấp phát CCDC</button>
            <button class="btn sm" data-new="THONG_KE_PDA">＋ PDA</button>
          </div></div>
        <div class="hero-right"><div style="font-size:12px;color:#cdeae6">Lịch công việc tháng</div><div class="big">${Math.round((cal.pct || 0) * 100)}%</div><div style="font-size:12px;color:#cdeae6">${cal.done || 0}/${cal.total || 0} việc hoàn thành</div></div>
      </div></section>
      <div class="mt">${kpiGrid(M, code)}</div>
      <div class="grid g2 mt">
        <div class="card"><div class="card-h"><h3>Nhập / xuất 6 tháng</h3><span class="sub">số dòng giao dịch</span></div><div class="card-b"><div class="chart-box"><canvas id="chK1"></canvas></div></div></div>
        <div class="card"><div class="card-h"><h3>Top xuất 30 ngày</h3><span class="sub">theo số lượng</span></div><div class="card-b"><div class="chart-box"><canvas id="chK2"></canvas></div></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><div class="card-h"><h3>Lịch công việc hôm nay</h3><div class="right"><a class="btn sm" href="#/sheet/${k.cal}">Mở lịch tháng</a></div></div>${todayHtml}</div>
        <div class="card"><div class="card-h"><h3>Thiết bị PDA</h3><div class="right"><a class="btn sm" data-go="${go('THONG_KE_PDA')}">Xem sổ PDA</a></div></div><div class="card-b" style="display:flex;gap:6px;flex-wrap:wrap">${pdaChips}</div>
          <div class="card-h" style="border-top:1px solid var(--line)"><h3>Trạng thái tồn</h3></div><div class="card-b"><div class="chart-box" style="height:180px"><canvas id="chK3"></canvas></div></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><div class="card-h"><h3>Mã cần đặt</h3><span class="chip red">${M.need.length}</span><div class="right"><a class="btn sm" data-go="${go('TON_KHO')}">Tồn kho →</a></div></div>${needList(M.need)}</div>
        <div class="card"><div class="card-h"><h3>Giao dịch gần đây</h3><div class="right"><a class="btn sm" data-go="${go('SO_NHAP_XUAT')}">Sổ nhập xuất →</a></div></div>
          ${M.recent.length ? '<ul class="list">' + M.recent.map(x => `<li><span class="chip ${/^Nhập|đến$/.test(x.type) ? 'green' : 'amber'}">${esc(x.type)}</span><div class="grow"><div class="t">${esc(x.name || x.code)}</div><div class="s">${x.d ? dmy(isoOf(x.d)) : ''} · ${esc(x.who || '')}</div></div><b>${fmt(x.q)} ${esc(x.unit)}</b></li>`).join('') + '</ul>' : '<div class="empty">Chưa có giao dịch nào cho kho này.</div>'}</div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><div class="card-h"><h3>Cảnh báo & việc cần làm</h3></div>${alertList(M)}</div>
        <div class="card"><div class="card-h"><h3>Mở nhanh sổ của kho ${code}</h3></div><div class="card-b" style="display:flex;gap:8px;flex-wrap:wrap">
          ${['SO_NHAP_XUAT', 'TON_KHO', 'DINH_MUC', 'KIEM_KE', 'KH_NVL_THANG', 'KH_CCDC_QUY', 'TAI_SAN_CCDC', 'HU_HONG', 'THANH_LY', 'THONG_KE_PDA', k.cal].filter(sh).map(n => `<a class="btn" data-go="${go(n)}">${icon(schemaOf(n).icon).replace('<svg', '<svg width="15" height="15"')} ${esc(schemaOf(n).title)}</a>`).join('')}
        </div></div>
      </div>`;
    bindGo(view);
    if ($('#editKho')) $('#editKho').onclick = () => openRowDrawer('DM_KHO', dmRow);
    $$('[data-new]', view).forEach(b => b.onclick = () => {
      const n = b.dataset.new, def = tableDef(n), pre = {};
      if (def.khoCol) pre[colNum(def.khoCol)] = code;
      def.cols.forEach(col => { if (!col.computed && fieldType(def, col, def.dataStart).t === 'date' && /^ngày$|ngày ghi nhận|ngày cấp/i.test(col.h)) pre[col.c] = isoOf(today0()); });
      openRowDrawer(n, null, pre);
    });
    chart($('#chK1'), { type: 'bar', data: { labels: M.months.map(monthLabel), datasets: [
      { label: 'Nhập', data: M.months.map(key => M.series[key].in), backgroundColor: '#17a99a', borderRadius: 5 },
      { label: 'Xuất', data: M.months.map(key => M.series[key].out), backgroundColor: k.color === '#17a99a' ? '#f59e0b' : k.color, borderRadius: 5 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } } });
    chart($('#chK2'), { type: 'bar', data: { labels: M.top.map(x => x.name.length > 22 ? x.name.slice(0, 21) + '…' : x.name), datasets: [{ label: 'Số lượng xuất', data: M.top.map(x => x.q), backgroundColor: k.color, borderRadius: 5 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.raw.toLocaleString('vi-VN')} ${M.top[c.dataIndex].unit}` } } }, scales: { y: { grid: { display: false } } } } });
    statusDonut($('#chK3'), M);
  }

  /* ------------------------------------------------------------------ sheet page */
  function viewState(n) { return state.views[n] || (state.views[n] = { q: '', sort: null, page: 1, size: 50, fcol: '', fval: '' }); }

  function renderSheet(view, name) {
    const s = sh(name);
    if (!s) { view.innerHTML = `<div class="empty">Không tìm thấy tab <b>${esc(name)}</b> trong Google Sheet.</div>`; setCrumb(name); return; }
    const sc = schemaOf(name);
    setCrumb(sc.title, name);
    const desc = String(val(name, 2, 1) || '');
    if (sc.type === 'doc') return renderDoc(view, name);
    if (sc.type === 'task') return renderTasks(view);
    if (sc.type === 'dv') return renderDV(view);
    if (sc.type === 'guide') return renderGuide(view);
    if (sc.type === 'stock' && !viewState(name).raw) return renderStock(view, name);
    if (sc.type === 'bhld' && !viewState(name).raw) return renderBhld(view, name);
    if (sc.type === 'staff' && !viewState(name).raw) return renderStaff(view, name);
    if (sc.type === 'pdaloan' && !viewState(name).raw) return renderPdaLoan(view, name);
    if (sc.type === 'gloves' && !viewState(name).raw) return renderGloves(view, name);
    if (sc.type === 'report') {
      view.innerHTML = `<div class="card"><div class="card-h"><h3>${esc(val(name, 1, 1))}</h3><span class="sub">${esc(desc)}</span></div>${reportTable(name, sc.headerRow)}</div>`;
      return;
    }
    const def = tableDef(name), vs = viewState(name);
    const title = String(val(name, 1, 1) || sc.title);
    const k = state.kho;
    const showKhoNote = (def.khoCol || def.khoGroups || def.kho) && k !== 'ALL';
    view.innerHTML = `
      <div class="card">
        <div class="card-h"><div><h3>${esc(title)}</h3><div class="sub" style="margin-top:3px">${esc(desc)}</div></div>
          <div class="right">${showKhoNote ? `<span class="chip brand">Đang lọc kho: ${esc(k)}</span>` : ''}${def.kho ? `<span class="chip" style="background:${khoInfo(def.kho).color};color:#fff;border:0">Kho ${def.kho}</span>` : ''}</div></div>
        ${paramsBlock(def)}
        ${name === PDA_DEV ? pdaStatusTabs(vs) : ''}
        <div class="toolbar">
          <div class="search"><input class="input" id="q" placeholder="Tìm trong bảng… (phím /)" value="${esc(vs.q)}"></div>
          ${def.type !== 'calendar' ? filterSelects(def, vs) : ''}
          <div class="right">
            ${def.addRow ? `<button class="btn primary need-edit" id="addRow">＋ Thêm dòng</button>` : ''}
            ${schemaOf(def.name).type === "stock" ? `<button class="btn" id="stockBack">← Báo cáo tồn kho</button>` : schemaOf(def.name).type === "bhld" ? `<button class="btn" id="stockBack">← Danh sách nón / áo</button>` : schemaOf(def.name).type === "staff" ? `<button class="btn" id="stockBack">← Danh sách nhân viên</button>` : schemaOf(def.name).type === "pdaloan" ? `<button class="btn" id="stockBack">← Cấp phát dạng danh sách</button>` : schemaOf(def.name).type === "gloves" ? `<button class="btn" id="stockBack">← Trang găng tay</button>` : ""}
            ${name === 'DM_NVL' || name === 'DM_CCDC' ? `<button class="btn need-edit" id="catMgr" title="Đánh dấu mã đang dùng / ngừng dùng">⚙ Đang dùng / Ngừng dùng</button>` : ''}
            ${def.addCol ? `<button class="btn need-edit" id="addCol" title="Bổ sung hạng mục (cột mới) vào bảng">＋ Hạng mục</button>` : ''}
            <button class="btn" id="csv" title="Xuất bảng đang xem ra Excel (CSV)">⭳ Xuất Excel</button>
            <button class="btn" id="print" title="In / lưu PDF">⎙ In</button>
          </div>
        </div>
        <div id="tbl"></div>
      </div>
      ${(def.side || []).map((sd, i) => sideBlock(name, sd, i)).join('')}`;
    const draw = () => drawTable(def);
    draw();
    $$('[data-stg]', view).forEach(b => b.onclick = () => { vs.stg = b.dataset.stg; vs.page = 1; renderSheet(view, name); });
    $('#q').addEventListener('input', debounce(e => { vs.q = e.target.value; vs.page = 1; draw(); }, 200));
    if ($('#fcol')) {
      $('#fcol').onchange = e => { vs.fcol = e.target.value; vs.fval = ''; vs.page = 1; renderSheet(view, name); };
      if ($('#fval')) $('#fval').onchange = e => { vs.fval = e.target.value; vs.page = 1; draw(); };
    }
    if (s.local) $('.card-h .sub', view).insertAdjacentHTML('beforeend', ' · <b class="warn-text">Tab chưa có trên Google Sheet – chạy hàm setupV2 trong Apps Script (hoặc thêm dòng đầu tiên) để tạo.</b>');
    const ld = loanOfSheet(name); if (ld && sc.type !== 'pdaloan') loanPanel(view, ld);
    if ($('#addRow')) $('#addRow').onclick = () => {
      if (loanOfSheet(name)) return loanOut(loanOfSheet(name));
      const pre = {};
      // Cột đầu là "Ngày" (sổ nhập xuất, kiểm kê, hư hỏng…) → điền sẵn hôm nay
      if (def.cols[0] && /^ngày/i.test(def.cols[0].h) && !def.cols[0].computed) pre[def.cols[0].c] = isoOf(new Date());
      if (def.khoCol && k !== 'ALL') pre[colNum(def.khoCol)] = k;
      openRowDrawer(name, null, pre);
    };
    if ($('#addCol')) $('#addCol').onclick = () => addColumn(def);
    if ($('#catMgr')) $('#catMgr').onclick = () => openCatalogManager(name === 'DM_NVL' ? 'NVL' : 'CCDC', () => route(true));
    if ($('#stockBack')) $('#stockBack').onclick = () => { viewState(name).raw = false; route(true); };
    $('#csv').onclick = () => exportCSV(def);
    $('#print').onclick = () => window.print();
    bindParams(def, view);
  }

  function filterSelects(def, vs) {
    const cand = def.cols.filter(col => {
      const set = new Set(); const s = sh(def.name);
      for (let r = def.dataStart; r <= s.v.length && set.size <= 40; r++) { const v = val(def.name, r, col.c); if (v !== '') set.add(plain(v)); }
      col._distinct = set; return set.size > 1 && set.size <= 40;
    });
    if (!cand.length) return '';
    const fc = cand.find(c => c.L === vs.fcol);
    return `<select class="select" id="fcol" title="Lọc theo cột"><option value="">Lọc theo cột…</option>${cand.map(c => `<option value="${c.L}" ${c.L === vs.fcol ? 'selected' : ''}>${esc(c.h)}</option>`).join('')}</select>
      ${fc ? `<select class="select" id="fval"><option value="">— Tất cả —</option>${[...fc._distinct].sort().map(v => `<option ${v === vs.fval ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : ''}`;
  }

  function visibleCols(def) {
    if (!def.khoGroups || state.kho === 'ALL') return def.cols;
    return def.cols.filter(c => !c.kho || c.kho === state.kho);
  }

  function filteredRows(def) {
    const vs = viewState(def.name), k = state.kho;
    let rows = tableRows(def);
    if (def.khoCol && k !== 'ALL') rows = rows.filter(r => String(val(def.name, r, colNum(def.khoCol))) === k);
    if (def.name === PDA_DEV && vs.stg) rows = rows.filter(r => pdaStatusGroup(val(def.name, r, 5)) === vs.stg);
    if (vs.fcol && vs.fval) { const c = colNum(vs.fcol); rows = rows.filter(r => plain(val(def.name, r, c)) === vs.fval); }
    if (vs.q) {
      const q = vs.q.toLowerCase();
      rows = rows.filter(r => def.cols.some(col => fmt(val(def.name, r, col.c), col.h).toLowerCase().includes(q)));
    }
    if (vs.sort) {
      const { c, dir } = vs.sort, h = (def.cols.find(x => x.c === c) || {}).h;
      rows.sort((a, b) => {
        const va = val(def.name, a, c), vb = val(def.name, b, c);
        const da = toDate(va, h), db = toDate(vb, h);
        let cmp;
        if (da || db) cmp = (da || 0) - (db || 0);
        else if (typeof va === 'number' || typeof vb === 'number') cmp = (num(va) || 0) - (num(vb) || 0);
        else cmp = String(va).localeCompare(String(vb), 'vi');
        return dir * cmp;
      });
    } else if (def.newestFirst) rows.reverse();
    return rows;
  }

  function drawTable(def) {
    const host = $('#tbl'); if (!host) return;
    const vs = viewState(def.name), cols = visibleCols(def);
    const rows = filteredRows(def);
    const size = def.type === 'calendar' ? 40 : vs.size;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    if (vs.page > pages) vs.page = pages;
    const slice = rows.slice((vs.page - 1) * size, vs.page * size);
    const t0 = isoOf(today0());
    let head = '';
    if (def.khoGroups && state.kho === 'ALL') {
      head += '<tr>' + (def.hideRowNo ? '' : '<th class="grp" style="background:transparent"></th>');
      let i = 0;
      while (i < cols.length) {
        const g = cols[i].kho; let span = 0;
        while (i < cols.length && cols[i].kho === g) { span++; i++; }
        head += g ? `<th class="grp" colspan="${span}" style="background:${khoInfo(g).color}">${esc(khoInfo(g).name)}</th>` : `<th class="grp" colspan="${span}" style="background:transparent"></th>`;
      }
      head += '<th class="grp" style="background:transparent"></th></tr>';
    }
    // Kiểu cột (theo dữ liệu trang đang xem): số → căn phải; mã/IMEI/ngày → chữ số đều nhau; STT → giữa
    const kindOf = {};
    cols.forEach(col => {
      let n = 0, d = 0, t = 0;
      slice.forEach(r => { const v = val(def.name, r, col.c); if (v === '') return; t++; if (typeof v === 'number') n++; else if (typeof v === 'string' && v.startsWith('D:')) d++; });
      kindOf[col.c] = /^stt$/i.test(col.h.trim()) ? 'stt'
        : CODE_COL.test(col.h) ? 'code'
        : t && d / t > .6 ? 'date'
        : t && n / t > .6 && !RAW_HINT.test(col.h) && !DATE_HINT.test(col.h) ? 'num' : '';
    });
    head += `<tr class="${def.khoGroups && state.kho === 'ALL' ? 'two' : ''}">${def.hideRowNo ? '' : '<th class="rowno">#</th>'}` + cols.map(col => {
      const on = vs.sort && vs.sort.c === col.c, s = on ? (vs.sort.dir > 0 ? '▲' : '▼') : '↕';
      return `<th data-sort="${col.c}" class="${[col.computed ? 'computed' : '', kindOf[col.c], on ? 'sorted' : ''].join(' ')}" title="${col.computed ? 'Cột tự tính (công thức) – không sửa' : 'Cột nhập liệu – bấm vào ô để sửa'}">${esc(col.h)}<span class="sort">${s}</span></th>`;
    }).join('') + '<th></th></tr>';
    const pendingCells = new Set();
    state.queue.forEach(op => { if (op.payload.sheet === def.name && op.action === 'update') op.payload.changes.forEach(ch => pendingCells.add(ch.row + ':' + ch.col)); });
    let body = '';
    slice.forEach(r => {
      let cls = '';
      if (def.type === 'calendar') {
        const d = toDate(val(def.name, r, 1), true);
        if (d && isoOf(d) === t0) cls = 'today';
        if (val(def.name, r, 2) === 'Chủ Nhật') cls += ' sunday';
      }
      body += `<tr class="${cls}" data-r="${r}">${def.hideRowNo ? "" : `<td class="rowno">${r}</td>`}`;
      cols.forEach(col => {
        const v = val(def.name, r, col.c), editable = !col.computed && canEditCell(def.name, r, col.c);
        const f = fmt(v, col.h);
        const cc = STATUS_COL.test(col.h) || def.type === 'calendar' ? chipClass(f) : null;
        const isNum = typeof v === 'number' && !RAW_HINT.test(col.h) && !(DATE_HINT.test(col.h) && v > 30000);
        const long = typeof f === 'string' && f.length > 40;
        const k = kindOf[col.c];
        const klass = [editable ? 'edit' : 'calc', isNum || k === 'num' ? 'num' : (long ? 'wrap' : 'nowrap'), k && k !== 'num' ? k : '', pendingCells.has(r + ':' + col.c) ? 'pending' : ''].join(' ');
        body += `<td class="${klass}" data-c="${col.c}">${cc ? `<span class="chip ${cc}">${esc(f)}</span>` : esc(f)}</td>`;
      });
      const nImg = state.images.filter(im => im.sheet === def.name && +im.row === r).length;
      body += `<td class="rowact"><button class="ra ${nImg ? 'has' : ''}" data-act="img" title="Hình ảnh">📷${nImg ? ' ' + nImg : ''}</button><button class="ra" data-act="open" title="Xem / sửa chi tiết">✎</button>${def.addRow ? '<button class="ra need-edit" data-act="del" title="Xóa dòng (giữ công thức)">🗑</button>' : ''}</td></tr>`;
    });
    if (!slice.length) body = `<tr><td colspan="${cols.length + 2}"><div class="empty">${tableRows(def).length ? 'Không có dòng phù hợp bộ lọc.' : 'Chưa có dữ liệu.' + (def.addRow ? ' Bấm “＋ Thêm dòng” để nhập.' : '')}</div></td></tr>`;
    // Tổng tiền (Thành tiền / Giá trị tồn) của các dòng đang lọc
    let totals = '';
    if (def.totals) {
      const moneyCols = cols.filter(col => /thành tiền|giá trị/i.test(col.h));
      totals = moneyCols.map(col => {
        const sum = rows.reduce((a, r) => a + num(val(def.name, r, col.c) || 0), 0);
        return `<span class="tot"><b>${esc(col.h.replace(/\s*\(VNĐ\)/i, ''))}:</b> ${Math.round(sum).toLocaleString('vi-VN')} đ</span>`;
      }).join('');
      if (totals) totals = `<div class="totals">Tổng các dòng đang xem: ${totals}</div>`;
    }
    host.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table></div>${totals}
      <div class="pager"><span>${rows.length.toLocaleString('vi-VN')} dòng${rows.length !== tableRows(def).length ? ` (lọc từ ${tableRows(def).length.toLocaleString('vi-VN')})` : ''} · <span class="legend"><i></i>ô nền xám = tự tính, không sửa</span></span>
        <div class="right">${def.type === 'calendar' ? '' : `<select class="select" id="psize">${[25, 50, 100, 200, 500].map(n => `<option ${n === vs.size ? 'selected' : ''}>${n}</option>`).join('')}</select>`}
          <button class="btn sm" id="pprev" ${vs.page <= 1 ? 'disabled' : ''}>‹</button><span>Trang ${vs.page}/${pages}</span><button class="btn sm" id="pnext" ${vs.page >= pages ? 'disabled' : ''}>›</button></div></div>`;
    $$('th[data-sort]', host).forEach(th => th.onclick = () => {
      const c = +th.dataset.sort;
      vs.sort = vs.sort && vs.sort.c === c ? (vs.sort.dir > 0 ? { c, dir: -1 } : null) : { c, dir: 1 };
      drawTable(def);
    });
    if ($('#psize', host)) $('#psize', host).onchange = e => { vs.size = +e.target.value; vs.page = 1; drawTable(def); };
    $('#pprev', host).onclick = () => { vs.page--; drawTable(def); };
    $('#pnext', host).onclick = () => { vs.page++; drawTable(def); };
    $('tbody', host).addEventListener('click', e => {
      const btn = e.target.closest('[data-act]'), tr = e.target.closest('tr[data-r]');
      if (!tr) return;
      const r = +tr.dataset.r;
      if (btn) {
        if (btn.dataset.act === 'open' || btn.dataset.act === 'img') openRowDrawer(def.name, r, null, btn.dataset.act === 'img');
        else if (btn.dataset.act === 'del') deleteRow(def, r);
        return;
      }
      const td = e.target.closest('td.edit');
      if (td && !td.classList.contains('editing')) startEdit(def, td, r, +td.dataset.c);
    });
  }

  /* inline editing */
  function startEdit(def, td, r, c) {
    const col = def.cols.find(x => x.c === c); if (!col) return;
    const ft = fieldType(def, col, r), v = val(def.name, r, c), cur = inputValue(v, ft);
    state.editing = true;
    td.classList.add('editing');
    let ctl;
    if (ft.t === 'select') {
      ctl = document.createElement('select');
      ctl.innerHTML = selectOptionsHtml(ft, cur);
    } else {
      ctl = document.createElement('input');
      ctl.type = ft.t === 'date' ? 'date' : ft.t === 'number' ? 'number' : 'text';
      if (ft.t === 'number') ctl.step = 'any';
      if (ft.dl) ctl.setAttribute('list', ft.dl);
      if (ft.t === 'suggest') { const id = 'sg-' + c; let dl = document.getElementById(id); if (!dl) { dl = document.createElement('datalist'); dl.id = id; document.body.appendChild(dl); } dl.innerHTML = ft.list.map(o => `<option value="${esc(o)}">`).join(''); ctl.setAttribute('list', id); }
      ctl.value = cur;
    }
    td.innerHTML = ''; td.appendChild(ctl); ctl.focus(); if (ctl.select && ctl.type === 'text') ctl.select();
    let done = false;
    const finish = (save, move) => {
      if (done) return; done = true;
      state.editing = false;
      const nv = ctl.value;
      if (save && nv !== cur) {
        enqueue('update', { sheet: def.name, changes: [{ row: r, col: c, value: ft.t === 'number' && nv !== '' ? Number(nv) : nv }] });
        toast(state.apiUrl ? 'Đã lưu – đang đồng bộ lên Google Sheet' : 'Đã lưu trên máy (chưa kết nối Sheet)');
      }
      drawTable(def);
      if (state.pendingRender && !move) rerender();
      if (move) {
        const tds = $$('#tbl td.edit');
        const idx = tds.findIndex(x => +x.closest('tr').dataset.r === r && +x.dataset.c === c);
        const next = tds[idx + (move > 0 ? 1 : -1)];
        if (next) startEdit(def, next, +next.closest('tr').dataset.r, +next.dataset.c);
      }
    };
    ctl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') finish(false);
      else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? -1 : 1); }
    });
    ctl.addEventListener('blur', () => setTimeout(() => finish(true), 120));
    if (ctl.tagName === 'SELECT') ctl.addEventListener('change', () => {
      const v = ctl.value;
      if (v === OPT_ADD || v === OPT_MANAGE) {
        // Thoát chế độ sửa ô trước, rồi mới hỏi (tránh mất ô khi hộp thoại lấy focus)
        ctl.value = cur; finish(false);
        if (v === OPT_ADD) {
          const name = askNewOption(def, col);
          if (name && name !== cur) { enqueue('update', { sheet: def.name, changes: [{ row: r, col: c, value: name }] }); drawTable(def); }
        } else openListManager(def, col, () => drawTable(def));
        return;
      }
      finish(true);
    });
  }

  function deleteRow(def, r) {
    if (!confirm(`Xóa dữ liệu dòng ${r}?\n“${rowLabel(def, r)}”\n\nCác ô nhập sẽ được xóa trên Google Sheet, công thức được giữ nguyên.`)) return;
    enqueue('clearRow', { sheet: def.name, row: r, lastCol: def.lastCol });
    toast('Đã xóa dòng ' + r);
    drawTable(def);
  }

  function addColumn(def) {
    const title = prompt('Tên hạng mục (cột) mới cần bổ sung vào tab ' + def.name + ':');
    if (!title || !title.trim()) return;
    const s = sh(def.name), row = s.v[def.headerRow - 1] || [];
    const col = Math.max(def.lastCol, row.length) + 1;
    enqueue('addColumn', { sheet: def.name, headerRow: def.headerRow, col, title: title.trim() });
    toast(`Đã thêm cột “${title.trim()}” (cột ${colLet(col)})`);
    route(true);
  }

  /* params */
  function paramLabel(n, A1) {
    const p = ref(A1);
    for (let c = p.c - 1; c >= 1; c--) { const v = val(n, p.r, c); if (typeof v === 'string' && v.trim() && !/^[DP]:/.test(v)) return v.replace(/:$/, ''); if (v !== '' && typeof v !== 'string') break; }
    const right = val(n, p.r, p.c + 1); if (typeof right === 'string' && right) return right.replace(/^←\s*/, '');
    return A1;
  }
  function paramsBlock(def) {
    const params = def.params || [], sums = def.summary || [];
    if (!params.length && !sums.length) return '';
    const n = def.name;
    const LBL = { CHECKLIST_EVENT: { B5: 'Số việc TRỄ', C5: 'Số việc chưa Xong' }, LICH_CV: { B3: 'Tháng', D3: 'Năm', F3: '% hoàn thành' } };
    const lbl = A1 => (LBL[n] && LBL[n][A1]) || (def.type === 'calendar' && LBL.LICH_CV[A1]) || paramLabel(n, A1);
    let h = '<div class="params">';
    params.forEach(A1 => {
      const p = ref(A1), v = val(n, p.r, p.c), label = lbl(A1);
      const editable = canEditCell(n, p.r, p.c);
      const isOverride = isF(n, p.r, p.c);
      if (!editable) { h += `<div class="param"><label>${esc(label)}</label><div class="ro">${esc(fmt(v, label)) || '—'}</div></div>`; return; }
      let list = dvFor(n, p.L, p.r);
      if (!list && def.paramList && def.paramList[A1]) { const pl = def.paramList[A1], c = colNum(pl.col); list = []; for (let r = pl.from; r <= (sh(pl.sheet) ? sh(pl.sheet).v.length : 0); r++) { const x = val(pl.sheet, r, c); if (x) list.push(x); } }
      if (!list && def.paramKho === A1) list = KHO_CODES;
      if (!list && def.type === 'calendar' && A1 === 'B3') list = Array.from({ length: 12 }, (_, i) => String(i + 1));
      let ctl;
      if (list) ctl = `<select class="select" data-param="${A1}">${list.map(o => `<option ${String(o) === plain(v) ? 'selected' : ''}>${esc(o)}</option>`).join('')}${plain(v) && !list.map(String).includes(plain(v)) ? `<option selected>${esc(plain(v))}</option>` : ''}</select>`;
      else if (toDate(v, label) || DATE_HINT.test(label)) { const d = toDate(v, true); ctl = `<input class="input" type="date" data-param="${A1}" value="${d ? isoOf(d) : ''}">`; }
      else ctl = `<input class="input" type="${typeof v === 'number' || /P:/.test(v) ? 'number' : 'text'}" step="any" data-param="${A1}" value="${esc(inputValue(v, {}))}">`;
      h += `<div class="param"><label>${esc(label)}${isOverride ? ' <span title="Ô đang dùng công thức tự tính; chọn giá trị mới sẽ thay công thức">ⓘ</span>' : ''}</label>${ctl}</div>`;
    });
    sums.forEach(A1 => { const p = ref(A1), label = lbl(A1); h += `<div class="param sum"><label>${esc(label)}</label><div class="ro">${esc(fmt(val(n, p.r, p.c), label)) || '0'}</div></div>`; });
    if (def.paramKho && state.kho !== 'ALL' && plain(valA(n, def.paramKho)) !== state.kho) h += `<div class="param"><label>Bộ lọc kho đang chọn: ${esc(state.kho)}</label><button class="btn" data-setkho="${def.paramKho}">Áp dụng kho ${esc(state.kho)} cho bảng này</button></div>`;
    return h + '</div>';
  }
  function bindParams(def, view) {
    $$('[data-param]', view).forEach(el => el.addEventListener('change', () => {
      const p = ref(el.dataset.param);
      if (isF(def.name, p.r, p.c) && !confirm('Ô này đang là công thức tự tính. Ghi giá trị mới sẽ thay công thức. Tiếp tục?')) { route(true); return; }
      let v = el.value; if (el.type === 'number' && v !== '') v = Number(v);
      enqueue('update', { sheet: def.name, changes: [{ row: p.r, col: p.c, value: v }] });
      toast(state.apiUrl ? 'Đã đổi tham số – Google Sheet sẽ tự tính lại' : 'Đã lưu trên máy (cần kết nối Sheet để tự tính lại)');
    }));
    $$('[data-setkho]', view).forEach(b => b.onclick = () => { const p = ref(b.dataset.setkho); enqueue('update', { sheet: def.name, changes: [{ row: p.r, col: p.c, value: state.kho }] }); route(true); });
  }
  function sideBlock(n, sd) {
    const c1 = colNum(sd.from), hr = sd.headerRow;
    let c2 = sd.to === 'auto' ? c1 : colNum(sd.to);
    // to: 'auto' → kéo tới cột tiêu đề cuối liền mạch (bảng tổng hợp tự thêm cột thiết bị mới)
    if (sd.to === 'auto') while (c2 < c1 + 40 && String(val(n, hr, c2 + 1) || '').trim()) c2++;
    const head = []; for (let c = c1; c <= c2; c++) head.push({ c, h: String(val(n, hr, c) || '') });
    const rows = [];
    for (let r = hr + 1; r <= sh(n).v.length; r++) {
      if (sd.rows && rows.length >= sd.rows) break;
      const any = head.some(x => val(n, r, x.c) !== '');
      if (!any) { if (!sd.rows) break; continue; }
      rows.push(r);
    }
    // Cột số: tiêu đề căn phải cùng phía với số; cột STT gọn ở giữa
    head.forEach(x => {
      const vals = rows.map(r => val(n, r, x.c)).filter(v => v !== '');
      x.num = vals.length > 0 && vals.every(v => typeof v === 'number');
      x.stt = /^stt$/i.test(x.h.trim());
    });
    const cls = x => x.stt ? 'stt' : x.num ? 'num' : '';
    return `<div class="card mt"><div class="card-h"><h3>${esc(sd.title)}</h3><span class="sub">tự tính trong Google Sheet</span></div><div class="tbl-wrap" style="max-height:none"><table class="tbl side"><thead><tr>${head.map(x => `<th class="${cls(x)}">${esc(x.h)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => {
        const total = /^tổng$/i.test(String(head.map(x => val(n, r, x.c)).find(v => typeof v === 'string' && v.trim()) || '').trim());
        return `<tr class="${total ? 'total' : ''}">` + head.map(x => { const v = val(n, r, x.c); return `<td class="${cls(x)}">${esc(fmt(v, x.h))}</td>`; }).join('') + '</tr>';
      }).join('') || `<tr><td colspan="${head.length}" class="empty">Chưa có dữ liệu</td></tr>`}</tbody></table></div></div>`;
  }

  function renderDoc(view, n) {
    const s = sh(n); let h = `<div class="card"><div class="card-h"><div><h3>${esc(val(n, 1, 1))}</h3><div class="sub">${esc(val(n, 2, 1))}</div></div></div><div class="card-b doc">`;
    let open = false;
    for (let r = 3; r <= s.v.length; r++) {
      const a = val(n, r, 1), b = val(n, r, 2), c = val(n, r, 3);
      if (a && !b) { if (open) h += '</dl>'; h += `<h2>${esc(a)}</h2><dl>`; open = true; }
      else if (b) { if (!open) { h += '<dl>'; open = true; } const link = sh(b) ? `<a href="#/sheet/${encodeURIComponent(b)}">${esc(b)}</a><div class="muted" style="font-weight:500;font-size:12px">${esc(schemaOf(b).title)}</div>` : esc(b); h += `<dt>${link}</dt><dd>${esc(c)}</dd>`; }
    }
    if (open) h += '</dl>';
    h += `<h2>Cách dùng trang web</h2><dl>
      <dt>Sửa trực tiếp</dt><dd>Bấm vào ô (chữ đậm, không nghiêng) để sửa. Enter để lưu, Esc để hủy, Tab để sang ô kế tiếp. Ô xám/nghiêng là công thức – Google Sheet tự tính lại sau khi lưu.</dd>
      <dt>Thêm / xóa dòng</dt><dd>“＋ Thêm dòng” điền vào dòng trống đầu tiên của tab (tự kéo công thức). 🗑 xóa nội dung ô nhập, giữ công thức.</dd>
      <dt>Bổ sung hạng mục</dt><dd>“＋ Hạng mục” thêm cột mới vào bên phải bảng trên Google Sheet.</dd>
      <dt>Hình ảnh</dt><dd>Bấm 📷 ở mỗi dòng để tải ảnh (chụp bằng điện thoại được). Ảnh lưu ở Google Drive, link ghi ở tab WEB_HINH_ANH.</dd>
      <dt>Theo dõi từng kho</dt><dd>Chọn kho ở góc trên để lọc mọi bảng, hoặc mở trang riêng của từng kho ở menu bên trái.</dd>
      <dt>Sao lưu</dt><dd>Mọi thay đổi ghi nhật ký (tab WEB_NHAT_KY). Sao lưu cả file vào Google Drive hằng ngày lúc 23:00, và bấm “Sao lưu ngay” trong Cài đặt bất cứ lúc nào.</dd>
      <dt>Đồng bộ nhiều người</dt><dd>Web hỏi Google Sheet mỗi 10 giây và chỉ tải lại tab vừa đổi: người khác (hoặc ai sửa thẳng trên Sheet) thấy thay đổi sau khoảng 10–20 giây. Bấm ⟳ để tải ngay. Mất mạng thì thay đổi được giữ trên máy và tự gửi khi có mạng lại.</dd></dl>
      <h2>Nhập – Xuất – Tồn: NVL và CCDC</h2><dl>
      <dt>Ghi phiếu</dt><dd>Mỗi dòng = 1 mã ở 1 kho. Loại giao dịch: Nhập · Xuất (bắt buộc có người nhận) · Điều chuyển đi + Điều chuyển đến (ghi 2 dòng, mỗi kho 1 dòng, có kho đối ứng) · Xuất hủy / hao hụt. Riêng CCDC có thêm <b>Thu hồi nhập kho</b> khi CCDC đã cấp phát được trả về kho. Cột “Kiểm tra” báo dòng thiếu dữ liệu hoặc sai mã.</dd>
      <dt>Đơn giá – Thành tiền</dt><dd>Chọn mã xong, web tự điền Đơn giá theo danh mục (sửa được nếu giá thực tế khác). Để trống Đơn giá thì Sheet tự lấy giá danh mục. Thành tiền = Số lượng × Đơn giá, tự tính. Cuối bảng có tổng Thành tiền của các dòng đang lọc (lọc theo kho, tìm kiếm, lọc cột).</dd>
      <dt>Tồn kho</dt><dd>Tồn kho NVL và Tồn kho CCDC tự tính từ sổ. Chỉ nhập “Tồn đầu” một lần (số kiểm kê ngày bắt đầu dùng). Có Giá trị tồn từng kho và tổng, tính theo đơn giá danh mục. Tồn kho CCDC có thêm cột “Đang sử dụng” lấy từ Sổ tài sản CCDC.</dd>
      <dt>Mã NVL / CCDC mới</dt><dd>Trong phiếu, bấm “＋ Mã NVL/CCDC mới” dưới ô mã: chọn nhóm (mã tự sinh), nhập tên, ĐVT, đơn giá. Mã không còn dùng thì bấm “⚙ Danh mục” → <b>Ngừng dùng</b> (ẩn khỏi gợi ý, vẫn giữ lịch sử). Không xóa hẳn mã đã có giao dịch.</dd>
      <dt>Dropdown</dt><dd>Cuối mỗi dropdown có “＋ Thêm lựa chọn mới…” và “⚙ Sửa / xóa danh sách…”. Bỏ một lựa chọn không làm mất dữ liệu đã nhập ở các dòng cũ.</dd></dl>
      <h2>Thiết bị: cấp phát PDA hằng ngày</h2><dl>
      <dt>Khai báo máy</dt><dd>Mỗi máy khai báo 1 lần ở <b>Thống kê PDA</b> (kho, IMEI, tên thiết bị, tình trạng). Trang cấp phát tra máy theo IMEI.</dd>
      <dt>Cấp máy</dt><dd>Trang <b>Cấp phát PDA hằng ngày</b> → “＋ Cấp máy”: ngày, ca và giờ cấp tự điền; chọn IMEI, nhập người nhận, MSNV, bộ phận. Web cảnh báo nếu máy đang được người khác mượn hoặc không ở tình trạng TỐT.</dd>
      <dt>Nhận lại máy</dt><dd>Ở danh sách “Máy đang được mượn”, bấm “↩ Trả máy”, chọn tình trạng khi trả. Nếu máy hư / rơi vỡ / mất, web có thể cập nhật luôn máy đó ở Thống kê PDA thành <b>MỚI HƯ</b>.</dd>
      <dt>Theo dõi</dt><dd>Chỉ số trong ngày: lượt cấp, đang mượn, quá hạn trả (mượn từ hôm trước chưa trả), trả về có lỗi, máy sẵn sàng. Máy quá hạn trả được cảnh báo ở Tổng quan và trang từng kho.</dd></dl>
      <h2>Dành cho Quản lý: Task</h2><dl>
      <dt>Tạo task</dt><dd>Bắt buộc có tiêu đề, người phụ trách và hạn chót. Có thể chia thành checklist các bước nhỏ. Task quá hạn luôn đứng đầu danh sách, số task quá hạn hiện trên menu.</dd>
      <dt>Thói quen</dt><dd>Đầu ngày xem tab “Quá hạn” và “Hôm nay”. Cuối tuần nhóm theo người phụ trách và rà mục “Dễ bị sót”.</dd></dl>
      <h2>Dành cho Quản lý: Dịch vụ mua ngoài</h2><dl>
      <dt>Dùng khi nào</dt><dd>Mua CCDC không có trong hệ thống kho, hoặc thuê dịch vụ nhà cung cấp: vệ sinh máy lạnh, xịt côn trùng, sửa chữa nhà vệ sinh…</dd>
      <dt>Thông tin</dt><dd>Mỗi yêu cầu chia 6 phần theo thứ tự: ① Thông tin yêu cầu (nội dung, loại, mức độ, kho, bộ phận yêu cầu) · ② Người thực hiện &amp; tiến độ · ③ Timeline dự kiến · ④ Nhà cung cấp &amp; chi phí · ⑤ Phê duyệt (người duyệt yêu cầu, kết quả duyệt) · ⑥ Giải trình. Bắt buộc: nội dung, bộ phận yêu cầu, người thực hiện, ngày hoàn thành dự kiến; từ bước “Chờ duyệt” trở đi phải có người duyệt.</dd>
      <dt>Ai làm gì</dt><dd><b>Người thực hiện</b> đi báo giá, bấm “Gửi duyệt”, sau khi được duyệt thì “Bắt đầu thực hiện”, “Bàn giao – chờ nghiệm thu”, “Nghiệm thu – Hoàn thành”. <b>Người duyệt yêu cầu</b> xem nội dung, chi phí rồi bấm “Duyệt” hoặc “Từ chối” (từ chối phải ghi lý do ở Giải trình). Chỉ tài khoản có quyền Người duyệt yêu cầu mới thấy nút Duyệt / Từ chối.</dd>
      <dt>Tiến độ</dt><dd>Đang báo giá → Chờ duyệt → Đã duyệt → Đang thực hiện → Chờ nghiệm thu → Hoàn thành (hoặc dừng ở Từ chối / Hủy). Trong chi tiết yêu cầu có nút chuyển sang bước kế tiếp: Duyệt / Từ chối tự ghi ngày duyệt; Nghiệm thu tự ghi ngày hoàn thành thực tế.</dd>
      <dt>Giải trình</dt><dd>Bắt buộc khi yêu cầu quá hạn timeline, hoàn thành trễ, chi phí thực tế vượt dự kiến, bị từ chối hoặc hủy. Tab “Thiếu giải trình” liệt kê các yêu cầu còn thiếu.</dd>
      <dt>Theo dõi</dt><dd>Chỉ số: đang xử lý (kèm tổng giá trị), chờ duyệt, quá hạn, thiếu giải trình, hoàn thành trong tháng (tỷ lệ đúng hạn, chi phí). Có thể nhóm theo tiến độ, kho, bộ phận, người thực hiện, người duyệt; đính kèm ảnh báo giá / hiện trường / nghiệm thu.</dd></dl>
      <h2>Hệ thống: Phân quyền truy cập</h2><dl>
      <dt>Mã truy cập riêng</dt><dd>Mỗi người đăng nhập bằng mã truy cập cá nhân do Quản trị cấp (menu Hệ thống → Phân quyền truy cập). Tên người dùng tự lấy theo tài khoản và ghi vào Nhật ký thay đổi. Mã chung (đặt bằng hàm setPasscode) chỉ nên để Quản trị giữ.</dd>
      <dt>Vai trò</dt><dd><b>Người xem</b>: xem, tải Excel, không sửa được gì · <b>Người chỉnh sửa</b>: thêm / sửa / xóa dữ liệu · <b>Quản trị</b>: toàn quyền và cấp quyền cho người khác. Quyền cộng thêm <b>Người duyệt yêu cầu</b>: được Duyệt / Từ chối Dịch vụ mua ngoài và duyệt hoàn thành Task “Chờ duyệt” (gắn được cho cả Người xem).</dd>
      <dt>Kiểm soát</dt><dd>Quyền được Apps Script kiểm tra trên máy chủ, nên không thể vượt quyền bằng cách sửa giao diện. Khóa (🔒) tài khoản để tạm ngưng; xóa nếu người đó nghỉ hẳn.</dd></dl>`;
    view.innerHTML = h + '</div></div>';
  }

  /* ------------------------------------------------------------------ drawer */
  function openDrawer(title, body, foot) {
    $('#drawerTitle').textContent = title;
    $('#drawerBody').innerHTML = body;
    $('#drawerFoot').innerHTML = foot || '';
    $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
    if (state.pendingRender) setTimeout(rerender, 250);
  }

  /** Mã kế tiếp theo kho: tiền tố của kho + số thứ tự lớn nhất đang có + 1 */
  function nextSeqCode(def, kho) {
    const q = def.seqCode, pre = (q.prefix || {})[kho] || `PDA-${kho || 'X'}-`, c = colNum(q.col), s = sh(def.name);
    let max = 0;
    if (s) for (let r = def.dataStart; r <= s.v.length; r++) { const v = String(val(def.name, r, c)); if (v.toUpperCase().startsWith(pre.toUpperCase())) max = Math.max(max, Number(v.slice(pre.length)) || 0); }
    return pre + String(max + 1).padStart(q.pad || 2, '0');
  }

  /* ------------------------------------------------------------------ nhân sự (MSNV ↔ họ tên)
   * Không cần danh sách riêng: web tự học từ các tab có cột MSNV + tên (sổ nhập xuất, cấp phát PDA, nón/áo…).
   * Nhập MSNV → tự điền tên; nhập tên → tự điền MSNV. Người mới được ghi nhớ sau lần lưu đầu tiên. */
  function peopleDir() {
    const byMsnv = {}, byName = {};
    sheetOrder().forEach(n => {
      const p = schemaOf(n).people, s = sh(n); if (!p || !s) return;
      const cm = colNum(p.msnv), cn = colNum(p.name), start = schemaOf(n).dataStart || 5;
      for (let r = start; r <= s.v.length; r++) {
        const m = plain(val(n, r, cm)).trim(), nm = plain(val(n, r, cn)).trim();
        if (!m || !nm || /dữ liệu cũ/i.test(nm)) continue;
        byMsnv[m.toUpperCase()] = nm; byName[nm.toLowerCase()] = m;
      }
    });
    return { byMsnv, byName };
  }
  function bindPeople(body, def) {
    const mEl = body.querySelector(`[data-c="${colNum(def.people.msnv)}"]`), nEl = body.querySelector(`[data-c="${colNum(def.people.name)}"]`);
    if (!mEl || !nEl) return;
    const dir = peopleDir();
    const dl = (id, list) => { let d = document.getElementById(id); if (!d) { d = document.createElement('datalist'); d.id = id; document.body.appendChild(d); } d.innerHTML = list.map(o => `<option value="${esc(o[0])}">${esc(o[1] || '')}</option>`).join(''); };
    dl('dl-MSNV', Object.keys(dir.byMsnv).map(k => [k, dir.byMsnv[k]]));
    dl('dl-NAME', [...new Set(Object.values(dir.byMsnv))].map(nm => [nm, dir.byName[nm.toLowerCase()]]));
    mEl.setAttribute('list', 'dl-MSNV'); nEl.setAttribute('list', 'dl-NAME'); mEl.setAttribute('autocomplete', 'off'); nEl.setAttribute('autocomplete', 'off');
    const hint = document.createElement('div'); hint.className = 'muted'; hint.style.fontSize = '12px'; mEl.after(hint);
    const fromMsnv = () => {
      const m = mEl.value.trim().toUpperCase(), nm = dir.byMsnv[m];
      if (nm && (!nEl.value.trim() || nEl.dataset.auto === '1')) { nEl.value = nm; nEl.dataset.auto = '1'; }
      hint.textContent = !m ? '' : nm ? `✓ ${nm}` : 'MSNV mới – nhập họ tên, web sẽ nhớ cho lần sau';
      hint.style.color = nm ? 'var(--green)' : '';
    };
    const fromName = () => {
      nEl.dataset.auto = '';
      const m = dir.byName[nEl.value.trim().toLowerCase()];
      if (m && !mEl.value.trim()) { mEl.value = m; fromMsnv(); }
    };
    mEl.addEventListener('input', fromMsnv); nEl.addEventListener('change', fromName);
    fromMsnv();
  }

  function nextCode(def, group) {
    const ac = def.autoCode; if (!ac) return '';
    const g = ac.map[group]; if (!g) return '';
    const pre = `${ac.prefix}-${g}-`; let max = 0;
    for (let r = def.dataStart; r <= sh(def.name).v.length; r++) { const v = String(val(def.name, r, colNum(ac.col))); if (v.startsWith(pre)) max = Math.max(max, Number(v.slice(pre.length)) || 0); }
    return pre + String(max + 1).padStart(3, '0');
  }

  function openRowDrawer(name, r, preset, focusImages) {
    const def = tableDef(name), isNew = !r;
    const fields = def.cols.map(col => {
      const v = isNew ? (preset && preset[col.c] != null ? encLocal(preset[col.c]) : '') : val(name, r, col.c);
      const editable = !col.computed && (isNew || canEditCell(name, r, col.c));
      const ft = fieldType(def, col, r || def.dataStart);
      const id = 'f' + col.c;
      let ctl;
      if (!editable) {
        if (isNew) return '';
        ctl = `<div class="ro">${esc(fmt(v, col.h)) || '<span class="muted">—</span>'}</div>`;
      } else if (ft.t === 'select') {
        ctl = `<select class="select" id="${id}" data-c="${col.c}" ${ft.manage ? 'data-managed="1"' : ''}>${selectOptionsHtml(ft, plain(v))}</select>`;
      } else if (ft.t === 'textarea') ctl = `<textarea id="${id}" data-c="${col.c}">${esc(inputValue(v, ft))}</textarea>`;
      else {
        let list = '';
        if (ft.dl) list = `list="${ft.dl}"`;
        else if (ft.t === 'suggest') list = `list="sgd-${col.c}"`;
        ctl = `<input class="input" id="${id}" data-c="${col.c}" ${list} type="${ft.t === 'date' ? 'date' : ft.t === 'number' ? 'number' : 'text'}" step="any" value="${esc(inputValue(v, ft))}">${ft.t === 'suggest' ? `<datalist id="sgd-${col.c}">${ft.list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}`;
      }
      const full = ft.t === 'textarea' || col.h.length > 28;
      return `<div class="field ${full ? 'full' : ''}"><label for="${id}">${esc(col.h)} ${!editable ? '<span class="c">(tự tính)</span>' : ''}</label>${ctl}</div>`;
    }).join('');
    const imgs = isNew ? '' : `<div class="sec-title" id="imgSec">📷 Hình ảnh theo dõi <span class="chip" id="imgCount"></span></div>
      <div class="gallery" id="imgGrid"></div>
      <label class="upload mt need-edit" id="upl"><input type="file" accept="image/*" multiple id="imgInput"><b>Bấm để chọn ảnh</b> hoặc kéo thả vào đây<br><small>Trên điện thoại có thể chụp trực tiếp · ảnh tự nén ≤ 1600px</small></label>`;
    const title = isNew ? `Thêm dòng – ${schemaOf(name).title}` : `${schemaOf(name).title} · dòng ${r}`;
    const ext = DRAWER_EXT[name];   // phần bổ sung riêng từng tab (VD: ngày nhập + người nhập máy PDA)
    openDrawer(title, `${!isNew ? `<div class="muted" style="margin-bottom:12px">${esc(rowLabel(def, r))}</div>` : ''}<div class="form">${fields}</div>${ext ? ext.html(r, isNew) : ''}${imgs}`,
      `${!isNew && def.addRow ? '<button class="btn danger need-edit" id="dDel">🗑 Xóa dòng</button>' : ''}<span style="flex:1"></span><button class="btn" data-close>Đóng</button><button class="btn primary need-edit" id="dSave">${isNew ? '＋ Thêm vào Sheet' : '💾 Lưu thay đổi'}</button>`);
    const body = $('#drawerBody');
    // Tự điền tên/ĐVT khi chọn mã; tự sinh mã danh mục
    if (def.autoCode && isNew) {
      const gEl = body.querySelector(`[data-c="${colNum(def.autoCode.from)}"]`), cEl = body.querySelector(`[data-c="${colNum(def.autoCode.col)}"]`);
      if (gEl && cEl) gEl.addEventListener('change', () => { if (!cEl.value) cEl.value = nextCode(def, gEl.value); });
    }
    // Số máy tự đánh theo kho cho dòng mới (VD: PDA-20-07) – vẫn sửa được theo nhãn thật
    if (def.seqCode && isNew) {
      const q = def.seqCode, cEl = body.querySelector(`[data-c="${colNum(q.col)}"]`), kEl = body.querySelector(`[data-c="${colNum(q.khoCol)}"]`);
      if (cEl && kEl) {
        const fill = () => { if (!cEl.value || cEl.dataset.auto === '1') { cEl.value = nextSeqCode(def, kEl.value); cEl.dataset.auto = '1'; } };
        cEl.addEventListener('input', () => { cEl.dataset.auto = ''; });
        kEl.addEventListener('change', fill); fill();
      }
    }
    if (def.people) bindPeople(body, def);
    if (ext) ext.bind(body, r, isNew);
    $$('select[data-managed]', body).forEach(sel => bindManagedSelect(sel, def, def.cols.find(x => x.c === +sel.dataset.c)));
    if (def.lookup) Object.keys(def.lookup).forEach(L => {
      const el = body.querySelector(`[data-c="${colNum(L)}"]`); if (!el) return;
      const kind = def.lookup[L];
      const hint = document.createElement('div'); hint.className = 'muted'; hint.style.fontSize = '12px'; el.after(hint);
      const priceEl = def.price && def.price.code === L ? body.querySelector(`[data-c="${colNum(def.price.to)}"]`) : null;
      const upd = (initial) => {
        const o = kind === 'PDA' ? findDevice(el.value) : codes(kind, true).find(x => String(x.v) === el.value);
        const mayFill = !(initial === true && !isNew);   // dòng cũ: không tự ghi đơn giá khi chỉ mở xem
        const missMsg = kind === 'PDA' ? '⚠ Số máy / IMEI chưa khai báo ở tab Thống kê PDA' : '⚠ Mã không có trong danh mục – bấm “＋ Mã mới” để thêm';
        let warn = '';
        if (kind === 'PDA' && o) {   // máy đang có người mượn / máy không ở tình trạng TỐT
          const busy = loanList(LOANS.PDA).find(x => x.open && sameDevice(x.item, el.value) && x.r !== r);
          if (busy) warn = ` · ⚠ đang được mượn bởi ${busy.who || '?'} (${busy.ca} ${busy.d ? dmy(isoOf(busy.d)) : ''})`;
          else if (o.st && !/^tốt$/i.test(o.st)) warn = ` · ⚠ máy đang ở tình trạng ${o.st}`;
        }
        hint.textContent = el.value ? (o ? `${o.stop ? '⚠ Mã đã ngừng dùng · ' : ''}${o.l}${o.u ? ' · ' + o.u : ''}${o.p ? ' · ' + num(o.p).toLocaleString('vi-VN') + ' đ' : ''}${warn}` : missMsg) : '';
        hint.style.color = el.value && (!o || o.stop || warn) ? 'var(--red)' : '';
        // Tự điền đơn giá theo danh mục khi ô Đơn giá còn trống (vẫn sửa được)
        if (mayFill && priceEl && o && o.p !== '' && o.p != null && (priceEl.value === '' || priceEl.dataset.auto === '1')) { priceEl.value = num(o.p); priceEl.dataset.auto = '1'; }
      };
      if (priceEl) priceEl.addEventListener('input', () => { priceEl.dataset.auto = ''; });
      el.addEventListener('input', () => upd(false)); upd(true);
      if (kind === 'NVL' || kind === 'CCDC') {
        const tools = document.createElement('div'); tools.className = 'lk-tools need-edit';
        tools.innerHTML = `<button type="button" class="btn sm" data-lk="new">＋ Mã ${kind} mới</button><button type="button" class="btn sm" data-lk="cat">⚙ Danh mục ${kind}</button>`;
        hint.after(tools);
        tools.querySelector('[data-lk=new]').onclick = () => openNewCodeModal(kind, code => { el.value = code; upd(); });
        tools.querySelector('[data-lk=cat]').onclick = () => openCatalogManager(kind, upd);
      }
    });
    $('#dSave').onclick = () => {
      const changes = [], values = {};
      $$('[data-c]', body).forEach(el => {
        const c = +el.dataset.c; let v = el.value;
        if (el.type === 'number' && v !== '') v = Number(v);
        if (isNew) { if (v !== '') values[c] = v; }
        else {
          const col = def.cols.find(x => x.c === c), ft = fieldType(def, col, r);
          if (String(v) !== String(inputValue(val(name, r, c), ft))) changes.push({ row: r, col: c, value: v });
        }
      });
      if (isNew && !Object.keys(values).length) { toast('Chưa nhập thông tin nào', 'warn'); return; }
      if (ext && ext.save(r, isNew, values, changes) === false) return;
      if (isNew) {
        const op = enqueue('append', { sheet: name, values, dataStart: def.dataStart, lastCol: def.lastCol });
        toast(state.apiUrl ? `Đã thêm dòng ${op.payload._row} – đang đồng bộ` : `Đã thêm dòng ${op.payload._row} trên máy`);
      } else if (changes.length) {
        enqueue('update', { sheet: name, changes });
        toast(`Đã lưu ${changes.length} thay đổi`);
      }
      closeDrawer(); route(true);
    };
    if ($('#dDel')) $('#dDel').onclick = () => { closeDrawer(); deleteRow(def, r); route(true); };
    if (!isNew) { drawImages(name, r); bindUpload(def, r); if (focusImages) setTimeout(() => $('#imgSec').scrollIntoView({ behavior: 'smooth' }), 260); }
  }

  function drawImages(name, r) {
    const list = state.images.filter(im => im.sheet === name && +im.row === r);
    $('#imgCount').textContent = list.length;
    $('#imgGrid').innerHTML = list.map(im => `<div class="ph" data-url="${esc(im.url)}" data-cap="${esc(im.name + ' · ' + im.time)}"><img loading="lazy" src="${esc(im.url)}" alt="${esc(im.name)}" referrerpolicy="no-referrer"><button class="del need-edit" data-id="${esc(im.id)}" title="Xóa ảnh">✕</button><div class="cap">${esc(im.time)}</div></div>`).join('') || '<div class="muted">Chưa có ảnh.</div>';
    $$('#imgGrid .ph').forEach(ph => ph.addEventListener('click', e => {
      if (e.target.closest('.del')) return;
      lightbox(ph.dataset.url, ph.dataset.cap);
    }));
    $$('#imgGrid .del').forEach(b => b.onclick = async () => {
      if (!confirm('Xóa ảnh này? (ảnh được chuyển vào thùng rác Google Drive)')) return;
      try { await api('deleteImage', { id: b.dataset.id }); state.images = state.images.filter(im => im.id !== b.dataset.id); saveCache(); drawImages(name, r); toast('Đã xóa ảnh'); }
      catch (e) { toast('Không xóa được ảnh: ' + e.message, 'err'); }
    });
  }

  function compress(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = rej;
      fr.onload = () => {
        const img = new Image();
        img.onerror = rej;
        img.onload = () => {
          const max = 1600, sc = Math.min(1, max / Math.max(img.width, img.height));
          const cv = document.createElement('canvas'); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          res(cv.toDataURL('image/jpeg', .85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function bindUpload(def, r) {
    const input = $('#imgInput'), zone = $('#upl');
    const go = async files => {
      if (!state.apiUrl) { toast('Cần kết nối Google Sheet (Cài đặt) để tải ảnh lên Google Drive', 'warn'); return; }
      for (const f of files) {
        if (!/^image\//.test(f.type)) continue;
        try {
          toast('Đang tải ảnh ' + f.name + '…');
          const data = await compress(f);
          const name = `${def.name}_dong${r}_${Date.now()}.jpg`;
          const j = await api('upload', { sheet: def.name, row: r, kho: rowKho(def, r), label: rowLabel(def, r), name, mime: 'image/jpeg', data });
          state.images.push({ ...j.image, sheet: def.name, row: r, kho: rowKho(def, r), label: rowLabel(def, r), time: new Date().toLocaleString('vi-VN'), user: state.user });
          saveCache(); drawImages(def.name, r);
          toast('Đã tải ảnh lên Google Drive');
        } catch (e) { toast('Tải ảnh lỗi: ' + e.message, 'err'); }
      }
      state.pendingRender = true;
    };
    input.onchange = () => { go([...input.files]); input.value = ''; };
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); go([...e.dataTransfer.files]); });
  }

  function lightbox(url, cap) {
    const lb = $('#lightbox'); $('img', lb).src = url.replace(/sz=w\d+/, 'sz=w2400'); $('.lb-cap', lb).textContent = cap || ''; lb.hidden = false;
  }

  /* ------------------------------------------------------------------ gallery / log / settings */
  function renderGallery(view) {
    setCrumb('Thư viện hình ảnh', state.images.length + ' ảnh');
    const k = state.kho;
    const list = state.images.filter(im => k === 'ALL' || im.kho === k).slice().reverse();
    const bySheet = {};
    list.forEach(im => (bySheet[im.sheet] = bySheet[im.sheet] || []).push(im));
    view.innerHTML = `<div class="card"><div class="card-h"><h3>Hình ảnh theo dõi</h3><span class="sub">${k === 'ALL' ? 'tất cả các kho' : esc(khoInfo(k).name)} · ảnh lưu ở Google Drive, link ở tab WEB_HINH_ANH</span></div>
      <div class="card-b">${!state.apiUrl ? '<div class="banner" style="margin:0 0 14px">Cần kết nối Google Sheet để tải và xem ảnh.</div>' : ''}
      ${Object.keys(bySheet).length ? Object.entries(bySheet).map(([n, ims]) => `<div class="sec-title">${esc(schemaOf(n).title)} <span class="chip">${ims.length}</span></div>
        <div class="gallery">${ims.map(im => `<div class="ph" data-url="${esc(im.url)}" data-cap="${esc((im.label || '') + ' · ' + im.time)}" data-sheet="${esc(im.sheet)}" data-row="${im.row}"><img loading="lazy" src="${esc(im.url)}" referrerpolicy="no-referrer" alt=""><div class="cap">${esc(im.kho ? im.kho + ' · ' : '')}${esc(im.label || ('Dòng ' + im.row))}</div></div>`).join('')}</div>`).join('')
        : '<div class="empty">Chưa có ảnh nào. Mở một dòng bất kỳ trong các sổ và bấm 📷 để tải ảnh lên.</div>'}</div></div>`;
    $$('.ph', view).forEach(ph => ph.onclick = () => lightbox(ph.dataset.url, ph.dataset.cap + ' — mở dòng: ' + ph.dataset.sheet + ' #' + ph.dataset.row));
  }

  async function renderLog(view) {
    setCrumb('Nhật ký thay đổi', 'WEB_NHAT_KY');
    const pend = state.queue.map(op => `<li><span class="chip amber">Chờ</span><div class="grow"><div class="t">${esc(op.action)} · ${esc(op.payload.sheet)}</div><div class="s">${new Date(op.t).toLocaleString('vi-VN')}</div></div></li>`).join('');
    view.innerHTML = `${state.queue.length ? `<div class="card"><div class="card-h"><h3>Đang chờ đồng bộ</h3><span class="chip amber">${state.queue.length}</span><div class="right"><button class="btn sm" id="flushNow">Đồng bộ ngay</button></div></div><ul class="list">${pend}</ul></div>` : ''}
      <div class="card ${state.queue.length ? 'mt' : ''}"><div class="card-h"><h3>Lịch sử thay đổi trên Google Sheet</h3><span class="sub">300 thay đổi gần nhất từ web</span></div><div id="logBody"><div class="empty">${state.apiUrl ? 'Đang tải…' : 'Cần kết nối Google Sheet để xem nhật ký.'}</div></div></div>`;
    if ($('#flushNow')) $('#flushNow').onclick = flush;
    if (!state.apiUrl) return;
    try {
      const j = await api('log', { limit: 300 });
      $('#logBody').innerHTML = j.log.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Thời gian</th><th>Người dùng</th><th>Hành động</th><th>Tab</th><th>Vị trí</th><th>Giá trị cũ</th><th>Giá trị mới</th></tr></thead><tbody>${j.log.map(x => `<tr><td class="nowrap">${esc(x.time)}</td><td>${esc(x.user)}</td><td><span class="chip brand">${esc(x.action)}</span></td><td><a href="#/sheet/${encodeURIComponent(x.sheet)}">${esc(x.sheet)}</a></td><td>${esc(x.where)}</td><td class="wrap">${esc(x.oldV)}</td><td class="wrap">${esc(x.newV)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Chưa có thay đổi nào.</div>';
    } catch (e) { $('#logBody').innerHTML = `<div class="empty">Không tải được: ${esc(e.message)}</div>`; }
  }

  function renderSettings(view) {
    setCrumb('Cài đặt & Sao lưu');
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${C.SHEET_ID}/edit`;
    view.innerHTML = `
      <div class="card"><div class="card-h"><h3>Kết nối Google Sheet</h3><span class="chip ${state.apiUrl ? (state.online ? 'green' : 'red') : 'amber'}">${state.apiUrl ? (state.online ? 'Đã kết nối' : 'Lỗi kết nối') : 'Chưa kết nối'}</span></div><div class="card-b">
        <div class="setting-row"><label>URL Web App (Apps Script)</label><input class="input" id="sUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(state.apiUrl)}"></div>
        <div class="setting-row"><label>Mã truy cập</label><input class="input" id="sKey" type="password" placeholder="(nếu đã đặt APP_PASSCODE)" value="${esc(state.key)}"></div>
        <div class="setting-row"><label>Tên người dùng (ghi nhật ký)</label><input class="input" id="sUser" placeholder="VD: Nguyễn Văn A – Thủ kho HCM20" value="${esc(state.user)}"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn primary" id="sSave">Lưu & kết nối</button><button class="btn" id="sTest">Kiểm tra kết nối</button>${state.apiUrl ? '<button class="btn danger" id="sOff">Ngắt kết nối</button>' : ''}</div>
        <p class="muted" style="margin-top:12px">Chưa có URL? Làm theo <b>README.md</b> (mục 1): mở Google Sheet → Tiện ích mở rộng → Apps Script → dán file <span class="code-inline">apps-script/Code.gs</span> → Triển khai ứng dụng web.</p>
      </div></div>
      <div class="grid g2 mt">
        <div class="card"><div class="card-h"><h3>Sao lưu</h3></div><div class="card-b">
          <p class="muted" style="margin-top:0">• Sao lưu tự động: bản sao cả file vào Google Drive (thư mục “GHN Kho Vat Tu - Sao luu”) lúc 23:00 hằng ngày, giữ 30 bản – bật bằng hàm <span class="code-inline">setupTriggers</span>.<br>• Mọi thay đổi từ web ghi vào tab WEB_NHAT_KY.<br>• Trên máy này: thay đổi chưa gửi được giữ lại và tự gửi khi có mạng.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary need-edit" id="bNow" ${state.apiUrl ? '' : 'disabled'}>☁ Sao lưu ngay lên Drive</button><button class="btn" id="bJson">⭳ Tải bản sao lưu (.json)</button><a class="btn" href="https://docs.google.com/spreadsheets/d/${C.SHEET_ID}/export?format=xlsx" target="_blank" rel="noopener">⭳ Tải file Excel (.xlsx)</a></div>
          <div id="bList" class="mt"></div>
        </div></div>
        <div class="card"><div class="card-h"><h3>Dữ liệu</h3></div><div class="card-b">
          <div class="setting-row"><label>Nguồn dữ liệu</label><div>${state.mode === 'live' ? 'Trực tiếp từ Google Sheet' : 'Bản chụp ' + esc(window.SNAPSHOT.generatedAt)} · ${sheetOrder().length} tab</div></div>
          <div class="setting-row"><label>Thay đổi chờ đồng bộ</label><div>${state.queue.length} ${state.queue.length ? '<button class="btn sm" id="qFlush">Gửi ngay</button> <button class="btn sm danger" id="qClear">Bỏ các thay đổi chờ</button>' : ''}</div></div>
          <div class="setting-row"><label>Google Sheet</label><div><a href="${sheetUrl}" target="_blank" rel="noopener">Mở file gốc ↗</a></div></div>
          <div class="setting-row"><label>Bộ nhớ đệm trên máy</label><div><button class="btn sm" id="cClear">Xóa bộ nhớ đệm & tải lại</button></div></div>
        </div></div>
      </div>`;
    const readForm = () => { state.authFail = false; state.apiUrl = $('#sUrl').value.trim(); state.key = $('#sKey').value.trim(); state.user = $('#sUser').value.trim(); LS.set('apiUrl', state.apiUrl); LS.set('key', state.key); LS.set('user', state.user); };
    $('#sSave').onclick = async () => { readForm(); updateBanner(); if (state.apiUrl) { await fetchAll(); flush(); } route(true); };
    $('#sTest').onclick = async () => { readForm(); try { const j = await api('ping'); toast(`Kết nối OK: “${j.title}”`); state.online = true; } catch (e) { toast('Lỗi: ' + e.message, 'err'); } };
    if ($('#sOff')) $('#sOff').onclick = () => { state.apiUrl = ''; LS.set('apiUrl', ''); state.mode = 'snapshot'; updateBanner(); setSync(''); route(true); };
    $('#bNow').onclick = async () => { try { toast('Đang sao lưu…'); const j = await api('backup'); toast('Đã sao lưu: ' + j.backup.name); listBk(); } catch (e) { toast('Sao lưu lỗi: ' + e.message, 'err'); } };
    $('#bJson').onclick = () => download(`GHN-KhoVatTu-M12-${isoOf(new Date())}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), data: state.data, images: state.images, queue: state.queue }), 'application/json');
    if ($('#qFlush')) $('#qFlush').onclick = flush;
    if ($('#qClear')) $('#qClear').onclick = () => { if (confirm('Bỏ tất cả thay đổi chưa đồng bộ?')) { state.queue = []; saveQueue(); location.reload(); } };
    $('#cClear').onclick = () => { LS.del('cache'); location.reload(); };
    const listBk = async () => {
      if (!state.apiUrl) return;
      // Máy chủ trả thời gian dạng dd/MM/yyyy HH:mm: đổi ra số để sắp xếp đúng (mới nhất trước)
      const tsOf = s => { const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/); return m ? +(m[3] + m[2] + m[1] + m[4] + m[5]) : 0; };
      try { const j = await api('backups'); j.backups.sort((a, b) => tsOf(b.time) - tsOf(a.time)); $('#bList').innerHTML = j.backups.length ? '<ul class="list" style="border:1px solid var(--line);border-radius:10px">' + j.backups.slice(0, 10).map(b => `<li><div class="grow"><div class="t">${esc(b.name)}</div><div class="s">${esc(b.time)}</div></div><a class="btn sm" href="${esc(b.url)}" target="_blank" rel="noopener">Mở</a></li>`).join('') + '</ul>' : '<div class="muted">Chưa có bản sao lưu.</div>'; }
      catch (e) { $('#bList').innerHTML = ''; }
    };
    listBk();
  }

  /* ------------------------------------------------------------------ DANH SÁCH LỰA CHỌN (dropdown)
   * Dropdown lấy từ quy tắc xác thực dữ liệu của Google Sheet. Thêm / bớt lựa chọn ngay trên web
   * → Apps Script (setList) thay quy tắc của cột trên Sheet. Dữ liệu đã nhập ở dòng cũ không bị đổi. */
  const OPT_ADD = '__add__', OPT_MANAGE = '__manage__';
  function selectOptionsHtml(ft, cur) {
    const list = ft.list.map(String);
    return '<option value=""></option>' + list.map(o => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')
      + (cur && !list.includes(cur) ? `<option selected>${esc(cur)}</option>` : '')
      + (ft.manage && canEdit() ? `<option disabled>──────────</option><option value="${OPT_ADD}">＋ Thêm lựa chọn mới…</option><option value="${OPT_MANAGE}">⚙ Sửa / xóa danh sách…</option>` : '');
  }
  const currentList = (def, col) => (dvFor(def.name, col.L, def.dataStart, def.dataStart) || []).map(String);
  function saveList(def, col, values) {
    enqueue('setList', { sheet: def.name, col: col.L, dataStart: def.dataStart, values });
    toast(`Đã cập nhật danh sách “${col.h}” (${values.length} lựa chọn)`);
  }
  /** Hỏi tên lựa chọn mới, thêm vào danh sách; trả về tên (hoặc '' nếu hủy) */
  function askNewOption(def, col) {
    const name = (prompt(`Thêm lựa chọn mới cho “${col.h}”:`) || '').trim();
    if (!name) return '';
    const list = currentList(def, col);
    const same = list.find(x => x.toLowerCase() === name.toLowerCase());
    if (same) { toast(`“${same}” đã có trong danh sách`, 'warn'); return same; }
    saveList(def, col, [...list, name]);
    return name;
  }
  /** Gắn xử lý "Thêm mới / Sửa danh sách" cho 1 dropdown trong form */
  function bindManagedSelect(sel, def, col) {
    let prev = sel.value;
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (v !== OPT_ADD && v !== OPT_MANAGE) { prev = v; return; }
      sel.value = prev;
      const redraw = pick => { sel.innerHTML = selectOptionsHtml(fieldType(def, col, def.dataStart), pick); sel.value = pick; prev = pick; };
      if (v === OPT_ADD) { const name = askNewOption(def, col); if (name) redraw(name); }
      else openListManager(def, col, () => redraw(prev));
    });
  }

  function colUsage(def, col) {
    const s = sh(def.name), out = {};
    if (!s) return out;
    for (let r = def.dataStart; r <= s.v.length; r++) { const v = plain(val(def.name, r, col.c)); if (v) out[v] = (out[v] || 0) + 1; }
    return out;
  }

  function modal(html, cls = '') {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(bg);
    const close = () => { bg.remove(); if (state.pendingRender) setTimeout(() => { if (!renderBlocked()) rerender(); }, 300); };
    bg.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    return { bg, close, $: s => bg.querySelector(s), $$: s => [...bg.querySelectorAll(s)] };
  }

  function openListManager(def, col, onClose) {
    let items = currentList(def, col);
    const orig = items.join('\n'), usage = colUsage(def, col);
    const m = modal(`<h3>Danh sách “${esc(col.h)}”</h3>
      <p class="muted" style="margin:0">Tab ${esc(def.name)} · cột ${esc(col.L)}. Bớt lựa chọn <b>không xóa</b> dữ liệu đã nhập ở các dòng cũ.</p>
      <ul class="lm-list" id="lmList"></ul>
      <div class="ck-add"><input class="input" id="lmNew" placeholder="Thêm lựa chọn… (Enter)"><button class="btn" id="lmAdd" type="button">＋ Thêm</button></div>
      <div class="row"><button class="btn" id="lmCancel" type="button">Hủy</button><button class="btn primary" id="lmSave" type="button">💾 Lưu danh sách</button></div>`, 'wide');
    const done = () => { m.close(); onClose && onClose(); };
    const draw = () => {
      m.$('#lmList').innerHTML = items.map((x, i) => `<li><span class="grow">${esc(x)}</span><span class="muted">${usage[x] ? usage[x] + ' dòng đang dùng' : 'chưa dùng'}</span>
        <button class="icon-btn sm" data-up="${i}" title="Đưa lên" aria-label="Đưa ${esc(x)} lên" ${i ? '' : 'disabled'}>↑</button>
        <button class="icon-btn sm danger" data-del="${i}" title="Bỏ khỏi danh sách" aria-label="Bỏ ${esc(x)}">✕</button></li>`).join('') || '<li class="muted">Danh sách trống</li>';
      m.$$('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); });
      m.$$('[data-del]').forEach(b => b.onclick = () => {
        const x = items[+b.dataset.del];
        if (usage[x] && !confirm(`“${x}” đang được dùng ở ${usage[x]} dòng.\nCác dòng đó vẫn giữ nguyên giá trị, chỉ là không chọn được “${x}” cho dòng mới.\n\nBỏ khỏi danh sách?`)) return;
        items.splice(+b.dataset.del, 1); draw();
      });
    };
    const add = () => {
      const el = m.$('#lmNew'), s = el.value.trim(); if (!s) return;
      if (items.some(x => x.toLowerCase() === s.toLowerCase())) { toast(`“${s}” đã có`, 'warn'); return; }
      items.push(s); el.value = ''; draw(); el.focus();
    };
    draw();
    m.$('#lmAdd').onclick = add;
    m.$('#lmNew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    m.$('#lmCancel').onclick = done;
    m.$('#lmSave').onclick = () => {
      if (!items.length) { toast('Danh sách phải còn ít nhất 1 lựa chọn', 'warn'); return; }
      if (items.join('\n') !== orig) saveList(def, col, items);
      done();
    };
    setTimeout(() => m.$('#lmNew').focus(), 50);
  }

  /* ------------------------------------------------------------------ DANH MỤC MÃ NVL / CCDC
   * Thêm mã mới ngay khi đang nhập phiếu; "Ngừng dùng" thay cho xóa (Tồn kho, Định mức, Kế hoạch
   * và lịch sử nhập/xuất đều tham chiếu theo mã nên không xóa hẳn được). */
  function openNewCodeModal(kind, onDone) {
    const name = catSheet(kind), def = tableDef(name), ac = def.autoCode;
    const groups = Object.keys(ac.map);
    const units = [...new Set(codes(kind, true).map(o => plain(o.u)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    const m = modal(`<h3>＋ Thêm mã ${kind} mới</h3>
      <p class="muted" style="margin:0">Ghi vào tab ${name}. Mã tự sinh theo nhóm.</p>
      <div class="field"><label for="ncG">Nhóm</label><select class="select" id="ncG">${groups.map(g => `<option>${esc(g)}</option>`).join('')}</select></div>
      <div class="field"><label for="ncC">Mã</label><input class="input" id="ncC"></div>
      <div class="field"><label for="ncN">Tên ${kind} <span class="req">*</span></label><input class="input" id="ncN" placeholder="VD: Băng keo trong 5cm"></div>
      <div class="form" style="margin-top:0">
        <div class="field"><label for="ncU">ĐVT <span class="req">*</span></label><input class="input" id="ncU" list="ncUl"><datalist id="ncUl">${units.map(u => `<option value="${esc(u)}">`).join('')}</datalist></div>
        <div class="field"><label for="ncP">Đơn giá (VNĐ)</label><input class="input" id="ncP" type="number" min="0" step="any"></div>
      </div>
      <div class="row"><button class="btn" id="ncCancel" type="button">Hủy</button><button class="btn primary" id="ncSave" type="button">＋ Thêm vào danh mục</button></div>`);
    const setCode = () => { m.$('#ncC').value = nextCode(def, m.$('#ncG').value); };
    setCode();
    m.$('#ncG').onchange = setCode;
    m.$('#ncCancel').onclick = m.close;
    m.$('#ncSave').onclick = () => {
      const code = m.$('#ncC').value.trim(), nm = m.$('#ncN').value.trim(), u = m.$('#ncU').value.trim(), p = m.$('#ncP').value;
      if (!code || !nm || !u) { toast('Cần nhập mã, tên và ĐVT', 'warn'); return; }
      const all = codes(kind, true);
      if (all.some(o => String(o.v) === code)) { toast(`Mã ${code} đã tồn tại`, 'warn'); return; }
      const dup = all.find(o => String(o.l).trim().toLowerCase() === nm.toLowerCase());
      if (dup && !confirm(`Đã có “${dup.l}” (mã ${dup.v}${dup.stop ? ', đang ngừng dùng' : ''}).\nVẫn tạo mã mới?`)) return;
      const values = { 1: code, 2: nm, 3: m.$('#ncG').value, 4: u };
      if (p !== '') values[5] = Number(p);
      enqueue('append', { sheet: name, values, dataStart: def.dataStart, lastCol: def.lastCol });
      fillDatalists();
      toast(`Đã thêm ${code} – ${nm}`);
      m.close(); onDone && onDone(code);
    };
    setTimeout(() => m.$('#ncN').focus(), 50);
  }

  /** Đặt Đang dùng / Ngừng dùng cho 1 mã (tự thêm cột "Trạng thái sử dụng" nếu Sheet chưa có) */
  function setCodeUse(kind, r, stop) {
    const name = catSheet(kind);
    let uc = useCol(name);
    if (!uc) {
      const def = tableDef(name), hdr = sh(name).v[3] || [];
      uc = Math.max(def.lastCol, hdr.length) + 1;
      enqueue('addColumn', { sheet: name, headerRow: 4, col: uc, title: USE_COL_TITLE });
    }
    enqueue('update', { sheet: name, changes: [{ row: r, col: uc, value: stop ? USE_STOP : USE_ON }] });
    fillDatalists();
  }

  function stockOf(code) {
    const s = sh('TON_KHO'); if (!s) return null;
    for (let r = 5; r <= s.v.length; r++) if (String(val('TON_KHO', r, 1)) === String(code)) return [7, 13, 19].reduce((a, c) => a + num(val('TON_KHO', r, c)), 0);
    return null;
  }

  function openCatalogManager(kind, onClose) {
    let q = '', show = 'all';
    const m = modal(`<h3>⚙ Danh mục ${kind}: đang dùng / ngừng dùng</h3>
      <p class="muted" style="margin:0">Mã <b>ngừng dùng</b> sẽ ẩn khỏi gợi ý khi nhập phiếu, nhưng vẫn giữ trong lịch sử, tồn kho và báo cáo.</p>
      <div class="toolbar" style="padding:12px 0;border:0">
        <div class="search" style="flex:1"><input class="input" id="cmQ" placeholder="Tìm mã hoặc tên…"></div>
        <div class="tabs">${[['all', 'Tất cả'], ['on', 'Đang dùng'], ['off', 'Ngừng dùng']].map(t => `<button class="tab ${t[0] === show ? 'active' : ''}" data-show="${t[0]}" type="button">${t[1]}</button>`).join('')}</div>
      </div>
      <ul class="lm-list tall" id="cmList"></ul>
      <div class="row"><button class="btn" id="cmNew" type="button">＋ Mã mới</button><span style="flex:1"></span><button class="btn primary" id="cmClose" type="button">Xong</button></div>`, 'wide');
    const done = () => { m.close(); onClose && onClose(); };
    const draw = () => {
      const ql = q.toLowerCase();
      const list = codes(kind, true).filter(o => (show === 'all' || (show === 'off') === o.stop) && (!ql || `${o.v} ${o.l} ${o.g}`.toLowerCase().includes(ql)));
      m.$('#cmList').innerHTML = list.map(o => {
        const st = kind === 'NVL' ? stockOf(o.v) : null;
        return `<li class="${o.stop ? 'off' : ''}"><div class="grow"><div class="t">${esc(o.v)} · ${esc(o.l)}</div><div class="s">${esc(o.g)}${o.u ? ' · ' + esc(o.u) : ''}${st ? ` · tồn 3 kho: ${st.toLocaleString('vi-VN')}` : ''}</div></div>
          <span class="chip ${o.stop ? 'red' : 'green'}">${o.stop ? USE_STOP : USE_ON}</span>
          <button class="btn sm" data-r="${o.r}" data-stop="${o.stop ? 0 : 1}" data-st="${st || 0}" type="button">${o.stop ? 'Dùng lại' : 'Ngừng dùng'}</button></li>`;
      }).join('') || '<li class="muted">Không có mã phù hợp</li>';
      m.$$('#cmList [data-r]').forEach(b => b.onclick = () => {
        const stop = b.dataset.stop === '1', st = +b.dataset.st;
        if (stop && st > 0 && !confirm(`Mã này còn tồn ${st.toLocaleString('vi-VN')} ở 3 kho.\nVẫn đánh dấu ngừng dùng?`)) return;
        setCodeUse(kind, +b.dataset.r, stop); draw();
      });
    };
    draw();
    m.$('#cmQ').addEventListener('input', debounce(e => { q = e.target.value; draw(); }, 150));
    m.$$('[data-show]').forEach(b => b.onclick = () => { show = b.dataset.show; m.$$('[data-show]').forEach(x => x.classList.toggle('active', x === b)); draw(); });
    m.$('#cmNew').onclick = () => openNewCodeModal(kind, () => draw());
    m.$('#cmClose').onclick = done;
    setTimeout(() => m.$('#cmQ').focus(), 50);
  }

  /* ------------------------------------------------------------------ CẤP PHÁT HẰNG NGÀY (PDA · Nón bảo hộ & áo phản quang)
   * Cùng 1 cấu trúc cột: A Ngày · B Ca · C Kho · D Vật cấp · E (tên máy / mã số) · F MSNV · G Người nhận · H Bộ phận
   *                     · I Tình trạng khi cấp · J Tình trạng khi trả · K Ghi chú · L Trạng thái (Sheet tự tính)
   * Đã trả = đã ghi "Tình trạng khi trả". Quá hạn trả = mượn từ hôm trước mà chưa trả. Không ghi giờ. */
  const LC = { date: 1, ca: 2, kho: 3, item: 4, item2: 5, msnv: 6, who: 7, dept: 8, condOut: 9, condIn: 10, note: 11 };
  const PDA_DEV = 'THONG_KE_PDA';
  const LOANS = {
    PDA: { key: 'PDA', sheet: 'CAP_PHAT_PDA', noun: 'máy', itemLabel: 'Số máy PDA / IMEI', outBtn: '＋ Cấp máy', icon: 'phone', alert: 'PDA' }
  };
  const loanOfSheet = n => Object.values(LOANS).find(d => d.sheet === n);
  const nowCa = () => { const h = new Date().getHours(); return h >= 6 && h < 14 ? 'Ca 1' : h >= 14 && h < 22 ? 'Ca 2' : 'Ca 3'; };

  /** Tìm máy PDA theo Số máy (VD PDA-20-07) hoặc IMEI (so phần số, quét mã vạch / có chữ "IMEI:" đều được) */
  function findDevice(input) {
    const s = String(input || '').trim(); if (!s) return null;
    const up = s.toUpperCase(), dg = imeiKey(s);
    return codes('PDA').find(d => (d.code && d.code.toUpperCase() === up) || (dg.length >= 8 && imeiKey(d.imei) === dg)) || null;
  }
  const sameDevice = (a, b) => {
    if (!a || !b) return false;
    if (String(a).trim().toUpperCase() === String(b).trim().toUpperCase()) return true;
    const da = findDevice(a), db = findDevice(b);
    return !!da && !!db && da.r === db.r;
  };

  function loanList(def, k) {
    const n = def.sheet, s = sh(n); if (!s) return [];
    const t0 = today0(), out = [];
    for (let r = 5; r <= s.v.length; r++) {
      const g = c => plain(val(n, r, c)).trim();
      const item = g(LC.item), who = g(LC.who), msnv = g(LC.msnv);
      if (!item && !who && !msnv) continue;
      const kho = g(LC.kho); if (k && kho !== k) continue;
      const d = toDate(val(n, r, LC.date), true), condIn = g(LC.condIn);
      const open = !condIn, late = open && !!d && d < t0;
      const dev = def.key === 'PDA' ? findDevice(item) : null;
      out.push({ r, d, ca: g(LC.ca), kho, item, item2: g(LC.item2), dev, label: def.key === 'PDA' ? (dev ? (dev.code || dev.imei) : item) : [item, g(LC.item2)].filter(Boolean).join(' · '),
        sub: def.key === 'PDA' ? (dev ? dev.name : 'Chưa khai báo') : '', msnv, who, dept: g(LC.dept), condOut: g(LC.condOut), condIn, note: g(LC.note),
        open, late, lateDays: late ? Math.round((t0 - d) / 86400000) : 0, today: !!d && +d === +t0, bad: !!condIn && condIn !== 'Bình thường' });
    }
    return out;
  }
  function loanCounts(def, k) {
    const L = loanList(def, k);
    const c = { today: L.filter(x => x.today).length, returned: L.filter(x => x.today && !x.open).length, open: L.filter(x => x.open && !x.late).length,
      late: L.filter(x => x.late).length, bad: L.filter(x => x.today && x.bad).length };
    if (def.key === 'PDA') {
      const busy = new Set(L.filter(x => x.open && x.dev).map(x => x.dev.r));
      const devs = codes('PDA').filter(d => !k || d.kho === k), good = devs.filter(d => /^tốt$/i.test(d.st));
      Object.assign(c, { ready: good.filter(d => !busy.has(d.r)).length, good: good.length, devices: devs.length });
    } else {
      const open = L.filter(x => x.open);
      Object.assign(c, { helmets: open.filter(x => /nón/i.test(x.item)).length, vests: open.filter(x => /áo/i.test(x.item)).length });
    }
    return c;
  }

  function loanPanel(view, def) {
    const k = state.kho === 'ALL' ? null : state.kho, c = loanCounts(def, k);
    const open = loanList(def, k).filter(x => x.open).sort((a, b) => (b.late - a.late) || ((a.d || 0) - (b.d || 0)) || a.label.localeCompare(b.label));
    const dupes = {};
    if (def.key === 'PDA') open.forEach(x => { const id = x.dev ? 'r' + x.dev.r : x.item; dupes[id] = (dupes[id] || 0) + 1; });
    const last = def.key === 'PDA'
      ? kpi('Máy sẵn sàng cấp', c.ready, c.devices ? `${c.good} máy TỐT / ${c.devices} máy khai báo` : 'Chưa khai báo máy ở Thống kê PDA', c.devices ? '' : 'amber', '#/sheet/' + PDA_DEV)
      : kpi('Đang ở người dùng', c.helmets + c.vests, `Nón: ${c.helmets} · Áo: ${c.vests}`, 'blue');
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="kpis">
        ${kpi('Lượt cấp hôm nay', c.today, `${c.returned} lượt đã trả`, 'blue')}
        ${kpi('Đang mượn', c.open, 'Cấp trong hôm nay, chưa trả', c.open ? 'amber' : 'green')}
        ${kpi('Quá hạn trả', c.late, 'Mượn từ hôm trước, chưa trả', c.late ? 'red' : 'green')}
        ${kpi('Trả về có lỗi hôm nay', c.bad, def.key === 'PDA' ? 'Hư / rơi vỡ / mất…' : 'Bẩn / rách / mất…', c.bad ? 'red' : 'green')}
        ${last}
      </div>
      <div class="card mt">
        <div class="card-h"><div><h3>Đang được mượn${k ? ' · ' + esc(k) : ''}</h3><div class="sub" style="margin-top:3px">Quá hạn đứng đầu · bấm “Trả” khi nhận lại</div></div>
          <div class="right"><button class="btn primary need-edit" id="loanOut">${def.outBtn}</button></div></div>
        ${open.length ? `<ul class="list">${open.map(x => {
          const dup = def.key === 'PDA' && dupes[x.dev ? 'r' + x.dev.r : x.item] > 1;
          return `<li class="${x.late ? 'is-late' : ''}">
            <div class="grow"><div class="t">${esc(x.label || '(chưa ghi)')}${x.sub ? ` · <span class="muted">${esc(x.sub)}</span>` : ''}${dup ? ' <span class="chip red">Đang mượn trùng</span>' : ''}</div>
              <div class="s">👤 ${esc(x.who || '—')}${x.msnv ? ' (' + esc(x.msnv) + ')' : ''} · ${esc(x.kho)} · ${esc(x.ca)} · ${x.d ? dmy(isoOf(x.d)) : ''}${x.dept ? ' · ' + esc(x.dept) : ''}${x.condOut && x.condOut !== 'Bình thường' ? ' · khi cấp: ' + esc(x.condOut) : ''}</div></div>
            <span class="chip ${x.late ? 'red' : 'amber'}">${x.late ? `Quá hạn ${x.lateDays} ngày` : 'Đang mượn'}</span>
            <button class="btn sm need-edit" data-ret="${x.r}">↩ Trả</button></li>`;
        }).join('')}</ul>` : '<div class="empty">Không có lượt nào đang được mượn. 👍</div>'}
      </div>`;
    view.prepend(wrap);
    bindGo(wrap);
    $('#loanOut').onclick = () => loanOut(def);
    $$('[data-ret]', wrap).forEach(b => b.onclick = () => loanReturn(def, +b.dataset.ret));
  }

  function loanOut(def) {
    const k = state.kho === 'ALL' ? '' : state.kho;
    const pre = { [LC.date]: isoOf(new Date()), [LC.ca]: nowCa(), [LC.condOut]: 'Bình thường' };
    if (k) pre[LC.kho] = k;
    openRowDrawer(def.sheet, null, pre);
  }

  function loanReturn(def, r) {
    const x = loanList(def).find(l => l.r === r); if (!x) return;
    const conds = (dvFor(def.sheet, 'J', 5, 5) || ['Bình thường']).map(String);
    const dev = def.key === 'PDA' ? x.dev : null;
    const m = modal(`<h3>↩ Nhận lại ${esc(x.label)}</h3>
      <p class="muted" style="margin:0">${x.sub ? esc(x.sub) + ' · ' : ''}${esc(x.who)}${x.msnv ? ' (' + esc(x.msnv) + ')' : ''} · cấp ${x.d ? dmy(isoOf(x.d)) : ''} ${esc(x.ca)}${x.condOut ? ' · khi cấp: ' + esc(x.condOut) : ''}</p>
      <div class="field"><label for="rtC">Tình trạng khi trả</label><select class="select" id="rtC">${conds.map(o => `<option>${esc(o)}</option>`).join('')}</select></div>
      <div class="field"><label for="rtN">Ghi chú</label><input class="input" id="rtN" placeholder="Mô tả lỗi / hư hỏng (nếu có)"></div>
      ${dev ? `<label class="chk" id="rtDevBox" hidden><input type="checkbox" id="rtDev" checked> Cập nhật máy ${esc(dev.code || dev.imei)} ở Thống kê PDA thành <b>MỚI HƯ</b> (ngày ghi nhận lỗi = hôm nay)</label>` : ''}
      <div class="row"><button class="btn" id="rtCancel" type="button">Hủy</button><button class="btn primary" id="rtOk" type="button">✓ Xác nhận đã nhận lại</button></div>`);
    const syncBox = () => { if (m.$('#rtDevBox')) m.$('#rtDevBox').hidden = m.$('#rtC').value === 'Bình thường'; };
    m.$('#rtC').onchange = syncBox; syncBox();
    m.$('#rtCancel').onclick = m.close;
    m.$('#rtOk').onclick = () => {
      const cond = m.$('#rtC').value, note = m.$('#rtN').value.trim();
      const changes = [{ row: r, col: LC.condIn, value: cond }];
      if (note) changes.push({ row: r, col: LC.note, value: x.note ? x.note + ' · ' + note : note });
      enqueue('update', { sheet: def.sheet, changes });
      if (dev && cond !== 'Bình thường' && m.$('#rtDev') && m.$('#rtDev').checked) {
        const dr = dev.r, desc = plain(val(PDA_DEV, dr, 6)), today = isoOf(new Date());
        enqueue('update', { sheet: PDA_DEV, changes: [{ row: dr, col: 5, value: 'MỚI HƯ' }, { row: dr, col: 7, value: today }, { row: dr, col: 8, value: today },
          { row: dr, col: 6, value: (desc ? desc + ' · ' : '') + `${dmy(today)}: ${cond}${note ? ' – ' + note : ''} (trả bởi ${x.who})` }] });
      }
      toast(`Đã nhận lại ${x.label}${cond !== 'Bình thường' ? ' – ' + cond : ''}`, cond !== 'Bình thường' ? 'warn' : '');
      m.close(); route(true);
    };
  }

  function loanAlerts(view, k) {
    Object.values(LOANS).forEach(def => {
      if (!sh(def.sheet)) return;
      const c = loanCounts(def, k); if (!c.late) return;
      const wrap = document.createElement('div');
      const go = k ? `kho:|${k}|#/sheet/${def.sheet}` : `#/sheet/${def.sheet}`;
      wrap.innerHTML = `<div class="task-alert red" data-go="${esc(go)}" role="link" tabindex="0">${icon(def.icon)}<span>${esc(def.alert)}${k ? ' · ' + esc(k) : ''}: <b>${c.late}</b> lượt mượn từ hôm trước chưa trả</span><span class="go">Xem →</span></div>`;
      view.prepend(wrap); bindGo(wrap);
    });
  }

  /* ------------------------------------------------------------------ DANH SÁCH NHÂN VIÊN (tab DS_NHAN_VIEN)
   * A Họ tên · B MSNV · C Bộ phận · D Kho · E SĐT · F Trạng thái · G Ngày thêm · H Ghi chú
   * Ban đầu trống: người mới tự được lưu ở lần cấp PDA đầu tiên, các lần sau gõ MSNV / tên là chọn được. */
  const STAFF = 'DS_NHAN_VIEN';
  const NV = { name: 1, msnv: 2, dept: 3, kho: 4, phone: 5, st: 6, added: 7, note: 8 };
  const NV_HEAD = ['Họ tên', 'MSNV', 'Bộ phận', 'Kho', 'SĐT', 'Trạng thái', 'Ngày thêm', 'Ghi chú'];
  function staffList() {
    const s = sh(STAFF); if (!s) return [];
    const out = [];
    for (let r = 5; r <= s.v.length; r++) {
      const g = c => plain(val(STAFF, r, c)).trim();
      const name = g(NV.name), msnv = g(NV.msnv); if (!name && !msnv) continue;
      out.push({ r, name, msnv, dept: g(NV.dept), kho: g(NV.kho), phone: g(NV.phone), st: g(NV.st) || 'Đang làm',
        added: toDate(val(STAFF, r, NV.added), true), note: g(NV.note), src: 'staff' });
    }
    return out;
  }
  /** Danh bạ để chọn người nhận: Danh sách nhân viên + người đã có trong dữ liệu cũ (cấp phát, nón áo…) */
  function peopleList() {
    const L = staffList(), seen = new Set(L.map(x => x.msnv.toUpperCase()).filter(Boolean));
    const lastDept = {};
    loanList(LOANS.PDA).forEach(x => { if (x.msnv && x.dept) lastDept[x.msnv.toUpperCase()] = x.dept; });
    const dir = peopleDir();
    Object.keys(dir.byMsnv).forEach(m => { if (!seen.has(m)) { seen.add(m); L.push({ r: 0, name: dir.byMsnv[m], msnv: m, dept: lastDept[m] || '', kho: '', phone: '', st: 'Đang làm', src: 'old' }); } });
    return L;
  }
  function staffFind(q, list) {
    const s = String(q || '').trim(); if (!s) return null;
    const up = s.toUpperCase(), low = s.toLowerCase(), L = list || peopleList();
    return L.find(x => x.msnv && x.msnv.toUpperCase() === up) || L.find(x => x.name && x.name.toLowerCase() === low) || null;
  }
  /** Gợi ý khi gõ: giá trị = MSNV, nhãn = họ tên · bộ phận (gõ tên hay MSNV đều lọc được) */
  function staffDatalist(list) {
    let d = document.getElementById('dl-STAFF'); if (!d) { d = document.createElement('datalist'); d.id = 'dl-STAFF'; document.body.appendChild(d); }
    d.innerHTML = list.filter(x => x.msnv && x.st !== 'Nghỉ việc').map(x => `<option value="${esc(x.msnv)}">${esc(x.name)}${x.dept ? ' · ' + esc(x.dept) : ''}</option>`).join('');
  }
  const staffDepts = list => {
    const base = (dvFor(STAFF, 'C', 5, 5) || dvFor(LOANS.PDA.sheet, 'H', 5, 5) || BO_PHAN).map(String);
    (list || []).forEach(x => { if (x.dept && !base.includes(x.dept)) base.push(x.dept); });
    return base;
  };
  /** Nhóm bộ phận để thống kê tần suất: Sort / In-out / Khác */
  const deptGroup = d => /sort/i.test(d || '') ? 'Sort' : /in\s*[-\/]?\s*out/i.test(d || '') ? 'In/out' : d ? 'Khác' : 'Chưa ghi bộ phận';
  const DEPT_GROUPS = ['Sort', 'In/out', 'Khác', 'Chưa ghi bộ phận'];
  const GROUP_COLOR = { 'Sort': '#14a394', 'In/out': '#3b82f6', 'Khác': '#f59e0b', 'Chưa ghi bộ phận': '#94a3b8' };
  function staffAppend(p) {
    enqueue('append', { sheet: STAFF, dataStart: 5, lastCol: NV_HEAD.length, values: { [NV.name]: p.name, [NV.msnv]: p.msnv, [NV.dept]: p.dept || '', [NV.kho]: p.kho || '',
      [NV.phone]: p.phone || '', [NV.st]: 'Đang làm', [NV.added]: isoOf(new Date()), [NV.note]: p.note || '' } });
  }

  function renderStaff(view, name) {
    const sc = schemaOf(name), vs = viewState(name), s = sh(name);
    setCrumb(sc.title, 'Danh mục');
    vs.dg = vs.dg || ''; vs.st = vs.st || 'Đang làm';
    const k = state.kho === 'ALL' ? null : state.kho;
    const all = staffList().filter(x => !k || !x.kho || x.kho === k);
    const loans = loanList(LOANS.PDA), t0 = today0(), from30 = new Date(t0); from30.setDate(from30.getDate() - 29);
    const holding = {}, freq = {};
    loans.forEach(x => {
      const m = x.msnv.toUpperCase(); if (!m) return;
      if (x.open) (holding[m] = holding[m] || []).push(x.dev ? (x.dev.code || x.dev.imei) : x.item);
      if (x.d && x.d >= from30) freq[m] = (freq[m] || 0) + 1;
    });
    const dupes = {}; all.forEach(x => { const m = x.msnv.toUpperCase(); if (m) dupes[m] = (dupes[m] || 0) + 1; });
    const active = all.filter(x => x.st !== 'Nghỉ việc');
    const cnt = g => active.filter(x => deptGroup(x.dept) === g).length;
    view.innerHTML = `
      <div class="kpis">
        ${kpi('Nhân viên đang làm', active.length, k ? khoInfo(k).name : 'Toàn cụm', 'blue')}
        ${kpi('Bộ phận Sort', cnt('Sort'), 'Sort ca 01, ca 02…', '')}
        ${kpi('Bộ phận In/out', cnt('In/out'), 'Inout ca 01, ca 02…', '')}
        ${kpi('Đang giữ PDA', active.filter(x => holding[x.msnv.toUpperCase()]).length, 'Chưa trả máy', 'amber')}
        ${kpi('Thiếu bộ phận / MSNV', all.filter(x => !x.dept || !x.msnv).length, 'Cần bổ sung để thống kê', all.some(x => !x.dept || !x.msnv) ? 'red' : 'green')}
      </div>
      <div class="card mt">
        <div class="card-h"><div><h3>Danh sách nhân viên${k ? ' · ' + esc(k) : ''}</h3>
          <div class="sub" style="margin-top:3px">Ban đầu để trống cũng được: khi cấp PDA cho người mới, web tự lưu họ tên – MSNV – bộ phận vào đây; các lần sau chỉ cần gõ MSNV hoặc tên để chọn.${s && s.local ? ' <b class="warn-text">Tab chưa có trên Google Sheet – chạy setupV7 trong Apps Script.</b>' : ''}</div></div>
          <div class="right"><button class="btn primary need-edit" id="nvAdd">＋ Thêm nhân viên</button><button class="btn need-edit" id="nvBulk">⧉ Thêm nhiều (dán từ Excel)</button><button class="btn" id="nvRaw" title="Bảng gốc trên Google Sheet">⚙ Bảng gốc</button><button class="btn" id="nvCsv">⭳ Xuất Excel</button></div></div>
        <div class="toolbar">
          <div class="tabs">${[['', 'Tất cả'], ...DEPT_GROUPS.slice(0, 3).map(g => [g, g])].map(t => `<button class="tab ${vs.dg === t[0] ? 'active' : ''}" data-dg="${esc(t[0])}">${esc(t[1])} <span class="tcount">${t[0] ? cnt(t[0]) : active.length}</span></button>`).join('')}</div>
          <div class="right"><select class="select" id="nvSt">${[['Đang làm', 'Đang làm'], ['Nghỉ việc', 'Đã nghỉ việc'], ['', 'Tất cả trạng thái']].map(o => `<option value="${o[0]}" ${vs.st === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
        </div>
        <div class="toolbar"><div class="search" style="flex:1"><input class="input" id="nvq" placeholder="Tìm họ tên, MSNV, bộ phận, SĐT…" value="${esc(vs.q || '')}"></div></div>
        <div id="nvBody"></div>
      </div>`;
    const draw = () => {
      const q = (vs.q || '').trim().toLowerCase();
      const list = all.filter(x => (!vs.dg || deptGroup(x.dept) === vs.dg) && (!vs.st || x.st === vs.st)
        && (!q || `${x.name} ${x.msnv} ${x.dept} ${x.phone}`.toLowerCase().includes(q)))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      $('#nvBody').innerHTML = list.length ? `<div class="tbl-wrap"><table class="tbl staff"><thead><tr><th>Họ tên</th><th class="code">MSNV</th><th>Bộ phận</th><th>Kho</th><th>SĐT</th><th>Đang giữ PDA</th><th class="num" title="Số lượt lấy PDA trong 30 ngày qua">Lượt PDA 30 ngày</th><th></th></tr></thead><tbody>
        ${list.map(x => { const m = x.msnv.toUpperCase(), h = holding[m] || [];
          return `<tr class="${x.st === 'Nghỉ việc' ? 'is-off' : ''}"><td><b>${esc(x.name || '(chưa có tên)')}</b>${x.st === 'Nghỉ việc' ? ' <span class="chip">Nghỉ việc</span>' : ''}</td>
          <td class="code">${x.msnv ? esc(x.msnv) : '<span class="warn-text">chưa có MSNV</span>'}${dupes[m] > 1 ? ' <span class="chip red">Trùng MSNV</span>' : ''}</td>
          <td>${x.dept ? `<span class="chip dg" style="--dg:${GROUP_COLOR[deptGroup(x.dept)]}">${esc(x.dept)}</span>` : '<span class="warn-text">chưa có bộ phận</span>'}</td>
          <td>${esc(x.kho)}</td><td>${x.phone ? `<a href="tel:${esc(x.phone)}">${esc(x.phone)}</a>` : '<span class="muted">—</span>'}</td>
          <td>${h.length ? h.map(c => `<span class="chip amber">${esc(c)}</span>`).join(' ') : '<span class="muted">chưa giữ gì</span>'}</td>
          <td class="num">${freq[m] || '<span class="muted">0</span>'}</td>
          <td class="rowact"><button class="btn sm need-edit" data-nv="${x.r}" title="Sửa thông tin">✎ Sửa</button></td></tr>`; }).join('')}
        </tbody></table></div>` : `<div class="empty">${all.length ? 'Không có nhân viên phù hợp.' : 'Chưa có nhân viên nào. Danh sách sẽ tự đầy dần khi cấp PDA (người mới được lưu ở lần đầu), hoặc bấm “⧉ Thêm nhiều” để dán danh sách từ Excel.'}</div>`;
      $$('[data-nv]', view).forEach(b => b.onclick = () => openRowDrawer(name, +b.dataset.nv));
    };
    draw();
    $$('[data-dg]', view).forEach(b => b.onclick = () => { vs.dg = b.dataset.dg; renderStaff(view, name); });
    $('#nvSt').onchange = e => { vs.st = e.target.value; draw(); };
    $('#nvq').addEventListener('input', debounce(e => { vs.q = e.target.value; draw(); }, 200));
    $('#nvRaw').onclick = () => { vs.raw = true; route(true); };
    $('#nvAdd').onclick = () => openRowDrawer(name, null, { [NV.st]: 'Đang làm', [NV.added]: isoOf(new Date()), ...(k ? { [NV.kho]: k } : {}) });
    $('#nvBulk').onclick = () => openStaffBulk();
    $('#nvCsv').onclick = () => {
      const q = v => `"${String(v).replace(/"/g, '""')}"`;
      const lines = [NV_HEAD.map(q).join(',')].concat(all.map(x => [x.name, x.msnv, x.dept, x.kho, x.phone, x.st, x.added ? dmy(isoOf(x.added)) : '', x.note].map(q).join(',')));
      download(`DS_NHAN_VIEN${k ? '_' + k : ''}_${isoOf(new Date())}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    };
  }

  /** Dán danh sách từ Excel: mỗi dòng 1 người – Họ tên | MSNV | Bộ phận | SĐT (cột cách nhau bằng Tab) */
  function openStaffBulk() {
    const k = state.kho === 'ALL' ? 'HCM20' : state.kho, exist = staffList(), depts = staffDepts(exist);
    const m = modal(`<h3>⧉ Thêm nhiều nhân viên một lượt</h3>
      <p class="muted" style="margin:0">Copy từ Excel 4 cột theo thứ tự <b>Họ tên · MSNV · Bộ phận · SĐT</b> (SĐT có thể bỏ trống) rồi dán vào ô dưới – mỗi dòng 1 người.</p>
      <div class="field"><label for="sbK">Kho</label><select class="select" id="sbK">${KHO_CODES.map(c => `<option ${c === k ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label for="sbT">Danh sách</label><textarea class="input" id="sbT" rows="7" placeholder="Nguyễn Văn A&#9;3180001&#9;Sort ca 01&#9;0901234567&#10;Trần Thị B&#9;3180002&#9;Inout ca 02"></textarea></div>
      <p class="muted" style="margin:0;font-size:12px">Bộ phận nên khớp danh sách: ${depts.map(esc).join(', ')} – để thống kê tần suất lấy PDA của Sort / In-out.</p>
      <div id="sbPrev" class="sb-prev"></div>
      <div class="row"><button class="btn" id="sbCancel" type="button">Hủy</button><button class="btn primary" id="sbOk" type="button" disabled>Thêm 0 nhân viên</button></div>`, 'wide');
    const have = new Set(exist.map(x => x.msnv.toUpperCase()).filter(Boolean));
    let rows = [];
    const parse = () => {
      const seen = new Set();
      rows = m.$('#sbT').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
        const p = (l.includes('\t') ? l.split('\t') : l.split(/\s*[;,|]\s*/)).map(x => x.trim());
        const r = { name: p[0] || '', msnv: (p[1] || '').replace(/\s+/g, ''), dept: p[2] || '', phone: p[3] || '' };
        const u = r.msnv.toUpperCase();
        r.err = !r.name ? 'Thiếu họ tên' : !r.msnv ? 'Thiếu MSNV' : have.has(u) ? 'Đã có trong danh sách' : seen.has(u) ? 'Trùng MSNV trong bảng dán' : '';
        r.warn = !r.err && r.dept && !depts.some(d => d.toLowerCase() === r.dept.toLowerCase()) ? 'Bộ phận mới' : '';
        seen.add(u); return r;
      });
      const ok = rows.filter(r => !r.err);
      m.$('#sbPrev').innerHTML = rows.length ? `<table class="tbl"><thead><tr><th>Họ tên</th><th>MSNV</th><th>Bộ phận</th><th>SĐT</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.msnv)}</td><td>${esc(r.dept)}</td><td>${esc(r.phone)}</td><td>${r.err ? `<span class="chip red">${esc(r.err)}</span>` : r.warn ? `<span class="chip amber">${esc(r.warn)}</span>` : '<span class="chip green">OK</span>'}</td></tr>`).join('')}</tbody></table>` : '';
      m.$('#sbOk').disabled = !ok.length; m.$('#sbOk').textContent = `Thêm ${ok.length} nhân viên`;
    };
    m.$('#sbT').addEventListener('input', debounce(parse, 150));
    m.$('#sbCancel').onclick = m.close;
    m.$('#sbOk').onclick = () => {
      const ok = rows.filter(r => !r.err), today = isoOf(new Date()), kho = m.$('#sbK').value;
      if (!ok.length) return;
      // Bộ phận gõ khác chữ hoa/thường → dùng đúng tên trong danh sách
      const canon = d => depts.find(x => x.toLowerCase() === d.toLowerCase()) || d;
      enqueue('appendMany', { sheet: STAFF, dataStart: 5, lastCol: NV_HEAD.length, rows: ok.map(r => ({ [NV.name]: r.name, [NV.msnv]: r.msnv, [NV.dept]: canon(r.dept), [NV.kho]: kho, [NV.phone]: r.phone, [NV.st]: 'Đang làm', [NV.added]: today })) });
      toast(`Đã thêm ${ok.length} nhân viên`);
      m.close(); route(true);
    };
  }

  /* ------------------------------------------------------------------ CẤP PHÁT PDA – DẠNG DANH SÁCH
   * Chỉ hiện máy TỐT ở Thống kê PDA (+ máy đang được mượn để nhận lại). Gõ MSNV / tên vào ô Người nhận → Enter = cấp.
   * Mỗi lượt cấp vẫn là 1 dòng CAP_PHAT_PDA → đó là LỊCH SỬ, dùng để thống kê tần suất theo bộ phận. */
  function periodRange(per) {
    const t = today0(), mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    switch (per) {
      case 'today': return [t, t, 'Hôm nay'];
      case 'week': return [mon, t, 'Tuần này'];
      case 'lastweek': return [add(mon, -7), add(mon, -1), 'Tuần trước'];
      case 'month': return [new Date(t.getFullYear(), t.getMonth(), 1), t, `Tháng ${t.getMonth() + 1}/${t.getFullYear()}`];
      case 'lastmonth': { const a = new Date(t.getFullYear(), t.getMonth() - 1, 1); return [a, new Date(t.getFullYear(), t.getMonth(), 0), `Tháng ${a.getMonth() + 1}/${a.getFullYear()}`]; }
      case '30': return [add(t, -29), t, '30 ngày qua'];
      default: return [null, null, 'Toàn bộ'];
    }
  }
  const PERIODS = [['today', 'Hôm nay'], ['week', 'Tuần này'], ['lastweek', 'Tuần trước'], ['month', 'Tháng này'], ['lastmonth', 'Tháng trước'], ['30', '30 ngày qua'], ['all', 'Toàn bộ']];
  const periodSelect = (id, cur, skip) => `<select class="select" id="${id}">${PERIODS.filter(p => !(skip || []).includes(p[0])).map(p => `<option value="${p[0]}" ${cur === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select>`;
  /** Lượt mượn kèm bộ phận (lấy theo dòng cấp phát, thiếu thì tra Danh sách nhân viên) */
  function loanHistory(k, per) {
    const [a, b] = periodRange(per), people = peopleList();
    return loanList(LOANS.PDA, k).filter(x => !a || (x.d && x.d >= a && x.d <= b)).map(x => {
      const p = !x.dept || !x.who ? staffFind(x.msnv, people) : null;
      const dept = x.dept || (p && p.dept) || '';
      return Object.assign(x, { dept, who: x.who || (p && p.name) || '', group: deptGroup(dept) });
    });
  }

  function renderPdaLoan(view, name) {
    const sc = schemaOf(name), vs = viewState(name), def = LOANS.PDA, s = sh(name);
    setCrumb(sc.title, 'Thiết bị');
    vs.tab = vs.tab || 'list';
    const k = state.kho === 'ALL' ? null : state.kho, c = loanCounts(def, k);
    view.innerHTML = `
      <div class="kpis">
        ${kpi('Máy sẵn sàng cấp', c.ready, c.devices ? `${c.good} máy TỐT / ${c.devices} máy khai báo` : 'Chưa khai báo máy ở Thống kê PDA', c.ready ? 'green' : 'red', '#/sheet/' + PDA_DEV)}
        ${kpi('Đang cấp phát', c.open + c.late, c.late ? `${c.late} lượt mượn từ hôm trước chưa trả` : 'Chưa trả máy', c.late ? 'red' : 'amber')}
        ${kpi('Lượt cấp hôm nay', c.today, `${c.returned} lượt đã trả`, 'blue')}
        ${kpi('Trả về có lỗi hôm nay', c.bad, 'Hư / rơi vỡ / mất…', c.bad ? 'red' : 'green')}
      </div>
      <div class="card mt">
        <div class="card-h"><div><h3>Cấp phát PDA hằng ngày${k ? ' · ' + esc(k) : ''}</h3>
          <div class="sub" style="margin-top:3px">Chỉ hiện máy tình trạng <b>TỐT</b>. Gõ <b>MSNV</b> (hoặc tên) vào ô “Người nhận” rồi Enter để cấp – người mới nhập 1 lần, lần sau chỉ cần chọn. Mỗi lượt cấp được lưu lại làm lịch sử.${s && s.local ? ' <b class="warn-text">Tab chưa có trên Google Sheet – chạy setupV7 trong Apps Script.</b>' : ''}</div></div>
          <div class="right"><button class="btn" id="plRaw" title="Bảng gốc trên Google Sheet">⚙ Bảng gốc</button></div></div>
        <div class="toolbar"><div class="tabs">${[['list', 'Cấp phát hôm nay'], ['hist', 'Lịch sử cấp PDA'], ['freq', 'Tần suất theo bộ phận']].map(t => `<button class="tab ${vs.tab === t[0] ? 'active' : ''}" data-pt="${t[0]}">${t[1]}</button>`).join('')}</div></div>
        <div id="plBody"></div>
      </div>`;
    bindGo(view);
    $$('[data-pt]', view).forEach(b => b.onclick = () => { vs.tab = b.dataset.pt; renderPdaLoan(view, name); });
    $('#plRaw').onclick = () => { vs.raw = true; route(true); };
    const body = $('#plBody');
    if (vs.tab === 'hist') pdaLoanHist(body, name, vs, k);
    else if (vs.tab === 'freq') pdaLoanFreq(body, name, vs, k);
    else pdaLoanList(body, name, vs, k);
  }

  function pdaLoanList(body, name, vs, k) {
    const def = LOANS.PDA, edit = canEdit(), people = peopleList(), depts = staffDepts(people);
    vs.ca = vs.ca || nowCa(); vs.pf = vs.pf || 'all';
    staffDatalist(people);
    const open = loanList(def, k).filter(x => x.open);
    const busy = new Map(open.filter(x => x.dev).map(x => [x.dev.r, x]));
    const devs = codes('PDA').filter(d => (!k || d.kho === k) && /^tốt$/i.test(d.st));
    const free = devs.filter(d => !busy.has(d.r));
    const holdBy = {}; open.forEach(x => { const m = x.msnv.toUpperCase(); if (m) (holdBy[m] = holdBy[m] || []).push(x.label); });
    body.innerHTML = `
      <div class="toolbar">
        <div class="tabs">${[['all', 'Tất cả', open.length + free.length], ['out', 'Đã cấp phát', open.length], ['free', 'Trong kho', free.length]].map(t => `<button class="tab ${vs.pf === t[0] ? 'active' : ''}" data-pf="${t[0]}">${t[1]} <span class="tcount">${t[2]}</span></button>`).join('')}</div>
        <div class="right"><label class="muted" for="plCa" style="font-size:13px">Ca cấp</label><select class="select" id="plCa">${(dvFor(name, 'B', 5, 5) || ['Ca 1', 'Ca 2', 'Ca 3', 'Hành chính']).map(o => `<option ${o === vs.ca ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
          <button class="btn need-edit" id="plRetSel" disabled>↩ Nhận lại máy đã chọn</button></div>
      </div>
      <div class="toolbar"><div class="search" style="flex:1"><input class="input" id="plq" placeholder="Tìm số máy, IMEI, model, người nhận, MSNV…" value="${esc(vs.pq || '')}"></div></div>
      <div id="plTbl"></div>`;
    const draw = () => {
      const q = (vs.pq || '').trim().toLowerCase();
      const hit = s2 => !q || s2.toLowerCase().includes(q);
      const outRows = vs.pf === 'free' ? [] : open.filter(x => hit(`${x.label} ${x.sub} ${x.who} ${x.msnv} ${x.dev ? x.dev.imei : ''}`))
        .sort((a, b) => (b.late - a.late) || a.label.localeCompare(b.label, 'vi', { numeric: true }));
      const freeRows = vs.pf === 'out' ? [] : free.filter(d => hit(`${d.code} ${d.imei} ${d.name}`)).sort((a, b) => (a.code || a.imei).localeCompare(b.code || b.imei, 'vi', { numeric: true }));
      const devCell = (code, imei, model) => `<td class="pl-dev"><b>${esc(code || '—')}</b>${imei ? `<div class="s">${esc(imeiKey(imei) || imei)}</div>` : ''}</td><td>${esc(model || '')}</td>`;
      $('#plTbl').innerHTML = (outRows.length || freeRows.length) ? `<div class="tbl-wrap"><table class="tbl pl"><thead><tr><th class="ck">${outRows.length && edit ? '<input type="checkbox" id="plAll" title="Chọn tất cả máy đang cấp">' : ''}</th><th>Số máy</th><th>Model</th><th>Kho</th><th class="pl-who-h">Người nhận</th><th>Trạng thái</th><th></th></tr></thead><tbody>
        ${outRows.length ? `<tr class="grp"><td colspan="7">▾ Đã cấp phát (${outRows.length})</td></tr>` : ''}
        ${outRows.map(x => `<tr class="is-out ${x.late ? 'is-late' : ''}" data-lr="${x.r}">
          <td class="ck">${edit ? `<input type="checkbox" class="pl-ck" value="${x.r}">` : ''}</td>${devCell(x.dev ? x.dev.code : x.item, x.dev ? x.dev.imei : '', x.sub)}<td>${esc(x.kho)}</td>
          <td><div class="t"><b>${esc(x.who || '—')}</b></div><div class="s">${esc(x.msnv)}${x.dept ? ' · ' + esc(x.dept) : ''} · ${esc(x.ca)} ${x.d ? ddmm(x.d) : ''}</div></td>
          <td><span class="chip ${x.late ? 'red' : 'amber'}">${x.late ? `Quá hạn ${x.lateDays} ngày` : 'Đang mượn'}</span></td>
          <td class="rowact nowrap">${edit ? `<button class="btn sm" data-qret="${x.r}" title="Nhận lại – máy bình thường">✓ Trả</button><button class="btn sm" data-ret="${x.r}" title="Nhận lại – có lỗi / hư hỏng">⚠ Trả có lỗi</button>` : ''}</td></tr>`).join('')}
        ${freeRows.length ? `<tr class="grp"><td colspan="7">▾ Trong kho – sẵn sàng cấp (${freeRows.length})</td></tr>` : ''}
        ${freeRows.map(d => `<tr data-dr="${d.r}">
          <td class="ck"></td>${devCell(d.code, d.imei, d.name)}<td>${esc(d.kho)}</td>
          <td class="pl-who">${edit ? `<input class="input pl-in" list="dl-STAFF" placeholder="Gõ MSNV hoặc tên…" autocomplete="off">
            <div class="pl-hint"></div>
            <div class="pl-new" hidden><input class="input pl-nm" placeholder="Họ tên nhân viên mới"><input class="input pl-ms" placeholder="MSNV"><select class="select pl-dp"><option value="">— Bộ phận —</option>${depts.map(o => `<option>${esc(o)}</option>`).join('')}</select></div>` : '<span class="muted">—</span>'}</td>
          <td><span class="chip green">Tốt</span></td>
          <td class="rowact">${edit ? '<button class="btn sm primary pl-go" disabled>Cấp</button>' : ''}</td></tr>`).join('')}
        </tbody></table></div>`
        : `<div class="empty">${devs.length || open.length ? 'Không có máy phù hợp.' : 'Chưa có máy PDA tình trạng TỐT' + (k ? ' ở kho ' + esc(k) : '') + '. Khai báo / cập nhật tình trạng ở Thống kê PDA.'}</div>`;
      bindRows();
    };
    const lend = (d, p, tr) => {
      const today = isoOf(new Date()), kho = d.kho || k || '';
      const held = holdBy[p.msnv.toUpperCase()];
      if (held && !confirm(`${p.name} đang giữ ${held.join(', ')} chưa trả. Vẫn cấp thêm ${d.code || d.imei}?`)) return;
      if (p.isNew || p.src === 'old') staffAppend({ name: p.name, msnv: p.msnv, dept: p.dept, kho, note: 'Tự thêm khi cấp PDA' });
      else if (!p.dept0 && p.dept && p.r) enqueue('update', { sheet: STAFF, changes: [{ row: p.r, col: NV.dept, value: p.dept }] });
      enqueue('append', { sheet: name, dataStart: 5, lastCol: 12, values: { [LC.date]: today, [LC.ca]: vs.ca, [LC.kho]: kho, [LC.item]: d.code || d.imei,
        [LC.msnv]: p.msnv, [LC.who]: p.name, [LC.dept]: p.dept || '', [LC.condOut]: 'Bình thường' } });
      toast(`${d.code || d.imei} → ${p.name} (${p.msnv})${p.isNew ? ' · đã lưu vào Danh sách nhân viên' : ''}`);
      route(true);
    };
    const quickReturn = rs => {
      if (!rs.length) return;
      enqueue('update', { sheet: name, changes: rs.map(r => ({ row: r, col: LC.condIn, value: 'Bình thường' })) });
      toast(rs.length > 1 ? `Đã nhận lại ${rs.length} máy` : `Đã nhận lại ${open.find(x => x.r === rs[0]).label}`);
      route(true);
    };
    const bindRows = () => {
      $$('[data-qret]', body).forEach(b => b.onclick = () => quickReturn([+b.dataset.qret]));
      $$('[data-ret]', body).forEach(b => b.onclick = () => loanReturn(def, +b.dataset.ret));
      const selBtn = $('#plRetSel'), cks = $$('.pl-ck', body);
      const syncSel = () => { const n = cks.filter(c2 => c2.checked).length; selBtn.disabled = !n; selBtn.textContent = n ? `↩ Nhận lại ${n} máy đã chọn` : '↩ Nhận lại máy đã chọn'; };
      cks.forEach(c2 => c2.onchange = syncSel);
      if ($('#plAll')) $('#plAll').onchange = e => { cks.forEach(c2 => { c2.checked = e.target.checked; }); syncSel(); };
      selBtn.onclick = () => { const rs = cks.filter(c2 => c2.checked).map(c2 => +c2.value); if (rs.length && confirm(`Nhận lại ${rs.length} máy (tình trạng bình thường)?`)) quickReturn(rs); };
      syncSel();
      $$('tr[data-dr]', body).forEach(tr => {
        const d = free.find(x => x.r === +tr.dataset.dr), inp = $('.pl-in', tr); if (!inp) return;
        const hint = $('.pl-hint', tr), box = $('.pl-new', tr), go = $('.pl-go', tr);
        const nm = $('.pl-nm', tr), ms = $('.pl-ms', tr), dp = $('.pl-dp', tr);
        let cur = null;
        const check = () => {
          const v = inp.value.trim(), p = staffFind(v, people);
          tr.classList.toggle('editing', !!v);
          if (!v) { cur = null; hint.innerHTML = ''; box.hidden = true; go.disabled = true; return; }
          if (p) {
            box.hidden = !!p.dept; if (!p.dept) { nm.hidden = true; ms.hidden = true; }
            cur = { name: p.name, msnv: p.msnv, dept: p.dept || dp.value, dept0: p.dept, r: p.r, src: p.src };
            const held = holdBy[p.msnv.toUpperCase()];
            hint.className = 'pl-hint ok';
            hint.innerHTML = `✓ <b>${esc(p.name)}</b> · ${esc(p.msnv)}${p.dept ? ' · ' + esc(p.dept) : ' · <span class="warn-text">chọn bộ phận để lưu lại</span>'}${held ? ` <span class="chip red">đang giữ ${esc(held.join(', '))}</span>` : ''}`;
            go.disabled = !cur.dept;
          } else {
            box.hidden = false; nm.hidden = false; ms.hidden = false;
            const isCode = /\d/.test(v);
            if (isCode && !ms.dataset.touched) ms.value = v.replace(/\s+/g, '');
            if (!isCode && !nm.dataset.touched) nm.value = v;
            hint.className = 'pl-hint new';
            hint.textContent = 'Nhân viên mới – điền đủ họ tên, MSNV, bộ phận. Web lưu vào Danh sách nhân viên, lần sau chỉ cần chọn.';
            const dup = staffFind(ms.value, people);
            cur = { name: nm.value.trim(), msnv: ms.value.trim(), dept: dp.value, isNew: true };
            if (dup) { hint.className = 'pl-hint bad'; hint.textContent = `MSNV ${dup.msnv} đã có: ${dup.name}`; cur = null; }
            go.disabled = !cur || !cur.name || !cur.msnv || !cur.dept;
          }
        };
        inp.addEventListener('input', check);
        [nm, ms].forEach(el => el.addEventListener('input', () => { el.dataset.touched = '1'; check(); }));
        dp.addEventListener('change', check);
        [inp, nm, ms].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!go.disabled) go.click(); else if (!box.hidden) (nm.hidden ? dp : (!nm.value.trim() ? nm : !ms.value.trim() ? ms : dp)).focus(); } }));
        go.onclick = () => { check(); if (cur && !go.disabled) lend(d, cur, tr); };
      });
    };
    draw();
    $$('[data-pf]', body).forEach(b => b.onclick = () => { vs.pf = b.dataset.pf; pdaLoanList(body, name, vs, k); });
    $('#plCa').onchange = e => { vs.ca = e.target.value; };
    $('#plq').addEventListener('input', debounce(e => { vs.pq = e.target.value; draw(); }, 200));
  }

  function pdaLoanHist(body, name, vs, k) {
    vs.hp = vs.hp || 'week'; vs.hg = vs.hg || '';
    const list = loanHistory(k, vs.hp);
    body.innerHTML = `
      <div class="toolbar">
        <div class="tabs">${[['', 'Tất cả'], ['Sort', 'Sort'], ['In/out', 'In/out'], ['Khác', 'Khác']].map(t => `<button class="tab ${vs.hg === t[0] ? 'active' : ''}" data-hg="${esc(t[0])}">${t[1]} <span class="tcount">${t[0] ? list.filter(x => x.group === t[0]).length : list.length}</span></button>`).join('')}</div>
        <div class="right">${periodSelect('hPer', vs.hp)}<button class="btn" id="hCsv">⭳ Xuất Excel</button></div>
      </div>
      <div class="toolbar"><div class="search" style="flex:1"><input class="input" id="hq" placeholder="Tìm số máy, người nhận, MSNV, bộ phận…" value="${esc(vs.hq || '')}"></div></div>
      <div id="hTbl"></div>`;
    const rows = () => {
      const q = (vs.hq || '').trim().toLowerCase();
      return list.filter(x => (!vs.hg || x.group === vs.hg) && (!q || `${x.label} ${x.sub} ${x.who} ${x.msnv} ${x.dept}`.toLowerCase().includes(q)))
        .sort((a, b) => ((b.d || 0) - (a.d || 0)) || (b.r - a.r));
    };
    const draw = () => {
      const L = rows(), shown = L.slice(0, 500);
      $('#hTbl').innerHTML = L.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="date">Ngày</th><th>Ca</th><th>Số máy</th><th>Model</th><th>Người nhận</th><th class="code">MSNV</th><th>Bộ phận</th><th>Khi trả</th><th>Trạng thái</th></tr></thead><tbody>
        ${shown.map(x => `<tr><td class="date">${x.d ? dmy(isoOf(x.d)) : ''}</td><td class="nowrap">${esc(x.ca)}</td><td><b>${esc(x.label)}</b></td><td>${esc(x.sub)}</td><td>${esc(x.who)}</td><td class="code">${esc(x.msnv)}</td>
          <td>${x.dept ? `<span class="chip dg" style="--dg:${GROUP_COLOR[x.group]}">${esc(x.dept)}</span>` : '<span class="muted">—</span>'}</td><td>${esc(x.condIn)}</td>
          <td><span class="chip ${x.open ? (x.late ? 'red' : 'amber') : x.bad ? 'red' : 'green'}">${x.open ? (x.late ? 'Quá hạn trả' : 'Đang mượn') : x.bad ? 'Trả – có lỗi' : 'Đã trả'}</span></td></tr>`).join('')}
        </tbody></table></div>${L.length > shown.length ? `<p class="muted" style="margin:8px 12px">Đang hiện 500 / ${L.length} lượt mới nhất – xuất Excel để xem đủ.</p>` : ''}`
        : `<div class="empty">Không có lượt cấp PDA nào trong ${esc(periodRange(vs.hp)[2].toLowerCase())}.</div>`;
    };
    draw();
    $$('[data-hg]', body).forEach(b => b.onclick = () => { vs.hg = b.dataset.hg; pdaLoanHist(body, name, vs, k); });
    $('#hPer').onchange = e => { vs.hp = e.target.value; pdaLoanHist(body, name, vs, k); };
    $('#hq').addEventListener('input', debounce(e => { vs.hq = e.target.value; draw(); }, 200));
    $('#hCsv').onclick = () => {
      const q = v => `"${String(v).replace(/"/g, '""')}"`;
      const lines = [['Ngày', 'Ca', 'Kho', 'Số máy', 'Model', 'Người nhận', 'MSNV', 'Bộ phận', 'Nhóm', 'Tình trạng khi cấp', 'Tình trạng khi trả', 'Ghi chú'].map(q).join(',')]
        .concat(rows().map(x => [x.d ? dmy(isoOf(x.d)) : '', x.ca, x.kho, x.label, x.sub, x.who, x.msnv, x.dept, x.group, x.condOut, x.condIn, x.note].map(q).join(',')));
      download(`LichSu_CapPDA_${vs.hp}${k ? '_' + k : ''}_${isoOf(new Date())}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    };
  }

  function pdaLoanFreq(body, name, vs, k) {
    vs.fp = vs.fp || 'week';
    const [a0, b0, label] = periodRange(vs.fp), list = loanHistory(k, vs.fp);
    // Các ngày trong kỳ (tới hôm nay) – kỳ "Toàn bộ" lấy từ lượt đầu tiên
    const first = a0 || list.reduce((m, x) => (x.d && (!m || x.d < m) ? x.d : m), null) || today0();
    const last = b0 || today0(), days = [];
    for (let d = new Date(first); d <= last && days.length < 400; d.setDate(d.getDate() + 1)) days.push(new Date(d));
    const nDays = Math.max(1, days.filter(d => d <= today0()).length);
    const byGroup = {}, byDept = {}, byPerson = {}, byDay = {};
    list.forEach(x => {
      const g = byGroup[x.group] = byGroup[x.group] || { n: 0, people: new Set(), bad: 0 };
      g.n++; if (x.msnv) g.people.add(x.msnv.toUpperCase()); if (x.bad) g.bad++;
      const dk = x.dept || 'Chưa ghi bộ phận', dd = byDept[dk] = byDept[dk] || { n: 0, people: new Set(), bad: 0, group: x.group };
      dd.n++; if (x.msnv) dd.people.add(x.msnv.toUpperCase()); if (x.bad) dd.bad++;
      const pk = (x.msnv || x.who).toUpperCase();
      if (pk) { const p = byPerson[pk] = byPerson[pk] || { who: x.who, msnv: x.msnv, dept: x.dept, n: 0, days: new Set(), bad: 0, late: 0 }; p.n++; if (x.d) p.days.add(+x.d); if (x.bad) p.bad++; if (x.late) p.late++; }
      if (x.d) { const key = isoOf(x.d); byDay[key] = byDay[key] || {}; byDay[key][x.group] = (byDay[key][x.group] || 0) + 1; }
    });
    const tot = list.length, G = g => byGroup[g] || { n: 0, people: new Set(), bad: 0 };
    const avg = n => (n / nDays).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
    const pct = n => tot ? Math.round(n * 100 / tot) + '%' : '0%';
    const depts = Object.entries(byDept).sort((a, b) => b[1].n - a[1].n);
    const top = Object.values(byPerson).sort((a, b) => b.n - a.n).slice(0, 15);
    body.innerHTML = `
      <div class="toolbar">
        <div class="muted" style="font-size:13px">Kỳ thống kê: <b>${esc(label)}</b>${a0 ? ` (${dmy(isoOf(a0))} – ${dmy(isoOf(b0))})` : ''} · ${nDays} ngày</div>
        <div class="right">${periodSelect('fPer', vs.fp, ['today'])}<button class="btn" id="fCopy">⧉ Sao chép báo cáo</button></div>
      </div>
      <div class="kpis" style="padding:0 14px">
        ${kpi('Tổng lượt cấp', tot, `TB ${avg(tot)} lượt / ngày`, 'blue')}
        ${['Sort', 'In/out', 'Khác'].map(g => kpi(`Bộ phận ${g}`, G(g).n, `${pct(G(g).n)} · ${G(g).people.size} người · TB ${avg(G(g).n)}/ngày${G(g).bad ? ' · ' + G(g).bad + ' lượt trả lỗi' : ''}`, '')).join('')}
      </div>
      ${tot ? `<div class="freq-grid">
        <div class="card"><div class="card-h"><h3>Số lượt lấy PDA theo ngày</h3></div><div class="chart-box" style="height:260px"><canvas id="fChart"></canvas></div></div>
        <div class="card"><div class="card-h"><h3>Theo bộ phận</h3></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bộ phận</th><th class="num">Lượt</th><th class="num">%</th><th class="num">Số người</th><th class="num" title="Trung bình lượt / ngày">TB / ngày</th><th class="num" title="Trung bình lượt mỗi người trong kỳ">Lượt / người</th><th class="num">Trả lỗi</th></tr></thead><tbody>
          ${depts.map(([dk, v]) => `<tr><td><span class="chip dg" style="--dg:${GROUP_COLOR[v.group]}">${esc(dk)}</span></td><td class="num"><b>${v.n}</b></td><td class="num">${pct(v.n)}</td><td class="num">${v.people.size}</td><td class="num">${avg(v.n)}</td><td class="num">${v.people.size ? (v.n / v.people.size).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : '—'}</td><td class="num">${v.bad || ''}</td></tr>`).join('')}
          </tbody></table></div></div>
      </div>
      <div class="card mt"><div class="card-h"><div><h3>Nhân viên lấy PDA nhiều nhất</h3><div class="sub" style="margin-top:3px">${esc(label)} · tối đa 15 người</div></div></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Nhân viên</th><th class="code">MSNV</th><th>Bộ phận</th><th class="num">Lượt lấy</th><th class="num">Số ngày lấy</th><th class="num">Trả lỗi</th><th class="num">Quá hạn trả</th></tr></thead><tbody>
        ${top.map((p, i) => `<tr><td>${i + 1}</td><td><b>${esc(p.who || '—')}</b></td><td class="code">${esc(p.msnv)}</td><td>${esc(p.dept)}</td><td class="num"><b>${p.n}</b></td><td class="num">${p.days.size}</td><td class="num">${p.bad ? `<span class="chip red">${p.bad}</span>` : ''}</td><td class="num">${p.late ? `<span class="chip red">${p.late}</span>` : ''}</td></tr>`).join('')}
        </tbody></table></div></div>` : `<div class="empty">Chưa có lượt cấp PDA nào trong ${esc(label.toLowerCase())}.</div>`}`;
    if (tot) {
      const groups = DEPT_GROUPS.filter(g => byGroup[g]);
      chart($('#fChart'), { type: 'bar', data: { labels: days.map(d => ddmm(d)), datasets: groups.map(g => ({ label: g, data: days.map(d => (byDay[isoOf(d)] || {})[g] || 0), backgroundColor: GROUP_COLOR[g], borderRadius: 4 })) },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } } });
    }
    $('#fPer').onchange = e => { vs.fp = e.target.value; pdaLoanFreq(body, name, vs, k); };
    $('#fCopy').onclick = async () => {
      const lines = [`Tần suất lấy PDA${k ? ' – ' + khoInfo(k).short : ''} · ${label}${a0 ? ` (${dmy(isoOf(a0))} – ${dmy(isoOf(b0))})` : ''}`, `Tổng: ${tot} lượt · TB ${avg(tot)} lượt/ngày`];
      ['Sort', 'In/out', 'Khác'].forEach(g => { if (G(g).n) lines.push(` - ${g}: ${G(g).n} lượt (${pct(G(g).n)}) · ${G(g).people.size} người · TB ${avg(G(g).n)}/ngày`); });
      lines.push('', 'Chi tiết bộ phận:'); depts.forEach(([dk, v]) => lines.push(` - ${dk}: ${v.n} lượt · ${v.people.size} người${v.bad ? ' · trả lỗi ' + v.bad : ''}`));
      if (top.length) { lines.push('', 'Lấy nhiều nhất:'); top.slice(0, 5).forEach((p, i) => lines.push(` ${i + 1}. ${p.who} (${p.msnv}${p.dept ? ' · ' + p.dept : ''}): ${p.n} lượt`)); }
      try { await navigator.clipboard.writeText(lines.join('\n')); toast('Đã sao chép báo cáo tần suất'); } catch (e) { toast('Không sao chép được', 'warn'); }
    };
  }

  /* ------------------------------------------------------------------ THỐNG KÊ PDA: nhóm tình trạng + nhập máy */
  const PDA_STG = [['good', 'Tốt', 'green'], ['new', 'Mới hư', 'amber'], ['bad', 'Hư', 'red'], ['liq', 'Thanh lý', ''], ['other', 'Khác', '']];
  function pdaStatusGroup(st) {
    const s = plain(st).trim().toLowerCase();
    if (/^tốt$/.test(s)) return 'good';
    if (/^mới hư/.test(s)) return 'new';
    if (/thanh lý/.test(s)) return 'liq';
    if (/^hư|sửa|bảo hành/.test(s)) return 'bad';
    return 'other';
  }
  function pdaStatusTabs(vs) {
    const k = state.kho === 'ALL' ? null : state.kho, cnt = {};
    codes('PDA').filter(d => !k || d.kho === k).forEach(d => { const g = pdaStatusGroup(d.st); cnt[g] = (cnt[g] || 0) + 1; });
    const all = Object.values(cnt).reduce((a, b) => a + b, 0);
    return `<div class="toolbar"><div class="tabs">
      <button class="tab ${!vs.stg ? 'active' : ''}" data-stg="">Tất cả <span class="tcount">${all}</span></button>
      ${PDA_STG.filter(g => g[0] !== 'other' || cnt.other).map(g => `<button class="tab ${vs.stg === g[0] ? 'active' : ''}" data-stg="${g[0]}">${g[1]} <span class="tcount ${cnt[g[0]] && g[2] ? 'c-' + g[2] : ''}">${cnt[g[0]] || 0}</span></button>`).join('')}
    </div><div class="right muted" style="font-size:12px">Tốt · Mới hư · Hư (gồm chờ sửa / đang sửa) · Thanh lý (chờ + đã thanh lý)</div></div>`;
  }

  /** Ô chọn nhân viên theo MSNV: có trong Danh sách nhân viên → tự hiện tên; chưa có → điền tên (và bộ phận) lần đầu */
  function staffPicker(host, opts = {}) {
    const people = opts.people || peopleList(), depts = staffDepts(people);
    staffDatalist(people);
    host.innerHTML = `<div class="sp">
      <input class="input sp-id" list="dl-STAFF" autocomplete="off" placeholder="${esc(opts.placeholder || 'Nhập MSNV (ID)…')}" value="${esc(opts.value || '')}">
      <div class="sp-hint"></div>
      <div class="sp-new" hidden><input class="input sp-nm" placeholder="Họ tên (chỉ nhập lần đầu)">${opts.needDept ? `<select class="select sp-dp"><option value="">— Bộ phận —</option>${depts.map(o => `<option>${esc(o)}</option>`).join('')}</select>` : ''}</div>
    </div>`;
    const id = host.querySelector('.sp-id'), hint = host.querySelector('.sp-hint'), box = host.querySelector('.sp-new'), nm = host.querySelector('.sp-nm'), dp = host.querySelector('.sp-dp');
    let cur = null;
    const check = () => {
      const v = id.value.trim(); const p = staffFind(v, people);
      if (!v) { cur = null; hint.textContent = ''; hint.className = 'sp-hint'; box.hidden = true; }
      else if (p) {
        const needDept = opts.needDept && !p.dept;
        box.hidden = !needDept; nm.hidden = true;
        cur = { msnv: p.msnv, name: p.name, dept: p.dept || (dp ? dp.value : ''), known: true, src: p.src, r: p.r, dept0: p.dept, kho: p.kho };
        hint.className = 'sp-hint ok';
        hint.innerHTML = `✓ <b>${esc(p.name)}</b> · ${esc(p.msnv)}${p.dept ? ' · ' + esc(p.dept) : needDept ? ' · <span class="warn-text">chọn bộ phận</span>' : ''}`;
      } else {
        box.hidden = false; nm.hidden = false;
        const isName = !/\d/.test(v);
        cur = { msnv: isName ? '' : v.replace(/\s+/g, ''), name: nm.value.trim() || (isName ? v : ''), dept: dp ? dp.value : '', isNew: true };
        hint.className = 'sp-hint new';
        hint.textContent = isName ? 'Không tìm thấy tên này – hãy nhập MSNV.' : 'MSNV chưa có trong Danh sách nhân viên – nhập họ tên lần đầu, các lần sau tên tự hiện.';
      }
      if (opts.onChange) opts.onChange(cur);
    };
    id.addEventListener('input', check); nm.addEventListener('input', check); if (dp) dp.addEventListener('change', check);
    check();
    return {
      input: id,
      /** null = để trống; { error } = thiếu thông tin; còn lại = nhân viên hợp lệ */
      get() {
        check();
        if (!cur) return null;
        if (!cur.msnv) return { error: 'Cần nhập MSNV' };
        if (!cur.name) return { error: `MSNV ${cur.msnv} chưa có trong danh sách – nhập họ tên` };
        if (opts.needDept && !cur.dept) return { error: `Chọn bộ phận cho ${cur.name}` };
        return cur;
      },
      focus() { (cur && cur.isNew && !nm.value ? nm : id).focus(); }
    };
  }
  /** Người mới / người chỉ có trong dữ liệu cũ → lưu vào Danh sách nhân viên; người có sẵn mà thiếu bộ phận → bổ sung */
  function staffEnsure(p, kho, note) {
    if (!p || p.error) return;
    if (p.isNew || p.src === 'old') staffAppend({ name: p.name, msnv: p.msnv, dept: p.dept, kho, note });
    else if (p.r && !p.dept0 && p.dept) enqueue('update', { sheet: STAFF, changes: [{ row: p.r, col: NV.dept, value: p.dept }] });
  }

  // Nhật ký nhập máy PDA (tab NHAP_PDA)
  const NHAP = 'NHAP_PDA', NP = { date: 1, code: 2, imei: 3, kho: 4, name: 5, msnv: 6, who: 7, note: 8, at: 9 };
  function pdaIntake(code, imei) {
    const s = sh(NHAP); if (!s) return null;
    const c = String(code || '').trim().toUpperCase(), ik = imeiKey(imei || '');
    for (let r = s.v.length; r >= 5; r--) {
      const rc = plain(val(NHAP, r, NP.code)).trim().toUpperCase(), ri = imeiKey(plain(val(NHAP, r, NP.imei)));
      if ((c && rc === c) || (ik.length >= 8 && ri === ik)) return { r, date: toDate(val(NHAP, r, NP.date), true), msnv: plain(val(NHAP, r, NP.msnv)).trim(), who: plain(val(NHAP, r, NP.who)).trim() };
    }
    return null;
  }
  const DRAWER_EXT = {
    [PDA_DEV]: {
      html(r, isNew) {
        const it = isNew ? null : pdaIntake(plain(val(PDA_DEV, r, 1)), plain(val(PDA_DEV, r, 3)));
        const d = isNew ? isoOf(new Date()) : it && it.date ? isoOf(it.date) : '';
        return `<div class="sec-title">📥 Nhập máy</div>
          <div class="form">
            <div class="field"><label for="xInDate">Ngày nhập máy</label><input class="input" type="date" id="xInDate" value="${esc(d)}"></div>
            <div class="field"><label>Người nhập máy (MSNV)</label><div id="xInWho"></div></div>
          </div>
          <p class="muted" style="font-size:12px;margin:4px 0 0">Tên lấy theo <b>Danh sách nhân viên</b> – chỉ cần nhập MSNV. MSNV mới thì điền tên lần đầu, các lần sau tên tự hiện. Lưu ở tab “Nhật ký nhập máy PDA”.</p>`;
      },
      bind(body, r, isNew) {
        const it = isNew ? null : pdaIntake(plain(val(PDA_DEV, r, 1)), plain(val(PDA_DEV, r, 3)));
        this._it = it;
        this._pick = staffPicker($('#xInWho', body), { value: it ? it.msnv : '' });
        this._date0 = $('#xInDate', body).value;
      },
      save(r, isNew, values) {
        const body = $('#drawerBody'), date = $('#xInDate', body).value, p = this._pick.get();
        if (p && p.error) { toast(p.error, 'warn'); this._pick.focus(); return false; }
        const code = isNew ? (values[1] || '') : plain(val(PDA_DEV, r, 1)), imei = isNew ? (values[3] || '') : plain(val(PDA_DEV, r, 3));
        const kho = isNew ? (values[2] || '') : plain(val(PDA_DEV, r, 2)), model = isNew ? (values[4] || '') : plain(val(PDA_DEV, r, 4));
        if (isNew && !code && !imei) { toast('Nhập Số máy PDA hoặc IMEI', 'warn'); return false; }
        const it = this._it;
        const changed = isNew ? !!(p || date) : (date !== this._date0 || (p ? p.msnv : '') !== (it ? it.msnv : ''));
        if (!changed || (!p && !date)) return true;
        if (p) staffEnsure(p, kho, 'Tự thêm khi nhập máy PDA');
        if (it) enqueue('update', { sheet: NHAP, changes: [{ row: it.r, col: NP.date, value: date }, { row: it.r, col: NP.msnv, value: p ? p.msnv : '' }, { row: it.r, col: NP.who, value: p ? p.name : '' }] });
        else enqueue('append', { sheet: NHAP, dataStart: 5, lastCol: 9, values: { [NP.date]: date, [NP.code]: code, [NP.imei]: imei, [NP.kho]: kho, [NP.name]: model,
          [NP.msnv]: p ? p.msnv : '', [NP.who]: p ? p.name : '', [NP.at]: new Date().toLocaleString('vi-VN') } });
        if (!isNew) toast('Đã lưu thông tin nhập máy');
        return true;
      }
    }
  };

  /* ------------------------------------------------------------------ GĂNG TAY BẢO HỘ (tab GANG_TAY)
   * A Ngày · B Kho · C Loại (Cấp lần đầu / Đổi mới / Nhập kho / Kiểm kê) · D MSNV · E Họ tên · F Bộ phận · G Vị trí
   * H Số lượng (đôi) · I Găng cũ (Có = xanh / Không = đỏ) · J Đơn giá · K Truy thu · L Ghi chú · M Người thực hiện
   * Vật tư cấp lần đầu 1 đôi / người; hư thì mang găng cũ tới đổi. Không có găng cũ → truy thu. Quá 3 tuần chưa đổi → cảnh báo. */
  const GLOVE = 'GANG_TAY';
  const GT = { date: 1, kho: 2, type: 3, msnv: 4, name: 5, dept: 6, pos: 7, qty: 8, old: 9, price: 10, charge: 11, note: 12, by: 13 };
  const GT_HEAD = ['Ngày', 'Kho', 'Loại giao dịch', 'MSNV', 'Họ tên', 'Bộ phận', 'Vị trí', 'Số lượng (đôi)', 'Găng cũ', 'Đơn giá (VNĐ)', 'Truy thu (VNĐ)', 'Ghi chú', 'Người thực hiện'];
  const GT_WARN_DAYS = 21;
  const GT_ISSUE = ['Cấp lần đầu', 'Đổi mới'];
  const vnd = n => (Number(n) || 0).toLocaleString('vi-VN') + ' đ';
  function gloveRows() {
    const s = sh(GLOVE); if (!s) return [];
    const out = [];
    for (let r = 5; r <= s.v.length; r++) {
      const g = c => plain(val(GLOVE, r, c)).trim();
      const type = g(GT.type), msnv = g(GT.msnv); if (!type && !msnv) continue;
      out.push({ r, d: toDate(val(GLOVE, r, GT.date), true), kho: g(GT.kho), type, msnv, name: g(GT.name), dept: g(GT.dept), pos: g(GT.pos),
        qty: num(val(GLOVE, r, GT.qty)) || 0, old: g(GT.old), price: num(val(GLOVE, r, GT.price)) || 0, charge: num(val(GLOVE, r, GT.charge)) || 0, note: g(GT.note), by: g(GT.by),
        issue: GT_ISSUE.includes(type), red: type === 'Đổi mới' && /^không$/i.test(g(GT.old)) });
    }
    return out.sort((a, b) => ((a.d || 0) - (b.d || 0)) || a.r - b.r);
  }
  /** Tồn kho theo kho: lần kiểm kê gần nhất + nhập − cấp/đổi sau đó. Kèm chênh lệch mỗi lần kiểm kê. */
  function gloveStock(rows) {
    const run = {}, counts = [];
    rows.forEach(x => {
      const k = x.kho || 'HCM20'; run[k] = run[k] || 0;
      if (x.type === 'Nhập kho') run[k] += x.qty;
      else if (x.issue) run[k] -= x.qty;
      else if (x.type === 'Kiểm kê') { counts.push({ ...x, book: run[k], diff: x.qty - run[k] }); run[k] = x.qty; }
    });
    return { byKho: run, counts };
  }
  function glovePrice(rows, kho) {
    const imp = rows.filter(x => x.type === 'Nhập kho' && x.price > 0);
    const same = imp.filter(x => !kho || x.kho === kho);
    const x = (same.length ? same : imp).slice(-1)[0];
    return x ? x.price : 0;
  }
  /** Mỗi nhân viên: lần cấp đầu, các lần đổi (xanh / đỏ), lần gần nhất, truy thu */
  function glovePeople(rows, k) {
    const staff = staffList().filter(x => x.st !== 'Nghỉ việc' && (!k || !x.kho || x.kho === k));
    const map = {};
    staff.forEach(s => { if (s.msnv) map[s.msnv.toUpperCase()] = { msnv: s.msnv, name: s.name, dept: s.dept, kho: s.kho, phone: s.phone, events: [] }; });
    rows.filter(x => x.issue && x.msnv && (!k || x.kho === k)).forEach(x => {
      const key = x.msnv.toUpperCase();
      const p = map[key] = map[key] || { msnv: x.msnv, name: x.name, dept: x.dept, kho: x.kho, events: [], notInList: true };
      p.events.push(x);
      if (x.pos) p.pos = x.pos;
      if (!p.dept && x.dept) p.dept = x.dept;
    });
    const t0 = today0();
    return Object.values(map).map(p => {
      const ev = p.events, last = ev.length ? ev[ev.length - 1] : null;
      const days = last && last.d ? Math.round((t0 - last.d) / 86400000) : null;
      return Object.assign(p, { first: ev.find(x => x.type === 'Cấp lần đầu') || ev[0] || null, last, days,
        swaps: ev.filter(x => x.type === 'Đổi mới'), reds: ev.filter(x => x.red).length, charge: ev.reduce((a, x) => a + x.charge, 0),
        status: !ev.length ? 'none' : days !== null && days >= GT_WARN_DAYS ? 'due' : 'ok' });
    });
  }
  /** Cảnh báo ở Tổng quan / trang kho: nhân viên quá 3 tuần chưa đổi găng */
  function gloveAlert(view, k) {
    if (!sh(GLOVE)) return;
    const n = glovePeople(gloveRows(), k).filter(p => p.status === 'due').length; if (!n) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="task-alert amber" data-go="#/sheet/${GLOVE}" role="link" tabindex="0">${icon('glove')}<span>Găng tay${k ? ' · ' + esc(k) : ''}: <b>${n}</b> nhân viên quá ${GT_WARN_DAYS / 7} tuần chưa đổi găng</span><span class="go">Xem →</span></div>`;
    view.prepend(wrap); bindGo(wrap);
  }

  function renderGloves(view, name) {
    const sc = schemaOf(name), vs = viewState(name), s = sh(name);
    setCrumb(sc.title, 'Công việc hàng ngày');
    vs.gt = vs.gt || 'staff'; vs.gf = vs.gf || 'all'; vs.gd = vs.gd || ''; vs.gp = vs.gp || 'month';
    const k = state.kho === 'ALL' ? null : state.kho;
    const rows = gloveRows(), mine = rows.filter(x => !k || x.kho === k);
    const people = glovePeople(rows, k), stock = gloveStock(rows), price = glovePrice(rows, k);
    const stockNow = k ? (stock.byKho[k] || 0) : Object.values(stock.byKho).reduce((a, b) => a + b, 0);
    const [m0] = periodRange('month');
    const month = mine.filter(x => x.d && x.d >= m0);
    const mIn = month.filter(x => x.type === 'Nhập kho').reduce((a, x) => a + x.qty, 0), mOut = month.filter(x => x.issue).reduce((a, x) => a + x.qty, 0);
    const mRed = month.filter(x => x.red), mCharge = mRed.reduce((a, x) => a + x.charge, 0);
    const listed = people.filter(p => !p.notInList), issued = listed.filter(p => p.events.length);
    const due = people.filter(p => p.status === 'due');
    // Theo bộ phận: đã cấp / tổng nhân viên (VD Inout ca 01: 99/100)
    const depts = {};
    people.forEach(p => { const d = p.dept || 'Chưa ghi bộ phận'; const x = depts[d] = depts[d] || { total: 0, issued: 0, due: 0 }; if (!p.notInList) x.total++; if (p.events.length) x.issued++; if (p.status === 'due') x.due++; });
    view.innerHTML = `
      <div class="kpis">
        ${kpi('Tồn kho găng tay', stockNow, `Tháng này: nhập ${mIn} · cấp / đổi ${mOut} đôi`, stockNow > 0 ? 'blue' : 'red')}
        ${kpi('Đã cấp lần đầu', `${issued.length}/${listed.length}`, 'nhân viên trong Danh sách nhân viên', issued.length < listed.length ? 'amber' : 'green')}
        ${kpi(`Quá ${GT_WARN_DAYS / 7} tuần chưa đổi`, due.length, 'Cần nhắc mang găng cũ tới đổi', due.length ? 'red' : 'green')}
        ${kpi('Đổi không có găng cũ (tháng)', mRed.length, `Truy thu ${vnd(mCharge)}`, mRed.length ? 'red' : 'green')}
        ${kpi('Đơn giá hiện tại', price ? vnd(price) : '—', price ? 'Theo lần nhập kho gần nhất' : 'Chưa có – nhập kho kèm đơn giá', price ? '' : 'amber')}
      </div>
      <div class="card mt">
        <div class="card-h"><div><h3>Găng tay bảo hộ${k ? ' · ' + esc(k) : ''}</h3>
          <div class="sub" style="margin-top:3px">Vật tư cấp lần đầu <b>1 đôi / nhân viên</b>. Găng hư → nhân viên mang <b>găng cũ</b> tới đổi (xanh); không có găng cũ → đỏ, hệ thống tính <b>truy thu</b> và chụp ảnh minh chứng. Quá ${GT_WARN_DAYS / 7} tuần chưa đổi → cảnh báo.${s && s.local ? ' <b class="warn-text">Tab chưa có trên Google Sheet – chạy setupV8 trong Apps Script.</b>' : ''}</div></div>
          <div class="right"><button class="btn primary need-edit" id="gIssue">＋ Cấp / đổi găng</button><button class="btn need-edit" id="gFirst">⧉ Cấp phát ban đầu</button><button class="btn need-edit" id="gIn">📥 Nhập kho</button><button class="btn need-edit" id="gCount">📋 Kiểm kê</button><button class="btn" id="gRaw" title="Bảng gốc trên Google Sheet">⚙ Bảng gốc</button></div></div>
        <div class="gt-depts">${Object.entries(depts).sort((a, b) => a[0].localeCompare(b[0], 'vi')).map(([d, x]) => `<button class="gt-dept ${vs.gd === d ? 'active' : ''}" data-gd="${esc(d)}"><b>${esc(d)}</b><span>Đã cấp ${x.issued}/${x.total || x.issued}</span>${x.due ? `<span class="c-red">${x.due} quá hạn đổi</span>` : ''}</button>`).join('') || '<span class="muted">Chưa có nhân viên – thêm ở Danh sách nhân viên.</span>'}
          ${vs.gd ? '<button class="btn sm" data-gd="">✕ Bỏ lọc bộ phận</button>' : ''}</div>
        <div class="toolbar"><div class="tabs">${[['staff', 'Nhân viên'], ['hist', 'Lịch sử cấp – đổi'], ['stock', 'Nhập – tồn kho']].map(t => `<button class="tab ${vs.gt === t[0] ? 'active' : ''}" data-gt="${t[0]}">${t[1]}</button>`).join('')}</div></div>
        <div id="gBody"></div>
      </div>`;
    const body = $('#gBody');
    const ctx = { name, vs, k, rows, mine, people, stock, price };
    if (vs.gt === 'hist') gloveHist(body, ctx); else if (vs.gt === 'stock') gloveStockTab(body, ctx); else gloveStaffTab(body, ctx);
    $$('[data-gt]', view).forEach(b => b.onclick = () => { vs.gt = b.dataset.gt; renderGloves(view, name); });
    $$('[data-gd]', view).forEach(b => b.onclick = () => { vs.gd = vs.gd === b.dataset.gd ? '' : b.dataset.gd; renderGloves(view, name); });
    $('#gIssue').onclick = () => openGloveIssue(ctx);
    $('#gFirst').onclick = () => openGloveFirst(ctx);
    $('#gIn').onclick = () => openGloveStock(ctx, 'Nhập kho');
    $('#gCount').onclick = () => openGloveStock(ctx, 'Kiểm kê');
    $('#gRaw').onclick = () => { vs.raw = true; route(true); };
  }

  function gloveStaffTab(body, ctx) {
    const { vs, people } = ctx, edit = canEdit();
    const inDept = people.filter(p => !vs.gd || (p.dept || 'Chưa ghi bộ phận') === vs.gd);
    const cnt = f => inDept.filter(p => f === 'all' || (f === 'none' && !p.events.length) || (f === 'due' && p.status === 'due') || (f === 'red' && p.reds)).length;
    body.innerHTML = `
      <div class="toolbar"><div class="tabs">${[['all', 'Tất cả'], ['none', 'Chưa cấp'], ['due', `Quá ${GT_WARN_DAYS / 7} tuần chưa đổi`], ['red', 'Có truy thu']].map(t => `<button class="tab ${vs.gf === t[0] ? 'active' : ''}" data-gf="${t[0]}">${t[1]} <span class="tcount ${t[0] === 'due' || t[0] === 'red' ? (cnt(t[0]) ? 'c-red' : '') : ''}">${cnt(t[0])}</span></button>`).join('')}</div>
        <div class="right gt-legend"><span class="gt-d first">Cấp lần đầu</span><span class="gt-d green">Đổi – có găng cũ</span><span class="gt-d red">Đổi – không có găng cũ</span></div></div>
      <div class="toolbar"><div class="search" style="flex:1"><input class="input" id="gq" placeholder="Tìm họ tên, MSNV, bộ phận, vị trí…" value="${esc(vs.gq || '')}"></div></div>
      <div id="gTbl"></div>`;
    const draw = () => {
      const q = (vs.gq || '').trim().toLowerCase();
      const L = inDept.filter(p => (vs.gf === 'all' || (vs.gf === 'none' && !p.events.length) || (vs.gf === 'due' && p.status === 'due') || (vs.gf === 'red' && p.reds))
        && (!q || `${p.name} ${p.msnv} ${p.dept} ${p.pos || ''}`.toLowerCase().includes(q)))
        .sort((a, b) => ({ due: 0, none: 1, ok: 2 }[a.status] - { due: 0, none: 1, ok: 2 }[b.status]) || (b.days || 0) - (a.days || 0) || a.name.localeCompare(b.name, 'vi'));
      $('#gTbl').innerHTML = L.length ? `<div class="tbl-wrap"><table class="tbl gt"><thead><tr><th>Nhân viên</th><th>Bộ phận</th><th>Vị trí</th><th>Lịch sử cấp / đổi</th><th class="num">Lần gần nhất</th><th class="num">Truy thu</th><th></th></tr></thead><tbody>
        ${L.map(p => `<tr class="${p.status === 'due' ? 'is-late' : ''}">
          <td><b>${esc(p.name || '—')}</b><div class="s">${esc(p.msnv)}${p.notInList ? ' · <span class="warn-text">chưa có trong Danh sách NV</span>' : ''}</div></td>
          <td>${esc(p.dept || '')}</td><td>${esc(p.pos || '')}</td>
          <td>${p.events.length ? `<div class="gt-dates">${p.events.slice(-8).map(e => `<span class="gt-d ${e.type === 'Cấp lần đầu' ? 'first' : e.red ? 'red' : 'green'}" title="${esc(e.type)}${e.red ? ' – không có găng cũ, truy thu ' + vnd(e.charge) : ''}${e.qty > 1 ? ' · ' + e.qty + ' đôi' : ''}">${e.d ? ddmm(e.d) : '?'}</span>`).join('')}${p.events.length > 8 ? `<span class="muted">+${p.events.length - 8}</span>` : ''}</div>` : '<span class="chip amber">Chưa cấp</span>'}</td>
          <td class="num">${p.days === null ? '—' : p.status === 'due' ? `<span class="chip red">${p.days} ngày</span>` : `${p.days} ngày`}</td>
          <td class="num">${p.charge ? `<b class="c-red">${vnd(p.charge)}</b>` : ''}</td>
          <td class="rowact">${edit ? `<button class="btn sm ${p.events.length ? '' : 'primary'}" data-gi="${esc(p.msnv)}">${p.events.length ? '⇄ Đổi găng' : '＋ Cấp lần đầu'}</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">${people.length ? 'Không có nhân viên phù hợp.' : 'Chưa có nhân viên. Thêm ở “Danh sách nhân viên” hoặc bấm “＋ Cấp / đổi găng” và nhập MSNV.'}</div>`;
      $$('[data-gi]', body).forEach(b => b.onclick = () => openGloveIssue(ctx, b.dataset.gi));
    };
    draw();
    $$('[data-gf]', body).forEach(b => b.onclick = () => { vs.gf = b.dataset.gf; gloveStaffTab(body, ctx); });
    $('#gq').addEventListener('input', debounce(e => { vs.gq = e.target.value; draw(); }, 200));
  }

  function gloveHist(body, ctx) {
    const { vs, mine } = ctx;
    const [a, b, label] = periodRange(vs.gp);
    const L = mine.filter(x => x.issue && (!a || (x.d && x.d >= a && x.d <= b)) && (!vs.gd || (x.dept || 'Chưa ghi bộ phận') === vs.gd)).reverse();
    const byDept = {};
    L.forEach(x => { const d = x.dept || 'Chưa ghi bộ phận', o = byDept[d] = byDept[d] || { first: 0, green: 0, red: 0, pairs: 0, charge: 0, people: new Set() };
      o.pairs += x.qty; o.people.add(x.msnv); if (x.type === 'Cấp lần đầu') o.first++; else if (x.red) o.red++; else o.green++; o.charge += x.charge; });
    const tot = Object.values(byDept).reduce((s2, o) => ({ pairs: s2.pairs + o.pairs, red: s2.red + o.red, green: s2.green + o.green, first: s2.first + o.first, charge: s2.charge + o.charge }), { pairs: 0, red: 0, green: 0, first: 0, charge: 0 });
    body.innerHTML = `
      <div class="toolbar"><div class="muted" style="font-size:13px">${esc(label)}${a ? ` (${dmy(isoOf(a))} – ${dmy(isoOf(b))})` : ''}: <b>${tot.pairs}</b> đôi · cấp lần đầu ${tot.first} · đổi xanh <b class="c-green">${tot.green}</b> · đổi đỏ <b class="c-red">${tot.red}</b> · truy thu <b class="c-red">${vnd(tot.charge)}</b></div>
        <div class="right">${periodSelect('gPer', vs.gp)}<button class="btn" id="gCsv">⭳ Xuất Excel</button></div></div>
      ${Object.keys(byDept).length ? `<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Bộ phận</th><th class="num">Số đôi cấp</th><th class="num">Cấp lần đầu</th><th class="num">Đổi – xanh</th><th class="num">Đổi – đỏ</th><th class="num">Số NV</th><th class="num">Truy thu</th></tr></thead><tbody>
        ${Object.entries(byDept).sort((x, y) => y[1].pairs - x[1].pairs).map(([d, o]) => `<tr><td><b>${esc(d)}</b></td><td class="num"><b>${o.pairs}</b></td><td class="num">${o.first}</td><td class="num c-green">${o.green}</td><td class="num ${o.red ? 'c-red' : ''}">${o.red}</td><td class="num">${o.people.size}</td><td class="num">${o.charge ? vnd(o.charge) : ''}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
      ${L.length ? `<div class="tbl-wrap mt"><table class="tbl"><thead><tr><th class="date">Ngày</th><th>Loại</th><th>Nhân viên</th><th class="code">MSNV</th><th>Bộ phận</th><th>Vị trí</th><th class="num">SL</th><th>Găng cũ</th><th class="num">Truy thu</th><th>Ghi chú</th><th></th></tr></thead><tbody>
        ${L.slice(0, 500).map(x => `<tr><td class="date">${x.d ? dmy(isoOf(x.d)) : ''}</td><td>${esc(x.type)}</td><td>${esc(x.name)}</td><td class="code">${esc(x.msnv)}</td><td>${esc(x.dept)}</td><td>${esc(x.pos)}</td><td class="num">${x.qty}</td>
          <td>${x.type === 'Đổi mới' ? `<span class="chip ${x.red ? 'red' : 'green'}">${x.red ? 'Không' : 'Có'}</span>` : ''}</td><td class="num">${x.charge ? vnd(x.charge) : ''}</td><td>${esc(x.note)}</td>
          <td class="rowact"><button class="btn sm" data-gimg="${x.r}" title="Ảnh minh chứng">📷 ${state.images.filter(im => im.sheet === GLOVE && +im.row === x.r).length || ''}</button></td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">Chưa có lượt cấp / đổi găng trong ${esc(label.toLowerCase())}.</div>`}`;
    $('#gPer').onchange = e => { vs.gp = e.target.value; gloveHist(body, ctx); };
    $$('[data-gimg]', body).forEach(b2 => b2.onclick = () => openRowDrawer(GLOVE, +b2.dataset.gimg, null, true));
    $('#gCsv').onclick = () => {
      const q = v => `"${String(v).replace(/"/g, '""')}"`;
      const lines = [GT_HEAD.map(q).join(',')].concat(L.map(x => [x.d ? dmy(isoOf(x.d)) : '', x.kho, x.type, x.msnv, x.name, x.dept, x.pos, x.qty, x.old, x.price, x.charge, x.note, x.by].map(q).join(',')));
      download(`GangTay_${vs.gp}${ctx.k ? '_' + ctx.k : ''}_${isoOf(new Date())}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    };
  }

  function gloveStockTab(body, ctx) {
    const { vs, mine, stock, k } = ctx;
    const [a, b, label] = periodRange(vs.gp);
    const inP = x => !a || (x.d && x.d >= a && x.d <= b);
    const P = mine.filter(inP);
    const sum = f => P.filter(f).reduce((s2, x) => s2 + x.qty, 0);
    const imp = P.filter(x => x.type === 'Nhập kho'), money = imp.reduce((s2, x) => s2 + x.qty * x.price, 0);
    const counts = stock.counts.filter(x => (!k || x.kho === k) && inP(x));
    const khoList = k ? [k] : KHO_CODES;
    body.innerHTML = `
      <div class="toolbar"><div class="muted" style="font-size:13px">${esc(label)}${a ? ` (${dmy(isoOf(a))} – ${dmy(isoOf(b))})` : ''}</div><div class="right">${periodSelect('gPer2', vs.gp)}</div></div>
      <div class="kpis" style="padding:0 14px">
        ${kpi('Nhập trong kỳ', sum(x => x.type === 'Nhập kho'), `Thành tiền ${vnd(money)}`, 'blue')}
        ${kpi('Cấp lần đầu', sum(x => x.type === 'Cấp lần đầu'), 'đôi', '')}
        ${kpi('Đổi mới', sum(x => x.type === 'Đổi mới'), `${P.filter(x => x.red).length} lượt không có găng cũ`, '')}
        ${khoList.map(c => kpi(`Tồn hiện tại · ${c}`, stock.byKho[c] || 0, 'Theo kiểm kê gần nhất + nhập − cấp', (stock.byKho[c] || 0) > 0 ? 'green' : 'red')).join('')}
      </div>
      <div class="freq-grid">
        <div class="card"><div class="card-h"><h3>Lịch sử nhập & giá</h3></div>
          ${imp.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="date">Ngày</th><th>Kho</th><th class="num">SL (đôi)</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th><th>Ghi chú</th></tr></thead><tbody>
            ${imp.slice().reverse().map(x => `<tr><td class="date">${x.d ? dmy(isoOf(x.d)) : ''}</td><td>${esc(x.kho)}</td><td class="num">${x.qty}</td><td class="num">${x.price ? vnd(x.price) : '—'}</td><td class="num">${vnd(x.qty * x.price)}</td><td>${esc(x.note)}</td></tr>`).join('')}
            </tbody></table></div>` : '<div class="empty">Chưa có lần nhập kho trong kỳ. Bấm “📥 Nhập kho”.</div>'}</div>
        <div class="card"><div class="card-h"><h3>Kiểm kê hằng tháng</h3></div>
          ${counts.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="date">Ngày</th><th>Kho</th><th class="num">Sổ sách</th><th class="num">Thực tế</th><th class="num">Chênh lệch</th><th>Ghi chú</th></tr></thead><tbody>
            ${counts.slice().reverse().map(x => `<tr><td class="date">${x.d ? dmy(isoOf(x.d)) : ''}</td><td>${esc(x.kho)}</td><td class="num">${x.book}</td><td class="num"><b>${x.qty}</b></td><td class="num ${x.diff ? 'c-red' : 'c-green'}">${x.diff > 0 ? '+' : ''}${x.diff}</td><td>${esc(x.note)}</td></tr>`).join('')}
            </tbody></table></div>` : '<div class="empty">Chưa kiểm kê trong kỳ. Cuối tháng bấm “📋 Kiểm kê” và nhập số đếm thực tế.</div>'}</div>
      </div>`;
    $('#gPer2').onchange = e => { vs.gp = e.target.value; gloveStockTab(body, ctx); };
  }

  const gloveBy = () => state.user || (state.me && state.me.name) || '';

  /** Cấp lần đầu / đổi găng cho 1 nhân viên */
  function openGloveIssue(ctx, msnv) {
    const { rows, k } = ctx;
    const m = modal(`<h3>🧤 Cấp / đổi găng tay</h3>
      <div class="form" style="margin-top:4px">
        <div class="field full"><label>Nhân viên (MSNV)</label><div id="giWho"></div></div>
        <div class="field"><label for="giType">Loại</label><select class="select" id="giType">${GT_ISSUE.map(o => `<option>${o}</option>`).join('')}</select></div>
        <div class="field"><label for="giKho">Kho</label><select class="select" id="giKho">${KHO_CODES.map(c => `<option ${c === (k || 'HCM20') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="giQty">Số lượng (đôi)</label><input class="input" type="number" id="giQty" min="1" value="1"></div>
        <div class="field"><label for="giPos">Vị trí làm việc</label><input class="input" id="giPos" placeholder="VD: bắt hàng, quét mã…"></div>
        <div class="field"><label for="giDate">Ngày</label><input class="input" type="date" id="giDate" value="${isoOf(new Date())}"></div>
      </div>
      <div id="giOldBox" class="gt-old">
        <div class="lbl">Nhân viên có mang <b>găng cũ</b> tới đổi không?</div>
        <label class="gt-opt green"><input type="radio" name="giOld" value="Có" checked> Có găng cũ – <b>xanh</b></label>
        <label class="gt-opt red"><input type="radio" name="giOld" value="Không"> Không có găng cũ – <b>đỏ</b> (truy thu)</label>
        <div id="giCharge" hidden class="gt-charge">Đơn giá <input class="input" type="number" id="giPrice" min="0" step="1000" style="width:120px"> đ → <b>Truy thu: <span id="giSum">0 đ</span></b> (bắt buộc)</div>
      </div>
      <div class="field"><label for="giNote">Ghi chú</label><input class="input" id="giNote" placeholder="VD: găng rách ngón cái"></div>
      <label class="chk"><input type="checkbox" id="giPhoto"> Mở mục ảnh để chụp <b>minh chứng</b> sau khi lưu</label>
      <p class="muted" id="giInfo" style="font-size:12px;margin:0"></p>
      <div class="row"><button class="btn" id="giCancel" type="button">Hủy</button><button class="btn primary" id="giOk" type="button">✓ Lưu</button></div>`, 'wide');
    let person = null;
    const sync = () => {
      const type = m.$('#giType').value, isSwap = type === 'Đổi mới', red = isSwap && m.$('input[name=giOld]:checked').value === 'Không';
      m.$('#giOldBox').hidden = !isSwap; m.$('#giCharge').hidden = !red;
      m.$('#giSum').textContent = vnd((+m.$('#giQty').value || 0) * (+m.$('#giPrice').value || 0));
      if (red && !m.$('#giPhoto').dataset.touched) m.$('#giPhoto').checked = true;
    };
    const pick = staffPicker(m.$('#giWho'), { value: msnv || '', needDept: true, onChange: p => {
      person = p;
      const ev = p && p.msnv ? rows.filter(x => x.issue && x.msnv.toUpperCase() === p.msnv.toUpperCase()) : [];
      const last = ev.slice(-1)[0];
      m.$('#giType').value = ev.length ? 'Đổi mới' : 'Cấp lần đầu';
      if (last) { if (!m.$('#giPos').value) m.$('#giPos').value = last.pos; if (last.kho) m.$('#giKho').value = last.kho; }
      else if (p && p.kho) m.$('#giKho').value = p.kho;
      m.$('#giInfo').innerHTML = !p || !p.msnv ? '' : ev.length ? `Đã nhận ${ev.length} lần · gần nhất ${last.d ? dmy(isoOf(last.d)) : ''} (${esc(last.type)})${last.red ? ' – không có găng cũ' : ''}` : 'Chưa nhận găng lần nào → <b>Cấp lần đầu</b> (mặc định 1 đôi).';
      if (!m.$('#giPrice').dataset.touched) m.$('#giPrice').value = glovePrice(rows, m.$('#giKho').value) || '';
      sync();
    } });
    m.$('#giPrice').addEventListener('input', () => { m.$('#giPrice').dataset.touched = '1'; sync(); });
    m.$('#giPhoto').addEventListener('change', () => { m.$('#giPhoto').dataset.touched = '1'; });
    ['#giType', '#giQty'].forEach(s2 => m.$(s2).addEventListener('input', sync));
    m.$('#giType').addEventListener('change', sync);
    m.$$('input[name=giOld]').forEach(r => r.addEventListener('change', sync));
    if (!m.$('#giPrice').value) m.$('#giPrice').value = glovePrice(rows, m.$('#giKho').value) || '';
    sync();
    setTimeout(() => pick.focus(), 50);
    m.$('#giCancel').onclick = m.close;
    m.$('#giOk').onclick = () => {
      const p = pick.get();
      if (!p) { toast('Nhập MSNV nhân viên', 'warn'); pick.focus(); return; }
      if (p.error) { toast(p.error, 'warn'); pick.focus(); return; }
      const type = m.$('#giType').value, qty = Math.max(1, +m.$('#giQty').value || 1), kho = m.$('#giKho').value;
      const red = type === 'Đổi mới' && m.$('input[name=giOld]:checked').value === 'Không';
      const priceV = +m.$('#giPrice').value || 0;
      if (red && !priceV) { toast('Nhập đơn giá để tính tiền truy thu', 'warn'); m.$('#giPrice').focus(); return; }
      staffEnsure(p, kho, 'Tự thêm khi cấp găng tay');
      const op = enqueue('append', { sheet: GLOVE, dataStart: 5, lastCol: GT_HEAD.length, values: { [GT.date]: m.$('#giDate').value || isoOf(new Date()), [GT.kho]: kho, [GT.type]: type,
        [GT.msnv]: p.msnv, [GT.name]: p.name, [GT.dept]: p.dept || '', [GT.pos]: m.$('#giPos').value.trim(), [GT.qty]: qty,
        [GT.old]: type === 'Đổi mới' ? (red ? 'Không' : 'Có') : '', [GT.price]: priceV || '', [GT.charge]: red ? qty * priceV : '', [GT.note]: m.$('#giNote').value.trim(), [GT.by]: gloveBy() } });
      toast(`${type}: ${p.name} · ${qty} đôi${red ? ' · truy thu ' + vnd(qty * priceV) : ''}`, red ? 'warn' : '');
      const photo = m.$('#giPhoto').checked;
      m.close(); route(true);
      if (photo && op && op.payload._row) setTimeout(() => openRowDrawer(GLOVE, op.payload._row, null, true), 200);
    };
  }

  /** Cấp phát ban đầu: chọn bộ phận → tích những người chưa nhận → cấp 1 đôi / người trong 1 lần */
  function openGloveFirst(ctx) {
    const { people, k } = ctx, today = isoOf(new Date());
    const depts = [...new Set(people.filter(p => !p.events.length).map(p => p.dept || 'Chưa ghi bộ phận'))].sort((a, b) => a.localeCompare(b, 'vi'));
    const m = modal(`<h3>⧉ Cấp phát găng tay ban đầu</h3>
      <p class="muted" style="margin:0">Bước 1: chọn bộ phận · Bước 2: tích nhân viên nhận găng (mặc định đã tích tất cả người <b>chưa nhận lần nào</b>) · Bước 3: kiểm tra vị trí, bấm Cấp. Mỗi người <b>1 đôi</b>.</p>
      <div class="form" style="margin-top:6px">
        <div class="field"><label for="gfDept">Bộ phận</label><select class="select" id="gfDept"><option value="">— Chọn bộ phận —</option>${depts.map(d => `<option>${esc(d)}</option>`).join('')}</select></div>
        <div class="field"><label for="gfKho">Kho</label><select class="select" id="gfKho">${KHO_CODES.map(c => `<option ${c === (k || 'HCM20') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="gfDate">Ngày cấp</label><input class="input" type="date" id="gfDate" value="${today}"></div>
        <div class="field"><label for="gfPos">Vị trí (áp cho người chưa ghi)</label><input class="input" id="gfPos" placeholder="VD: bắt hàng"></div>
      </div>
      <div id="gfList" class="sb-prev"></div>
      ${depts.length ? '' : '<div class="empty">Mọi nhân viên trong danh sách đã được cấp lần đầu. 👍</div>'}
      <div class="row"><button class="btn" id="gfCancel" type="button">Hủy</button><button class="btn primary" id="gfOk" type="button" disabled>Cấp 0 đôi</button></div>`, 'wide');
    const draw = () => {
      const d = m.$('#gfDept').value;
      const L = people.filter(p => !p.events.length && (p.dept || 'Chưa ghi bộ phận') === d && p.msnv);
      m.$('#gfList').innerHTML = d ? (L.length ? `<table class="tbl"><thead><tr><th><input type="checkbox" id="gfAll" checked></th><th>Họ tên</th><th>MSNV</th><th>Vị trí</th></tr></thead><tbody>${L.map(p => `<tr><td><input type="checkbox" class="gf-ck" value="${esc(p.msnv)}" checked></td><td>${esc(p.name)}</td><td>${esc(p.msnv)}</td><td><input class="input gf-pos" data-m="${esc(p.msnv)}" value="${esc(p.pos || '')}" placeholder="Vị trí"></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Bộ phận này đã cấp đủ.</div>') : '';
      const upd = () => { const n = m.$$('.gf-ck').filter(c => c.checked).length; m.$('#gfOk').disabled = !n; m.$('#gfOk').textContent = `Cấp ${n} đôi cho ${n} người`; };
      m.$$('.gf-ck').forEach(c => c.onchange = upd);
      if (m.$('#gfAll')) m.$('#gfAll').onchange = e => { m.$$('.gf-ck').forEach(c => { c.checked = e.target.checked; }); upd(); };
      upd();
    };
    m.$('#gfDept').onchange = draw;
    m.$('#gfCancel').onclick = m.close;
    m.$('#gfOk').onclick = () => {
      const sel = new Set(m.$$('.gf-ck').filter(c => c.checked).map(c => c.value));
      const posAll = m.$('#gfPos').value.trim(), kho = m.$('#gfKho').value, date = m.$('#gfDate').value || today, by = gloveBy();
      const rowsOut = people.filter(p => sel.has(p.msnv)).map(p => {
        const pe = m.$(`.gf-pos[data-m="${CSS.escape(p.msnv)}"]`);
        return { [GT.date]: date, [GT.kho]: kho, [GT.type]: 'Cấp lần đầu', [GT.msnv]: p.msnv, [GT.name]: p.name, [GT.dept]: p.dept || '', [GT.pos]: (pe && pe.value.trim()) || posAll, [GT.qty]: 1, [GT.by]: by };
      });
      if (!rowsOut.length) return;
      enqueue('appendMany', { sheet: GLOVE, dataStart: 5, lastCol: GT_HEAD.length, rows: rowsOut });
      toast(`Đã cấp lần đầu ${rowsOut.length} đôi – ${m.$('#gfDept').value}`);
      m.close(); route(true);
    };
  }

  /** Nhập kho (kèm đơn giá) / Kiểm kê (số đếm thực tế) */
  function openGloveStock(ctx, type) {
    const { k, stock, rows } = ctx, isIn = type === 'Nhập kho', kho0 = k || 'HCM20';
    const m = modal(`<h3>${isIn ? '📥 Nhập kho găng tay' : '📋 Kiểm kê găng tay'}</h3>
      <div class="form" style="margin-top:4px">
        <div class="field"><label for="gsKho">Kho</label><select class="select" id="gsKho">${KHO_CODES.map(c => `<option ${c === kho0 ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="gsDate">Ngày</label><input class="input" type="date" id="gsDate" value="${isoOf(new Date())}"></div>
        <div class="field"><label for="gsQty">${isIn ? 'Số lượng nhập (đôi)' : 'Số đếm thực tế (đôi)'}</label><input class="input" type="number" id="gsQty" min="0"></div>
        ${isIn ? '<div class="field"><label for="gsPrice">Đơn giá (VNĐ / đôi)</label><input class="input" type="number" id="gsPrice" min="0" step="500"></div>' : ''}
        <div class="field full"><label for="gsNote">Ghi chú</label><input class="input" id="gsNote" placeholder="${isIn ? 'Nhà cung cấp, số phiếu…' : 'Kiểm kê tháng …'}"></div>
      </div>
      <p class="muted" id="gsInfo" style="font-size:13px;margin:0"></p>
      <div class="row"><button class="btn" id="gsCancel" type="button">Hủy</button><button class="btn primary" id="gsOk" type="button">✓ Lưu</button></div>`);
    const info = () => {
      const kho = m.$('#gsKho').value, cur = stock.byKho[kho] || 0, q = m.$('#gsQty').value;
      m.$('#gsInfo').innerHTML = isIn ? `Tồn sổ sách hiện tại ${kho}: <b>${cur}</b> đôi · đơn giá lần trước: ${glovePrice(rows, kho) ? vnd(glovePrice(rows, kho)) : '—'}${q && m.$('#gsPrice').value ? ` · thành tiền <b>${vnd(q * m.$('#gsPrice').value)}</b>` : ''}`
        : `Tồn sổ sách ${kho}: <b>${cur}</b> đôi${q !== '' ? ` · chênh lệch <b class="${q - cur ? 'c-red' : 'c-green'}">${q - cur > 0 ? '+' : ''}${q - cur}</b>` : ''}`;
    };
    if (isIn) m.$('#gsPrice').value = glovePrice(rows, kho0) || '';
    m.$$('input, select').forEach(el => el.addEventListener('input', info)); m.$('#gsKho').addEventListener('change', () => { if (isIn && !m.$('#gsPrice').dataset.t) m.$('#gsPrice').value = glovePrice(rows, m.$('#gsKho').value) || ''; info(); });
    if (isIn) m.$('#gsPrice').addEventListener('input', () => { m.$('#gsPrice').dataset.t = '1'; });
    info();
    m.$('#gsCancel').onclick = m.close;
    m.$('#gsOk').onclick = () => {
      const q = m.$('#gsQty').value;
      if (q === '' || +q < 0 || (isIn && +q === 0)) { toast('Nhập số lượng', 'warn'); m.$('#gsQty').focus(); return; }
      enqueue('append', { sheet: GLOVE, dataStart: 5, lastCol: GT_HEAD.length, values: { [GT.date]: m.$('#gsDate').value || isoOf(new Date()), [GT.kho]: m.$('#gsKho').value, [GT.type]: type,
        [GT.qty]: +q, [GT.price]: isIn ? (+m.$('#gsPrice').value || '') : '', [GT.note]: m.$('#gsNote').value.trim(), [GT.by]: gloveBy() } });
      toast(isIn ? `Đã nhập kho ${q} đôi găng tay` : `Đã ghi kiểm kê: ${q} đôi`);
      m.close(); route(true);
    };
  }

  /* ------------------------------------------------------------------ BÁO CÁO PDA (theo kho, sao chép gửi nhóm)
   * Lấy từ Thống kê PDA: tổng máy đang quản lý, hoạt động tốt theo model, hư hỏng (mô tả, ngày hư,
   * dự kiến sửa xong), chờ sửa / đang sửa, chờ thanh lý; kèm cấp phát trong ngày và danh mục thanh lý. */
  const PDA_GROUPS = [
    ['good', 'Hoạt động tốt', s => /^tốt$/i.test(s)],
    ['bad', 'Hư hỏng', s => /^(hư|mới hư)$/i.test(s)],
    ['wait', 'Chờ sửa', s => /^chờ sửa$/i.test(s)],
    ['fix', 'Đang sửa / bảo hành', s => /gửi sửa|bảo hành|đang sửa/i.test(s)],
    ['liq', 'Chờ thanh lý', s => /^chờ thanh lý$/i.test(s)],
    ['store', 'Lưu trữ', s => /lưu trữ/i.test(s)]
  ];
  const isLiquidated = d => /^đã thanh lý$/i.test(d.st);
  function pdaReportData(k) {
    const devs = codes('PDA').filter(d => (!k || d.kho === k) && !isLiquidated(d));
    return (k ? [k] : KHO_CODES).map(code => {
      const list = devs.filter(d => d.kho === code);
      const groups = PDA_GROUPS.map(([id, label, test]) => ({ id, label, items: list.filter(d => test(d.st)) }));
      const other = list.filter(d => !PDA_GROUPS.some(g => g[2](d.st)));
      if (other.length) groups.push({ id: 'other', label: 'Chưa ghi tình trạng', items: other });
      return { kho: code, total: list.length, groups, loans: sh(LOANS.PDA.sheet) ? loanCounts(LOANS.PDA, code) : null };
    });
  }
  const byModel = items => { const m = {}; items.forEach(d => { const k = d.name || 'Chưa ghi model'; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const devLabel = d => d.code || (d.imei ? 'IMEI ' + imeiKey(d.imei) : 'Dòng ' + d.r);
  const ddmm = d => d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` : '';
  /** Ngày theo dõi sửa chữa của 1 máy: [chữ, quá hạn?] */
  function devDates(d) {
    const parts = []; let late = false;
    if (d.errAt) parts.push('hư ' + ddmm(d.errAt));
    if (d.sentAt) parts.push('gửi sửa ' + ddmm(d.sentAt));
    if (d.repairDue) { late = d.repairDue < today0() && !d.backAt; parts.push('dự kiến xong ' + ddmm(d.repairDue) + (late ? ' (trễ)' : '')); }
    if (d.backAt) parts.push('nhận về ' + ddmm(d.backAt));
    return [parts.join(' · '), late];
  }

  function pdaReportText(data) {
    const t = new Date(), lines = [`Báo cáo PDA ngày ${pad(t.getDate())}/${pad(t.getMonth() + 1)}/${t.getFullYear()}`];
    data.forEach(k => {
      lines.push('', khoInfo(k.kho).short, ` - PDA tổng ${k.total}:`);
      k.groups.forEach(g => {
        if (!g.items.length) return;
        lines.push(`   + ${g.label}: ${g.items.length}`);
        if (g.id === 'good') byModel(g.items).forEach(([m, n]) => lines.push(`     * ${m} : ${n} PDA`));
        else g.items.forEach(d => { const dt = devDates(d)[0]; lines.push(`     * ${devLabel(d)}${d.name ? ' (' + d.name + ')' : ''}${d.desc ? ': ' + d.desc : ''}${dt ? ' [' + dt + ']' : ''}`); });
      });
      if (k.loans) lines.push(` - Cấp phát hôm nay: ${k.loans.today} lượt · đang mượn ${k.loans.open} · quá hạn trả ${k.loans.late}${k.loans.bad ? ' · trả về lỗi ' + k.loans.bad : ''}`);
    });
    return lines.join('\n');
  }

  function renderPdaReport(view) {
    setCrumb('Báo cáo PDA', 'Thiết bị');
    const k = state.kho === 'ALL' ? null : state.kho, data = pdaReportData(k), vs = viewState('__pdaRep');
    vs.liq = vs.liq || 'propose';
    const sum = data.reduce((a, x) => { a.total += x.total; x.groups.forEach(g => { a[g.id] = (a[g.id] || 0) + g.items.length; }); return a; }, { total: 0 });
    const allDevs = codes('PDA').filter(d => !k || d.kho === k);
    const liqLists = {
      propose: allDevs.filter(d => /^(hư|mới hư)$/i.test(d.st)),
      wait: allDevs.filter(d => /^chờ thanh lý$/i.test(d.st)),
      done: allDevs.filter(isLiquidated)
    };
    const lateRepair = allDevs.filter(d => devDates(d)[1]).length;
    const devLi = d => { const [dt, late] = devDates(d); return `<li class="dev"><b class="code-inline">${esc(devLabel(d))}</b> <span class="muted">${esc(d.name || 'Chưa ghi model')}</span>${d.desc ? `<div>${esc(d.desc)}</div>` : ''}${dt ? `<div class="dates ${late ? 'late' : ''}">📅 ${esc(dt)}</div>` : ''}</li>`; };
    const card = x => `
      <div class="card"><div class="card-h"><h3><span class="chip" style="background:${khoInfo(x.kho).color};color:#fff;border:0">${esc(x.kho)}</span> ${esc(khoInfo(x.kho).name)}</h3><div class="right"><b>${x.total}</b> <span class="muted">PDA</span></div></div>
        <div class="card-b rep">
          ${x.total ? x.groups.filter(g => g.items.length).map(g => `<div class="rep-g ${g.id}"><div class="rep-h"><span>${esc(g.label)}</span><b>${g.items.length}</b></div>
            ${g.id === 'good' ? `<ul>${byModel(g.items).map(([m, n]) => `<li><span>${esc(m)}</span><b>${n}</b></li>`).join('')}</ul>` : `<ul>${g.items.map(devLi).join('')}</ul>`}
          </div>`).join('') : '<div class="empty">Chưa khai báo PDA cho kho này.</div>'}
          ${x.loans ? `<div class="rep-g loans"><div class="rep-h"><span>Cấp phát hôm nay</span><b>${x.loans.today}</b></div><ul>
            <li><span>Đang mượn</span><b>${x.loans.open}</b></li><li><span>Quá hạn trả</span><b class="${x.loans.late ? 'late' : ''}">${x.loans.late}</b></li><li><span>Trả về có lỗi</span><b>${x.loans.bad}</b></li></ul></div>` : ''}
        </div></div>`;
    const liqTabs = [['propose', 'Máy hư – đề xuất thanh lý'], ['wait', 'Chờ thanh lý'], ['done', 'Đã thanh lý']];
    const liqRows = liqLists[vs.liq];
    view.innerHTML = `
      <div class="kpis">
        ${kpi('Tổng PDA đang quản lý', sum.total, k ? khoInfo(k).name : 'Toàn cụm 3 kho (không gồm máy đã thanh lý)', 'blue', '#/sheet/' + PDA_DEV)}
        ${kpi('Hoạt động tốt', sum.good || 0, sum.total ? Math.round((sum.good || 0) / sum.total * 100) + '% tổng số máy' : '', 'green')}
        ${kpi('Hư hỏng', sum.bad || 0, 'HƯ + MỚI HƯ', sum.bad ? 'red' : 'green')}
        ${kpi('Chờ sửa / đang sửa', (sum.wait || 0) + (sum.fix || 0), lateRepair ? `${lateRepair} máy trễ ngày dự kiến sửa xong` : `Chờ sửa ${sum.wait || 0} · Đang sửa ${sum.fix || 0}`, lateRepair ? 'red' : ((sum.wait || 0) + (sum.fix || 0) ? 'amber' : ''))}
        ${kpi('Thanh lý', liqLists.wait.length, `Chờ thanh lý · đã thanh lý ${liqLists.done.length}`, liqLists.wait.length ? 'amber' : '')}
      </div>
      <div class="card mt"><div class="card-h"><div><h3>Báo cáo PDA ngày ${dmy(isoOf(new Date()))}</h3><div class="sub" style="margin-top:3px">Số liệu lấy trực tiếp từ Thống kê PDA và Cấp phát PDA. Ngày hư, ngày gửi sửa, <b>dự kiến sửa xong</b> nhập ở Thống kê PDA (các cột ngày). Máy đã thanh lý không tính vào tổng.</div></div>
        <div class="right"><button class="btn primary" id="repCopy">📋 Sao chép báo cáo</button><button class="btn" id="repPrint">⎙ In</button></div></div></div>
      <div class="grid ${data.length > 1 ? 'g3' : ''} mt rep-grid">${data.map(card).join('')}</div>
      <div class="card mt" id="liqCard"><div class="card-h"><div><h3>Danh mục thanh lý PDA</h3><div class="sub" style="margin-top:3px">Máy hư không sửa được → <b>Đề xuất thanh lý</b> → khi đã bàn giao thanh lý bấm <b>Đã thanh lý</b>. Tình trạng được ghi vào Thống kê PDA.</div></div>
        <div class="right"><button class="btn" id="liqCopy">📋 Sao chép danh mục</button></div></div>
        <div class="toolbar"><div class="tabs">${liqTabs.map(t => `<button class="tab ${vs.liq === t[0] ? 'active' : ''}" data-liq="${t[0]}">${t[1]} <span class="tcount">${liqLists[t[0]].length}</span></button>`).join('')}</div></div>
        ${liqRows.length ? `<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Số máy PDA</th><th>Kho</th><th>Thiết bị</th><th>IMEI</th><th>Tình trạng</th><th>Mô tả lỗi</th><th>Ngày hư</th><th></th></tr></thead><tbody>
          ${liqRows.map(d => `<tr><td class="code">${esc(devLabel(d))}</td><td>${esc(d.kho)}</td><td>${esc(d.name || '—')}</td><td class="code">${esc(imeiKey(d.imei))}</td>
            <td><span class="chip ${/thanh lý/i.test(d.st) ? (isLiquidated(d) ? '' : 'amber') : 'red'}">${esc(d.st)}</span></td><td class="wrap">${esc(d.desc)}</td><td class="date">${d.errAt ? dmy(isoOf(d.errAt)) : ''}</td>
            <td class="rowact">${vs.liq === 'propose' ? `<button class="btn sm need-edit" data-liqset="CHỜ THANH LÝ" data-r="${d.r}">→ Đề xuất thanh lý</button>`
              : vs.liq === 'wait' ? `<button class="btn sm need-edit" data-liqset="ĐÃ THANH LÝ" data-r="${d.r}">✓ Đã thanh lý</button> <button class="btn sm need-edit" data-liqset="HƯ" data-r="${d.r}">↩ Hủy đề xuất</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">${vs.liq === 'propose' ? 'Không có máy hư.' : vs.liq === 'wait' ? 'Chưa có máy nào chờ thanh lý.' : 'Chưa có máy nào đã thanh lý.'}</div>`}
      </div>`;
    bindGo(view);
    $$('[data-liq]', view).forEach(b => b.onclick = () => { vs.liq = b.dataset.liq; renderPdaReport(view); });
    $$('[data-liqset]', view).forEach(b => b.onclick = () => {
      const r = +b.dataset.r, st = b.dataset.liqset, d = allDevs.find(x => x.r === r); if (!d) return;
      const msg = st === 'ĐÃ THANH LÝ' ? `Xác nhận máy ${devLabel(d)} đã được thanh lý?\nMáy sẽ không còn tính vào tổng PDA.` : st === 'CHỜ THANH LÝ' ? `Đề xuất thanh lý máy ${devLabel(d)}?` : `Hủy đề xuất, đưa máy ${devLabel(d)} về tình trạng HƯ?`;
      if (!confirm(msg)) return;
      const today = isoOf(new Date()), note = { 'CHỜ THANH LÝ': 'đề xuất thanh lý', 'ĐÃ THANH LÝ': 'đã thanh lý', 'HƯ': 'hủy đề xuất thanh lý' }[st];
      enqueue('update', { sheet: PDA_DEV, changes: [{ row: r, col: 5, value: st }, { row: r, col: 8, value: today },
        { row: r, col: 6, value: (d.desc ? d.desc + ' · ' : '') + `${dmy(today)}: ${note}${state.user ? ' (' + state.user + ')' : ''}` }] });
      toast(`${devLabel(d)}: ${st.toLowerCase()}`);
      route(true);
    });
    const copy = async (txt, okMsg) => {
      try { await navigator.clipboard.writeText(txt); toast(okMsg); }
      catch (e) { modal(`<h3>Nội dung</h3><textarea class="dv-explain" style="min-height:320px">${esc(txt)}</textarea><div class="row"><button class="btn primary" type="button" onclick="this.closest('.modal-bg').remove()">Đóng</button></div>`, 'wide'); }
    };
    $('#repCopy').onclick = () => copy(pdaReportText(data), 'Đã sao chép báo cáo – dán vào Zalo / email');
    $('#liqCopy').onclick = () => {
      const t = new Date(), lbl = { propose: 'Máy hư – đề xuất thanh lý', wait: 'Danh mục PDA chờ thanh lý', done: 'Danh mục PDA đã thanh lý' }[vs.liq];
      copy([`${lbl} – ngày ${pad(t.getDate())}/${pad(t.getMonth() + 1)}/${t.getFullYear()} (${liqRows.length} máy)`, ...liqRows.map((d, i) => `${i + 1}. ${devLabel(d)} · ${d.kho} · ${d.name || 'Chưa ghi model'} · IMEI ${imeiKey(d.imei)}${d.desc ? ' · ' + d.desc : ''}`)].join('\n'), 'Đã sao chép danh mục');
    };
    $('#repPrint').onclick = () => window.print();
  }

  /* ------------------------------------------------------------------ DANH SÁCH NÓN BẢO HỘ & ÁO PHẢN QUANG
   * Mỗi chiếc 1 dòng (DS_BHLD: A Mã số · B Loại · C Kho · D Người đang giữ · E MSNV · F Bộ phận · G Ngày nhận · H Tình trạng · I Ghi chú).
   * Nhân viên nhận → chỉ cần gõ tên (hoặc MSNV) vào dòng của chiếc đó; MSNV + ngày nhận tự điền. Thu hồi = xóa tên. */
  const BH = { code: 1, type: 2, kho: 3, who: 4, msnv: 5, dept: 6, recv: 7, cond: 8, note: 9 };
  const BH_PREFIX = { 'Nón bảo hộ': 'NON', 'Áo phản quang': 'AO' };
  const khoShort = k => ({ HCM20: '20', ST: 'ST', TK: 'TK' }[k] || k);
  function bhldList(name, k) {
    const s = sh(name); if (!s) return [];
    const out = [];
    for (let r = 5; r <= s.v.length; r++) {
      const g = c => plain(val(name, r, c)).trim();
      const code = g(BH.code), type = g(BH.type); if (!code && !type) continue;
      const kho = g(BH.kho); if (k && kho !== k) continue;
      const who = g(BH.who), cond = g(BH.cond) || 'Tốt';
      out.push({ r, code, type, kho, who, msnv: g(BH.msnv), dept: g(BH.dept), recv: toDate(val(name, r, BH.recv), true), cond, note: g(BH.note),
        out: !!who, broken: /^(hư|mất)$/i.test(cond) });
    }
    return out;
  }

  function renderBhld(view, name) {
    const sc = schemaOf(name), vs = viewState(name);
    setCrumb(sc.title, 'Công việc hàng ngày');
    vs.bf = vs.bf || 'all'; vs.bt = vs.bt || '';
    const k = state.kho === 'ALL' ? null : state.kho, all = bhldList(name, k), edit = canEdit();
    const cnt = t => all.filter(x => !t || x.type === t);
    const c = { helmet: cnt('Nón bảo hộ').length, vest: cnt('Áo phản quang').length, out: all.filter(x => x.out).length,
      free: all.filter(x => !x.out && !x.broken).length, broken: all.filter(x => x.broken).length };
    const tabs = [['all', 'Tất cả', all.length], ['out', 'Đang cấp', c.out], ['free', 'Trong kho', c.free], ['broken', 'Hư / mất', c.broken]];
    const s = sh(name);
    view.innerHTML = `
      <div class="kpis">
        ${kpi('Nón bảo hộ', c.helmet, `${cnt('Nón bảo hộ').filter(x => x.out).length} đang cấp`, 'blue')}
        ${kpi('Áo phản quang', c.vest, `${cnt('Áo phản quang').filter(x => x.out).length} đang cấp`, 'blue')}
        ${kpi('Đang cấp cho nhân viên', c.out, k ? khoInfo(k).name : 'Toàn cụm', 'amber')}
        ${kpi('Còn trong kho', c.free, 'Sẵn sàng cấp', c.free ? 'green' : 'red')}
        ${kpi('Hư / mất', c.broken, 'Cần bổ sung', c.broken ? 'red' : 'green')}
      </div>
      <div class="card mt">
        <div class="card-h"><div><h3>Danh sách nón bảo hộ & áo phản quang${k ? ' · ' + esc(k) : ''}</h3>
          <div class="sub" style="margin-top:3px">Nhân viên nhận → gõ <b>tên</b> (hoặc MSNV) vào ô “Người đang giữ” của chiếc đó, Enter để lưu – MSNV và ngày nhận tự điền. Thu hồi về kho → bấm “Thu hồi”.${s && s.local ? ' <b class="warn-text">Tab chưa có trên Google Sheet – chạy setupV6 trong Apps Script.</b>' : ''}</div></div>
          <div class="right"><button class="btn primary need-edit" id="bhAdd">＋ Thêm nón / áo</button><button class="btn" id="bhRaw" title="Bảng gốc trên Google Sheet">⚙ Bảng gốc</button><button class="btn" id="bhCsv">⭳ Xuất Excel</button></div></div>
        <div class="toolbar">
          <div class="tabs">${tabs.map(t => `<button class="tab ${vs.bf === t[0] ? 'active' : ''}" data-bf="${t[0]}">${t[1]} <span class="tcount">${t[2]}</span></button>`).join('')}</div>
          <div class="right"><select class="select" id="bhType"><option value="">Nón + áo</option>${['Nón bảo hộ', 'Áo phản quang'].map(t => `<option ${vs.bt === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>
        <div class="toolbar"><div class="search" style="flex:1"><input class="input" id="bhq" placeholder="Tìm mã số, tên nhân viên, MSNV…" value="${esc(vs.q || '')}"></div></div>
        <div id="bhBody"></div>
      </div>`;
    const dir = peopleDir();
    const dlist = (id, rows) => { let d = document.getElementById(id); if (!d) { d = document.createElement('datalist'); d.id = id; document.body.appendChild(d); } d.innerHTML = rows.map(o => `<option value="${esc(o[0])}">${esc(o[1] || '')}</option>`).join(''); };
    dlist('dl-NAME', [...new Set(Object.values(dir.byMsnv))].map(nm => [nm, dir.byName[nm.toLowerCase()]]));
    dlist('dl-MSNV', Object.keys(dir.byMsnv).map(m => [m, dir.byMsnv[m]]));
    const draw = () => {
      const q = (vs.q || '').trim().toLowerCase();
      const list = all.filter(x => (vs.bf === 'all' || (vs.bf === 'out' && x.out) || (vs.bf === 'free' && !x.out && !x.broken) || (vs.bf === 'broken' && x.broken))
        && (!vs.bt || x.type === vs.bt) && (!q || `${x.code} ${x.who} ${x.msnv}`.toLowerCase().includes(q)))
        .sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code, 'vi', { numeric: true }));
      $('#bhBody').innerHTML = list.length ? `<div class="tbl-wrap"><table class="tbl bhld"><thead><tr><th class="code">Mã số</th><th>Loại</th><th>Kho</th><th>Người đang giữ</th><th>MSNV</th><th>Bộ phận</th><th class="date">Ngày nhận</th><th>Tình trạng</th><th></th></tr></thead><tbody>
        ${list.map(x => `<tr data-r="${x.r}" class="${x.out ? 'is-out' : ''}">
          <td class="code">${esc(x.code)}</td><td class="nowrap">${esc(x.type)}</td><td>${esc(x.kho)}</td>
          <td><input class="input bh-who" value="${esc(x.who)}" list="dl-NAME" placeholder="Gõ tên nhân viên…" ${edit ? '' : 'disabled'}></td>
          <td><input class="input bh-msnv" value="${esc(x.msnv)}" list="dl-MSNV" placeholder="MSNV" ${edit ? '' : 'disabled'}></td>
          <td>${esc(x.dept)}</td><td class="date">${x.recv ? dmy(isoOf(x.recv)) : ''}</td>
          <td><select class="select bh-cond" ${edit ? '' : 'disabled'}>${['Tốt', 'Cũ', 'Hư', 'Mất'].map(o => `<option ${o === x.cond ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
          <td class="rowact">${x.out ? '<button class="btn sm need-edit" data-back>↩ Thu hồi</button>' : '<span class="chip green">Trong kho</span>'}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">${all.length ? 'Không có dòng phù hợp.' : 'Chưa có nón / áo trong danh sách. Bấm “＋ Thêm nón / áo” để tạo danh sách (VD: 30 nón bảo hộ kho HCM20).'}</div>`;
      $$('#bhBody tr[data-r]').forEach(tr => {
        const r = +tr.dataset.r, x = all.find(i => i.r === r), whoEl = $('.bh-who', tr), mEl = $('.bh-msnv', tr);
        const commit = (who, msnv) => {
          who = who.trim(); msnv = msnv.trim();
          if (who === x.who && msnv === x.msnv) return;
          const changes = [{ row: r, col: BH.who, value: who }, { row: r, col: BH.msnv, value: msnv }];
          if (who && who !== x.who) changes.push({ row: r, col: BH.recv, value: isoOf(new Date()) });
          if (!who) changes.push({ row: r, col: BH.recv, value: '' }, { row: r, col: BH.dept, value: '' });
          enqueue('update', { sheet: name, changes });
          toast(who ? `${x.code} → ${who}${msnv ? ' (' + msnv + ')' : ''}` : `Đã thu hồi ${x.code} về kho`);
          route(true);
        };
        whoEl.addEventListener('change', () => {
          const m = dir.byName[whoEl.value.trim().toLowerCase()];
          commit(whoEl.value, whoEl.value.trim() ? (m || (whoEl.value.trim() === x.who ? x.msnv : mEl.value)) : '');
        });
        mEl.addEventListener('change', () => {
          const nm = dir.byMsnv[mEl.value.trim().toUpperCase()];
          commit(nm || whoEl.value, mEl.value);
        });
        [whoEl, mEl].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); }));
        $('.bh-cond', tr).addEventListener('change', e => { enqueue('update', { sheet: name, changes: [{ row: r, col: BH.cond, value: e.target.value }] }); toast(`${x.code}: ${e.target.value}`); route(true); });
        const back = $('[data-back]', tr);
        if (back) back.onclick = () => { if (confirm(`Thu hồi ${x.code} từ ${x.who} về kho?`)) commit('', ''); };
      });
    };
    draw();
    $$('[data-bf]', view).forEach(b => b.onclick = () => { vs.bf = b.dataset.bf; renderBhld(view, name); });
    $('#bhType').onchange = e => { vs.bt = e.target.value; draw(); };
    $('#bhq').addEventListener('input', debounce(e => { vs.q = e.target.value; draw(); }, 200));
    $('#bhRaw').onclick = () => { vs.raw = true; route(true); };
    $('#bhAdd').onclick = () => openBhldAdd(name);
    $('#bhCsv').onclick = () => {
      const q = s2 => `"${String(s2).replace(/"/g, '""')}"`, list = all;
      const lines = [['Mã số', 'Loại', 'Kho', 'Người đang giữ', 'MSNV', 'Bộ phận', 'Ngày nhận', 'Tình trạng', 'Ghi chú'].map(q).join(',')]
        .concat(list.map(x => [x.code, x.type, x.kho, x.who, x.msnv, x.dept, x.recv ? dmy(isoOf(x.recv)) : '', x.cond, x.note].map(q).join(',')));
      download(`DS_BHLD${k ? '_' + k : ''}_${isoOf(new Date())}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    };
  }

  /** Thêm nhiều nón / áo vào danh sách, mã số tự đánh: NON-20-001, AO-ST-001… */
  function openBhldAdd(name) {
    const k = state.kho === 'ALL' ? 'HCM20' : state.kho;
    const m = modal(`<h3>＋ Thêm nón / áo vào danh sách</h3>
      <div class="form" style="margin-top:4px">
        <div class="field"><label for="baT">Loại</label><select class="select" id="baT"><option>Nón bảo hộ</option><option>Áo phản quang</option></select></div>
        <div class="field"><label for="baK">Kho</label><select class="select" id="baK">${KHO_CODES.map(c => `<option ${c === k ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="baN">Số lượng</label><input class="input" id="baN" type="number" min="1" max="300" value="10"></div>
        <div class="field"><label for="baS">Mã bắt đầu</label><input class="input" id="baS"></div>
      </div>
      <p class="note-line" id="baPrev"></p>
      <div class="row"><button class="btn" id="baCancel" type="button">Hủy</button><button class="btn primary" id="baOk" type="button">＋ Thêm vào danh sách</button></div>`);
    const pre = () => `${BH_PREFIX[m.$('#baT').value]}-${khoShort(m.$('#baK').value)}-`;
    const nextNo = () => { let max = 0; bhldList(name).forEach(x => { if (x.code.startsWith(pre())) max = Math.max(max, Number(x.code.slice(pre().length)) || 0); }); return max + 1; };
    const prev = () => {
      const n = Math.max(1, Math.min(300, +m.$('#baN').value || 1)), s0 = Number((String(m.$('#baS').value).match(/(\d+)\s*$/) || [])[1]) || nextNo();
      m.$('#baPrev').textContent = `Sẽ tạo ${n} dòng: ${pre()}${String(s0).padStart(3, '0')} → ${pre()}${String(s0 + n - 1).padStart(3, '0')}, tình trạng “Tốt”, đang ở kho.`;
    };
    const reset = () => { m.$('#baS').value = pre() + String(nextNo()).padStart(3, '0'); prev(); };
    m.$('#baT').onchange = reset; m.$('#baK').onchange = reset; m.$('#baN').oninput = prev; m.$('#baS').oninput = prev;
    reset();
    m.$('#baCancel').onclick = m.close;
    m.$('#baOk').onclick = () => {
      const n = Math.max(1, Math.min(300, +m.$('#baN').value || 1)), s0 = Number((String(m.$('#baS').value).match(/(\d+)\s*$/) || [])[1]) || nextNo();
      const used = new Set(bhldList(name).map(x => x.code.toUpperCase()));
      const rows = [];
      for (let i = 0; i < n; i++) {
        const code = pre() + String(s0 + i).padStart(3, '0');
        if (used.has(code.toUpperCase())) { toast(`Mã ${code} đã có trong danh sách`, 'warn'); return; }
        rows.push({ [BH.code]: code, [BH.type]: m.$('#baT').value, [BH.kho]: m.$('#baK').value, [BH.cond]: 'Tốt' });
      }
      enqueue('appendMany', { sheet: name, rows, dataStart: 5, lastCol: 9 });
      toast(`Đã thêm ${n} ${m.$('#baT').value.toLowerCase()} vào danh sách`);
      m.close(); route(true);
    };
  }

  /* ------------------------------------------------------------------ TASK – Dành cho Quản lý
   * Dữ liệu ở tab QL_TASK của Google Sheet (Apps Script tự tạo tab ở lần ghi đầu tiên).
   * Chống bỏ sót: bắt buộc người phụ trách + hạn chót, nhóm theo hạn (quá hạn đứng đầu),
   * cảnh báo ở menu / Tổng quan / trang kho, checklist con với % hoàn thành. */
  const TASK = 'QL_TASK';
  const TK = { id: 1, title: 2, desc: 3, kho: 4, owner: 5, by: 6, prio: 7, start: 8, due: 9, status: 10, check: 11, doneAt: 12, note: 13, upd: 14 };
  const T_HEAD = ['Mã task', 'Tiêu đề', 'Mô tả', 'Kho', 'Người phụ trách', 'Người giao', 'Ưu tiên', 'Ngày giao', 'Hạn chót', 'Trạng thái', 'Checklist', 'Ngày hoàn thành', 'Kết quả / ghi chú', 'Cập nhật lần cuối'];
  const T_STATUS = ['Chưa làm', 'Đang làm', 'Chờ duyệt', 'Tạm hoãn', 'Hoàn thành', 'Hủy'];
  const T_DONE = ['Hoàn thành', 'Hủy'];
  const T_PRIO = ['Gấp', 'Cao', 'Trung bình', 'Thấp'];
  const T_KHO = ['Chung', ...KHO_CODES];
  const T_BUCKETS = [
    ['overdue', 'Quá hạn', 'red'], ['today', 'Hôm nay', 'amber'], ['tomorrow', 'Ngày mai', 'amber'],
    ['week', 'Trong 7 ngày tới', 'blue'], ['later', 'Sau đó', ''], ['nodue', 'Chưa có hạn chót – dễ bị sót', 'red'], ['done', 'Đã xong / đã hủy', 'green']
  ];

  /** Tab do web tạo: nếu Sheet chưa có thì dựng bản trống trên máy để vẫn xem/nhập được. */
  function ensureLocalSheets() {
    if (!state.data || !state.data.sheets) return;
    const defs = { [TASK]: { title: 'QUẢN LÝ TASK – CỤM M12', sub: 'Dành cho Quản lý · Mỗi dòng 1 task.', headers: T_HEAD, dv: { D: T_KHO, G: T_PRIO, J: T_STATUS } }, ...(window.AUTO_LOCAL || {}) };
    Object.keys(defs).forEach(n => {
      const d = defs[n];
      if (!state.data.sheets[n]) {
        const row3 = [];
        Object.keys(d.g || {}).forEach(L => { row3[colNum(L) - 1] = d.g[L]; });
        const mask = d.f ? d.headers.map((_, i) => d.f.includes(colLet(i + 1)) ? '1' : '0').join('').replace(/0+$/, '') : '';
        const dv = {};
        Object.keys(d.dv || {}).forEach(L => { dv[L + '5'] = d.dv[L]; });
        // fm: đánh dấu cột công thức ở dòng 5 để web khóa các cột tự tính
        state.data.sheets[n] = { v: [[d.title], [d.sub], row3, d.headers.slice()], fm: ['', '', '', '', mask], dv, local: true };
      }
      const order = state.data.order;
      if (order && !order.includes(n)) {
        const after = (S[n] || {}).after, i = after ? order.indexOf(after) : -1;
        if (i >= 0) order.splice(i + 1, 0, n); else if (n === TASK) order.unshift(n); else order.push(n);
      }
    });
  }

  function parseChecklist(s) {
    return String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).map(line => {
      const m = /^\[( |x|X)\]\s*(.*)$/.exec(line);
      return m ? { done: m[1] !== ' ', text: m[2] } : { done: false, text: line };
    });
  }
  const checklistText = items => items.filter(i => i.text.trim()).map(i => `[${i.done ? 'x' : ' '}] ${i.text.trim()}`).join('\n');

  function taskList() {
    const s = sh(TASK); if (!s) return [];
    const out = [];
    for (let r = 5; r <= s.v.length; r++) {
      const g = c => val(TASK, r, c);
      const title = plain(g(TK.title)).trim();
      if (!title && !plain(g(TK.id))) continue;
      const status = plain(g(TK.status)) || 'Chưa làm';
      out.push({
        r, id: plain(g(TK.id)), title: title || '(chưa có tiêu đề)', desc: plain(g(TK.desc)), kho: plain(g(TK.kho)) || 'Chung',
        owner: plain(g(TK.owner)).trim(), by: plain(g(TK.by)), prio: plain(g(TK.prio)) || 'Trung bình',
        start: toDate(g(TK.start), true), due: toDate(g(TK.due), true), status, items: parseChecklist(plain(g(TK.check))),
        doneAt: toDate(g(TK.doneAt), true), note: plain(g(TK.note)), upd: plain(g(TK.upd)), done: T_DONE.includes(status)
      });
    }
    return out;
  }
  const daysLeft = t => t.due ? Math.round((t.due - today0()) / 86400000) : null;
  function bucketOf(t) {
    if (t.done) return 'done';
    const d = daysLeft(t);
    if (d === null) return 'nodue';
    if (d < 0) return 'overdue';
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    return d <= 7 ? 'week' : 'later';
  }
  const inKhoScope = (t, k) => !k || t.kho === k || t.kho === 'Chung';
  function taskCounts(k) {
    const c = { overdue: 0, today: 0, week: 0, doing: 0, missing: 0, open: 0, doneMonth: 0, onTime: 0 };
    const t0 = today0(), m0 = new Date(t0.getFullYear(), t0.getMonth(), 1);
    taskList().filter(t => inKhoScope(t, k)).forEach(t => {
      const b = bucketOf(t);
      if (!t.done) {
        c.open++;
        if (b === 'overdue') c.overdue++;
        if (b === 'today') c.today++;
        if (b === 'today' || b === 'tomorrow' || b === 'week') c.week++;
        if (t.status === 'Đang làm') c.doing++;
        if (!t.owner || !t.due) c.missing++;
      } else if (t.status === 'Hoàn thành' && t.doneAt && t.doneAt >= m0) {
        c.doneMonth++;
        if (!t.due || t.doneAt <= t.due) c.onTime++;
      }
    });
    return c;
  }
  const meKey = () => String(state.user || '').split(/[\/–]| - /)[0].trim().toLowerCase();
  const isMine = t => { const me = meKey(); return !!me && t.owner.toLowerCase().includes(me); };

  function taskAlert(view, k) {
    if (!sh(TASK)) return;
    const c = taskCounts(k);
    if (!c.overdue && !c.today && !c.missing) return;
    const parts = [];
    if (c.overdue) parts.push(`<b>${c.overdue}</b> quá hạn`);
    if (c.today) parts.push(`<b>${c.today}</b> đến hạn hôm nay`);
    if (c.missing) parts.push(`<b>${c.missing}</b> thiếu người phụ trách / hạn chót`);
    const go = k ? `kho:|${k}|#/sheet/${TASK}` : `#/sheet/${TASK}`;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="task-alert ${c.overdue ? 'red' : ''}" data-go="${esc(go)}" role="link" tabindex="0">${icon('task')}<span>Task${k ? ' · ' + esc(k) : ''}: ${parts.join(' · ')}</span><span class="go">Xem task →</span></div>`;
    view.prepend(wrap);
    bindGo(wrap);
  }

  const tvs = () => state.views.__task || (state.views.__task = { q: '', tab: 'open', group: 'due', owner: '' });

  function renderTasks(view) {
    setCrumb('Task', 'Dành cho Quản lý');
    const vs = tvs(), k = state.kho === 'ALL' ? null : state.kho;
    const all = taskList().filter(t => inKhoScope(t, k));
    const c = taskCounts(k);
    const owners = [...new Set(taskList().map(t => t.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    const tabs = [['open', 'Cần làm', c.open], ['mine', 'Của tôi', null], ['overdue', 'Quá hạn', c.overdue], ['today', 'Hôm nay', c.today], ['week', '7 ngày tới', c.week], ['done', 'Đã xong', null], ['all', 'Tất cả', null]];
    const s = sh(TASK);
    view.innerHTML = `
      <div class="kpis">
        ${kpi('Quá hạn', c.overdue, 'Chưa xong, đã qua hạn chót', c.overdue ? 'red' : 'green')}
        ${kpi('Đến hạn hôm nay', c.today, `${c.week} task trong 7 ngày tới`, c.today ? 'amber' : '')}
        ${kpi('Đang làm', c.doing, `${c.open} task chưa xong`, 'blue')}
        ${kpi('Dễ bị sót', c.missing, 'Thiếu người phụ trách hoặc hạn chót', c.missing ? 'red' : 'green')}
        ${kpi('Hoàn thành tháng này', c.doneMonth, c.doneMonth ? `${Math.round(c.onTime / c.doneMonth * 100)}% đúng hạn` : 'Chưa có', 'green')}
      </div>
      <div class="card mt">
        <div class="card-h"><div><h3>Danh sách task</h3><div class="sub" style="margin-top:3px">Quá hạn luôn ở trên cùng · bấm vào task để xem chi tiết, checklist và ảnh${s && s.local ? ' · <b>Sheet chưa có tab QL_TASK – sẽ tự tạo khi thêm task đầu tiên</b>' : ''}</div></div>
          <div class="right">${k ? `<span class="chip brand">Đang lọc kho: ${esc(k)} + Chung</span>` : ''}<button class="btn primary need-edit" id="tNew">＋ Task mới</button></div></div>
        <div class="toolbar">
          <div class="tabs">${tabs.filter(t => t[0] !== 'mine' || meKey()).map(t => `<button class="tab ${vs.tab === t[0] ? 'active' : ''}" data-tab="${t[0]}">${t[1]}${t[2] ? ` <span class="tcount">${t[2]}</span>` : ''}</button>`).join('')}</div>
        </div>
        <div class="toolbar">
          <div class="search"><input class="input" id="tq" placeholder="Tìm task, mô tả, checklist…" value="${esc(vs.q)}"></div>
          <select class="select" id="tOwner"><option value="">Mọi người phụ trách</option>${owners.map(o => `<option ${vs.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
          <div class="right"><label class="muted" for="tGroup" style="font-size:12.5px">Nhóm theo</label>
            <select class="select" id="tGroup">${[['due', 'Hạn chót'], ['owner', 'Người phụ trách'], ['kho', 'Kho'], ['status', 'Trạng thái'], ['prio', 'Ưu tiên']].map(o => `<option value="${o[0]}" ${vs.group === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
            <button class="btn" id="tCsv" title="Xuất toàn bộ task ra Excel (CSV)">⭳ Xuất Excel</button></div>
        </div>
        <div id="tBody"></div>
      </div>`;
    const draw = () => { $('#tBody').innerHTML = taskGroupsHtml(filterTasks(all, vs), vs.group); bindTaskItems(); };
    draw();
    $$('[data-tab]', view).forEach(b => b.onclick = () => { vs.tab = b.dataset.tab; renderTasks(view); });
    $('#tq').addEventListener('input', debounce(e => { vs.q = e.target.value; draw(); }, 200));
    $('#tOwner').onchange = e => { vs.owner = e.target.value; draw(); };
    $('#tGroup').onchange = e => { vs.group = e.target.value; draw(); };
    $('#tNew').onclick = () => openTaskDrawer(null);
    $('#tCsv').onclick = () => exportCSV(tableDef(TASK));
  }

  function filterTasks(list, vs) {
    const q = vs.q.trim().toLowerCase();
    return list.filter(t => {
      const b = bucketOf(t);
      if (vs.tab === 'open' && t.done) return false;
      if (vs.tab === 'mine' && (t.done || !isMine(t))) return false;
      if (vs.tab === 'overdue' && b !== 'overdue') return false;
      if (vs.tab === 'today' && b !== 'today') return false;
      if (vs.tab === 'week' && !['today', 'tomorrow', 'week'].includes(b)) return false;
      if (vs.tab === 'done' && !t.done) return false;
      if (vs.owner && t.owner !== vs.owner) return false;
      if (q && ![t.id, t.title, t.desc, t.owner, t.note, t.items.map(i => i.text).join(' ')].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function taskSort(a, b) {
    const pa = T_PRIO.indexOf(a.prio), pb = T_PRIO.indexOf(b.prio);
    const da = a.due ? +a.due : Infinity, db = b.due ? +b.due : Infinity;
    return (a.done - b.done) || (da - db) || (pa - pb) || (a.r - b.r);
  }

  function taskGroupsHtml(list, group) {
    if (!list.length) return '<div class="empty">Không có task nào trong mục này. 🎉</div>';
    let groups;
    if (group === 'due') groups = T_BUCKETS.map(([key, label, cls]) => ({ label, cls, items: list.filter(t => bucketOf(t) === key) }));
    else {
      const keyOf = t => group === 'owner' ? (t.owner || '⚠ Chưa giao người') : group === 'kho' ? t.kho : group === 'status' ? t.status : t.prio;
      const order = group === 'status' ? T_STATUS : group === 'prio' ? T_PRIO : group === 'kho' ? T_KHO : null;
      const keys = [...new Set(list.map(keyOf))].sort((a, b) => order ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b, 'vi'));
      groups = keys.map(key => ({ label: key, cls: key.startsWith('⚠') ? 'red' : '', items: list.filter(t => keyOf(t) === key) }));
    }
    return groups.filter(g => g.items.length).map(g => `
      <div class="tgroup"><div class="tgroup-h"><span class="chip ${g.cls}">${esc(g.label)}</span><span class="muted">${g.items.length} task</span></div>
      <ul class="list">${g.items.sort(taskSort).map(taskItemHtml).join('')}</ul></div>`).join('');
  }

  function taskItemHtml(t) {
    const d = daysLeft(t), b = bucketOf(t);
    const dueTxt = !t.due ? '<span class="chip red">Chưa có hạn</span>'
      : `<span class="${b === 'overdue' ? 'late' : ''}">📅 ${dmy(isoOf(t.due))}${t.done ? '' : d < 0 ? ` · trễ ${-d} ngày` : d === 0 ? ' · hôm nay' : d === 1 ? ' · ngày mai' : ` · còn ${d} ngày`}</span>`;
    const n = t.items.length, nd = t.items.filter(i => i.done).length;
    const prioCls = t.prio === 'Gấp' ? 'red' : t.prio === 'Cao' ? 'amber' : '';
    const imgs = state.images.filter(im => im.sheet === TASK && +im.row === t.r).length;
    return `<li class="task-item ${b === 'overdue' ? 'is-late' : ''} ${t.done ? 'is-done' : ''}" data-r="${t.r}">
      <button class="tcheck need-edit ${t.done ? 'on' : ''}" data-done="${t.r}" title="${t.done ? 'Mở lại task' : 'Đánh dấu hoàn thành'}" aria-label="${t.done ? 'Mở lại task' : 'Đánh dấu hoàn thành'}">${t.done ? '✓' : ''}</button>
      <div class="grow">
        <div class="t">${t.id ? `<span class="muted">${esc(t.id)}</span> ` : ''}${esc(t.title)}</div>
        <div class="tmeta">
          <span class="chip ${chipClass(t.status) || ''}">${esc(t.status)}</span>
          ${t.prio !== 'Trung bình' ? `<span class="chip ${prioCls}">${esc(t.prio)}</span>` : ''}
          <span class="chip" ${khoInfo(t.kho).color && t.kho !== 'Chung' ? `style="border-color:${khoInfo(t.kho).color}"` : ''}>${esc(t.kho)}</span>
          ${t.owner ? `<span>👤 ${esc(t.owner)}</span>` : '<span class="chip red">Chưa giao người</span>'}
          ${dueTxt}
          ${n ? `<span class="tprog" title="Checklist ${nd}/${n}"><i style="width:${Math.round(nd / n * 100)}%"></i></span><span>${nd}/${n}</span>` : ''}
          ${imgs ? `<span>📷 ${imgs}</span>` : ''}
        </div>
      </div></li>`;
  }

  function bindTaskItems() {
    $$('#tBody .task-item').forEach(li => li.addEventListener('click', e => { if (e.target.closest('[data-done]')) return; openTaskDrawer(+li.dataset.r); }));
    $$('#tBody [data-done]').forEach(b => b.onclick = () => {
      const t = taskList().find(x => x.r === +b.dataset.done); if (!t) return;
      if (!t.done && t.status === 'Chờ duyệt' && !canApprove()) { toast('Task đang Chờ duyệt – chỉ Người duyệt yêu cầu mới duyệt hoàn thành được', 'warn'); return; }
      if (!t.done) {
        const left = t.items.filter(i => !i.done).length;
        if (left && !confirm(`Checklist còn ${left} bước chưa xong. Vẫn đánh dấu hoàn thành?`)) return;
        saveTask(t.r, { [TK.status]: 'Hoàn thành', [TK.doneAt]: isoOf(new Date()) });
        toast('Đã hoàn thành: ' + t.title);
      } else {
        saveTask(t.r, { [TK.status]: 'Đang làm', [TK.doneAt]: '' });
        toast('Đã mở lại task');
      }
      route(true);
    });
  }

  function stampNow() { const d = new Date(); return `${dmy(isoOf(d))} ${pad(d.getHours())}:${pad(d.getMinutes())} · ${state.user || 'Không tên'}`; }

  function nextTaskId() {
    let max = 0;
    taskList().forEach(t => { const m = /^T-(\d+)$/.exec(t.id); if (m) max = Math.max(max, +m[1]); });
    return 'T-' + String(max + 1).padStart(4, '0');
  }

  /** Ghi task: r = null → thêm mới; fields = { cột: giá trị } */
  function saveTask(r, fields) {
    fields = { ...fields, [TK.upd]: stampNow() };
    if (!r) {
      const values = {};
      Object.keys(fields).forEach(c => { if (fields[c] !== '' && fields[c] != null) values[c] = fields[c]; });
      const op = enqueue('append', { sheet: TASK, values, dataStart: 5, lastCol: T_HEAD.length });
      return op.payload._row;
    }
    const changes = [];
    Object.keys(fields).forEach(c => {
      const cur = val(TASK, r, +c), ft = [TK.start, TK.due, TK.doneAt].includes(+c) ? { t: 'date' } : { t: 'text' };
      if (String(fields[c]) !== String(inputValue(cur, ft))) changes.push({ row: r, col: +c, value: fields[c] });
    });
    if (changes.length > 1 || (changes.length && changes[0].col !== TK.upd)) enqueue('update', { sheet: TASK, changes });
    return r;
  }

  function openTaskDrawer(r, preset) {
    const t = r ? taskList().find(x => x.r === r) : null;
    const isNew = !t, k = state.kho === 'ALL' ? 'Chung' : state.kho;
    const owners = [...new Set(taskList().map(x => x.owner).filter(Boolean))];
    const v = {
      title: t ? t.title : '', desc: t ? t.desc : '', kho: t ? t.kho : k, owner: t ? t.owner : '', by: t ? t.by : (state.user || ''),
      prio: t ? t.prio : 'Trung bình', start: t && t.start ? isoOf(t.start) : isoOf(new Date()), due: t && t.due ? isoOf(t.due) : '',
      status: t ? t.status : 'Chưa làm', note: t ? t.note : '', ...(preset || {})
    };
    let items = t ? t.items.map(i => ({ ...i })) : [];
    const opt = (list, cur) => list.map(o => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('') + (cur && !list.includes(cur) ? `<option selected>${esc(cur)}</option>` : '');
    const body = `
      ${t ? `<div class="muted" style="margin-bottom:12px">${esc(t.id || 'Dòng ' + t.r)}${t.upd ? ' · cập nhật ' + esc(t.upd) : ''}${t.doneAt ? ' · hoàn thành ' + dmy(isoOf(t.doneAt)) : ''}</div>` : ''}
      <div class="form">
        <div class="field full"><label for="tTitle">Tiêu đề task <span class="req">*</span></label><input class="input" id="tTitle" value="${esc(v.title)}" placeholder="VD: Kiểm kê tháng 11 – kho TK"></div>
        <div class="field"><label for="tOwnerI">Người phụ trách <span class="req">*</span></label><input class="input" id="tOwnerI" list="dl-owner" value="${esc(v.owner)}" placeholder="Họ tên"><datalist id="dl-owner">${owners.map(o => `<option value="${esc(o)}">`).join('')}</datalist></div>
        <div class="field"><label for="tDue">Hạn chót <span class="req">*</span></label><input class="input" id="tDue" type="date" value="${esc(v.due)}">
          <div class="quick-due">${[['Hôm nay', 0], ['Ngày mai', 1], ['+3 ngày', 3], ['+7 ngày', 7], ['Cuối tháng', 'eom']].map(q => `<button type="button" class="btn sm" data-due="${q[1]}">${q[0]}</button>`).join('')}</div></div>
        <div class="field"><label for="tStatus">Trạng thái</label><select class="select" id="tStatus">${opt(T_STATUS, v.status)}</select></div>
        <div class="field"><label for="tPrio">Ưu tiên</label><select class="select" id="tPrio">${opt(T_PRIO, v.prio)}</select></div>
        <div class="field"><label for="tKho">Kho</label><select class="select" id="tKho">${opt(T_KHO, v.kho)}</select></div>
        <div class="field"><label for="tBy">Người giao</label><input class="input" id="tBy" value="${esc(v.by)}"></div>
        <div class="field"><label for="tStart">Ngày giao</label><input class="input" id="tStart" type="date" value="${esc(v.start)}"></div>
        <div class="field full"><label for="tDesc">Mô tả / yêu cầu</label><textarea id="tDesc" placeholder="Cần làm gì, kết quả mong muốn">${esc(v.desc)}</textarea></div>
      </div>
      <div class="sec-title">☑ Checklist các bước <span class="chip" id="ckCount"></span></div>
      <div class="tprog big"><i id="ckBar"></i></div>
      <div id="ckList"></div>
      <div class="ck-add"><input class="input" id="ckNew" placeholder="Thêm bước… (Enter để thêm)"><button class="btn" id="ckAddBtn" type="button">＋ Thêm bước</button></div>
      <div class="form mt"><div class="field full"><label for="tNote">Kết quả / ghi chú</label><textarea id="tNote" placeholder="Kết quả, vướng mắc, link tài liệu…">${esc(v.note)}</textarea></div></div>
      ${t ? `<div class="sec-title" id="imgSec">📷 Hình ảnh / bằng chứng <span class="chip" id="imgCount"></span></div>
        <div class="gallery" id="imgGrid"></div>
        <label class="upload mt need-edit" id="upl"><input type="file" accept="image/*" multiple id="imgInput"><b>Bấm để chọn ảnh</b> hoặc kéo thả vào đây<br><small>Trên điện thoại có thể chụp trực tiếp · ảnh tự nén ≤ 1600px</small></label>` : ''}`;
    openDrawer(isNew ? 'Task mới' : 'Chi tiết task', body,
      `${t ? '<button class="btn danger need-edit" id="tDel">🗑 Xóa task</button>' : ''}<span style="flex:1"></span>${t && t.status === 'Chờ duyệt' && canApprove() ? '<button class="btn primary" id="tApprove">✓ Duyệt hoàn thành</button>' : ''}<button class="btn" data-close>Đóng</button><button class="btn primary need-edit" id="tSave">${isNew ? '＋ Tạo task' : '💾 Lưu'}</button>`);

    const drawCk = () => {
      const n = items.length, nd = items.filter(i => i.done).length;
      $('#ckCount').textContent = n ? `${nd}/${n} · ${Math.round(nd / n * 100)}%` : 'chưa có bước';
      $('#ckBar').style.width = n ? Math.round(nd / n * 100) + '%' : '0';
      $('#ckList').innerHTML = items.map((i, idx) => `<div class="ck ${i.done ? 'on' : ''}"><input type="checkbox" data-i="${idx}" ${i.done ? 'checked' : ''} aria-label="Đánh dấu xong bước ${idx + 1}"><input class="input ck-t" data-t="${idx}" value="${esc(i.text)}"><button type="button" class="icon-btn ck-del" data-x="${idx}" title="Xóa bước" aria-label="Xóa bước">✕</button></div>`).join('') || '<div class="muted" style="padding:4px 0 8px">Chia task thành các bước nhỏ để không sót việc.</div>';
      $$('#ckList [data-i]').forEach(cb => cb.onchange = () => { items[+cb.dataset.i].done = cb.checked; drawCk(); });
      $$('#ckList [data-t]').forEach(inp => inp.oninput = () => { items[+inp.dataset.t].text = inp.value; });
      $$('#ckList [data-x]').forEach(b => b.onclick = () => { items.splice(+b.dataset.x, 1); drawCk(); });
    };
    ['tTitle', 'tOwnerI', 'tDue'].forEach(id => $('#' + id).addEventListener('input', e => e.target.classList.remove('bad')));
    const addCk = () => { const el = $('#ckNew'); const s = el.value.trim(); if (!s) return; items.push({ done: false, text: s }); el.value = ''; drawCk(); el.focus(); };
    drawCk();
    $('#ckAddBtn').onclick = addCk;
    $('#ckNew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCk(); } });
    $$('[data-due]').forEach(b => b.onclick = () => {
      const d = today0();
      if (b.dataset.due === 'eom') d.setMonth(d.getMonth() + 1, 0); else d.setDate(d.getDate() + Number(b.dataset.due));
      $('#tDue').value = isoOf(d);
    });

    $('#tSave').onclick = () => {
      const f = {
        [TK.title]: $('#tTitle').value.trim(), [TK.desc]: $('#tDesc').value.trim(), [TK.kho]: $('#tKho').value, [TK.owner]: $('#tOwnerI').value.trim(),
        [TK.by]: $('#tBy').value.trim(), [TK.prio]: $('#tPrio').value, [TK.start]: $('#tStart').value, [TK.due]: $('#tDue').value,
        [TK.status]: $('#tStatus').value, [TK.check]: checklistText(items), [TK.note]: $('#tNote').value.trim()
      };
      const miss = [];
      if (!f[TK.title]) miss.push(['tTitle', 'tiêu đề']);
      if (!f[TK.owner]) miss.push(['tOwnerI', 'người phụ trách']);
      if (!f[TK.due]) miss.push(['tDue', 'hạn chót']);
      $$('.input.bad', $('#drawerBody')).forEach(el => el.classList.remove('bad'));
      if (miss.length) {
        miss.forEach(m => $('#' + m[0]).classList.add('bad'));
        toast('Cần nhập ' + miss.map(m => m[1]).join(', ') + ' để task không bị sót', 'warn');
        $('#' + miss[0][0]).focus();
        return;
      }
      if (t && t.status === 'Chờ duyệt' && f[TK.status] === 'Hoàn thành' && !canApprove()) { toast('Task đang Chờ duyệt – chỉ Người duyệt yêu cầu mới duyệt hoàn thành được', 'warn'); return; }
      const wasDone = t && t.done, nowDone = T_DONE.includes(f[TK.status]);
      if (nowDone && !wasDone) {
        const left = items.filter(i => !i.done && i.text.trim()).length;
        if (f[TK.status] === 'Hoàn thành' && left && !confirm(`Checklist còn ${left} bước chưa xong. Vẫn lưu là Hoàn thành?`)) return;
        f[TK.doneAt] = isoOf(new Date());
      } else if (!nowDone && wasDone) f[TK.doneAt] = '';
      if (isNew) { f[TK.id] = nextTaskId(); saveTask(null, f); toast(`Đã tạo task ${f[TK.id]}`); }
      else { saveTask(t.r, f); toast('Đã lưu task'); }
      closeDrawer(); route(true);
    };
    // Người duyệt (kể cả vai trò Người xem): duyệt hoàn thành task đang Chờ duyệt – chỉ ghi Trạng thái + Ngày hoàn thành
    if ($('#tApprove')) $('#tApprove').onclick = () => {
      saveTask(t.r, { [TK.status]: 'Hoàn thành', [TK.doneAt]: isoOf(new Date()) });
      toast('✓ Đã duyệt hoàn thành: ' + t.title); closeDrawer(); route(true);
    };
    if ($('#tDel')) $('#tDel').onclick = () => {
      if (!confirm(`Xóa task “${t.title}”?\nDòng ${t.r} trên tab QL_TASK sẽ được xóa nội dung.`)) return;
      enqueue('clearRow', { sheet: TASK, row: t.r, lastCol: T_HEAD.length });
      toast('Đã xóa task'); closeDrawer(); route(true);
    };
    if (t) { drawImages(TASK, t.r); bindUpload(tableDef(TASK), t.r); }
    setTimeout(() => $('#tTitle').focus(), 250);
  }

  /* ------------------------------------------------------------------ DỊCH VỤ MUA NGOÀI – Dành cho Quản lý
   * Tab DV_MUA_NGOAI. Quy trình: Đang báo giá → Chờ duyệt → Đã duyệt → Đang thực hiện → Chờ nghiệm thu → Hoàn thành
   * (nhánh dừng: Từ chối / Hủy). Giải trình bắt buộc khi quá hạn / trễ, vượt chi phí, từ chối hoặc hủy. */
  const DVS = 'DV_MUA_NGOAI';
  const DV = { id: 1, date: 2, kho: 3, type: 4, level: 5, title: 6, detail: 7, dept: 8, req: 9, handler: 10, approver: 11,
    stage: 12, apprAt: 13, start: 14, due: 15, doneAt: 16, vendor: 17, est: 18, cost: 19, explain: 20, docs: 21, dueState: 22, upd: 23 };
  const DV_NCOL = 23;
  const DV_FLOW = ['Đang báo giá', 'Chờ duyệt', 'Đã duyệt', 'Đang thực hiện', 'Chờ nghiệm thu', 'Hoàn thành'];
  const DV_STOP = ['Từ chối', 'Hủy'];
  const DV_STAGES = [...DV_FLOW, ...DV_STOP];
  const DV_TYPES = ['Dịch vụ', 'CCDC ngoài hệ thống', 'Sửa chữa', 'Khác'];
  const DV_LEVELS = ['Khẩn cấp', 'Cao', 'Bình thường'];
  const dvStageCls = s => s === 'Hoàn thành' ? 'green' : DV_STOP.includes(s) ? '' : s === 'Chờ duyệt' ? 'amber' : s === 'Đang báo giá' ? 'blue' : 'brand';
  const money = n => n ? Math.round(n).toLocaleString('vi-VN') + ' đ' : '—';

  function dvList() {
    const s = sh(DVS); if (!s) return [];
    const out = [];
    for (let r = 5; r <= s.v.length; r++) {
      const g = c => plain(val(DVS, r, c)), d = c => toDate(val(DVS, r, c), true);
      const title = g(DV.title).trim(); if (!title && !g(DV.id)) continue;
      const stage = g(DV.stage) || 'Đang báo giá';
      const x = { r, id: g(DV.id), date: d(DV.date), kho: g(DV.kho) || 'Chung', type: g(DV.type), level: g(DV.level) || 'Bình thường', title: title || '(chưa có nội dung)',
        detail: g(DV.detail), dept: g(DV.dept), req: g(DV.req), handler: g(DV.handler), approver: g(DV.approver), stage, apprAt: d(DV.apprAt),
        start: d(DV.start), due: d(DV.due), doneAt: d(DV.doneAt), vendor: g(DV.vendor), est: num(val(DVS, r, DV.est) || 0), cost: num(val(DVS, r, DV.cost) || 0),
        explain: g(DV.explain), docs: g(DV.docs), upd: g(DV.upd) };
      x.closed = stage === 'Hoàn thành' || DV_STOP.includes(stage);
      const t0 = today0();
      x.left = x.due ? Math.round((x.due - t0) / 86400000) : null;
      x.late = !x.closed && x.due && x.left < 0;
      x.lateDone = stage === 'Hoàn thành' && x.due && x.doneAt && x.doneAt > x.due ? Math.round((x.doneAt - x.due) / 86400000) : 0;
      x.over = x.est > 0 && x.cost > x.est;
      x.needExplain = (x.late || x.lateDone || x.over || DV_STOP.includes(stage)) && !x.explain.trim();
      out.push(x);
    }
    return out;
  }
  function dvCounts(k) {
    const t0 = today0(), m0 = new Date(t0.getFullYear(), t0.getMonth(), 1);
    const L = dvList().filter(x => !k || x.kho === k || x.kho === 'Chung');
    const doneM = L.filter(x => x.stage === 'Hoàn thành' && x.doneAt && x.doneAt >= m0);
    return {
      open: L.filter(x => !x.closed).length, wait: L.filter(x => x.stage === 'Chờ duyệt').length, late: L.filter(x => x.late).length,
      soon: L.filter(x => !x.closed && x.left !== null && x.left >= 0 && x.left <= 3).length, explain: L.filter(x => x.needExplain).length,
      doneM: doneM.length, onTime: doneM.filter(x => !x.lateDone).length, costM: doneM.reduce((a, x) => a + (x.cost || x.est), 0),
      pipeline: L.filter(x => !x.closed).reduce((a, x) => a + (x.cost || x.est), 0)
    };
  }
  function dvAlert(view, k) {
    if (!sh(DVS)) return;
    const c = dvCounts(k);
    if (!c.late && !c.wait) return;
    const parts = [];
    if (c.late) parts.push(`<b>${c.late}</b> quá hạn timeline`);
    if (c.wait) parts.push(`<b>${c.wait}</b> chờ duyệt`);
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="task-alert ${c.late ? 'red' : ''}" data-go="${esc(k ? `kho:|${k}|#/sheet/${DVS}` : '#/sheet/' + DVS)}" role="link" tabindex="0">${icon('service')}<span>Dịch vụ mua ngoài${k ? ' · ' + esc(k) : ''}: ${parts.join(' · ')}</span><span class="go">Xem →</span></div>`;
    view.prepend(wrap); bindGo(wrap);
  }

  const dvvs = () => state.views.__dv || (state.views.__dv = { q: '', tab: 'open', group: 'stage' });

  function renderDV(view) {
    setCrumb('Dịch vụ mua ngoài', 'Dành cho Quản lý');
    const vs = dvvs(), k = state.kho === 'ALL' ? null : state.kho, c = dvCounts(k);
    const all = dvList().filter(x => !k || x.kho === k || x.kho === 'Chung');
    const s = sh(DVS);
    const tabs = [['open', 'Đang xử lý', c.open], ['wait', 'Chờ duyệt', c.wait], ['late', 'Quá hạn', c.late], ['explain', 'Thiếu giải trình', c.explain], ['done', 'Hoàn thành', null], ['stop', 'Từ chối / Hủy', null], ['all', 'Tất cả', null]];
    view.innerHTML = `
      <div class="kpis">
        ${kpi('Đang xử lý', c.open, `Giá trị: ${money(c.pipeline)}`, 'blue')}
        ${kpi('Chờ duyệt', c.wait, 'Cần người duyệt xử lý', c.wait ? 'amber' : 'green')}
        ${kpi('Quá hạn timeline', c.late, `${c.soon} yêu cầu đến hạn trong 3 ngày`, c.late ? 'red' : 'green')}
        ${kpi('Thiếu giải trình', c.explain, 'Trễ hạn / vượt chi phí / từ chối / hủy', c.explain ? 'red' : 'green')}
        ${kpi('Hoàn thành tháng này', c.doneM, c.doneM ? `${Math.round(c.onTime / c.doneM * 100)}% đúng hạn · ${money(c.costM)}` : 'Chưa có', 'green')}
      </div>
      <div class="card mt">
        <div class="card-h"><div><h3>Yêu cầu dịch vụ / mua ngoài</h3><div class="sub" style="margin-top:3px">Mua CCDC ngoài hệ thống kho, dịch vụ nhà cung cấp (vệ sinh máy lạnh, xịt côn trùng, sửa chữa…). Bấm vào yêu cầu để xem chi tiết, duyệt và cập nhật tiến độ.${s && s.local ? ' · <b class="warn-text">Tab chưa có trên Google Sheet – tự tạo khi có yêu cầu đầu tiên.</b>' : ''}</div></div>
          <div class="right">${k ? `<span class="chip brand">Đang lọc kho: ${esc(k)} + Chung</span>` : ''}<button class="btn primary need-edit" id="dvNew">＋ Yêu cầu mới</button></div></div>
        <div class="toolbar"><div class="tabs">${tabs.map(t => `<button class="tab ${vs.tab === t[0] ? 'active' : ''}" data-tab="${t[0]}">${t[1]}${t[2] ? ` <span class="tcount">${t[2]}</span>` : ''}</button>`).join('')}</div></div>
        <div class="toolbar">
          <div class="search"><input class="input" id="dvq" placeholder="Tìm nội dung, bộ phận, người thực hiện, người duyệt, nhà cung cấp…" value="${esc(vs.q)}"></div>
          <div class="right"><label class="muted" for="dvGroup" style="font-size:12.5px">Nhóm theo</label>
            <select class="select" id="dvGroup">${[['stage', 'Tiến độ'], ['kho', 'Kho'], ['dept', 'Bộ phận yêu cầu'], ['handler', 'Người thực hiện'], ['approver', 'Người duyệt'], ['type', 'Loại yêu cầu']].map(o => `<option value="${o[0]}" ${vs.group === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
            <button class="btn" id="dvCsv">⭳ Xuất Excel</button></div>
        </div>
        <div id="dvBody"></div>
      </div>`;
    const draw = () => { $('#dvBody').innerHTML = dvGroupsHtml(dvFilter(all, vs), vs.group); $$('#dvBody [data-r]').forEach(li => li.onclick = () => openDVDrawer(+li.dataset.r)); };
    draw();
    $$('[data-tab]', view).forEach(b => b.onclick = () => { vs.tab = b.dataset.tab; renderDV(view); });
    $('#dvq').addEventListener('input', debounce(e => { vs.q = e.target.value; draw(); }, 200));
    $('#dvGroup').onchange = e => { vs.group = e.target.value; draw(); };
    $('#dvNew').onclick = () => openDVDrawer(null);
    $('#dvCsv').onclick = () => exportCSV(tableDef(DVS));
  }

  function dvFilter(list, vs) {
    const q = vs.q.trim().toLowerCase();
    return list.filter(x => {
      if (vs.tab === 'open' && x.closed) return false;
      if (vs.tab === 'wait' && x.stage !== 'Chờ duyệt') return false;
      if (vs.tab === 'late' && !x.late) return false;
      if (vs.tab === 'explain' && !x.needExplain) return false;
      if (vs.tab === 'done' && x.stage !== 'Hoàn thành') return false;
      if (vs.tab === 'stop' && !DV_STOP.includes(x.stage)) return false;
      if (q && ![x.id, x.title, x.detail, x.dept, x.req, x.handler, x.approver, x.vendor, x.explain, x.docs].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function dvGroupsHtml(list, group) {
    if (!list.length) return '<div class="empty">Không có yêu cầu nào trong mục này.</div>';
    const keyOf = x => group === 'stage' ? x.stage : group === 'kho' ? x.kho : group === 'dept' ? (x.dept || '⚠ Chưa ghi bộ phận') : group === 'handler' ? (x.handler || '⚠ Chưa có người thực hiện') : group === 'approver' ? (x.approver || '⚠ Chưa có người duyệt') : (x.type || 'Khác');
    const order = group === 'stage' ? DV_STAGES : group === 'kho' ? ['Chung', ...KHO_CODES] : group === 'type' ? DV_TYPES : null;
    const keys = [...new Set(list.map(keyOf))].sort((a, b) => order ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b, 'vi'));
    const lv = l => DV_LEVELS.indexOf(l);
    const sortFn = (a, b) => (b.late - a.late) || (lv(a.level) - lv(b.level)) || ((a.due ? +a.due : Infinity) - (b.due ? +b.due : Infinity)) || (a.r - b.r);
    return keys.map(key => {
      const items = list.filter(x => keyOf(x) === key).sort(sortFn);
      const sum = items.reduce((a, x) => a + (x.cost || x.est), 0);
      return `<div class="tgroup"><div class="tgroup-h"><span class="chip ${group === 'stage' ? dvStageCls(key) : key.startsWith('⚠') ? 'red' : ''}">${esc(key)}</span><span class="muted">${items.length} yêu cầu${sum ? ' · ' + money(sum) : ''}</span></div>
        <ul class="list">${items.map(dvItemHtml).join('')}</ul></div>`;
    }).join('');
  }

  function dvSteps(stage) {
    if (DV_STOP.includes(stage)) return `<span class="chip">${esc(stage)}</span>`;
    const i = DV_FLOW.indexOf(stage);
    return `<span class="steps" title="${esc(stage)} (${i + 1}/${DV_FLOW.length})">${DV_FLOW.map((_, j) => `<i class="${j < i ? 'done' : j === i ? 'cur' : ''}"></i>`).join('')}</span>`;
  }

  function dvTimeline(x) {
    if (x.stage === 'Hoàn thành') return x.lateDone ? `<span class="late">Xong trễ ${x.lateDone} ngày</span>` : `<span class="ok">Xong đúng hạn${x.doneAt ? ' · ' + dmy(isoOf(x.doneAt)) : ''}</span>`;
    if (DV_STOP.includes(x.stage)) return '';
    if (!x.due) return '<span class="chip red">Chưa có timeline</span>';
    const range = `${x.start ? dmy(isoOf(x.start)).slice(0, 5) + ' → ' : ''}${dmy(isoOf(x.due))}`;
    return x.late ? `<span class="late">📅 ${range} · quá hạn ${-x.left} ngày</span>` : `<span>📅 ${range} · ${x.left === 0 ? 'hôm nay' : 'còn ' + x.left + ' ngày'}</span>`;
  }

  function dvItemHtml(x) {
    const lvCls = x.level === 'Khẩn cấp' ? 'red' : x.level === 'Cao' ? 'amber' : '';
    const imgs = state.images.filter(im => im.sheet === DVS && +im.row === x.r).length;
    return `<li class="task-item dv-item ${x.late ? 'is-late' : ''} ${x.closed ? 'is-closed' : ''}" data-r="${x.r}">
      <div class="grow">
        <div class="t">${x.id ? `<span class="muted">${esc(x.id)}</span> ` : ''}${esc(x.title)}</div>
        <div class="tmeta">
          <span class="chip ${dvStageCls(x.stage)}">${esc(x.stage)}</span>${dvSteps(x.stage)}
          ${x.level !== 'Bình thường' ? `<span class="chip ${lvCls}">${esc(x.level)}</span>` : ''}
          ${x.type ? `<span class="chip">${esc(x.type)}</span>` : ''}
          <span class="chip">${esc(x.kho)}</span>
          ${dvTimeline(x)}
        </div>
        <div class="tmeta dv-people">
          <span title="Bộ phận yêu cầu">🏢 ${esc(x.dept || '—')}</span>
          <span title="Người thực hiện">🛠 Thực hiện: ${x.handler ? esc(x.handler) : '<b class="late">chưa có</b>'}</span>
          <span title="Người duyệt yêu cầu">✅ Duyệt: ${esc(x.approver || "—")}${x.apprAt && !["Đang báo giá", "Chờ duyệt"].includes(x.stage) ? " · " + dmy(isoOf(x.apprAt)) : ""}</span>
          ${x.vendor ? `<span title="Nhà cung cấp">🏷 ${esc(x.vendor)}</span>` : ''}
          ${imgs ? `<span>📷 ${imgs}</span>` : ''}
          ${x.needExplain ? '<span class="chip red">Thiếu giải trình</span>' : ''}
        </div>
      </div>
      <div class="dv-money">
        <div class="v">${money(x.cost || x.est)}</div>
        <div class="s">${x.cost ? (x.over ? `<span class="late">vượt ${money(x.cost - x.est)}</span>` : 'thực tế') : x.est ? 'dự kiến' : ''}</div>
      </div></li>`;
  }

  function nextDVId() {
    const y = String(new Date().getFullYear()).slice(2);
    let max = 0;
    dvList().forEach(x => { const m = new RegExp('^DV' + y + '-(\\d+)$').exec(x.id); if (m) max = Math.max(max, +m[1]); });
    return `DV${y}-${String(max + 1).padStart(3, '0')}`;
  }

  /* Form chi tiết – tách rõ 2 vai trò:
   *  ② Người thực hiện & tiến độ: người thực hiện đi báo giá, thực hiện, bàn giao nghiệm thu
   *  ⑤ Phê duyệt: người duyệt yêu cầu xem nội dung + chi phí rồi Duyệt / Từ chối (chỉ tài khoản có quyền duyệt) */
  function openDVDrawer(r) {
    const x = r ? dvList().find(i => i.r === r) : null, isNew = !x;
    const k = state.kho === 'ALL' ? 'Chung' : state.kho;
    const iso = d => d ? isoOf(d) : '';
    const v = x ? { ...x, date: iso(x.date), start: iso(x.start), due: iso(x.due), doneAt: iso(x.doneAt), apprAt: iso(x.apprAt) }
      : { date: isoOf(new Date()), kho: k, type: 'Dịch vụ', level: 'Bình thường', title: '', detail: '', dept: '', req: state.user || '', handler: '', approver: '', stage: 'Đang báo giá', apprAt: '', start: '', due: '', doneAt: '', vendor: '', est: '', cost: '', explain: '', docs: '' };
    const edit = canEdit(), appr = canApprove();
    const ro = edit ? '' : 'disabled';
    const names = f => [...new Set(dvList().map(i => i[f]).filter(Boolean))];
    const approverNames = [...new Set([...(state.users || []).filter(u => u.approver && u.active).map(u => u.name), ...names('approver')])];
    const dl = (id, list) => `<datalist id="${id}">${list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
    const opt = (list, cur) => list.map(o => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('') + (cur && !list.includes(cur) ? `<option selected>${esc(cur)}</option>` : '');
    const inp = (id, val, extra = '') => `<input class="input" id="${id}" value="${esc(val == null ? '' : val)}" ${extra} ${ro}>`;
    const stage = v.stage, flowIdx = DV_FLOW.indexOf(stage);
    const stepBar = DV_STOP.includes(stage) ? `<div class="dv-stop chip ${stage === 'Từ chối' ? 'red' : ''}">${esc(stage)}</div>`
      : `<ol class="stepper">${DV_FLOW.map((s, j) => `<li class="${j < flowIdx ? 'done' : j === flowIdx ? 'cur' : ''}"><span>${j + 1}</span>${esc(s)}</li>`).join('')}</ol>`;

    // Nút chuyển bước – phần Thực hiện (người chỉnh sửa)
    const execBtns = !x || !edit ? [] : ({
      'Đã duyệt': [['▶ Bắt đầu thực hiện', 'Đang thực hiện', 'primary']],
      'Đang thực hiện': [['📋 Bàn giao – chờ nghiệm thu', 'Chờ nghiệm thu', 'primary']],
      'Chờ nghiệm thu': [['✓ Nghiệm thu – Hoàn thành', 'Hoàn thành', 'primary']],
      'Hủy': [['↺ Mở lại yêu cầu', 'Đang báo giá', '']]
    }[stage] || []).concat(!x.closed ? [['Hủy yêu cầu', 'Hủy', 'danger']] : []);
    // Phần Phê duyệt
    let apprState, apprBtns = [];
    if (stage === 'Đang báo giá') {
      apprState = '<span class="chip">Chưa gửi duyệt</span>';
      if (x && edit) apprBtns.push(['📨 Gửi duyệt', 'Chờ duyệt', 'primary']);
    } else if (stage === 'Chờ duyệt') {
      apprState = '<span class="chip amber">Chờ duyệt</span>';
      if (appr) apprBtns.push(['✓ Duyệt', 'Đã duyệt', 'primary'], ['✕ Từ chối', 'Từ chối', 'danger']);
    } else if (stage === 'Từ chối') {
      apprState = `<span class="chip red">Từ chối${v.apprAt ? ' · ' + dmy(v.apprAt) : ''}</span>`;
      if (edit) apprBtns.push(['↺ Gửi duyệt lại', 'Chờ duyệt', '']);
    } else if (stage === 'Hủy') apprState = '<span class="chip">Đã hủy</span>';
    else apprState = `<span class="chip green">✓ Đã duyệt${v.apprAt ? ' · ' + dmy(v.apprAt) : ''}</span>`;
    const apprNote = stage === 'Chờ duyệt' && !appr ? `<div class="note-line">Đang chờ <b>${esc(v.approver || 'người duyệt')}</b> duyệt. Chỉ tài khoản có quyền <b>Người duyệt yêu cầu</b> mới Duyệt / Từ chối được.</div>` : '';
    const approverLocked = !edit || ['Đã duyệt', 'Đang thực hiện', 'Chờ nghiệm thu', 'Hoàn thành'].includes(stage);
    const btnHtml = list => list.map(b => `<button type="button" class="btn ${b[2]}" data-stage="${esc(b[1])}">${b[0]}</button>`).join('');

    const body = `
      ${x ? `<div class="muted" style="margin-bottom:10px">${esc(x.id || 'Dòng ' + x.r)}${x.upd ? ' · cập nhật ' + esc(x.upd) : ''}</div>` : ''}
      ${stepBar}
      <div class="sec-title">① Thông tin yêu cầu</div>
      <div class="form">
        <div class="field full"><label for="dvTitle">Nội dung yêu cầu <span class="req">*</span></label>${inp('dvTitle', v.title, 'placeholder="VD: Vệ sinh 6 máy lạnh văn phòng kho TK"')}</div>
        <div class="field full"><label for="dvDetail">Chi tiết / số lượng / quy cách</label><textarea id="dvDetail" placeholder="Số lượng, vị trí, yêu cầu kỹ thuật…" ${ro}>${esc(v.detail)}</textarea></div>
        <div class="field"><label for="dvType">Loại yêu cầu</label><select class="select" id="dvType" ${ro}>${opt(DV_TYPES, v.type)}</select></div>
        <div class="field"><label for="dvLevel">Mức độ</label><select class="select" id="dvLevel" ${ro}>${opt(DV_LEVELS, v.level)}</select></div>
        <div class="field"><label for="dvKho">Kho</label><select class="select" id="dvKho" ${ro}>${opt(['Chung', ...KHO_CODES], v.kho)}</select></div>
        <div class="field"><label for="dvDate">Ngày yêu cầu</label>${inp('dvDate', v.date, 'type="date"')}</div>
        <div class="field"><label for="dvDept">Bộ phận yêu cầu <span class="req">*</span></label>${inp('dvDept', v.dept, 'list="dvDeptL" placeholder="VD: Vận hành ca 1"')}${dl('dvDeptL', names('dept'))}</div>
        <div class="field"><label for="dvReq">Người yêu cầu</label>${inp('dvReq', v.req, 'list="dvReqL"')}${dl('dvReqL', names('req'))}</div>
      </div>

      <div class="sec-title">② Người thực hiện &amp; tiến độ</div>
      <div class="form">
        <div class="field"><label for="dvHandler">Người thực hiện <span class="req">*</span></label>${inp('dvHandler', v.handler, 'list="dvHL" placeholder="Người đi báo giá, làm việc với NCC"')}${dl('dvHL', names('handler'))}</div>
        <div class="field"><label>Tiến độ hiện tại</label><div class="ro"><span class="chip ${dvStageCls(stage)}">${esc(stage)}</span>${flowIdx >= 0 ? ` <span class="muted">bước ${flowIdx + 1}/${DV_FLOW.length}</span>` : ''}</div></div>
      </div>
      ${execBtns.length ? `<div class="sec-actions">${btnHtml(execBtns)}</div>` : ''}

      <div class="sec-title">③ Timeline dự kiến</div>
      <div class="form">
        <div class="field"><label for="dvStart">Bắt đầu dự kiến</label>${inp('dvStart', v.start, 'type="date"')}</div>
        <div class="field"><label for="dvDue">Hoàn thành dự kiến <span class="req">*</span></label>${inp('dvDue', v.due, 'type="date"')}</div>
        <div class="field"><label for="dvDone">Hoàn thành thực tế</label>${inp('dvDone', v.doneAt, 'type="date"')}</div>
      </div>

      <div class="sec-title">④ Nhà cung cấp &amp; chi phí</div>
      <div class="form">
        <div class="field full"><label for="dvVendor">Nhà cung cấp</label>${inp('dvVendor', v.vendor, 'list="dvVL" placeholder="Tên đơn vị, số điện thoại"')}${dl('dvVL', names('vendor'))}</div>
        <div class="field"><label for="dvEst">Chi phí dự kiến (VNĐ)</label>${inp('dvEst', v.est || '', 'type="number" min="0" step="1000"')}</div>
        <div class="field"><label for="dvCost">Chi phí thực tế (VNĐ)</label>${inp('dvCost', v.cost || '', 'type="number" min="0" step="1000"')}</div>
        <div class="field full"><label for="dvDocs">Chứng từ / số phiếu</label>${inp('dvDocs', v.docs, 'placeholder="Số phiếu QLNS, hóa đơn, link báo giá…"')}</div>
      </div>

      <div class="sec-title">⑤ Phê duyệt</div>
      <div class="appr-box">
        <div class="form" style="margin:0">
          <div class="field"><label for="dvAppr">Người duyệt yêu cầu</label><input class="input" id="dvAppr" value="${esc(v.approver)}" list="dvAL" placeholder="Chọn người duyệt" ${approverLocked ? 'disabled' : ''}>${dl('dvAL', approverNames)}</div>
          <div class="field"><label>Kết quả duyệt</label><div class="ro">${apprState}</div></div>
        </div>
        ${apprNote}
        ${apprBtns.length ? `<div class="row2">${btnHtml(apprBtns)}</div>` : ''}
      </div>

      <div class="sec-title">⑥ Giải trình <span class="muted" style="font-weight:500;font-size:12px">(bắt buộc khi quá hạn, xong trễ, vượt chi phí, từ chối hoặc hủy)</span></div>
      <textarea id="dvExplain" class="dv-explain" placeholder="Lý do trễ / vượt chi phí / từ chối, hướng xử lý…" ${edit || appr ? '' : 'disabled'}>${esc(v.explain)}</textarea>
      ${x ? `<div class="sec-title" id="imgSec">📷 Báo giá, hiện trường, nghiệm thu <span class="chip" id="imgCount"></span></div>
        <div class="gallery" id="imgGrid"></div>
        <label class="upload mt need-edit" id="upl"><input type="file" accept="image/*" multiple id="imgInput"><b>Bấm để chọn ảnh</b> hoặc kéo thả vào đây<br><small>Trên điện thoại có thể chụp trực tiếp · ảnh tự nén ≤ 1600px</small></label>` : ''}`;
    openDrawer(isNew ? 'Yêu cầu dịch vụ / mua ngoài mới' : 'Chi tiết yêu cầu', body,
      `${x ? '<button class="btn danger need-edit" id="dvDel" title="Xóa yêu cầu">🗑</button>' : ''}<span style="flex:1"></span><button class="btn" data-close>Đóng</button><button class="btn primary need-edit" id="dvSave">${isNew ? '＋ Tạo yêu cầu' : '💾 Lưu'}</button>`);
    ['dvTitle', 'dvDept', 'dvHandler', 'dvDue', 'dvExplain', 'dvAppr'].forEach(id => $('#' + id).addEventListener('input', e => e.target.classList.remove('bad')));

    const fail = (miss) => {
      $$('#drawerBody .bad').forEach(el => el.classList.remove('bad'));
      miss.forEach(m => $('#' + m[0]).classList.add('bad'));
      toast('Cần nhập: ' + miss.map(m => m[1]).join(', '), 'warn');
      const el = $('#' + miss[0][0]); el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    };
    const commit = (f, label) => {
      f[DV.upd] = stampNow();
      if (isNew) {
        f[DV.id] = nextDVId();
        const values = {}; Object.keys(f).forEach(c => { if (f[c] !== '' && f[c] != null) values[c] = f[c]; });
        enqueue('append', { sheet: DVS, values, dataStart: 5, lastCol: DV_NCOL });
        toast(`Đã tạo yêu cầu ${f[DV.id]}`);
      } else {
        const dateCols = [DV.date, DV.apprAt, DV.start, DV.due, DV.doneAt];
        const changes = Object.keys(f).filter(c => String(f[c]) !== String(inputValue(val(DVS, x.r, +c), dateCols.includes(+c) ? { t: 'date' } : { t: 'text' })))
          .map(c => ({ row: x.r, col: +c, value: f[c] }));
        if (changes.some(ch => ch.col !== DV.upd)) { enqueue('update', { sheet: DVS, changes }); toast(label || 'Đã lưu yêu cầu'); }
      }
      closeDrawer(); route(true);
      return true;
    };

    // Người duyệt chỉ có quyền xem: chỉ ghi các ô duyệt (Apps Script cũng kiểm tra lại)
    const saveApprovalOnly = (newStage) => {
      const explain = $('#dvExplain').value.trim();
      if (newStage === 'Từ chối' && !explain) return fail([['dvExplain', 'giải trình (lý do từ chối)']]);
      const f = { [DV.stage]: newStage, [DV.apprAt]: isoOf(new Date()), [DV.approver]: v.approver || state.user || '', [DV.explain]: explain };
      return commit(f, newStage === 'Đã duyệt' ? '✓ Đã duyệt yêu cầu' : 'Đã từ chối yêu cầu');
    };

    const save = (forceStage) => {
      if (forceStage && (forceStage === 'Đã duyệt' || forceStage === 'Từ chối')) {
        if (!appr) { toast('Chỉ Người duyệt yêu cầu mới được Duyệt / Từ chối', 'err'); return false; }
        if (!edit) return saveApprovalOnly(forceStage);
      }
      if (!edit) { toast('Tài khoản của bạn chỉ có quyền xem', 'warn'); return false; }
      const $v = id => $('#' + id).value.trim();
      const f = {
        [DV.date]: $v('dvDate'), [DV.kho]: $v('dvKho'), [DV.type]: $v('dvType'), [DV.level]: $v('dvLevel'), [DV.title]: $v('dvTitle'), [DV.detail]: $v('dvDetail'),
        [DV.dept]: $v('dvDept'), [DV.req]: $v('dvReq'), [DV.handler]: $v('dvHandler'), [DV.approver]: $v('dvAppr'), [DV.stage]: forceStage || stage,
        [DV.apprAt]: v.apprAt || '', [DV.start]: $v('dvStart'), [DV.due]: $v('dvDue'), [DV.doneAt]: $v('dvDone'), [DV.vendor]: $v('dvVendor'),
        [DV.est]: $v('dvEst') === '' ? '' : Number($v('dvEst')), [DV.cost]: $v('dvCost') === '' ? '' : Number($v('dvCost')), [DV.explain]: $v('dvExplain'), [DV.docs]: $v('dvDocs')
      };
      const st = f[DV.stage], today = isoOf(new Date());
      // Tự điền theo bước
      if (st === 'Đã duyệt' || st === 'Từ chối') { f[DV.apprAt] = today; if (!f[DV.approver]) f[DV.approver] = state.user || ''; }
      if (forceStage === 'Chờ duyệt' && stage === 'Từ chối') f[DV.apprAt] = '';   // gửi duyệt lại
      if (st === 'Hoàn thành' && !f[DV.doneAt]) f[DV.doneAt] = today;
      if (st === 'Đang thực hiện' && !f[DV.start]) f[DV.start] = today;
      // Kiểm tra bắt buộc
      const miss = [];
      if (!f[DV.title]) miss.push(['dvTitle', 'nội dung yêu cầu']);
      if (!f[DV.dept]) miss.push(['dvDept', 'bộ phận yêu cầu']);
      if (!f[DV.handler]) miss.push(['dvHandler', 'người thực hiện']);
      if (!f[DV.due] && !DV_STOP.includes(st)) miss.push(['dvDue', 'hoàn thành dự kiến']);
      if (DV_FLOW.indexOf(st) >= 1 && !f[DV.approver]) miss.push(['dvAppr', 'người duyệt yêu cầu']);
      const due = f[DV.due] ? toDate(f[DV.due]) : null, done = f[DV.doneAt] ? toDate(f[DV.doneAt]) : null;
      const reasons = [];
      if (DV_STOP.includes(st)) reasons.push(st.toLowerCase());
      if (st !== 'Hoàn thành' && !DV_STOP.includes(st) && due && due < today0()) reasons.push('đã quá hạn timeline');
      if (st === 'Hoàn thành' && due && done && done > due) reasons.push('hoàn thành trễ hạn');
      if (f[DV.est] && f[DV.cost] && f[DV.cost] > f[DV.est]) reasons.push('chi phí thực tế vượt dự kiến');
      if (reasons.length && !f[DV.explain]) miss.push(['dvExplain', 'giải trình (' + reasons.join(', ') + ')']);
      if (miss.length) return fail(miss);
      const labels = { 'Chờ duyệt': '📨 Đã gửi duyệt', 'Đã duyệt': '✓ Đã duyệt yêu cầu', 'Từ chối': 'Đã từ chối yêu cầu', 'Hủy': 'Đã hủy yêu cầu' };
      return commit(f, forceStage ? (labels[forceStage] || `Đã chuyển sang “${forceStage}”`) : '');
    };
    $('#dvSave').onclick = () => save();
    $$('#drawerBody [data-stage]').forEach(b => b.onclick = () => save(b.dataset.stage));
    if ($('#dvDel')) $('#dvDel').onclick = () => {
      if (!confirm(`Xóa yêu cầu “${x.title}”?\nNên chuyển sang “Hủy” kèm giải trình để giữ lịch sử.\n\nVẫn xóa dòng ${x.r}?`)) return;
      enqueue('clearRow', { sheet: DVS, row: x.r, lastCol: DV_NCOL }); toast('Đã xóa yêu cầu'); closeDrawer(); route(true);
    };
    if (x) { drawImages(DVS, x.r); bindUpload(tableDef(DVS), x.r); }
    if (edit) setTimeout(() => $('#dvTitle').focus(), 250);
  }

  /* ------------------------------------------------------------------ PHÂN QUYỀN TRUY CẬP (Hệ thống)
   * Danh sách tài khoản nằm ở tab ẩn WEB_PHAN_QUYEN; chỉ Quản trị tải / sửa được (Apps Script kiểm tra). */
  const PERM_ROWS = [
    ['Xem toàn bộ dữ liệu, báo cáo, tải Excel', 1, 1, 1, 1],
    ['Thêm / sửa / xóa dữ liệu, tải ảnh', 0, 1, 0, 1],
    ['Sửa dropdown, thêm mã NVL / CCDC', 0, 1, 0, 1],
    ['Tạo, cập nhật Task và Dịch vụ mua ngoài', 0, 1, 0, 1],
    ['Duyệt / Từ chối yêu cầu (Dành cho Quản lý)', 0, 0, 1, 1],
    ['Sao lưu ngay lên Drive', 0, 1, 0, 1],
    ['Quản lý phân quyền truy cập', 0, 0, 0, 1]
  ];
  function renderPerm(view) {
    setCrumb('Phân quyền truy cập', 'Hệ thống');
    const me = state.me;
    view.innerHTML = `
      <div class="grid g2">
        <div class="card"><div class="card-h"><h3>Tài khoản đang đăng nhập</h3></div><div class="card-b">
          ${me ? `<div class="setting-row"><label>Họ tên</label><div><b>${esc(me.name || state.user || '—')}</b></div></div>
            <div class="setting-row"><label>Vai trò</label><div><span class="role-badge ${me.role}">${esc(ROLE_LABEL[me.role])}</span> ${me.approver ? '<span class="chip green">Người duyệt yêu cầu</span>' : ''}</div></div>
            <div class="setting-row"><label>Đăng nhập bằng</label><div>${me.master ? 'Mã chung (Quản trị)' : 'Mã truy cập cá nhân'}</div></div>`
            : `<p class="muted" style="margin:0">${state.apiUrl ? 'Chưa nhận được thông tin quyền từ Apps Script. Nếu đã đăng nhập mà vẫn thấy dòng này: Apps Script đang chạy bản cũ – vào Triển khai → Quản lý tùy chọn triển khai → ✏️ → Phiên bản: Mới → Triển khai.' : 'Chưa kết nối Google Sheet.'}</p>`}
          <div class="sec-actions"><button class="btn" id="pSwitch">⇄ Đổi tài khoản</button><button class="btn" id="pCheck">🔎 Kiểm tra phiên bản Apps Script</button></div>
          <div id="pCheckOut" class="note-line" style="margin-top:8px"></div>
        </div></div>
        <div class="card"><div class="card-h"><h3>Quyền của từng vai trò</h3></div>
          <div class="tbl-wrap" style="max-height:none"><table class="tbl perm-matrix"><thead><tr><th>Quyền</th><th>Người xem</th><th>Người chỉnh sửa</th><th>Người duyệt yêu cầu*</th><th>Quản trị</th></tr></thead><tbody>
          ${PERM_ROWS.map(r => `<tr><td>${esc(r[0])}</td>${r.slice(1).map(x => `<td class="${x ? 'y' : 'n'}">${x ? '✓' : '—'}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div>
          <div class="card-b note-line">* “Người duyệt yêu cầu” là quyền <b>cộng thêm</b>, gắn cho tài khoản Người xem hoặc Người chỉnh sửa: được Duyệt / Từ chối Dịch vụ mua ngoài và duyệt hoàn thành Task đang “Chờ duyệt”. Quản trị luôn có quyền duyệt.</div>
        </div>
      </div>
      <div class="card mt" id="pUsersCard"><div class="card-h"><div><h3>Danh sách tài khoản</h3><div class="sub" style="margin-top:3px">Mỗi người dùng 1 mã truy cập riêng. Mã chung (đặt bằng hàm setPasscode) chỉ nên để Quản trị giữ.</div></div>
        <div class="right">${isAdmin() ? '<button class="btn primary" id="pAdd">＋ Thêm tài khoản</button>' : ''}</div></div>
        <div id="pUsers">${isAdmin() ? '<div class="empty">Đang tải danh sách…</div>' : '<div class="empty">Chỉ Quản trị xem và chỉnh sửa được danh sách tài khoản.</div>'}</div></div>`;
    $('#pSwitch').onclick = () => { state.authFail = true; showLogin(true, 'Nhập mã truy cập của tài khoản khác.'); };
    $('#pCheck').onclick = checkServerVersion;
    if (!me && state.apiUrl) checkServerVersion();
    if (!isAdmin()) return;
    $('#pAdd').onclick = () => openUserModal(null);
    loadUsers();
  }

  /** Hỏi Apps Script đang chạy phiên bản nào (không cần mã truy cập) + cho biết web đang gọi URL nào */
  async function checkServerVersion() {
    const out = $('#pCheckOut'); if (!out) return;
    const id = (String(state.apiUrl).match(/\/s\/([^/]+)\/exec/) || [])[1] || state.apiUrl;
    const shortId = id.length > 20 ? id.slice(0, 10) + '…' + id.slice(-10) : id;
    out.innerHTML = 'Đang kiểm tra…';
    let ver = null;
    try {
      const r = await fetch(state.apiUrl + (state.apiUrl.includes('?') ? '&' : '?') + 'action=version&t=' + Date.now(), { redirect: 'follow' });
      const j = await r.json();
      if (j && j.ok && j.server) ver = j.server;
    } catch (e) { out.innerHTML = `<b class="warn-text">Không gọi được Apps Script: ${esc(e.message)}</b>`; return; }
    out.innerHTML = ver
      ? `✓ Apps Script đang chạy bản <b>${esc(ver)}</b> (mới). Mã triển khai web đang dùng: <span class="code-inline">${esc(shortId)}</span>. Nếu vẫn chưa thấy vai trò, bấm ⟳ hoặc đăng nhập lại.`
      : `<b class="warn-text">✗ Apps Script đang chạy bản CŨ.</b> Web đang gọi bản triển khai có mã <span class="code-inline">${esc(shortId)}</span>.<br>
         Mở Apps Script → <b>Triển khai → Quản lý tùy chọn triển khai</b>: chọn đúng dòng có mã trên (cuối URL), bấm ✏️ → <b>Phiên bản: Phiên bản mới</b> → Triển khai.
         Nếu không thấy mã này trong danh sách, bạn đang mở nhầm dự án Apps Script – hãy mở Apps Script từ chính Google Sheet (Tiện ích mở rộng → Apps Script).`;
  }

  async function loadUsers() {
    const host = $('#pUsers'); if (!host) return;
    if (!state.apiUrl) { host.innerHTML = '<div class="empty">Cần kết nối Google Sheet.</div>'; return; }
    try {
      const j = await api('users');
      state.users = j.users || [];
      drawUsers();
    } catch (e) { host.innerHTML = isOldServer(e) ? `<div class="empty"><b class="warn-text">${esc(OLD_SERVER_MSG)}</b></div>` : `<div class="empty">Không tải được danh sách: ${esc(e.message)}</div>`; }
  }

  function drawUsers() {
    const host = $('#pUsers'); if (!host) return;
    const list = state.users || [];
    if (!list.length) { host.innerHTML = '<div class="empty">Chưa có tài khoản nào. Bấm “＋ Thêm tài khoản” để cấp mã truy cập cho từng người.</div>'; return; }
    const order = { admin: 0, editor: 1, viewer: 2 };
    const rows = list.slice().sort((a, b) => (b.active - a.active) || (order[a.role] - order[b.role]) || a.name.localeCompare(b.name, 'vi'));
    host.innerHTML = `<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Họ tên</th><th>Bộ phận</th><th>Vai trò</th><th>Người duyệt</th><th>Trạng thái</th><th>Mã truy cập</th><th>Cập nhật</th><th></th></tr></thead><tbody>
      ${rows.map(u => `<tr data-row="${u.row}" class="${u.active ? '' : 'muted'}">
        <td><b>${esc(u.name)}</b>${u.note ? `<div class="muted" style="font-size:12px">${esc(u.note)}</div>` : ''}</td>
        <td>${esc(u.dept)}</td>
        <td><span class="role-badge ${u.role}">${esc(ROLE_LABEL[u.role])}</span></td>
        <td>${u.approver ? '<span class="chip green">✓ Có</span>' : '<span class="muted">—</span>'}</td>
        <td>${u.active ? '<span class="chip green">Hoạt động</span>' : '<span class="chip red">Khóa</span>'}</td>
        <td class="nowrap"><span class="pin" data-pin="${esc(u.pin)}">••••••••</span> <button class="ra" data-show title="Hiện / ẩn mã">👁</button><button class="ra" data-copy title="Sao chép mã">⧉</button></td>
        <td class="nowrap date">${esc(u.upd)}</td>
        <td class="rowact"><button class="ra" data-edit title="Sửa">✎</button><button class="ra" data-lock title="${u.active ? 'Khóa' : 'Mở khóa'}">${u.active ? '🔒' : '🔓'}</button><button class="ra" data-del title="Xóa">🗑</button></td></tr>`).join('')}
      </tbody></table></div>`;
    const userOf = el => (state.users || []).find(u => u.row === +el.closest('tr').dataset.row);
    $$('[data-show]', host).forEach(b => b.onclick = () => { const s = b.parentNode.querySelector('.pin'); s.textContent = s.textContent.startsWith('•') ? s.dataset.pin : '••••••••'; });
    $$('[data-copy]', host).forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.parentNode.querySelector('.pin').dataset.pin); toast('Đã sao chép mã truy cập'); } catch (e) { toast('Không sao chép được – bấm 👁 để xem mã', 'warn'); } });
    $$('[data-edit]', host).forEach(b => b.onclick = () => openUserModal(userOf(b)));
    $$('[data-lock]', host).forEach(b => b.onclick = async () => {
      const u = userOf(b);
      if (u.active && state.me && !state.me.master && u.name === state.me.name && !confirm('Đây là tài khoản bạn đang dùng. Khóa thì bạn sẽ bị đăng xuất. Tiếp tục?')) return;
      await saveUser({ ...u, active: !u.active });
    });
    $$('[data-del]', host).forEach(b => b.onclick = async () => {
      const u = userOf(b);
      if (!confirm(`Xóa tài khoản “${u.name}”?\nNgười này sẽ không đăng nhập được bằng mã cũ. Nên dùng 🔒 Khóa nếu chỉ tạm ngưng.`)) return;
      try { await api('deleteUser', { row: u.row, name: u.name }); toast('Đã xóa tài khoản ' + u.name); loadUsers(); }
      catch (e) { toast(isOldServer(e) ? OLD_SERVER_MSG : 'Không xóa được: ' + e.message, 'err'); }
    });
  }

  async function saveUser(u) {
    try {
      const j = await api('saveUser', { row: u.row || '', name: u.name, dept: u.dept, pin: u.pin, role: u.role, approver: !!u.approver, active: u.active !== false, note: u.note });
      toast(u.row ? 'Đã cập nhật tài khoản ' + u.name : 'Đã tạo tài khoản ' + u.name);
      await loadUsers();
      return j;
    } catch (e) { toast(isOldServer(e) ? OLD_SERVER_MSG : 'Không lưu được: ' + e.message, 'err'); return null; }
  }

  function genPin() { const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; const a = new Uint32Array(8); crypto.getRandomValues(a); a.forEach(n => { s += abc[n % abc.length]; }); return s; }

  function openUserModal(u) {
    const v = u || { name: '', dept: '', role: 'editor', approver: false, active: true, pin: genPin(), note: '' };
    const roles = [['viewer', 'Người xem', 'Chỉ xem, tải Excel'], ['editor', 'Người chỉnh sửa', 'Thêm / sửa / xóa dữ liệu'], ['admin', 'Quản trị', 'Toàn quyền + phân quyền']];
    const m = modal(`<h3>${u ? 'Sửa tài khoản' : '＋ Thêm tài khoản'}</h3>
      <div class="field"><label for="uName">Họ tên <span class="req">*</span></label><input class="input" id="uName" value="${esc(v.name)}" placeholder="VD: Lê Quang Tuấn"></div>
      <div class="field"><label for="uDept">Bộ phận / chức vụ</label><input class="input" id="uDept" value="${esc(v.dept)}" placeholder="VD: Thủ kho KTC Tân Kim"></div>
      <div class="field"><label>Vai trò</label><div class="role-pick">${roles.map(r => `<label><input type="radio" name="uRole" value="${r[0]}" ${v.role === r[0] ? 'checked' : ''}><b>${r[1]}</b><span class="muted">${r[2]}</span></label>`).join('')}</div></div>
      <label class="chk"><input type="checkbox" id="uAppr" ${v.approver ? 'checked' : ''}> <span><b>Người duyệt yêu cầu</b> (Dành cho Quản lý): được Duyệt / Từ chối Dịch vụ mua ngoài và duyệt hoàn thành Task</span></label>
      <div class="field"><label for="uPin">Mã truy cập (ít nhất 6 ký tự)</label><div style="display:flex;gap:8px"><input class="input pin" id="uPin" value="${esc(v.pin)}" style="flex:1;text-transform:uppercase"><button class="btn" id="uGen" type="button" title="Tạo mã ngẫu nhiên">🎲 Tạo mã</button></div></div>
      <div class="field"><label for="uNote">Ghi chú</label><input class="input" id="uNote" value="${esc(v.note)}"></div>
      <label class="chk"><input type="checkbox" id="uActive" ${v.active !== false ? 'checked' : ''}> Đang hoạt động (bỏ chọn = khóa tài khoản)</label>
      <div class="row"><button class="btn" id="uCancel" type="button">Hủy</button><button class="btn primary" id="uOk" type="button">💾 Lưu</button></div>`, 'wide');
    m.$('#uGen').onclick = () => { m.$('#uPin').value = genPin(); };
    m.$('#uCancel').onclick = m.close;
    m.$('#uOk').onclick = async () => {
      const name = m.$('#uName').value.trim(), pin = m.$('#uPin').value.trim().toUpperCase();
      if (!name) { toast('Cần nhập họ tên', 'warn'); m.$('#uName').focus(); return; }
      if (pin.length < 6) { toast('Mã truy cập cần ít nhất 6 ký tự', 'warn'); m.$('#uPin').focus(); return; }
      m.$('#uOk').disabled = true;
      const j = await saveUser({ row: u && u.row, name, dept: m.$('#uDept').value.trim(), pin, role: (m.$('input[name=uRole]:checked') || {}).value || 'viewer',
        approver: m.$('#uAppr').checked, active: m.$('#uActive').checked, note: m.$('#uNote').value.trim() });
      if (!j) { m.$('#uOk').disabled = false; return; }
      m.close();
      if (!u) modal(`<h3>✓ Đã tạo tài khoản</h3><p>Gửi mã truy cập này cho <b>${esc(name)}</b> (qua tin nhắn riêng):</p>
        <div class="appr-box" style="text-align:center;font-size:22px"><span class="pin">${esc(j.pin || pin)}</span></div>
        <p class="note-line">Người dùng mở web → nhập mã này ở ô “Mã truy cập”. Có thể đổi hoặc khóa mã bất cứ lúc nào.</p>
        <div class="row"><button class="btn primary" type="button" onclick="this.closest('.modal-bg').remove()">Xong</button></div>`);
    };
    setTimeout(() => m.$('#uName').focus(), 50);
  }

  /* ------------------------------------------------------------------ TỒN KHO (NVL · CCDC)
   * Tồn đầu    = tồn chốt 7:00 sáng nay (= tồn cuối của các ngày trước)
   * Nhập tháng = tổng nhập từ ngày 1 tới hôm nay (thường chỉ phát sinh 1 lần / tháng)
   * Xuất       = xuất hôm nay · xuất trong tháng
   * Tồn cuối   = Tồn đầu + Nhập hôm nay − Xuất hôm nay  (= số Sheet đang tính, cột Tồn cuối)
   * Bảng gốc của Sheet vẫn mở được bằng nút "Bảng gốc" để nhập Tồn đầu kỳ (khởi tạo). */
  function stockData(name, khos) {
    const sc = schemaOf(name), cfg = sc.stock, s = sh(name), L = cfg.ledger, ls = sh(L);
    const t0 = today0(), m0 = new Date(t0.getFullYear(), t0.getMonth(), 1);
    const agg = {};
    if (ls) for (let r = 5; r <= ls.v.length; r++) {
      const code = plain(val(L, r, 5)).trim(); if (!code) continue;
      const kho = plain(val(L, r, 3)).trim(); if (!khos.includes(kho)) continue;
      const typ = plain(val(L, r, 4)).trim(), q = num(val(L, r, 8)); if (!q) continue;
      const d = toDate(val(L, r, 1), true); if (!d || d > t0) continue;
      const dir = cfg.inT.includes(typ) ? 1 : cfg.outT.includes(typ) ? -1 : 0; if (!dir) continue;
      const a = agg[code] || (agg[code] = { inT: 0, outT: 0, inM: 0, outM: 0 });
      if (+d === +t0) { if (dir > 0) a.inT += q; else a.outT += q; }
      if (d >= m0) { if (dir > 0) a.inM += q; else a.outM += q; }
    }
    const price = {}; codes(cfg.kind, true).forEach(o => { price[o.v] = num(o.p || 0); });
    const rows = [];
    if (s) for (let r = 5; r <= s.v.length; r++) {
      const code = plain(val(name, r, 1)).trim(); if (!code) continue;
      const a = agg[code] || { inT: 0, outT: 0, inM: 0, outM: 0 };
      let end = 0; const need = [];
      khos.forEach(k => { const c = cfg.kho[k]; end += num(val(name, r, c.end) || 0); if (c.st && /^cần đặt/i.test(plain(val(name, r, c.st)))) need.push(k); });
      const one = khos.length === 1 ? cfg.kho[khos[0]] : null;
      rows.push({ r, code, nm: plain(val(name, r, 2)), u: plain(val(name, r, 3)), open7: end - a.inT + a.outT, ...a, end,
        min: one && one.min ? val(name, r, one.min) : '', st: one && one.st ? plain(val(name, r, one.st)) : (need.length ? 'CẦN ĐẶT (' + need.join(', ') + ')' : ''),
        need: need.length > 0, inUse: cfg.inUse ? num(val(name, r, cfg.inUse) || 0) : null, price: price[code] || 0, value: end * (price[code] || 0) });
    }
    return rows;
  }

  function renderStock(view, name) {
    const sc = schemaOf(name), cfg = sc.stock, vs = viewState(name);
    setCrumb(sc.title, name);
    vs.sf = vs.sf || 'all'; vs.so = vs.so || 'code';
    const k = state.kho === 'ALL' ? null : state.kho, khos = k ? [k] : KHO_CODES;
    const all = stockData(name, khos);
    const hasMin = !!cfg.kho.HCM20.min;
    const n = x => x ? Math.round(x * 100) / 100 : 0, f = x => n(x).toLocaleString('vi-VN');
    const tabs = [['all', 'Tất cả'], ...(hasMin ? [['need', 'Cần đặt']] : []), ['outT', 'Có xuất hôm nay'], ['moved', 'Phát sinh trong tháng'], ['zero', 'Hết hàng']];
    const filter = list => {
      const q = (vs.q || '').trim().toLowerCase();
      let out = list.filter(x => vs.sf === 'all' || (vs.sf === 'need' && x.need) || (vs.sf === 'outT' && x.outT) || (vs.sf === 'moved' && (x.inM || x.outM)) || (vs.sf === 'zero' && x.end <= 0));
      if (q) out = out.filter(x => (x.code + ' ' + x.nm).toLowerCase().includes(q));
      const so = { code: (a, b) => a.code.localeCompare(b.code), outT: (a, b) => b.outT - a.outT, outM: (a, b) => b.outM - a.outM, value: (a, b) => b.value - a.value, end: (a, b) => a.end - b.end };
      return out.sort(so[vs.so] || so.code);
    };
    const cnt = { need: all.filter(x => x.need).length, outT: all.filter(x => x.outT).length, value: all.reduce((a, x) => a + x.value, 0), moved: all.filter(x => x.inM || x.outM).length };
    view.innerHTML = `
      <div class="kpis">
        ${kpi('Số mã ' + cfg.kind, all.length, k ? khoInfo(k).name : 'Toàn cụm 3 kho', 'blue')}
        ${hasMin ? kpi('Mã cần đặt', cnt.need, 'Tồn cuối dưới mức Min', cnt.need ? 'red' : 'green') : kpi('Phát sinh trong tháng', cnt.moved, 'Mã có nhập / xuất từ ngày 1', '')}
        ${kpi('Có xuất hôm nay', cnt.outT, 'Số mã đã xuất trong ngày', cnt.outT ? 'amber' : '')}
        ${kpi('Giá trị tồn', cnt.value ? Math.round(cnt.value).toLocaleString('vi-VN') + ' đ' : '—', cnt.value ? 'Theo đơn giá danh mục' : 'Danh mục chưa có đơn giá', 'green')}
      </div>
      <div class="card mt">
        <div class="card-h"><div><h3>${esc(sc.title)}${k ? ' · ' + esc(khoInfo(k).name) : ' · toàn cụm'}</h3>
          <div class="sub" style="margin-top:3px"><b>Tồn đầu</b> = tồn chốt 7:00 sáng ${dmy(isoOf(today0()))} · <b>Nhập / Xuất trong tháng</b> = từ 01/${pad(today0().getMonth() + 1)} đến hôm nay · <b>Tồn cuối</b> = Tồn đầu + Nhập hôm nay − Xuất hôm nay${k ? '' : ' · chọn kho ở góc trên để xem riêng từng kho'}</div></div>
          <div class="right"><button class="btn" id="stRaw" title="Bảng gốc trên Google Sheet – nhập Tồn đầu kỳ khi khởi tạo">⚙ Bảng gốc</button><button class="btn" id="stCsv">⭳ Xuất Excel</button><button class="btn" id="stPrint">⎙ In</button></div></div>
        <div class="toolbar">
          <div class="tabs">${tabs.map(t => `<button class="tab ${vs.sf === t[0] ? 'active' : ''}" data-sf="${t[0]}">${t[1]}</button>`).join('')}</div>
        </div>
        <div class="toolbar">
          <div class="search"><input class="input" id="stq" placeholder="Tìm mã hoặc tên…" value="${esc(vs.q || '')}"></div>
          <div class="right"><label class="muted" for="stSort" style="font-size:12.5px">Sắp xếp</label>
            <select class="select" id="stSort">${[['code', 'Mã'], ['outT', 'Xuất hôm nay nhiều nhất'], ['outM', 'Xuất trong tháng nhiều nhất'], ['end', 'Tồn cuối ít nhất'], ['value', 'Giá trị tồn cao nhất']].map(o => `<option value="${o[0]}" ${vs.so === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
        </div>
        <div id="stBody"></div>
      </div>`;
    const draw = () => {
      const list = filter(all);
      const tot = list.reduce((a, x) => { ['open7', 'inM', 'inT', 'outT', 'outM', 'end', 'value'].forEach(c => { a[c] += x[c]; }); return a; }, { open7: 0, inM: 0, inT: 0, outT: 0, outM: 0, end: 0, value: 0 });
      const mv = x => x ? f(x) : '<span class="zero">·</span>';
      $('#stBody').innerHTML = `<div class="tbl-wrap"><table class="tbl stock"><thead><tr>
          <th class="code">Mã</th><th>Tên</th><th>ĐVT</th><th class="num">Tồn đầu<small>7:00</small></th><th class="num">Nhập<small>trong tháng</small></th>
          <th class="num">Xuất<small>hôm nay</small></th><th class="num">Xuất<small>trong tháng</small></th><th class="num">Tồn cuối</th>
          ${hasMin ? '<th class="num">Tồn min</th><th>Trạng thái</th>' : ''}${cfg.inUse ? '<th class="num">Đang sử dụng</th>' : ''}<th class="num">Đơn giá</th><th class="num">Giá trị tồn</th></tr></thead>
        <tbody>${list.map(x => `<tr data-r="${x.r}">
          <td class="code">${esc(x.code)}</td><td class="wrap">${esc(x.nm)}</td><td>${esc(x.u)}</td>
          <td class="num">${f(x.open7)}</td>
          <td class="num">${mv(x.inM)}${x.inT ? `<div class="sub-in">+${f(x.inT)} hôm nay</div>` : ''}</td>
          <td class="num ${x.outT ? 'hot' : ''}">${mv(x.outT)}</td><td class="num">${mv(x.outM)}</td>
          <td class="num strong ${x.end <= 0 ? 'late' : ''}">${f(x.end)}</td>
          ${hasMin ? `<td class="num">${x.min === '' ? '<span class="zero">—</span>' : f(num(x.min))}</td><td>${x.st ? `<span class="chip ${chipClass(x.st) || (x.need ? 'red' : '')}">${esc(x.st)}</span>` : ''}</td>` : ''}
          ${cfg.inUse ? `<td class="num">${mv(x.inUse)}</td>` : ''}
          <td class="num">${x.price ? f(x.price) : '<span class="zero">—</span>'}</td><td class="num">${x.value ? f(Math.round(x.value)) : '<span class="zero">—</span>'}</td></tr>`).join('')
          || `<tr><td colspan="13"><div class="empty">${all.length ? 'Không có mã phù hợp bộ lọc.' : 'Chưa có dữ liệu tồn kho.' + (sh(name) && sh(name).local ? ' Chạy hàm setupV5 trong Apps Script để tạo bảng.' : '')}</div></td></tr>`}</tbody>
        ${list.length ? `<tfoot><tr><td colspan="3"><b>Tổng ${list.length} mã</b> <span class="muted">(cộng số lượng các mã cùng loại để tham khảo)</span></td><td class="num">${f(tot.open7)}</td><td class="num">${f(tot.inM)}</td><td class="num">${f(tot.outT)}</td><td class="num">${f(tot.outM)}</td><td class="num">${f(tot.end)}</td>${hasMin ? '<td></td><td></td>' : ''}${cfg.inUse ? '<td></td>' : ''}<td></td><td class="num"><b>${f(Math.round(tot.value))}</b></td></tr></tfoot>` : ''}
        </table></div>`;
      $$('#stBody tr[data-r]').forEach(tr => tr.onclick = () => openRowDrawer(name, +tr.dataset.r));
    };
    draw();
    $$('[data-sf]', view).forEach(b => b.onclick = () => { vs.sf = b.dataset.sf; renderStock(view, name); });
    $('#stq').addEventListener('input', debounce(e => { vs.q = e.target.value; draw(); }, 200));
    $('#stSort').onchange = e => { vs.so = e.target.value; draw(); };
    $('#stRaw').onclick = () => { vs.raw = true; route(true); };
    $('#stPrint').onclick = () => window.print();
    $('#stCsv').onclick = () => {
      const list = filter(all), q = s => `"${String(s).replace(/"/g, '""')}"`;
      const head = ['Mã', 'Tên', 'ĐVT', 'Tồn đầu (7:00)', 'Nhập trong tháng', 'Nhập hôm nay', 'Xuất hôm nay', 'Xuất trong tháng', 'Tồn cuối', ...(hasMin ? ['Tồn min', 'Trạng thái'] : []), ...(cfg.inUse ? ['Đang sử dụng'] : []), 'Đơn giá', 'Giá trị tồn'];
      const lines = [head.map(q).join(',')].concat(list.map(x => [x.code, x.nm, x.u, n(x.open7), n(x.inM), n(x.inT), n(x.outT), n(x.outM), n(x.end), ...(hasMin ? [x.min, x.st] : []), ...(cfg.inUse ? [x.inUse] : []), x.price, Math.round(x.value)].map(q).join(',')));
      download(`${name}${k ? '_' + k : ''}_${isoOf(new Date())}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
      toast(`Đã xuất ${list.length} mã`);
    };
  }

  /* ------------------------------------------------------------------ HƯỚNG DẪN SỬ DỤNG */
  function renderGuide(view) {
    setCrumb('Hướng dẫn sử dụng', 'Danh mục');
    const S2 = [
      ['gioi-thieu', '1. Giới thiệu'], ['dang-nhap', '2. Đăng nhập & phân quyền'], ['man-hinh', '3. Bố cục màn hình'],
      ['hang-ngay', '4. Quy trình hằng ngày theo vai trò'], ['nghiep-vu', '5. Hướng dẫn từng nghiệp vụ'], ['thao-tac', '6. Thao tác chung'],
      ['dong-bo', '7. Đồng bộ, sao lưu & nhật ký'], ['hoi-dap', '8. Câu hỏi thường gặp']
    ];
    const step = list => `<ol class="steps-list">${list.map(s => `<li>${s}</li>`).join('')}</ol>`;
    view.innerHTML = `<div class="guide">
      <div class="card guide-hero"><div class="card-b">
        <h2>Hướng dẫn sử dụng · Kho Vật Tư Cụm M12</h2>
        <p>Hệ thống quản lý vật tư, công cụ dụng cụ, thiết bị và công việc hằng ngày cho 3 kho: <b>HCM20 · Sóng Thần · Tân Kim</b>. Dữ liệu lưu trên Google Sheet; trang web là nơi nhập, theo dõi và duyệt.</p>
        <nav class="toc">${S2.map(s => `<a href="#g-${s[0]}" data-anchor="g-${s[0]}">${esc(s[1])}</a>`).join('')}</nav>
      </div></div>

      <section class="card mt" id="g-gioi-thieu"><div class="card-h"><h3>1. Giới thiệu</h3></div><div class="card-b">
        <ul class="bul">
          <li><b>Một nguồn dữ liệu:</b> mọi thay đổi trên web ghi thẳng vào Google Sheet; ai sửa trên Sheet thì web cũng tự cập nhật sau 10–20 giây.</li>
          <li><b>Theo từng kho:</b> chọn kho ở góc trên bên phải để mọi bảng chỉ hiện dữ liệu của kho đó; mỗi kho có trang tổng hợp riêng ở mục <i>Theo dõi từng kho</i>.</li>
          <li><b>Tự tính:</b> tên vật tư, ĐVT, đơn giá, thành tiền, tồn kho, trạng thái… do Google Sheet tự tính – trên web là các ô <span class="code-inline">nền xám</span>, không sửa.</li>
          <li><b>Có kiểm soát:</b> mỗi người đăng nhập bằng mã riêng; mọi thay đổi ghi vào Nhật ký (ai, lúc nào, ô nào, giá trị cũ / mới).</li>
        </ul>
      </div></section>

      <section class="card mt" id="g-dang-nhap"><div class="card-h"><h3>2. Đăng nhập & phân quyền</h3></div><div class="card-b">
        ${step(['Mở trang web, nhập <b>Mã truy cập</b> cá nhân do Quản trị cấp → <b>Vào hệ thống</b>.', 'Vai trò hiện ở góc trên (Người xem / Người chỉnh sửa / Quản trị / Người duyệt).', 'Đổi tài khoản: <b>Hệ thống → Phân quyền truy cập → Đổi tài khoản</b>.'])}
        <div class="tbl-wrap" style="max-height:none"><table class="tbl perm-matrix"><thead><tr><th>Vai trò</th><th>Được làm</th></tr></thead><tbody>
          <tr><td><b>Người xem</b></td><td>Xem toàn bộ, tải Excel, in báo cáo. Không sửa được dữ liệu.</td></tr>
          <tr><td><b>Người chỉnh sửa</b></td><td>Thêm / sửa / xóa dữ liệu, cấp phát – nhận lại, tải ảnh, thêm lựa chọn dropdown, thêm mã NVL / CCDC.</td></tr>
          <tr><td><b>Người duyệt yêu cầu</b></td><td>Quyền cộng thêm: Duyệt / Từ chối <i>Dịch vụ mua ngoài</i>, duyệt hoàn thành <i>Task</i> đang “Chờ duyệt”.</td></tr>
          <tr><td><b>Quản trị</b></td><td>Toàn quyền, cấp và khóa tài khoản ở <i>Hệ thống → Phân quyền truy cập</i>.</td></tr>
        </tbody></table></div>
      </div></section>

      <section class="card mt" id="g-man-hinh"><div class="card-h"><h3>3. Bố cục màn hình</h3></div><div class="card-b">
        <ul class="bul">
          <li><b>Menu trái</b> theo thứ tự công việc: Tổng quan → Theo dõi từng kho → Dành cho Quản lý → Danh mục (GĐ1) → Nhập – Xuất – Tồn (GĐ2) → CCDC – Tuổi thọ (GĐ3) → Công việc hàng ngày (GĐ4) → Thiết bị (GĐ5) → Định mức & Kế hoạch (GĐ6) → Event (GĐ7) → Hệ thống. Số đỏ cạnh mục = việc cần xử lý (quá hạn, chờ duyệt…).</li>
          <li><b>Thanh trên:</b> chọn kho · vai trò · trạng thái đồng bộ (chấm xanh = đã đồng bộ) · ⟳ tải lại ngay · ◐ đổi giao diện sáng / tối.</li>
          <li><b>Dải cảnh báo</b> ở Tổng quan và trang kho: task quá hạn, dịch vụ chờ duyệt / quá hạn, PDA – nón / áo chưa trả.</li>
        </ul>
      </div></section>

      <section class="card mt" id="g-hang-ngay"><div class="card-h"><h3>4. Quy trình hằng ngày theo vai trò</h3></div><div class="card-b">
        <div class="grid g3">
          <div class="guide-role"><h4>Thủ kho / nhân viên kho</h4>
            <p class="lbl">Đầu ca</p>${step(['Chọn đúng kho ở góc trên.', 'Xem trang kho: mã cần đặt, máy / nón áo quá hạn trả.', 'Cấp PDA cho nhân sự trong ca (nhập MSNV – tên tự điền); giao nón / áo: gõ tên nhân viên vào chiếc được nhận.'])}
            <p class="lbl">Trong ca</p>${step(['Ghi mọi lượt xuất / nhập / điều chuyển ở Sổ Nhập – Xuất NVL hoặc CCDC ngay khi phát sinh.', 'Hư hỏng CCDC: ghi Nhật ký hư hỏng, chụp ảnh đính kèm.'])}
            <p class="lbl">Cuối ca</p>${step(['Nhận lại PDA, chọn tình trạng khi trả; nón / áo thu hồi thì bấm “Thu hồi”.', 'Kiểm tra danh sách “Đang được mượn” còn trống.', 'Cập nhật Lịch CV của kho (tiến độ sáng / tối).'])}
          </div>
          <div class="guide-role"><h4>Quản lý</h4>
            <p class="lbl">Đầu ngày (5 phút)</p>${step(['Mở Tổng quan, xử lý các dải cảnh báo.', 'Task: tab “Quá hạn” và “Hôm nay”.', 'Dịch vụ mua ngoài: tab “Chờ duyệt” → Duyệt / Từ chối.'])}
            <p class="lbl">Cuối tuần (15 phút)</p>${step(['Tồn kho: tab “Cần đặt” → lập Kế hoạch NVL tháng.', 'Task nhóm theo người phụ trách, rà mục “Dễ bị sót”.', 'Dịch vụ: tab “Thiếu giải trình”.'])}
          </div>
          <div class="guide-role"><h4>IT / phụ trách thiết bị</h4>
            ${step(['Cập nhật tình trạng máy ở <b>Thống kê PDA</b> (TỐT / HƯ / MỚI HƯ / CHỜ SỬA / ĐÃ GỬI SỬA / LƯU TRỮ), ghi mô tả lỗi và ngày ghi nhận lỗi.', 'Mở <b>Báo cáo PDA</b> → <b>Sao chép báo cáo</b> → dán vào nhóm Zalo / email.', 'Theo dõi máy quá hạn trả ở Cấp phát PDA.'])}
          </div>
        </div>
      </div></section>

      <section class="card mt" id="g-nghiep-vu"><div class="card-h"><h3>5. Hướng dẫn từng nghiệp vụ</h3></div><div class="card-b guide-dl">
        <h4>Dành cho Quản lý</h4>
        <dl>
          <dt>Task</dt><dd>“＋ Task mới” → bắt buộc tiêu đề, người phụ trách, hạn chót; chia checklist từng bước. Bấm ○ để hoàn thành nhanh. Task “Chờ duyệt” chỉ Người duyệt mới duyệt hoàn thành.</dd>
          <dt>Dịch vụ mua ngoài</dt><dd>Dùng cho mua CCDC ngoài hệ thống kho hoặc thuê dịch vụ (vệ sinh máy lạnh, côn trùng, sửa chữa…). Quy trình: <b>Đang báo giá → Chờ duyệt → Đã duyệt → Đang thực hiện → Chờ nghiệm thu → Hoàn thành</b>. Người thực hiện bấm các bước ở phần ②; Người duyệt bấm Duyệt / Từ chối ở phần ⑤. Giải trình bắt buộc khi trễ hạn, vượt chi phí, từ chối, hủy.</dd>
        </dl>
        <h4>Danh mục (GĐ1)</h4>
        <dl>
          <dt>Danh mục NVL / CCDC</dt><dd>Thêm mã mới bằng “＋ Thêm dòng” (mã tự sinh theo nhóm) hoặc ngay trong phiếu (“＋ Mã NVL mới”). Nhập <b>Đơn giá</b> ở danh mục để sổ nhập – xuất và tồn kho tự tính thành tiền, giá trị tồn. Mã không dùng nữa: “⚙ Đang dùng / Ngừng dùng” (không xóa, giữ lịch sử).</dd>
          <dt>Danh sách nhân viên</dt><dd>Họ tên, MSNV, bộ phận, kho, SĐT. Ban đầu để trống cũng được: lần đầu cấp PDA cho ai, web tự lưu người đó vào đây; lần sau gõ MSNV / tên là chọn được. Thêm cả danh sách: “⧉ Thêm nhiều” → dán 4 cột từ Excel (Họ tên · MSNV · Bộ phận · SĐT). <b>Bộ phận</b> phải đúng (Sort ca 01, Inout ca 02…) để thống kê tần suất lấy PDA. Người nghỉ việc: “✎ Sửa” → Trạng thái “Nghỉ việc” (không xóa để giữ lịch sử).</dd>
        </dl>
        <h4>Nhập – Xuất – Tồn (GĐ2)</h4>
        <dl>
          <dt>Ghi phiếu</dt><dd>Sổ Nhập – Xuất NVL / CCDC → “＋ Thêm dòng”: ngày, kho, loại giao dịch, mã, số lượng, bộ phận / kho đối ứng, MSNV (tên người nhận tự điền). Tên, ĐVT, đơn giá, thành tiền do Sheet tự lấy theo danh mục.</dd>
          <dt>Loại giao dịch</dt><dd><b>Nhập</b> · <b>Xuất</b> (phải có người nhận) · <b>Điều chuyển đi</b> + <b>Điều chuyển đến</b> (ghi 2 dòng, mỗi kho 1 dòng) · <b>Xuất hủy / hao hụt</b> · riêng CCDC có <b>Thu hồi nhập kho</b>. Cột “Kiểm tra” báo dòng thiếu dữ liệu hoặc sai mã.</dd>
          <dt>Tồn kho</dt><dd><b>Tồn đầu</b> = tồn chốt 7:00 sáng; <b>Nhập trong tháng</b>; <b>Xuất hôm nay</b> và <b>Xuất trong tháng</b>; <b>Tồn cuối</b> = Tồn đầu + Nhập hôm nay − Xuất hôm nay. Tab “Cần đặt” liệt kê mã dưới mức Min. Tồn đầu kỳ (khi bắt đầu dùng hệ thống) nhập ở “⚙ Bảng gốc”.</dd>
          <dt>Kiểm kê</dt><dd>Ghi số đếm thực tế theo kỳ (tuần / tháng / quý / trước – sau event) để đối chiếu với tồn cuối.</dd>
        </dl>
        <h4>CCDC – Tuổi thọ (GĐ3)</h4>
        <dl>
          <dt>Sổ tài sản CCDC</dt><dd>Ghi CCDC cấp cho vị trí / người dùng; web cảnh báo hết tuổi thọ và đến hạn kiểm tra.</dd>
          <dt>Hư hỏng · Thanh lý</dt><dd>Ghi nhật ký hư hỏng (kèm ảnh); báo cáo hư hỏng theo kỳ; đề xuất thanh lý theo quý.</dd>
        </dl>
        <h4>Công việc hàng ngày (GĐ4)</h4>
        <dl>
          <dt>Lịch CV từng kho</dt><dd>Chọn tháng / năm; nhập công việc sáng / tối và tiến độ (Hoàn thành / Chưa hoàn thành). Dòng hôm nay được tô vàng.</dd>
          <dt>Nón bảo hộ & áo phản quang</dt><dd>Dạng <b>danh sách</b>: mỗi chiếc nón / áo 1 dòng (mã số tự đánh, VD NON-20-001, AO-ST-001 – tạo hàng loạt bằng “＋ Thêm nón / áo”). Nhân viên nhận → gõ <b>tên</b> (hoặc MSNV) vào ô “Người đang giữ” của chiếc đó rồi Enter – MSNV và ngày nhận tự điền. Thu hồi về kho → “↩ Thu hồi”. Hư / mất → đổi Tình trạng. Lịch sử giao – nhận xem ở Nhật ký thay đổi.</dd>
          <dt>Găng tay bảo hộ</dt><dd><b>Cấp lần đầu</b>: “⧉ Cấp phát ban đầu” → chọn bộ phận → tích nhân viên chưa nhận (mặc định đã tích hết) → mỗi người 1 đôi. <b>Đổi găng</b>: nhân viên mang găng hư tới → bấm “⇄ Đổi găng” trên dòng người đó (hoặc “＋ Cấp / đổi găng”, nhập MSNV) → chọn <i>Có găng cũ</i> (xanh) hoặc <i>Không có găng cũ</i> (đỏ – hệ thống tính <b>truy thu</b> = số đôi × đơn giá, bắt buộc) → chụp ảnh minh chứng. Ô bộ phận ở trên cho thấy “Đã cấp x / y” từng bộ phận, bấm để lọc. Tab “Quá 3 tuần chưa đổi” = danh sách cần nhắc. <b>Nhập kho</b> ghi kèm đơn giá (lịch sử giá ở tab Nhập – tồn kho); cuối tháng <b>Kiểm kê</b> nhập số đếm thực tế → web báo chênh lệch với sổ sách.</dd>
        </dl>
        <h4>Thiết bị (GĐ5)</h4>
        <dl>
          <dt>Thống kê PDA</dt><dd>Mỗi máy 1 dòng: <b>Số máy PDA</b> (VD: PDA-20-07 – tự gợi ý theo kho, sửa theo nhãn dán trên máy), kho, IMEI, tên thiết bị, tình trạng, mô tả lỗi, <b>ngày ghi nhận lỗi (ngày hư)</b>, ngày gửi đi sửa, ngày nhận sửa chữa, <b>dự kiến sửa xong</b>. Tình trạng gồm cả CHỜ THANH LÝ / ĐÃ THANH LÝ. Các tab phía trên bảng tách máy theo <b>Tốt · Mới hư · Hư</b> (gồm chờ sửa / đang sửa) <b>· Thanh lý</b>. Thêm máy mới: “＋ Thêm dòng” → phần <b>📥 Nhập máy</b> ghi <b>ngày nhập máy</b> và <b>MSNV người nhập</b> (tên lấy từ Danh sách nhân viên; MSNV mới thì điền tên lần đầu) – lưu ở tab “Nhật ký nhập máy PDA”.</dd>
          <dt>Cấp phát PDA hằng ngày</dt><dd>Dạng <b>danh sách máy</b> (chỉ máy tình trạng TỐT), chia 2 nhóm <i>Đã cấp phát</i> / <i>Trong kho</i>. Chọn <b>Ca cấp</b>, rồi gõ <b>MSNV</b> (hoặc tên) vào ô “Người nhận” của máy → Enter / “Cấp”. Người mới: điền họ tên + bộ phận 1 lần, web tự lưu vào <b>Danh sách nhân viên</b>; lần sau chỉ cần chọn. Nhận lại: “✓ Trả” (máy bình thường), “⚠ Trả có lỗi” (ghi lỗi, cập nhật Thống kê PDA thành MỚI HƯ), hoặc tích chọn nhiều máy → “Nhận lại máy đã chọn” khi hết ca.</dd>
          <dt>Lịch sử & tần suất cấp PDA</dt><dd>Mỗi lượt cấp được lưu thành 1 dòng ở tab CAP_PHAT_PDA. Tab <b>Lịch sử cấp PDA</b>: lọc theo tuần / tháng / bộ phận, xuất Excel. Tab <b>Tần suất theo bộ phận</b>: số lượt lấy PDA của <b>Sort</b> và <b>In/out</b> (tuần này, tuần trước, tháng này, tháng trước…), trung bình / ngày, biểu đồ theo ngày, nhân viên lấy nhiều nhất; “Sao chép báo cáo” để gửi nhóm.</dd>
          <dt>Báo cáo PDA</dt><dd>Tổng hợp từng kho: tổng máy đang quản lý, hoạt động tốt theo model, hư hỏng (mô tả, ngày hư, dự kiến sửa xong – trễ hạn tô đỏ), chờ sửa / đang bảo hành, chờ thanh lý, cấp phát trong ngày. “Sao chép báo cáo” tạo nội dung sẵn để gửi nhóm.</dd>
          <dt>Thanh lý PDA</dt><dd>Cuối trang Báo cáo PDA: tab <b>Máy hư – đề xuất thanh lý</b> → bấm “Đề xuất thanh lý” (máy chuyển CHỜ THANH LÝ) → khi đã bàn giao bấm “Đã thanh lý” (máy không còn tính vào tổng). “Sao chép danh mục” để gửi phê duyệt.</dd>
        </dl>
        <h4>Định mức & Kế hoạch (GĐ6) · Event (GĐ7)</h4>
        <dl>
          <dt>Định mức Min / Max</dt><dd>Nhập Min / Max từng kho; có gợi ý theo xuất trung bình 3 tháng. Tồn dưới Min → trạng thái “CẦN ĐẶT”.</dd>
          <dt>Kế hoạch NVL / CCDC</dt><dd>Chọn kho, tháng / quý, hệ số event ở phần tham số → ra số lượng cần đặt, ngân sách, hạn đặt chậm nhất.</dd>
          <dt>Event</dt><dd>Lịch event và các mốc chuẩn bị; checklist từng việc, cảnh báo việc trễ.</dd>
        </dl>
      </div></section>

      <section class="card mt" id="g-thao-tac"><div class="card-h"><h3>6. Thao tác chung</h3></div><div class="card-b guide-dl"><dl>
        <dt>Sửa nhanh</dt><dd>Bấm vào ô (chữ đậm) để sửa: Enter lưu · Esc hủy · Tab sang ô kế tiếp. Ô nền xám là công thức – không sửa.</dd>
        <dt>Thêm / xem / xóa dòng</dt><dd>“＋ Thêm dòng” mở form nhập. ✎ xem – sửa chi tiết, 📷 ảnh, 🗑 xóa nội dung dòng (giữ công thức).</dd>
        <dt>Dropdown</dt><dd>Cuối mỗi dropdown có “＋ Thêm lựa chọn mới…” và “⚙ Sửa / xóa danh sách…” (VD: bộ phận, tên thiết bị). Bỏ lựa chọn không làm mất dữ liệu cũ.</dd>
        <dt>MSNV ↔ người nhận</dt><dd>Nhập MSNV, tên tự điền (và ngược lại). Người mới được web ghi nhớ sau lần lưu đầu tiên.</dd>
        <dt>Tìm, lọc, xuất</dt><dd>Ô tìm kiếm (phím /), “Lọc theo cột”, bấm tiêu đề cột để sắp xếp, “Xuất Excel”, “In”.</dd>
        <dt>Hình ảnh</dt><dd>📷 ở từng dòng: chụp trực tiếp bằng điện thoại, ảnh tự nén và lưu vào Google Drive; xem tất cả ở <i>Hệ thống → Thư viện hình ảnh</i>.</dd>
      </dl></div></section>

      <section class="card mt" id="g-dong-bo"><div class="card-h"><h3>7. Đồng bộ, sao lưu & nhật ký</h3></div><div class="card-b guide-dl"><dl>
        <dt>Đồng bộ</dt><dd>Lưu là ghi ngay lên Google Sheet. Mất mạng: thay đổi được giữ trên máy (“Chờ đồng bộ”) và tự gửi khi có mạng.</dd>
        <dt>Sao lưu</dt><dd>Tự động sao lưu cả file lúc 23:00 hằng ngày (giữ 30 bản). Quản trị / người chỉnh sửa có thể “Sao lưu ngay” ở <i>Cài đặt & Sao lưu</i>.</dd>
        <dt>Nhật ký</dt><dd><i>Hệ thống → Nhật ký thay đổi</i>: ai đã sửa gì, lúc nào, giá trị cũ / mới.</dd>
      </dl></div></section>

      <section class="card mt" id="g-hoi-dap"><div class="card-h"><h3>8. Câu hỏi thường gặp</h3></div><div class="card-b guide-dl"><dl>
        <dt>Báo “Sai mã truy cập” / “Tài khoản đã bị khóa”</dt><dd>Liên hệ Quản trị để kiểm tra mã ở trang Phân quyền truy cập.</dd>
        <dt>Không thấy nút Thêm / Sửa</dt><dd>Tài khoản đang là Người xem – nhãn “👁 Chỉ xem” ở góc trên.</dd>
        <dt>Thành tiền / giá trị tồn bằng 0</dt><dd>Mã đó chưa có đơn giá ở Danh mục NVL / CCDC.</dd>
        <dt>Tên thiết bị báo “Chưa khai báo”</dt><dd>Số máy / IMEI chưa có ở Thống kê PDA – khai báo máy trước khi cấp.</dd>
        <dt>Sửa trên Sheet mà web chưa đổi</dt><dd>Bấm ⟳ hoặc chờ 10–20 giây.</dd>
      </dl></div></section>
    </div>`;
    $$('[data-anchor]', view).forEach(a => a.onclick = e => { e.preventDefault(); const t = document.getElementById(a.dataset.anchor); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }

  /* ------------------------------------------------------------------ export */
  function download(name, content, type) {
    const blob = new Blob([content], { type }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportCSV(def) {
    const cols = visibleCols(def), rows = filteredRows(def);
    const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [cols.map(c => q((c.kho ? c.kho + ' – ' : '') + c.h)).join(',')].concat(rows.map(r => cols.map(c => q(fmt(val(def.name, r, c.c), c.h))).join(',')));
    download(`${def.name}${state.kho !== 'ALL' ? '_' + state.kho : ''}_${isoOf(new Date())}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    toast(`Đã xuất ${rows.length} dòng`);
  }

  /* ------------------------------------------------------------------ login */
  function showLogin(authFail, msg) {
    if ($('.modal-bg')) return;
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal"><img class="login-logo" src="assets/img/ghn-logo.png" alt="GHN"><h3>Đăng nhập Kho Vật Tư M12</h3><p class="muted" style="margin:0">${authFail ? esc(msg || 'Mã truy cập không đúng hoặc chưa nhập.') : 'Nhập mã truy cập cá nhân do Quản trị cấp.'}</p>
      <div class="field"><label for="lKey">Mã truy cập</label><input class="input" id="lKey" type="password" autocomplete="current-password" value="${esc(state.key)}"></div>
      <div class="field"><label for="lUser">Họ tên / bộ phận <span class="muted" style="font-weight:500">(chỉ cần khi dùng mã chung)</span></label><input class="input" id="lUser" value="${esc(state.user)}" placeholder="VD: Trần B – Thủ kho ST"></div>
      <div class="row"><button class="btn" id="lLater">Để sau</button><button class="btn primary" id="lOk">Vào hệ thống</button></div></div>`;
    document.body.appendChild(bg);
    $('#lOk').onclick = () => {
      const newKey = $('#lKey').value.trim();
      if (newKey !== state.key) { state.me = null; LS.del('me'); }   // đổi tài khoản → chờ máy chủ báo quyền mới
      state.user = $('#lUser').value.trim(); state.key = newKey; LS.set('user', state.user); LS.set('key', state.key); state.authFail = false; bg.remove(); applyRoleUi(); fetchAll().then(flush);
    };
    setTimeout(() => $('#lKey').focus(), 50);
    $('#lLater').onclick = () => bg.remove();
    $('#lKey').addEventListener('keydown', e => { if (e.key === 'Enter') $('#lOk').click(); });
  }

  /* ------------------------------------------------------------------ kho filter / theme */
  function setKho(k) {
    state.kho = k || 'ALL'; LS.set('kho', state.kho);
    $('#khoFilter').value = state.kho;
  }
  function initTheme() {
    const t = LS.get('theme', null); if (t) document.documentElement.dataset.theme = t;
    $('#themeBtn').onclick = () => {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const n = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; LS.set('theme', n); route(true);
    };
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    initTheme();
    applyRoleUi();
    $('#roleBadge').onclick = () => { location.hash = '#/phan-quyen'; };
    $('#khoFilter').innerHTML = '<option value="ALL">Tất cả kho</option>' + KHO.map(k => `<option value="${k.code}">${esc(k.code)} – ${esc(k.short)}</option>`).join('');
    $('#khoFilter').value = state.kho;
    $('#khoFilter').onchange = e => { setKho(e.target.value); Object.values(state.views).forEach(v => v.page = 1); route(true); };
    $('#openSheet').href = `https://docs.google.com/spreadsheets/d/${C.SHEET_ID}/edit`;
    $('#syncBadge').onclick = () => { if (state.authFail) showLogin(true); };
    $('#menuBtn').onclick = () => $('#app').classList.toggle('nav-open');
    $('#scrim').onclick = () => $('#app').classList.remove('nav-open');
    $('#refreshBtn').onclick = () => { if (state.apiUrl) { flush(); fetchAll(); } else toast('Chưa kết nối Google Sheet – vào Cài đặt để kết nối', 'warn'); };
    $('#drawer').addEventListener('click', e => { if (e.target === $('#drawer') || e.target.closest('[data-close]')) closeDrawer(); });
    $('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (!$('#lightbox').hidden) $('#lightbox').hidden = true; else if ($('#drawer').classList.contains('open')) closeDrawer(); }
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && $('#q')) { e.preventDefault(); $('#q').focus(); }
    });
    window.addEventListener('hashchange', () => route(false));
    window.addEventListener('online', () => { state.online = true; flush(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

    // Dữ liệu: bộ nhớ đệm (nếu có) → bản chụp → Google Sheet trực tiếp
    const cache = state.apiUrl ? LS.get('cache', null) : null;
    if (cache && cache.data) { state.data = stripPrivate(cache.data); state.images = cache.images || []; state.rev = cache.rev; state.mode = 'cache'; }
    else { state.data = JSON.parse(JSON.stringify(window.SNAPSHOT)); state.mode = 'snapshot'; }
    ensureLocalSheets();
    state.queue.forEach(applyLocal);
    fillDatalists(); updateBanner(); setSync(state.apiUrl ? 'busy' : '');
    route(false);
    if (state.apiUrl) {
      if (!state.user) showLogin(false);
      fetchAll(true).then(flush);
      setInterval(poll, (C.POLL_SECONDS || 20) * 1000);
      setInterval(() => { if (state.queue.length) flush(); }, 15000);
    }
  }
  init();
})();
