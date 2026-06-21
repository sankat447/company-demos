import { create } from "zustand";

interface Toast { id: number; msg: string; }
interface ToastState { toasts: Toast[]; push: (m: string) => void; dismiss: (id: number) => void; }

let seq = 1;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (msg) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts, { id, msg }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (msg: string) => useToasts.getState().push(msg);
