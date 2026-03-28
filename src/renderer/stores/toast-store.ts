/**
 * Toast notification store.
 *
 * Usage from any component:
 *   import { useToastStore } from '../stores/toast-store';
 *   const addToast = useToastStore((s) => s.addToast);
 *   addToast('Something went wrong saving that material.', 'error');
 */

import { create } from 'zustand';

export type ToastType = 'error' | 'warn' | 'success' | 'info';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message: string, type: ToastType = 'error') => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));

    // Auto-dismiss after 6s (errors stay longer than success)
    const duration = type === 'error' ? 8000 : type === 'warn' ? 6000 : 4000;
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, duration);
  },

  removeToast: (id: number) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
