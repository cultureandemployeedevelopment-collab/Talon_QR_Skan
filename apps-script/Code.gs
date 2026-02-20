/**
 * GHG QR Scanner backend (Google Apps Script)
 *
 * Sheet structure:
 * - Scanner: Tarix | Saat | Əməkdaş ID | Ad Soyad | Talon Növü | Talon ID | Status
 * - Adlar: ID | Ad və Soyad
 * - REPORT: should include at least "Talon ID" and optionally
 *   "Əməkdaş ID", "Talon Növü", "Status", "İstifadə Tarixi", "İstifadə Saatı"
 */

const CONFIG = {
  sheets: {
    scanner: 'Scanner',
    names: 'Adlar',
    report: 'REPORT'
  },
  scannerStatus: {
    success: 'Təsdiqləndi',
    duplicate: 'Təkrar cəhd',
    error: 'Xəta'
  }
};

function doGet(e) {
  const callback = (e && e.parameter && e.parameter.callback) || null;

  try {
    const action = getParam_(e, 'action');

    if (action === 'scanTicket') {
      const qrData = getParam_(e, 'qrData');
      const payload = scanTicket_(qrData);
      return jsonResponse_(payload, callback);
    }

    return jsonResponse_({ status: 'error', message: 'Unknown action' }, callback);
  } catch (err) {
    return jsonResponse_({ status: 'error', message: err.message }, callback);
  }
}

function scanTicket_(qrData) {
  if (!qrData) {
    return { status: 'error', message: 'QR məlumatı boşdur' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scannerSheet = mustGetSheet_(ss, CONFIG.sheets.scanner);
  const namesSheet = mustGetSheet_(ss, CONFIG.sheets.names);
  const reportSheet = mustGetSheet_(ss, CONFIG.sheets.report);

  const now = new Date();
  const parsed = parseQr_(qrData);
  const reportRowData = findReportByQr_(reportSheet, qrData);

  const employeeId = reportRowData.empId || parsed.empId || '';
  const ticketType = reportRowData.ticketType || parsed.ticketType || 'Bilinməyən talon';
  const fullName = findNameById_(namesSheet, employeeId) || 'Bilinməyən əməkdaş';

  const alreadyUsed = isQrAlreadyUsed_(scannerSheet, qrData) || reportRowData.used;

  if (alreadyUsed) {
    appendScannerRow_(scannerSheet, {
      date: now,
      employeeId: employeeId,
      fullName: fullName,
      ticketType: ticketType,
      qrData: qrData,
      status: CONFIG.scannerStatus.duplicate
    });

    return {
      status: 'warning',
      message: 'Bu QR artıq istifadə edilib',
      data: {
        empId: employeeId,
        adSoyad: fullName,
        ticketType: ticketType,
        qrData: qrData
      }
    };
  }

  markReportAsUsed_(reportSheet, reportRowData.rowIndex, now);

  appendScannerRow_(scannerSheet, {
    date: now,
    employeeId: employeeId,
    fullName: fullName,
    ticketType: ticketType,
    qrData: qrData,
    status: CONFIG.scannerStatus.success
  });

  return {
    status: 'success',
    message: 'Talon təsdiqləndi',
    data: {
      empId: employeeId,
      adSoyad: fullName,
      ticketType: ticketType,
      qrData: qrData
    }
  };
}

function parseQr_(qrData) {
  // Expected examples:
  // - GHG|100089|S|20260219|1186
  // - GHG|232323|A|20260219|4014|dinner
  const parts = String(qrData).split('|').map(function (x) { return x.trim(); });

  if (parts.length >= 3 && parts[0] === 'GHG') {
    const typeMap = { S: 'Səhər Yeməyi', G: 'Günorta Yeməyi', A: 'Axşam Yeməyi', Q: 'Quru Talon' };

    return {
      empId: parts[1] || '',
      ticketType: typeMap[parts[2]] || parts[2] || ''
    };
  }

  return { empId: '', ticketType: '' };
}

function findReportByQr_(sheet, qrData) {
  const map = headerMap_(sheet);
  const qrCol = findHeaderColumn_(map, ['talon id', 'qr', 'qr kod', 'kod']);
  const empCol = findHeaderColumn_(map, ['əməkdaş id', 'employee id', 'id']);
  const typeCol = findHeaderColumn_(map, ['talon növü', 'növ', 'ticket type']);
  const statusCol = findHeaderColumn_(map, ['status', 'vəziyyət']);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || !qrCol) {
    return { rowIndex: 0, empId: '', ticketType: '', used: false, statusCol: statusCol };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  for (var i = 0; i < values.length; i++) {
    const row = values[i];
    const qr = normalize_(row[qrCol - 1]);

    if (qr === normalize_(qrData)) {
      const statusText = String(statusCol ? row[statusCol - 1] : '').toLowerCase();
      const used = /istifadə|tesdiq|təsdiq|used/.test(statusText);

      return {
        rowIndex: i + 2,
        empId: empCol ? String(row[empCol - 1]).trim() : '',
        ticketType: typeCol ? String(row[typeCol - 1]).trim() : '',
        used: used,
        statusCol: statusCol
      };
    }
  }

  return { rowIndex: 0, empId: '', ticketType: '', used: false, statusCol: statusCol };
}

function markReportAsUsed_(sheet, rowIndex, now) {
  if (!rowIndex) return;

  const map = headerMap_(sheet);
  const statusCol = findHeaderColumn_(map, ['status', 'vəziyyət']);
  const usedDateCol = findHeaderColumn_(map, ['istifadə tarixi', 'used date', 'tarix']);
  const usedTimeCol = findHeaderColumn_(map, ['istifadə saatı', 'used time', 'saat']);

  if (statusCol) {
    sheet.getRange(rowIndex, statusCol).setValue('İstifadə edildi');
  }

  if (usedDateCol) {
    sheet.getRange(rowIndex, usedDateCol).setValue(now);
    sheet.getRange(rowIndex, usedDateCol).setNumberFormat('dd.MM.yyyy');
  }

  if (usedTimeCol) {
    sheet.getRange(rowIndex, usedTimeCol).setValue(now);
    sheet.getRange(rowIndex, usedTimeCol).setNumberFormat('HH:mm');
  }
}

function isQrAlreadyUsed_(scannerSheet, qrData) {
  const lastRow = scannerSheet.getLastRow();
  if (lastRow < 2) return false;

  // Scanner format uses Talon ID at column 6, Status at column 7
  const values = scannerSheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const normalizedQr = normalize_(qrData);

  for (var i = 0; i < values.length; i++) {
    const qr = normalize_(values[i][5]);
    const status = String(values[i][6] || '').toLowerCase();

    if (qr === normalizedQr && /təsdiq|tesdiq|istifadə/.test(status)) {
      return true;
    }
  }

  return false;
}

function appendScannerRow_(sheet, data) {
  sheet.appendRow([
    data.date,
    data.date,
    data.employeeId,
    data.fullName,
    data.ticketType,
    data.qrData,
    data.status
  ]);

  const row = sheet.getLastRow();
  sheet.getRange(row, 1).setNumberFormat('dd.MM.yyyy');
  sheet.getRange(row, 2).setNumberFormat('HH:mm');
}

function findNameById_(namesSheet, employeeId) {
  if (!employeeId) return '';

  const lastRow = namesSheet.getLastRow();
  if (lastRow < 2) return '';

  const values = namesSheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const idStr = String(employeeId).trim();

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === idStr) {
      return String(values[i][1]).trim();
    }
  }

  return '';
}

function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};

  for (var i = 0; i < headers.length; i++) {
    const key = normalizeHeader_(headers[i]);
    if (key) map[key] = i + 1;
  }

  return map;
}

function findHeaderColumn_(map, aliases) {
  for (var i = 0; i < aliases.length; i++) {
    const key = normalizeHeader_(aliases[i]);
    if (map[key]) return map[key];
  }
  return null;
}

function normalizeHeader_(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[ı]/g, 'i');
}

function normalize_(text) {
  return String(text || '').trim().toLowerCase();
}

function mustGetSheet_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet tapılmadı: ' + sheetName);
  return sheet;
}

function getParam_(e, name) {
  return (e && e.parameter && e.parameter[name]) || '';
}

function jsonResponse_(payload, callback) {
  const text = callback
    ? callback + '(' + JSON.stringify(payload) + ')'
    : JSON.stringify(payload);

  return ContentService
    .createTextOutput(text)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}
