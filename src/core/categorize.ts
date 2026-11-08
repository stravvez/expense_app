/** spend = counts as spending; investment / self = money moved, not spent (kept out of spend totals) */
export type CategoryKind = "spend" | "investment" | "self";
export type DefaultCategory = { key: string; name: string; icon: string; color: string; kind?: CategoryKind };

/** Seeded on first run. `key` is stable; names can be renamed by the user. */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { key: 'food', name: 'Food & Dining', icon: '🍔', color: '#eb6834' },
  { key: 'groceries', name: 'Groceries', icon: '🛒', color: '#008300' },
  { key: 'transport', name: 'Transport', icon: '🚕', color: '#2a78d6' },
  { key: 'shopping', name: 'Shopping', icon: '🛍️', color: '#e87ba4' },
  { key: 'entertainment', name: 'Entertainment', icon: '🎬', color: '#6250d6' },
  { key: 'bills', name: 'Bills & Recharge', icon: '💡', color: '#eda100' },
  { key: 'health', name: 'Health', icon: '💊', color: '#1baf7a' },
  { key: 'education', name: 'Education', icon: '📚', color: '#8a8984' },
  { key: 'travel', name: 'Travel', icon: '✈️', color: '#e34948' },
  { key: 'rent', name: 'Rent & Home', icon: '🏠', color: '#8a8984' },
  { key: 'transfers', name: 'Transfers to people', icon: '👥', color: '#8a8984' },
  { key: 'other', name: 'Other', icon: '📦', color: '#8a8984' },
  { key: 'investments', name: 'Investments', icon: '📈', color: '#8a8984', kind: 'investment' },
  { key: 'self', name: 'Self-transfer', icon: '🔁', color: '#8a8984', kind: 'self' },
];

/** keyword (matched against normalised counterparty + vpa) → category key */
export const DEFAULT_KEYWORDS: Record<string, string[]> = {
  food: ['swiggy', 'zomato', 'eatsure', 'dominos', 'pizza', 'mcdonald', 'kfc', 'burger', 'starbucks', 'cafe', 'coffee', 'chai', 'restaurant', 'dhaba', 'biryani', 'bakery', 'canteen', 'mess', 'food', 'haldiram', 'barbeque', 'subway', 'faasos'],
  groceries: ['blinkit', 'grofers', 'zepto', 'bigbasket', 'instamart', 'dmart', 'jiomart', 'reliance fresh', 'more retail', 'kirana', 'grocery', 'supermarket', 'dairy', 'milk', 'vegetable', 'fruits'],
  transport: ['uber', 'ola', 'rapido', 'metro', 'irctc', 'redbus', 'fastag', 'petrol', 'fuel', 'indianoil', 'iocl', 'bharat petroleum', 'bpcl', 'hpcl', 'hp petrol', 'parking', 'auto', 'cab', 'namma yatri', 'yulu'],
  shopping: ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'tata cliq', 'croma', 'decathlon', 'lenskart', 'reliance digital', 'snapdeal', 'shopsy', 'store', 'mart', 'fashion'],
  entertainment: ['bookmyshow', 'pvr', 'inox', 'cinepolis', 'netflix', 'hotstar', 'jiocinema', 'jiohotstar', 'prime video', 'spotify', 'youtube', 'sonyliv', 'zee5', 'steam', 'playstation', 'gaming', 'district'],
  bills: ['airtel', 'jio', 'vodafone', 'vi ', 'bsnl', 'electricity', 'bescom', 'msedcl', 'tata power', 'adani', 'broadband', 'act fibernet', 'gas', 'water', 'recharge', 'dth', 'tata play', 'insurance', 'lic', 'bill'],
  health: ['apollo', 'pharmeasy', 'netmeds', '1mg', 'tata 1mg', 'medplus', 'pharmacy', 'medical', 'chemist', 'hospital', 'clinic', 'diagnostic', 'lab', 'practo', 'cult', 'gym', 'fitness'],
  education: ['udemy', 'coursera', 'byju', 'unacademy', 'college', 'university', 'school', 'tuition', 'books', 'stationery', 'exam', 'fees', 'bits'],
  travel: ['makemytrip', 'goibibo', 'cleartrip', 'yatra', 'ixigo', 'airbnb', 'oyo', 'hotel', 'indigo', 'air india', 'vistara', 'akasa', 'spicejet'],
  investments: ['sip', 'nach', 'mutual fund', 'zerodha', 'groww', 'upstox', 'indmoney', 'paytm money', 'kuvera', 'smallcase', 'etmoney', 'angel one', 'hdfcmf', 'hdfc mf', 'sbi mf', 'icici pru', 'nippon', 'bse star', 'kfintech', 'nps', 'ppf', 'recurring deposit'],
  self: ['self', 'own account', 'self transfer'],
  rent: ['rent', 'nobroker', 'nestaway', 'housing', 'maintenance', 'society', 'pg ', 'hostel'],
};

const NOISE = /\b(pvt|private|ltd|limited|llp|inc|india|technologies|technology|tech|services|solutions|online|retail|enterprises|co)\b/g;

/** "Swiggy Pvt Ltd" → "swiggy", "swiggy.upi@axisbank" → "swiggy upi" */
export function normalizeParty(s: string | null | undefined): string {
  if (!s) return '';
  let t = s.toLowerCase();
  if (t.includes('@')) t = t.split('@')[0];
  return t
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type RuleRow = { match_type: 'exact' | 'keyword'; pattern: string; category_id: number; origin: 'default' | 'learned' };

/**
 * Precedence: learned exact (counterparty, then vpa) → learned keyword → default keyword.
 * Returns null → Uncategorised.
 */
/**
 * Union Bank SMS cut the payee to ~5–8 characters ("Fv.Redbu", "Fvg: CHANDA D").
 * Such names only make sense as a prefix of the real name.
 */
export function isTruncatedName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  return n.length >= 3 && n.length <= 8 && !n.includes('@');
}

export function categorize(
  input: { counterparty?: string | null; vpa?: string | null; truncated?: boolean },
  rules: RuleRow[]
): number | null {
  const direct = categorizeDirect(input, rules);
  if (direct != null || !input.truncated) return direct;

  // Truncated payee: "redbu" → learned/default pattern that starts with it ("redbus").
  const short = normalizeParty(input.counterparty).replace(/\s+/g, '');
  if (short.length < 4) return null;
  const rank = (r: RuleRow) => (r.origin === 'learned' ? 0 : 2) + (r.match_type === 'exact' ? 0 : 1);
  const hit = rules
    .map((r) => ({ r, p: r.pattern.toLowerCase().replace(/[^a-z0-9]/g, '') }))
    .filter(({ p }) => p.length > short.length && p.startsWith(short))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.p.length - b.p.length)[0];
  return hit?.r.category_id ?? null;
}

function categorizeDirect(input: { counterparty?: string | null; vpa?: string | null }, rules: RuleRow[]): number | null {
  const cp = normalizeParty(input.counterparty);
  const vp = normalizeParty(input.vpa);
  const keys = [cp, vp].filter(Boolean);
  if (!keys.length) return null;

  const exact = rules.filter((r) => r.match_type === 'exact');
  for (const k of keys) {
    const hit = exact.find((r) => r.pattern === k);
    if (hit) return hit.category_id;
  }

  const haystack = ` ${keys.join(' ')} `;
  const kw = rules
    .filter((r) => r.match_type === 'keyword')
    .sort((a, b) => (a.origin === b.origin ? b.pattern.length - a.pattern.length : a.origin === 'learned' ? -1 : 1));
  for (const r of kw) {
    const p = r.pattern.toLowerCase();
    // word-ish boundary match so "ola" doesn't hit "cola"
    const re = new RegExp(`(^|[^a-z0-9])${p.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    if (re.test(haystack)) return r.category_id;
  }
  return null;
}

/** Key used when the user re-categorises a transaction ("learn from edits"). */
export function learnKey(input: { counterparty?: string | null; vpa?: string | null }): string | null {
  return normalizeParty(input.counterparty) || normalizeParty(input.vpa) || null;
}
