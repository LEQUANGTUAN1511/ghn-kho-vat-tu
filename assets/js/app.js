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
    key: LS.get('key', ''), user: LS.get('user', ''),
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
    if (/^(CẦN ĐẶT|QUÁ HẠN|TRỄ|LỆCH|MÃ SAI|THIẾU|HƯ|MỚI HƯ|CHƯA HOÀN THÀNH)/.test(t)) return 'red';
    if (/^(SẮP|GẤP|DƯ$|CHƯA ĐẶT ĐM|CHỜ|ĐANG|ĐÃ THU HỒI|ĐÃ GỬI SỬA|CHƯA KIỂM TRA|CHƯA LÀM)/.test(t)) return 'amber';
    if (/^(OK|KHỚP|XONG|HOÀN THÀNH|TỐT|ĐÃ DUYỆT|ĐÃ DIỄN RA)$/.test(t)) return 'green';
    if (/^(ĐÃ THANH LÝ|LƯU TRỮ|CHƯA BẮT ĐẦU|KHO \(DỰ PHÒNG\))/.test(t)) return 'blue';
    return null;
  }
  const STATUS_COL = /trạng thái|tình trạng|cảnh báo|kiểm tra$|tiến độ|^tình/i;
  const khoInfo = code => KHO.find(k => k.code === code) || { code, name: code, short: code, color: '#17a99a' };
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
    file: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/>',
    task: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l1.5 1.5L12 7M8 14l1.5 1.5L12 13M14 8.5h3M14 14.5h3"/>'
  };
  const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[n] || IC.file}</svg>`;

  /* ------------------------------------------------------------------ data access */
  const sh = n => state.data && state.data.sheets && state.data.sheets[n];
  const val = (n, r, c) => { const s = sh(n); const row = s && s.v[r - 1]; return row && row[c - 1] != null ? row[c - 1] : ''; };
  const valA = (n, A1) => { const p = ref(A1); return val(n, p.r, p.c); };
  const isF = (n, r, c) => { const s = sh(n); const f = s && s.fm && s.fm[r - 1]; return !!f && f[c - 1] === '1'; };
  const OVERRIDE = { KH_NVL_THANG: ['B4'], KH_CCDC_QUY: ['B4'] };
  const canEditCell = (n, r, c) => !isF(n, r, c) || (OVERRIDE[n] || []).includes(colLet(c) + r);
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
  function codes(kind) {
    if (kind === 'KHO') return KHO_CODES.map(c => ({ v: c, l: khoInfo(c).name }));
    const name = kind === 'NVL' ? 'DM_NVL' : 'DM_CCDC', s = sh(name), out = [];
    if (!s) return out;
    for (let r = 5; r <= s.v.length; r++) { const a = val(name, r, 1); if (a) out.push({ v: a, l: val(name, r, 2), u: val(name, r, 4) }); }
    return out;
  }
  function fillDatalists() {
    ['NVL', 'CCDC', 'KHO'].forEach(k => { $('#dl-' + k).innerHTML = codes(k).map(o => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join(''); });
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
      if (!h) continue;
      let kho = null;
      if (sc.khoGroups) for (const k in sc.khoGroups) { const [a, b] = sc.khoGroups[k].map(colNum); if (c >= a && c <= b) kho = k; }
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
      if (def.cols.some(col => row[col.c - 1] !== '' && row[col.c - 1] != null)) out.push(r);
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
    if (list) return { t: 'select', list };
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
      if (String(j.error).startsWith('AUTH')) { state.authFail = true; showLogin(true); throw Object.assign(new Error('Sai mã truy cập'), { auth: true }); }
      throw new Error(j.error || 'Lỗi không xác định');
    }
    return j;
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
    else if (op.action === 'append') {
      const s = sh(n); let target = 0;
      for (let r = p.dataStart; r <= s.v.length + 1; r++) {
        let empty = true;
        for (let c = 1; c <= p.lastCol; c++) { if (!isF(n, r, c) && val(n, r, c) !== '') { empty = false; break; } }
        if (empty) { target = r; break; }
      }
      if (!target) target = s.v.length + 1;
      p._row = target;
      Object.keys(p.values).forEach(c => setLocal(n, target, +c, encLocal(p.values[c])));
    } else if (op.action === 'clearRow') {
      for (let c = 1; c <= p.lastCol; c++) if (!isF(n, p.row, c)) setLocal(n, p.row, c, '');
    } else if (op.action === 'addColumn') setLocal(n, p.headerRow, p.col, p.title);
  }

  async function flush() {
    if (state.authFail) { setSync('off'); return; }
    if (!state.apiUrl || state.syncing || !state.queue.length) { if (!state.queue.length && state.apiUrl && !state.syncing) setSync(state.online ? 'ok' : 'off'); return; }
    state.syncing = true; setSync('busy');
    let changed = false;
    while (state.queue.length) {
      const op = state.queue[0];
      try {
        const { _row, ...payload } = op.payload;
        await api(op.action, payload);
        state.queue.shift(); saveQueue(); changed = true; state.online = true;
      } catch (e) {
        if (e.auth) break;
        if (e.net || e instanceof TypeError) { state.online = false; break; }
        toast('Không ghi được: ' + e.message, 'err');
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
  async function fetchSheets(names, rev) {
    state.refreshing = true;
    try {
      setSync('busy', 'Đang cập nhật…');
      const j = await api('all', { sheets: names.join(','), nodv: 1 });
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
      await fetchSheets(list, j.rev);
    } catch (e) {
      if (!e.auth) { state.online = false; setSync('off'); }
    }
  }
  const poll = () => checkChanges(false);

  function rerender() {
    if (state.editing || $('#drawer').classList.contains('open')) { state.pendingRender = true; return; }
    state.pendingRender = false;
    route(true);
  }

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
      if (!items.length) return;
      h += `<div class="nav-sec">${esc(g.title)}</div>`;
      items.forEach(n => {
        const sc = schemaOf(n);
        let extra = '';
        if (sc.type === 'task' && state.data) { const c = taskCounts(state.kho === 'ALL' ? null : state.kho); const m = c.overdue + c.today; if (m) extra = `<span class="cnt" title="Quá hạn + đến hạn hôm nay">${m}</span>`; }
        h += a('#/sheet/' + encodeURIComponent(n), icon(sc.icon), sc.title, extra);
      });
    });
    h += '<div class="nav-sec">Hệ thống</div>';
    h += a('#/hinh-anh', icon('image'), 'Thư viện hình ảnh', state.images.length ? `<span class="cnt" style="background:#2b6f68">${state.images.length}</span>` : '');
    h += a('#/nhat-ky', icon('history'), 'Nhật ký thay đổi');
    h += a('#/cai-dat', icon('gear'), 'Cài đặt & Sao lưu');
    $('#nav').innerHTML = h;
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
    destroyCharts();
    buildNav();
    $('#app').classList.remove('nav-open');
    const view = $('#view');
    if (!state.data) { view.innerHTML = '<div class="empty">Đang tải…</div>'; return; }
    let m;
    if ((m = /^#\/kho\/(.+)$/.exec(h))) { renderKho(view, m[1]); taskAlert(view, m[1]); }
    else if ((m = /^#\/sheet\/(.+)$/.exec(h))) renderSheet(view, m[1]);
    else if (h === '#/hinh-anh') renderGallery(view);
    else if (h === '#/nhat-ky') renderLog(view);
    else if (h === '#/cai-dat') renderSettings(view);
    else { renderOverview(view); taskAlert(view, state.kho === 'ALL' ? null : state.kho); }
    if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
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
        <div class="toolbar">
          <div class="search"><input class="input" id="q" placeholder="Tìm trong bảng… (phím /)" value="${esc(vs.q)}"></div>
          ${def.type !== 'calendar' ? filterSelects(def, vs) : ''}
          <div class="right">
            ${def.addRow ? `<button class="btn primary" id="addRow">＋ Thêm dòng</button>` : ''}
            ${def.addCol ? `<button class="btn" id="addCol" title="Bổ sung hạng mục (cột mới) vào bảng">＋ Hạng mục</button>` : ''}
            <button class="btn" id="csv" title="Xuất bảng đang xem ra Excel (CSV)">⭳ Xuất Excel</button>
            <button class="btn" id="print" title="In / lưu PDF">⎙ In</button>
          </div>
        </div>
        <div id="tbl"></div>
      </div>
      ${(def.side || []).map((sd, i) => sideBlock(name, sd, i)).join('')}`;
    const draw = () => drawTable(def);
    draw();
    $('#q').addEventListener('input', debounce(e => { vs.q = e.target.value; vs.page = 1; draw(); }, 200));
    if ($('#fcol')) {
      $('#fcol').onchange = e => { vs.fcol = e.target.value; vs.fval = ''; vs.page = 1; renderSheet(view, name); };
      if ($('#fval')) $('#fval').onchange = e => { vs.fval = e.target.value; vs.page = 1; draw(); };
    }
    if ($('#addRow')) $('#addRow').onclick = () => {
      const pre = {};
      if (def.khoCol && k !== 'ALL') pre[colNum(def.khoCol)] = k;
      openRowDrawer(name, null, pre);
    };
    if ($('#addCol')) $('#addCol').onclick = () => addColumn(def);
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
      head += '<tr>' + '<th class="grp" style="background:transparent"></th>';
      let i = 0;
      while (i < cols.length) {
        const g = cols[i].kho; let span = 0;
        while (i < cols.length && cols[i].kho === g) { span++; i++; }
        head += g ? `<th class="grp" colspan="${span}" style="background:${khoInfo(g).color}">${esc(khoInfo(g).name)}</th>` : `<th class="grp" colspan="${span}" style="background:transparent"></th>`;
      }
      head += '<th class="grp" style="background:transparent"></th></tr>';
    }
    head += `<tr class="${def.khoGroups && state.kho === 'ALL' ? 'two' : ''}"><th class="rowno">#</th>` + cols.map(col => {
      const s = vs.sort && vs.sort.c === col.c ? (vs.sort.dir > 0 ? '▲' : '▼') : '↕';
      return `<th data-sort="${col.c}" class="${col.computed ? 'computed' : ''}" title="${col.computed ? 'Cột tự tính (công thức) – không sửa' : 'Cột nhập liệu – bấm vào ô để sửa'}">${esc(col.h)}<span class="sort">${s}</span></th>`;
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
      body += `<tr class="${cls}" data-r="${r}"><td class="rowno">${r}</td>`;
      cols.forEach(col => {
        const v = val(def.name, r, col.c), editable = !col.computed && canEditCell(def.name, r, col.c);
        const f = fmt(v, col.h);
        const cc = STATUS_COL.test(col.h) || def.type === 'calendar' ? chipClass(f) : null;
        const isNum = typeof v === 'number' && !RAW_HINT.test(col.h) && !(DATE_HINT.test(col.h) && v > 30000);
        const long = typeof f === 'string' && f.length > 40;
        const klass = [editable ? 'edit' : 'calc', isNum ? 'num' : (long ? 'wrap' : 'nowrap'), pendingCells.has(r + ':' + col.c) ? 'pending' : ''].join(' ');
        body += `<td class="${klass}" data-c="${col.c}">${cc ? `<span class="chip ${cc}">${esc(f)}</span>` : esc(f)}</td>`;
      });
      const nImg = state.images.filter(im => im.sheet === def.name && +im.row === r).length;
      body += `<td class="rowact"><button class="ra ${nImg ? 'has' : ''}" data-act="img" title="Hình ảnh">📷${nImg ? ' ' + nImg : ''}</button><button class="ra" data-act="open" title="Xem / sửa chi tiết">✎</button>${def.addRow ? '<button class="ra" data-act="del" title="Xóa dòng (giữ công thức)">🗑</button>' : ''}</td></tr>`;
    });
    if (!slice.length) body = `<tr><td colspan="${cols.length + 2}"><div class="empty">${tableRows(def).length ? 'Không có dòng phù hợp bộ lọc.' : 'Chưa có dữ liệu.' + (def.addRow ? ' Bấm “＋ Thêm dòng” để nhập.' : '')}</div></td></tr>`;
    host.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <div class="pager"><span>${rows.length.toLocaleString('vi-VN')} dòng${rows.length !== tableRows(def).length ? ` (lọc từ ${tableRows(def).length.toLocaleString('vi-VN')})` : ''} · <i>chữ nghiêng/xám = tự tính</i></span>
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
      ctl.innerHTML = '<option value=""></option>' + ft.list.map(o => `<option ${String(o) === cur ? 'selected' : ''}>${esc(o)}</option>`).join('') + (cur && !ft.list.map(String).includes(cur) ? `<option selected>${esc(cur)}</option>` : '');
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
    if (ctl.tagName === 'SELECT') ctl.addEventListener('change', () => finish(true));
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
    const c1 = colNum(sd.from), c2 = colNum(sd.to), hr = sd.headerRow;
    const head = []; for (let c = c1; c <= c2; c++) head.push({ c, h: String(val(n, hr, c) || '') });
    const rows = [];
    for (let r = hr + 1; r <= sh(n).v.length; r++) {
      if (sd.rows && rows.length >= sd.rows) break;
      const any = head.some(x => val(n, r, x.c) !== '');
      if (!any) { if (!sd.rows) break; continue; }
      rows.push(r);
    }
    return `<div class="card mt"><div class="card-h"><h3>${esc(sd.title)}</h3><span class="sub">tự tính trong Google Sheet</span></div><div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr>${head.map(x => `<th>${esc(x.h)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => '<tr>' + head.map(x => { const v = val(n, r, x.c); return `<td class="${typeof v === 'number' ? 'num' : ''}">${esc(fmt(v, x.h))}</td>`; }).join('') + '</tr>').join('') || `<tr><td colspan="${head.length}" class="empty">Chưa có dữ liệu</td></tr>`}</tbody></table></div></div>`;
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
      <dt>Sao lưu</dt><dd>Mọi thay đổi ghi nhật ký (tab WEB_NHAT_KY). Sao lưu cả file vào Google Drive hằng ngày lúc 23:00, và bấm “Sao lưu ngay” trong Cài đặt bất cứ lúc nào.</dd></dl>`;
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
        const cur = plain(v);
        ctl = `<select class="select" id="${id}" data-c="${col.c}"><option value=""></option>${ft.list.map(o => `<option ${String(o) === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}${cur && !ft.list.map(String).includes(cur) ? `<option selected>${esc(cur)}</option>` : ''}</select>`;
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
      <label class="upload mt" id="upl"><input type="file" accept="image/*" multiple id="imgInput"><b>Bấm để chọn ảnh</b> hoặc kéo thả vào đây<br><small>Trên điện thoại có thể chụp trực tiếp · ảnh tự nén ≤ 1600px</small></label>`;
    const title = isNew ? `Thêm dòng – ${schemaOf(name).title}` : `${schemaOf(name).title} · dòng ${r}`;
    openDrawer(title, `${!isNew ? `<div class="muted" style="margin-bottom:12px">${esc(rowLabel(def, r))}</div>` : ''}<div class="form">${fields}</div>${imgs}`,
      `${!isNew && def.addRow ? '<button class="btn danger" id="dDel">🗑 Xóa dòng</button>' : ''}<span style="flex:1"></span><button class="btn" data-close>Đóng</button><button class="btn primary" id="dSave">${isNew ? '＋ Thêm vào Sheet' : '💾 Lưu thay đổi'}</button>`);
    const body = $('#drawerBody');
    // Tự điền tên/ĐVT khi chọn mã; tự sinh mã danh mục
    if (def.autoCode && isNew) {
      const gEl = body.querySelector(`[data-c="${colNum(def.autoCode.from)}"]`), cEl = body.querySelector(`[data-c="${colNum(def.autoCode.col)}"]`);
      if (gEl && cEl) gEl.addEventListener('change', () => { if (!cEl.value) cEl.value = nextCode(def, gEl.value); });
    }
    if (def.lookup) Object.keys(def.lookup).forEach(L => {
      const el = body.querySelector(`[data-c="${colNum(L)}"]`); if (!el) return;
      const hint = document.createElement('div'); hint.className = 'muted'; hint.style.fontSize = '12px'; el.after(hint);
      const upd = () => { const o = codes(def.lookup[L]).find(x => x.v === el.value); hint.textContent = el.value ? (o ? `${o.l}${o.u ? ' · ' + o.u : ''}` : '⚠ Mã không có trong danh mục') : ''; };
      el.addEventListener('input', upd); upd();
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
      if (isNew) {
        if (!Object.keys(values).length) { toast('Chưa nhập thông tin nào', 'warn'); return; }
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
    $('#imgGrid').innerHTML = list.map(im => `<div class="ph" data-url="${esc(im.url)}" data-cap="${esc(im.name + ' · ' + im.time)}"><img loading="lazy" src="${esc(im.url)}" alt="${esc(im.name)}" referrerpolicy="no-referrer"><button class="del" data-id="${esc(im.id)}" title="Xóa ảnh">✕</button><div class="cap">${esc(im.time)}</div></div>`).join('') || '<div class="muted">Chưa có ảnh.</div>';
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
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="bNow" ${state.apiUrl ? '' : 'disabled'}>☁ Sao lưu ngay lên Drive</button><button class="btn" id="bJson">⭳ Tải bản sao lưu (.json)</button><a class="btn" href="https://docs.google.com/spreadsheets/d/${C.SHEET_ID}/export?format=xlsx" target="_blank" rel="noopener">⭳ Tải file Excel (.xlsx)</a></div>
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
    if (!state.data.sheets[TASK]) {
      state.data.sheets[TASK] = {
        v: [['QUẢN LÝ TASK – CỤM M12'], ['Dành cho Quản lý · Mỗi dòng 1 task.'], [], T_HEAD.slice()], fm: [],
        dv: { D5: T_KHO, G5: T_PRIO, J5: T_STATUS }, local: true
      };
    }
    if (state.data.order && !state.data.order.includes(TASK)) state.data.order.unshift(TASK);
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
          <div class="right">${k ? `<span class="chip brand">Đang lọc kho: ${esc(k)} + Chung</span>` : ''}<button class="btn primary" id="tNew">＋ Task mới</button></div></div>
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
      <button class="tcheck ${t.done ? 'on' : ''}" data-done="${t.r}" title="${t.done ? 'Mở lại task' : 'Đánh dấu hoàn thành'}" aria-label="${t.done ? 'Mở lại task' : 'Đánh dấu hoàn thành'}">${t.done ? '✓' : ''}</button>
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
        <label class="upload mt" id="upl"><input type="file" accept="image/*" multiple id="imgInput"><b>Bấm để chọn ảnh</b> hoặc kéo thả vào đây<br><small>Trên điện thoại có thể chụp trực tiếp · ảnh tự nén ≤ 1600px</small></label>` : ''}`;
    openDrawer(isNew ? 'Task mới' : 'Chi tiết task', body,
      `${t ? '<button class="btn danger" id="tDel">🗑 Xóa task</button>' : ''}<span style="flex:1"></span><button class="btn" data-close>Đóng</button><button class="btn primary" id="tSave">${isNew ? '＋ Tạo task' : '💾 Lưu'}</button>`);

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
    if ($('#tDel')) $('#tDel').onclick = () => {
      if (!confirm(`Xóa task “${t.title}”?\nDòng ${t.r} trên tab QL_TASK sẽ được xóa nội dung.`)) return;
      enqueue('clearRow', { sheet: TASK, row: t.r, lastCol: T_HEAD.length });
      toast('Đã xóa task'); closeDrawer(); route(true);
    };
    if (t) { drawImages(TASK, t.r); bindUpload(tableDef(TASK), t.r); }
    setTimeout(() => $('#tTitle').focus(), 250);
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
  function showLogin(authFail) {
    if ($('.modal-bg')) return;
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal"><img class="login-logo" src="assets/img/ghn-logo.png" alt="GHN"><h3>Đăng nhập Kho Vật Tư M12</h3><p class="muted" style="margin:0">${authFail ? 'Mã truy cập không đúng hoặc chưa nhập.' : 'Nhập tên để ghi nhận người thay đổi dữ liệu.'}</p>
      <div class="field"><label>Họ tên / bộ phận</label><input class="input" id="lUser" value="${esc(state.user)}" placeholder="VD: Trần B – Thủ kho ST"></div>
      <div class="field"><label>Mã truy cập</label><input class="input" id="lKey" type="password" value="${esc(state.key)}"></div>
      <div class="row"><button class="btn" id="lLater">Để sau</button><button class="btn primary" id="lOk">Vào hệ thống</button></div></div>`;
    document.body.appendChild(bg);
    $('#lOk').onclick = () => { state.user = $('#lUser').value.trim(); state.key = $('#lKey').value.trim(); LS.set('user', state.user); LS.set('key', state.key); state.authFail = false; bg.remove(); fetchAll().then(flush); };
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
    if (cache && cache.data) { state.data = cache.data; state.images = cache.images || []; state.rev = cache.rev; state.mode = 'cache'; }
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
