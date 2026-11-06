/** person id; `null` means "me" */
export type PartyId = number | null;
export type SplitMode = 'equal' | 'exact' | 'percent';
export type Share = { personId: PartyId; sharePaise: number };

export type ComputeResult = { ok: true; shares: Share[] } | { ok: false; error: string };

/**
 * Compute shares. Leftover paise from rounding go to "me" when I'm a participant,
 * otherwise to the first participant, so shares always sum exactly to the total.
 */
export function computeShares(
  totalPaise: number,
  mode: SplitMode,
  participants: PartyId[],
  values: Map<PartyId, number> = new Map() // exact: paise; percent: 0-100
): ComputeResult {
  if (totalPaise <= 0) return { ok: false, error: 'Amount must be more than zero' };
  if (!participants.length) return { ok: false, error: 'Pick at least one person' };
  if (new Set(participants).size !== participants.length) return { ok: false, error: 'Duplicate participant' };

  const absorbIdx = participants.includes(null) ? participants.indexOf(null) : 0;
  let shares: number[];

  if (mode === 'equal') {
    const base = Math.floor(totalPaise / participants.length);
    shares = participants.map(() => base);
  } else if (mode === 'exact') {
    shares = participants.map((p) => Math.round(values.get(p) ?? 0));
    const sum = shares.reduce((a, b) => a + b, 0);
    if (shares.some((s) => s < 0)) return { ok: false, error: 'Shares cannot be negative' };
    if (sum !== totalPaise) return { ok: false, error: `Shares add up to ${(sum / 100).toFixed(2)}, need ${(totalPaise / 100).toFixed(2)}` };
    return { ok: true, shares: participants.map((personId, i) => ({ personId, sharePaise: shares[i] })) };
  } else {
    const pct = participants.map((p) => values.get(p) ?? 0);
    const sumPct = pct.reduce((a, b) => a + b, 0);
    if (pct.some((x) => x < 0)) return { ok: false, error: 'Percent cannot be negative' };
    if (Math.abs(sumPct - 100) > 0.001) return { ok: false, error: `Percentages add up to ${sumPct}%, need 100%` };
    shares = pct.map((x) => Math.floor((totalPaise * x) / 100));
  }

  const rem = totalPaise - shares.reduce((a, b) => a + b, 0);
  shares[absorbIdx] += rem;
  return { ok: true, shares: participants.map((personId, i) => ({ personId, sharePaise: shares[i] })) };
}

export type SplitRecord = { payerPersonId: PartyId; shares: Share[] };
export type SettlementRecord = { personId: number; amountPaise: number; direction: 'in' | 'out' };

/**
 * Net balance per person from my point of view.
 * > 0 → they owe me; < 0 → I owe them.
 * Settlement 'in' = they paid me; 'out' = I paid them.
 */
export function computeBalances(splits: SplitRecord[], settlements: SettlementRecord[]): Map<number, number> {
  const bal = new Map<number, number>();
  const add = (id: number, v: number) => bal.set(id, (bal.get(id) ?? 0) + v);

  for (const s of splits) {
    if (s.payerPersonId === null) {
      for (const sh of s.shares) if (sh.personId !== null) add(sh.personId, sh.sharePaise);
    } else {
      const mine = s.shares.find((sh) => sh.personId === null);
      if (mine) add(s.payerPersonId, -mine.sharePaise);
    }
  }
  for (const st of settlements) add(st.personId, st.direction === 'in' ? -st.amountPaise : st.amountPaise);
  return bal;
}

/** What a transaction costs *me* once split: my share if a split exists, otherwise the full amount. */
export function myShareOf(amountPaise: number, split: SplitRecord | undefined): number {
  if (!split) return amountPaise;
  return split.shares.find((s) => s.personId === null)?.sharePaise ?? 0;
}
