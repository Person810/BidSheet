import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  formatBusinessDate,
  isDateFormatPreference,
  type DateFormatPreference,
} from '../../shared/dateFormatting';

export interface DateFormatApi {
  getSettings: () => Promise<{ date_format_preference?: unknown }>;
  getSystemLocale: () => Promise<string>;
}

export interface DateFormatState {
  preference: DateFormatPreference;
  systemLocale: string;
  format: (value: string) => string;
}

export interface DateFormatController {
  getState: () => DateFormatState;
  load: () => Promise<DateFormatState>;
  reloadPreference: () => Promise<DateFormatState>;
  subscribe: (listener: (state: DateFormatState) => void) => () => void;
}

function createState(
  preference: DateFormatPreference = 'system',
  systemLocale = '',
): DateFormatState {
  return {
    preference,
    systemLocale,
    format: (value) => formatBusinessDate(value, preference, systemLocale),
  };
}

async function readPreference(api: DateFormatApi): Promise<DateFormatPreference> {
  try {
    const settings = await api.getSettings();
    return isDateFormatPreference(settings?.date_format_preference)
      ? settings.date_format_preference
      : 'system';
  } catch {
    return 'system';
  }
}

export async function loadDateFormatState(api: DateFormatApi): Promise<DateFormatState> {
  const [preference, systemLocale] = await Promise.all([
    readPreference(api),
    api.getSystemLocale().catch(() => ''),
  ]);
  return createState(preference, systemLocale);
}

export function createDateFormatController(api: DateFormatApi): DateFormatController {
  let state = createState();
  let sessionLocale: string | undefined;
  const listeners = new Set<(nextState: DateFormatState) => void>();

  const publish = (nextState: DateFormatState) => {
    state = nextState;
    listeners.forEach((listener) => listener(state));
    return state;
  };

  return {
    getState: () => state,
    async load() {
      const loaded = await loadDateFormatState(api);
      sessionLocale = loaded.systemLocale;
      return publish(loaded);
    },
    async reloadPreference() {
      const preference = await readPreference(api);
      return publish(createState(preference, sessionLocale ?? state.systemLocale));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

interface DateFormatContextValue extends DateFormatState {
  reloadPreference: () => Promise<void>;
}

const DateFormatContext = createContext<DateFormatContextValue | null>(null);

export function DateFormatProvider({ children }: { children: React.ReactNode }) {
  const api: DateFormatApi = useMemo(() => ({
    getSettings: async () => {
      const s = await window.api.getSettings();
      return { date_format_preference: (s as any)?.date_format_preference };
    },
    getSystemLocale: () => window.api.getSystemLocale(),
  }), []);

  const controller = useMemo(
    () => createDateFormatController(api),
    [api],
  );
  const [state, setState] = useState<DateFormatState>(controller.getState);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    void controller.load();
    return unsubscribe;
  }, [controller]);

  const reloadPreference = useCallback(async () => {
    await controller.reloadPreference();
  }, [controller]);

  const value = useMemo(
    () => ({ ...state, reloadPreference }),
    [state, reloadPreference],
  );

  return (
    <DateFormatContext.Provider value={value}>
      {children}
    </DateFormatContext.Provider>
  );
}

export function useDateFormat(): DateFormatContextValue {
  const context = useContext(DateFormatContext);
  if (!context) {
    throw new Error('useDateFormat must be used within DateFormatProvider');
  }
  return context;
}
