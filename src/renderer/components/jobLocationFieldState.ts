import type {
  JobLocationLookupResult,
  JobLocationSuggestion,
} from '../../shared/types/ipc/job-locations';

export interface JobLocationDraft {
  location: string;
  sitePostcode: string;
  siteCountry: string;
}

export type JobLocationLookupStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; requestId: number }
  | {
      kind: 'results';
      suggestions: JobLocationSuggestion[];
      truncated: boolean;
    }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

export interface JobLocationFieldState {
  draft: JobLocationDraft;
  status: JobLocationLookupStatus;
}

export function createJobLocationFieldState(
  draft: JobLocationDraft,
): JobLocationFieldState {
  return {
    draft: { ...draft },
    status: { kind: 'idle' },
  };
}

export function updateJobLocationDraft(
  state: JobLocationFieldState,
  changes: Partial<JobLocationDraft>,
): JobLocationFieldState {
  return {
    draft: { ...state.draft, ...changes },
    status: { kind: 'idle' },
  };
}

export function beginJobLocationLookup(
  state: JobLocationFieldState,
  requestId: number,
): JobLocationFieldState {
  return {
    ...state,
    status: { kind: 'loading', requestId },
  };
}

export function completeJobLocationLookup(
  state: JobLocationFieldState,
  requestId: number,
  result: JobLocationLookupResult,
): JobLocationFieldState {
  if (state.status.kind !== 'loading' || state.status.requestId !== requestId) {
    return state;
  }
  return {
    ...state,
    status: result.suggestions.length === 0
      ? { kind: 'empty' }
      : {
          kind: 'results',
          suggestions: result.suggestions,
          truncated: result.truncated,
        },
  };
}

export function failJobLocationLookup(
  state: JobLocationFieldState,
  requestId: number,
  reason: unknown,
): JobLocationFieldState {
  if (state.status.kind !== 'loading' || state.status.requestId !== requestId) {
    return state;
  }
  return {
    ...state,
    status: {
      kind: 'error',
      message: reason instanceof Error
        ? reason.message
        : 'Could not find saved locations.',
    },
  };
}

export function dismissJobLocationLookup(
  state: JobLocationFieldState,
): JobLocationFieldState {
  return {
    ...state,
    status: { kind: 'idle' },
  };
}

export function cancelJobLocationEdits(
  _state: JobLocationFieldState,
  original: JobLocationDraft,
): JobLocationFieldState {
  return createJobLocationFieldState(original);
}

export function selectJobLocationSuggestion(
  state: JobLocationFieldState,
  suggestion: JobLocationSuggestion,
): JobLocationFieldState {
  return {
    draft: {
      ...state.draft,
      location: suggestion.location,
      siteCountry: state.draft.siteCountry.trim()
        ? state.draft.siteCountry
        : suggestion.country ?? '',
    },
    status: { kind: 'idle' },
  };
}

export function canSaveManualJobLocation(
  _state: JobLocationFieldState,
): boolean {
  return true;
}
