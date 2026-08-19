import qrcode from 'qrcode-generator';

const QR_ERROR_CORRECTION_LEVELS = new Set(['L', 'M', 'Q', 'H']);

export function createQrMatrix(value, options = {}) {
  const text = String(value || '').trim();
  if (!text) throw new Error('QR code value is required.');
  if (text.length > 2048) throw new Error('QR code value is too long.');

  const requestedLevel = String(options.errorCorrectionLevel || 'M').toUpperCase();
  const errorCorrectionLevel = QR_ERROR_CORRECTION_LEVELS.has(requestedLevel)
    ? requestedLevel
    : 'M';
  const qr = qrcode(0, errorCorrectionLevel);
  qr.addData(text, 'Byte');
  qr.make();

  const size = qr.getModuleCount();
  let matrix = '';
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      matrix += qr.isDark(row, column) ? '1' : '0';
    }
  }

  return {
    value: text,
    size,
    matrix,
    errorCorrectionLevel,
  };
}
