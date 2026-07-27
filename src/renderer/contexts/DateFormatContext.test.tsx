import { describe, expect, it, vi } from 'vitest';
import { createDateFormatController } from './DateFormatContext';

describe('DateFormatController', () => {
  it('loads preference and system locale', async () => {
    const api = {
      getSettings: vi.fn().mockResolvedValue({ date_format_preference: 'iso' }),
      getSystemLocale: vi.fn().mockResolvedValue('en-AU')
    };

    const controller = createDateFormatController(api);
    const state = await controller.load();

    expect(state.preference).toBe('iso');
    expect(state.systemLocale).toBe('en-AU');
  });

  it('falls back to system preference if getSettings fails', async () => {
    const api = {
      getSettings: vi.fn().mockRejectedValue(new Error('failed')),
      getSystemLocale: vi.fn().mockResolvedValue('en-AU')
    };

    const controller = createDateFormatController(api);
    const state = await controller.load();

    expect(state.preference).toBe('system');
  });

  it('reloads preference while retaining system locale', async () => {
    const api = {
      getSettings: vi.fn().mockResolvedValue({ date_format_preference: 'system' }),
      getSystemLocale: vi.fn().mockResolvedValue('en-AU')
    };

    const controller = createDateFormatController(api);
    await controller.load();

    api.getSettings.mockResolvedValue({ date_format_preference: 'iso' });
    const newState = await controller.reloadPreference();

    expect(newState.preference).toBe('iso');
    expect(newState.systemLocale).toBe('en-AU');
  });
});
