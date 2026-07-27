import {
  formatBusinessDate,
  parseBusinessDate,
  resolveDateOrder,
  type DateFormatPreference,
} from '../../shared/dateFormatting';

export interface LocalizedDateFieldState {
  initialCanonical: string | null;
  canonical: string | null;
  draft: string;
  error: string | null;
}

export function createLocalizedDateFieldState(
  canonical: string | null,
  preference: DateFormatPreference,
  locale?: string,
): LocalizedDateFieldState {
  let error: string | null = null;
  if (canonical) {
    try {
      parseBusinessDate(canonical, 'ymd');
    } catch {
      error = 'Replace this legacy value with a valid date, or clear it';
    }
  }
  return {
    initialCanonical: canonical,
    canonical,
    draft: canonical ? formatBusinessDate(canonical, preference, locale) : '',
    error,
  };
}

export function editLocalizedDateDraft(
  state: LocalizedDateFieldState,
  draft: string,
  preference: DateFormatPreference,
  locale?: string,
): LocalizedDateFieldState {
  try {
    return {
      ...state,
      canonical: parseBusinessDate(draft, preference, locale),
      draft,
      error: null,
    };
  } catch (error) {
    return {
      ...state,
      draft,
      error: error instanceof Error ? error.message : 'Enter a valid date',
    };
  }
}

export function clearLocalizedDate(
  state: LocalizedDateFieldState,
): LocalizedDateFieldState {
  return { ...state, canonical: null, draft: '', error: null };
}

export function changeLocalizedDatePreference(
  state: LocalizedDateFieldState,
  preference: DateFormatPreference,
  locale?: string,
): LocalizedDateFieldState {
  return {
    ...state,
    draft: state.canonical
      ? formatBusinessDate(state.canonical, preference, locale)
      : '',
    error: null,
  };
}

export function cancelLocalizedDateEdit(
  state: LocalizedDateFieldState,
  preference: DateFormatPreference,
  locale?: string,
): LocalizedDateFieldState {
  return createLocalizedDateFieldState(state.initialCanonical, preference, locale);
}

export function commitLocalizedDate(
  state: LocalizedDateFieldState,
): { ok: true; value: string | null } | { ok: false; error: string } {
  return state.error
    ? { ok: false, error: state.error }
    : { ok: true, value: state.canonical };
}

export function describeLocalizedDateField(
  preference: DateFormatPreference,
  locale?: string,
) {
  const order = resolveDateOrder(preference, locale).order;
  const labels = {
    dmy: 'DD/MM/YYYY',
    mdy: 'MM/DD/YYYY',
    ymd: 'YYYY-MM-DD',
  } as const;
  const displayOrder = labels[order];
  const example = formatBusinessDate('2026-07-08', preference, locale);
  return {
    order: displayOrder,
    placeholder: displayOrder,
    example,
    hint: `Enter date as ${displayOrder}, for example ${example}`,
  };
}
