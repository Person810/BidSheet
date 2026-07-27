import { describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from './locale-store';
import { LOCALE_PROFILES } from '../../shared/localeProfiles';

// Mock window.api
const mockGetSettings = vi.fn();
const mockGetSystemLocale = vi.fn();

global.window = {
  ...global.window,
  api: {
    getSettings: mockGetSettings,
    getSystemLocale: mockGetSystemLocale,
  } as any
} as any;

describe('useLocaleStore', () => {
  it('initializes with default locale', () => {
    const store = useLocaleStore.getState();
    expect(store.profile).toEqual(LOCALE_PROFILES['en-US']);
  });

  it('setLocale changes the current profile', () => {
    useLocaleStore.getState().setLocale('en-AU');
    expect(useLocaleStore.getState().profile).toEqual(LOCALE_PROFILES['en-AU']);
  });

  it('loadLocale sets profile based on preferences and system locale', async () => {
    mockGetSettings.mockResolvedValue({ locale: 'en-GB' });
    mockGetSystemLocale.mockResolvedValue('en-AU');
    
    await useLocaleStore.getState().loadLocale();
    
    expect(useLocaleStore.getState().profile).toEqual(LOCALE_PROFILES['en-GB']);
  });

  it('loadLocale falls back to system locale if no user preference', async () => {
    mockGetSettings.mockResolvedValue({});
    mockGetSystemLocale.mockResolvedValue('en-AU');
    
    await useLocaleStore.getState().loadLocale();
    
    expect(useLocaleStore.getState().profile).toEqual(LOCALE_PROFILES['en-AU']);
  });
});
