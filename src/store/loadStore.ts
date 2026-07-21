import { create } from "zustand";
import type { PdfSource } from "@/lib/pdf/types";

interface LoadState {
  source: PdfSource | null;
  password: string | null;
  error: string | null;
  setSource: (source: PdfSource | null, password: string | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useLoadStore = create<LoadState>((set) => ({
  source: null,
  password: null,
  error: null,
  setSource: (source, password) => set({ source, password, error: null }),
  setError: (error) => set({ error }),
  reset: () => set({ source: null, password: null, error: null }),
}));
