/**
 * First-run walkthrough store.
 *
 * The walkthrough auto-starts once after the setup wizard finishes
 * (tracked in localStorage) and can be replayed from Settings:
 *   import { useWalkthroughStore } from '../stores/walkthrough-store';
 *   const open = useWalkthroughStore((s) => s.open);
 */

import { create } from 'zustand';

const SEEN_KEY = 'bidsheet_walkthrough_seen';

export function hasSeenWalkthrough(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markWalkthroughSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // localStorage unavailable -- worst case the tour offers itself again
  }
}

interface WalkthroughState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useWalkthroughStore = create<WalkthroughState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => {
    markWalkthroughSeen();
    set({ isOpen: false });
  },
}));
