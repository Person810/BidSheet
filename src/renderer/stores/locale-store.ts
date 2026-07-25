import { create } from 'zustand';
import { resolveLocaleProfile, LOCALE_PROFILES, type LocaleProfile } from '../../shared/localeProfiles';

interface LocaleState {
  profile: LocaleProfile;
  loadLocale: () => Promise<void>;
  setLocale: (localeId: string) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  profile: LOCALE_PROFILES['en-US'],
  loadLocale: async () => {
    try {
      const s: any = await window.api.getSettings();
      const userPref = s?.locale ?? null;
      const sysLoc = await window.api.getSystemLocale();
      set({ profile: resolveLocaleProfile(sysLoc, userPref) });
    } catch (err) {
      console.warn('Failed to load locale:', err);
    }
  },
  setLocale: (localeId: string) => {
    const profile = LOCALE_PROFILES[localeId];
    if (profile) set({ profile });
  },
}));
