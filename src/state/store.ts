import { create } from 'zustand';
import { startOfMonth } from '../core/dates';

type AppState = {
  /** bumped after any write so screens re-query */
  dataVersion: number;
  bump: () => void;
  month: Date;
  setMonth: (m: Date) => void;
};

export const useApp = create<AppState>((set) => ({
  dataVersion: 0,
  bump: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
  month: startOfMonth(),
  setMonth: (month) => set({ month }),
}));
