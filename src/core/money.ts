/** All money is stored as integer paise to avoid floating-point drift. */

export function toPaise(amount: string | number): number {
  if (typeof amount === 'number') return Math.round(amount * 100);
  const clean = amount.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return NaN;
  const [rupees, frac = ''] = clean.split('.');
  return parseInt(rupees, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
}

/** Indian digit grouping: 12,34,567.89 */
function groupIndian(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

export function formatINR(paise: number, opts: { decimals?: boolean; sign?: boolean } = {}): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const showDecimals = opts.decimals ?? p !== 0;
  const body = `₹${groupIndian(rupees)}${showDecimals ? '.' + String(p).padStart(2, '0') : ''}`;
  if (neg) return `−${body}`;
  return opts.sign && paise > 0 ? `+${body}` : body;
}

/** Compact form for chart axes / tiles: ₹1.2L, ₹45.3k */
export function formatINRCompact(paise: number): string {
  const r = Math.abs(paise) / 100;
  const sign = paise < 0 ? '−' : '';
  if (r >= 1e7) return `${sign}₹${(r / 1e7).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (r >= 1e5) return `${sign}₹${(r / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
  if (r >= 1e3) return `${sign}₹${(r / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}₹${Math.round(r)}`;
}
