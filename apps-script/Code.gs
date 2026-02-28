const EMPLOYEES_FILE_ID = '1tJ_U_EtSF7YCjGahjKYn-w_TDgCuaPZL_tGMJ0ZFOdM';
const SCANNER_FILE_ID = '1RAGc0WsyXO6A7fjyad_nJDiLqM22eYREccJdjie3TMw';

const SCANNER_SHEET_NAME = 'Cadvel2';
const EMP_SHEET_NAME = 'Cadvel1';

function doGet(e) {
  const cb = e?.parameter?.callback;
  try {
    const action = (e?.parameter?.action || '').toString();

    let result;
    if (action === 'login') {
      result = handleLogin_(e);
    } else if (action === 'scanTicket') {
      result = handleScanTicket_(e);
    } else if (action === 'checkScanStatus') {
      result = handleCheckScanStatus_(e);
    } else if (action === 'getDailyScans') {
      result = handleGetDailyScans_(e);
    } else {
      result = { status: 'error', message: 'Naməlum əməliyyat' };
    }

    return sendJSONP_(result, cb);
  } catch (err) {
    return sendJSONP_({ status: 'error', message: String(err) }, cb);
  }
}

function doPost(e) {
  return doGet(e);
}

function sendJSONP_(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${json})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function openByIdSafe_(id, label) {
  try {
    return SpreadsheetApp.openById(id);
  } catch (openByIdErr) {
    try {
      const file = DriveApp.getFileById(id);
      return SpreadsheetApp.open(file);
    } catch (fallbackErr) {
      throw new Error(`${label} açılmadı. ID/Access problemi. ID=${id} | openById=${openByIdErr} | fallback=${fallbackErr}`);
    }
  }
}

function tzNow_() {
  return new Date();
}

function todayDDMMYYYY_() {
  return Utilities.formatDate(tzNow_(), 'Asia/Baku', 'dd.MM.yyyy');
}

function timeHHMM_() {
  return Utilities.formatDate(tzNow_(), 'Asia/Baku', 'HH:mm');
}

function normalizeQRDate_(dateToken) {
  const s = (dateToken || '').toString().trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;

  if (/^\d{8}$/.test(s)) {
    const yyyy = s.slice(0, 4);
    const mm = s.slice(4, 6);
    const dd = s.slice(6, 8);
    return `${dd}.${mm}.${yyyy}`;
  }

  return '';
}

function parseQR_(qrData) {
  const parts = (qrData || '').toString().split('|');
  // gözlənən: GHG|EMPID|TYPECODE|DATE|HASH|TYPEID
  if (parts.length < 6) return null;
  if (parts[0] !== 'GHG') return null;

  const empId = (parts[1] || '').toString().trim();
  const typeCode = (parts[2] || '').toString().trim(); // S/G/A/Q
  const rawDate = (parts[3] || '').toString().trim();
  const dateStr = normalizeQRDate_(rawDate);
  const hash = (parts[4] || '').toString().trim();
  const typeId = (parts[5] || '').toString().trim(); // breakfast/lunch/dinner/dry

  if (!empId || !typeCode || !dateStr || !typeId) return null;

  return { empId, typeCode, dateStr, hash, typeId };
}

function ticketName_(code) {
  return ({
    S: 'Səhər Yeməyi',
    G: 'Günorta Yeməyi',
    A: 'Axşam Yeməyi',
    Q: 'Quru Talon'
  })[code] || 'Naməlum';
}

function handleLogin_(e) {
  const id = (e.parameter.id || '').toString().trim();
  const pass = (e.parameter.pass || '').toString().trim();
  if (!id || !pass) return { status: 'error', message: 'ID və parol tələb olunur' };

  const empSS = openByIdSafe_(EMPLOYEES_FILE_ID, 'EMPLOYEES_FILE');
  const sh = empSS.getSheetByName(EMP_SHEET_NAME) || empSS.getSheets()[0];

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { status: 'not_found' };

  const headers = data[0].map((x) => String(x || '').trim().toLowerCase());
  const idCol = headers.findIndex((h) => h === 'id' || h === 'i̇d' || h.includes('id'));
  const passCol = headers.findIndex((h) => h === 'parol' || h.includes('parol'));
  const nameHeaderIndex = headers.findIndex((h) => h.includes('ad') && h.includes('soyad'));
  const nameCol = nameHeaderIndex >= 0 ? nameHeaderIndex : 2;

  if (idCol < 0 || passCol < 0) return { status: 'error', message: 'Employees sütunları tapılmadı (ID/Parol)' };

  for (let i = 1; i < data.length; i++) {
    const rowId = String(data[i][idCol] || '').trim();
    const rowPass = String(data[i][passCol] || '').trim();
    const rowName = String(data[i][nameCol] || '').trim();

    if (rowId === id) {
      if (rowPass !== pass) return { status: 'invalid_pass' };
      return { status: 'success', employee: { id, fullName: rowName } };
    }
  }
  return { status: 'not_found' };
}

function findEmployeeName_(empId) {
  try {
    const empSS = openByIdSafe_(EMPLOYEES_FILE_ID, 'EMPLOYEES_FILE');
    const sh = empSS.getSheetByName(EMP_SHEET_NAME) || empSS.getSheets()[0];
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return 'Naməlum əməkdaş';

    const headers = data[0].map((x) => String(x || '').trim().toLowerCase());
    const idCol = headers.findIndex((h) => h === 'id' || h === 'i̇d' || h.includes('id'));
    const nameHeaderIndex = headers.findIndex((h) => h.includes('ad') && h.includes('soyad'));
    const nameCol = nameHeaderIndex >= 0 ? nameHeaderIndex : 2;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol] || '').trim() === empId) {
        const n = String(data[i][nameCol] || '').trim();
        return n || 'Naməlum əməkdaş';
      }
    }
    return 'Naməlum əməkdaş';
  } catch (e) {
    return 'Naməlum əməkdaş';
  }
}

function getScannerSheet_() {
  const ss = openByIdSafe_(SCANNER_FILE_ID, 'SCANNER_FILE');
  let sh = ss.getSheetByName(SCANNER_SHEET_NAME);
  if (!sh) sh = ss.getSheetByName('Scanner') || ss.insertSheet('Scanner');

  if (sh.getLastRow() === 0) {
    sh.appendRow(['Tarix', 'Saat', '#', 'Əməkdaş ID', 'Ad Soyad', 'Talon Növü', 'Talon ID', 'Status']);
  }
  return sh;
}

function countConfirmed_(sh, dateStr, empId, typeId) {
  const last = sh.getLastRow();
  if (last < 2) return 0;

  const values = sh.getRange(2, 1, last - 1, 8).getValues();
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const talonId = String(values[i][6] || '').trim();
    const status = String(values[i][7] || '').trim();

    if (status !== 'Təsdiqləndi') continue;

    const p = parseQR_(talonId);
    if (!p) continue;

    if (p.dateStr === dateStr && p.empId === empId && p.typeId === typeId) {
      count++;
    }
  }
  return count;
}

function handleScanTicket_(e) {
  const qrData = (e.parameter.qrData || '').toString().trim();
  const parsed = parseQR_(qrData);
  if (!parsed) return { status: 'error', message: 'Yanlış QR formatı (və ya tarix formatı)' };

  const today = todayDDMMYYYY_();
  if (parsed.dateStr !== today) {
    return { status: 'error', message: 'Bu QR bu günə aid deyil' };
  }

  const sh = getScannerSheet_();
  const name = findEmployeeName_(parsed.empId);
  const ticketName = ticketName_(parsed.typeCode);

  const confirmedCount = countConfirmed_(sh, parsed.dateStr, parsed.empId, parsed.typeId);

  let statusText = 'Təsdiqləndi';
  let apiStatus = 'success';

  if (parsed.typeCode === 'Q') {
    if (confirmedCount >= 2) {
      statusText = 'Təkrar cəhd';
      apiStatus = 'warning';
    }
  } else if (confirmedCount >= 1) {
    statusText = 'Təkrar cəhd';
    apiStatus = 'warning';
  }

  sh.appendRow([
    parsed.dateStr,
    timeHHMM_(),
    parsed.dateStr,
    parsed.empId,
    name,
    ticketName,
    qrData,
    statusText
  ]);

  return {
    status: apiStatus,
    message: statusText,
    data: { empId: parsed.empId, adSoyad: name, ticketType: ticketName, ticketTypeId: parsed.typeId }
  };
}

function handleCheckScanStatus_(e) {
  const empId = (e.parameter.id || '').toString().trim();
  const typeId = (e.parameter.ticketType || '').toString().trim();
  const dateParam = (e.parameter.date || '').toString().trim();
  const dateStr = normalizeQRDate_(dateParam) || todayDDMMYYYY_();

  if (!empId || !typeId) return { status: 'error', used: false, message: 'id/ticketType boşdur' };

  const sh = getScannerSheet_();
  const confirmed = countConfirmed_(sh, dateStr, empId, typeId);

  const used = typeId === 'dry' ? confirmed >= 2 : confirmed >= 1;

  return { status: 'success', used };
}

function handleGetDailyScans_(e) {
  const today = todayDDMMYYYY_();
  const sh = getScannerSheet_();
  const last = sh.getLastRow();
  if (last < 2) return { status: 'success', date: today, scans: [] };

  const values = sh.getRange(2, 1, last - 1, 8).getValues();
  const scans = [];
  for (let i = 0; i < values.length; i++) {
    const rowDate = String(values[i][0] || '').trim();
    if (rowDate !== today) continue;

    scans.push({
      date:   rowDate,
      time:   String(values[i][1] || '').trim(),
      empId:  String(values[i][3] || '').trim(),
      name:   String(values[i][4] || '').trim(),
      type:   String(values[i][5] || '').trim(),
      status: String(values[i][7] || '').trim()
    });
  }

  // Return in reverse order (newest first)
  scans.reverse();
  return { status: 'success', date: today, scans };
}
