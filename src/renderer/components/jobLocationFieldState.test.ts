import { describe, expect, it } from 'vitest';
import * as jobLocationState from './jobLocationFieldState';

import type {
  JobLocationLookupResult,
  JobLocationSuggestion,
} from '../../shared/types/ipc/job-locations';
import {
  beginJobLocationLookup,
  canSaveManualJobLocation,
  completeJobLocationLookup,
  createJobLocationFieldState,
  failJobLocationLookup,
  selectJobLocationSuggestion,
  updateJobLocationDraft,
} from './jobLocationFieldState';

const suggestion: JobLocationSuggestion = {
  location: 'Adelaide, South Australia, Australia',
  postalCode: '5000',
  country: 'Australia',
  sourceKind: 'job',
};

const result: JobLocationLookupResult = {
  suggestions: [suggestion],
  truncated: false,
};

function populatedDraft() {
  return {
    location: 'Existing manual site text',
    sitePostcode: ' 5000 ',
    siteCountry: '',
  };
}

describe('job location lookup state', () => {
  it('starts idle with the exact editable display draft', () => {
    expect(createJobLocationFieldState(populatedDraft())).toEqual({
      draft: populatedDraft(),
      status: { kind: 'idle' },
    });
  });

  it('moves to loading without altering any site field', () => {
    const initial = createJobLocationFieldState(populatedDraft());
    const loading = beginJobLocationLookup(initial, 17);

    expect(loading.draft).toEqual(initial.draft);
    expect(loading.status).toEqual({ kind: 'loading', requestId: 17 });
  });

  it('shows a result without automatically applying the only match', () => {
    const initial = createJobLocationFieldState(populatedDraft());
    const loading = beginJobLocationLookup(initial, 17);
    const completed = completeJobLocationLookup(loading, 17, result);

    expect(completed.status).toEqual({
      kind: 'results',
      suggestions: [suggestion],
      truncated: false,
    });
    expect(completed.draft).toEqual(initial.draft);
  });

  it('copies Location only after explicit selection', () => {
    const initial = createJobLocationFieldState(populatedDraft());
    const results = completeJobLocationLookup(
      beginJobLocationLookup(initial, 17),
      17,
      result,
    );
    expect(results.draft.location).toBe('Existing manual site text');

    const selected = selectJobLocationSuggestion(results, suggestion);
    expect(selected.draft.location).toBe(
      'Adelaide, South Australia, Australia',
    );
  });

  it('fills Country from a selected result only when the draft Country is blank', () => {
    const blankCountry = createJobLocationFieldState(populatedDraft());
    expect(
      selectJobLocationSuggestion(blankCountry, suggestion).draft.siteCountry,
    ).toBe('Australia');

    const authoredCountry = createJobLocationFieldState({
      ...populatedDraft(),
      siteCountry: 'Commonwealth of Australia',
    });
    expect(
      selectJobLocationSuggestion(authoredCountry, suggestion).draft.siteCountry,
    ).toBe('Commonwealth of Australia');
  });

  it('never replaces the user-entered postal display with suggestion formatting', () => {
    const initial = createJobLocationFieldState({
      location: '',
      sitePostcode: ' sw1a   1aa ',
      siteCountry: '',
    });
    const differentlyFormatted: JobLocationSuggestion = {
      location: 'Westminster, United Kingdom',
      postalCode: 'SW1A 1AA',
      country: 'United Kingdom',
      sourceKind: 'client',
    };

    expect(
      selectJobLocationSuggestion(initial, differentlyFormatted).draft.sitePostcode,
    ).toBe(' sw1a   1aa ');
  });

  it('keeps manual save available before lookup and while results await selection', () => {
    const initial = createJobLocationFieldState(populatedDraft());
    const results = completeJobLocationLookup(
      beginJobLocationLookup(initial, 17),
      17,
      result,
    );

    expect(canSaveManualJobLocation(initial)).toBe(true);
    expect(canSaveManualJobLocation(results)).toBe(true);
  });

  it('keeps manual save available when lookup returns no suggestions', () => {
    const initial = createJobLocationFieldState(populatedDraft());
    const empty = completeJobLocationLookup(
      beginJobLocationLookup(initial, 17),
      17,
      { suggestions: [], truncated: false },
    );

    expect(empty.status).toEqual({ kind: 'empty' });
    expect(empty.draft).toEqual(initial.draft);
    expect(canSaveManualJobLocation(empty)).toBe(true);
  });
});

describe('international manual and ambiguous location transitions', () => {
  it.each([
    ['SW1A 1AA', 'United Kingdom'],
    ['K1A 0B1', 'Canada'],
    ['00501', 'United States'],
    ['12-345', 'Polska'],
    ['〒100-0001', '日本'],
    ['🙂 ٠٠٥', ''],
  ])('preserves arbitrary postal display %j and country %j', (sitePostcode, siteCountry) => {
    const state = createJobLocationFieldState({
      location: 'Manual place',
      sitePostcode,
      siteCountry,
    });

    expect(state.draft).toEqual({
      location: 'Manual place',
      sitePostcode,
      siteCountry,
    });
    expect(canSaveManualJobLocation(state)).toBe(true);
  });

  it('keeps multiple ambiguous results in the stable response order without selection', () => {
    const initial = createJobLocationFieldState(populatedDraft());
    const alternatives: JobLocationSuggestion[] = [
      suggestion,
      {
        location: 'Adelaide CBD, Australia',
        postalCode: '5000',
        country: 'Australia',
        sourceKind: 'client',
      },
      {
        location: 'Another 5000, Elsewhere',
        postalCode: '5000',
        country: 'Elsewhere',
        sourceKind: 'job',
      },
    ];
    const completed = completeJobLocationLookup(
      beginJobLocationLookup(initial, 22),
      22,
      { suggestions: alternatives, truncated: true },
    );

    expect(completed.status).toEqual({
      kind: 'results',
      suggestions: alternatives,
      truncated: true,
    });
    expect(completed.draft).toEqual(initial.draft);
  });

  it('allows every copied field to be edited after explicit selection', () => {
    const selected = selectJobLocationSuggestion(
      createJobLocationFieldState({
        location: '',
        sitePostcode: '5000',
        siteCountry: '',
      }),
      suggestion,
    );
    const edited = updateJobLocationDraft(selected, {
      location: 'Edited project entrance',
      sitePostcode: '5000-ALT',
      siteCountry: 'Edited country text',
    });

    expect(edited.draft).toEqual({
      location: 'Edited project entrance',
      sitePostcode: '5000-ALT',
      siteCountry: 'Edited country text',
    });
    expect(canSaveManualJobLocation(edited)).toBe(true);
  });

  it('ignores a stale response after a newer lookup has started', () => {
    const initial = createJobLocationFieldState(populatedDraft());
    const first = beginJobLocationLookup(initial, 30);
    const second = beginJobLocationLookup(first, 31);

    expect(completeJobLocationLookup(second, 30, result)).toBe(second);
    expect(second.status).toEqual({ kind: 'loading', requestId: 31 });
  });

  it('turns lookup failure into nonblocking error state without changing the draft', () => {
    const initial = createJobLocationFieldState(populatedDraft());
    const failed = failJobLocationLookup(
      beginJobLocationLookup(initial, 41),
      41,
      new Error('Could not find saved locations.'),
    );

    expect(failed.status).toEqual({
      kind: 'error',
      message: 'Could not find saved locations.',
    });
    expect(failed.draft).toEqual(initial.draft);
    expect(canSaveManualJobLocation(failed)).toBe(true);
  });

  it('dismisses visible results without changing the manual draft', () => {
    const initial = createJobLocationFieldState(populatedDraft());
    const results = completeJobLocationLookup(
      beginJobLocationLookup(initial, 51),
      51,
      result,
    );
    const dismiss = (
      jobLocationState as typeof jobLocationState & {
        dismissJobLocationLookup: (state: typeof results) => typeof results;
      }
    ).dismissJobLocationLookup;

    const dismissed = dismiss(results);
    expect(dismissed).toEqual({
      draft: results.draft,
      status: { kind: 'idle' },
    });
  });

  it('clears postcode or Country independently without clearing Location', () => {
    const initial = createJobLocationFieldState({
      location: 'Keep this project site',
      sitePostcode: 'K1A 0B1',
      siteCountry: 'Canada',
    });
    const postcodeCleared = updateJobLocationDraft(initial, { sitePostcode: '' });
    const countryCleared = updateJobLocationDraft(postcodeCleared, { siteCountry: '' });

    expect(countryCleared.draft).toEqual({
      location: 'Keep this project site',
      sitePostcode: '',
      siteCountry: '',
    });
  });

  it('cancel restores the complete original site draft after edits and selection', () => {
    const original = populatedDraft();
    const edited = updateJobLocationDraft(
      selectJobLocationSuggestion(createJobLocationFieldState(original), suggestion),
      {
        location: 'Unsaved replacement',
        sitePostcode: '9999',
        siteCountry: 'Unsaved country',
      },
    );
    const cancel = (
      jobLocationState as typeof jobLocationState & {
        cancelJobLocationEdits: (
          state: typeof edited,
          baseline: typeof original,
        ) => typeof edited;
      }
    ).cancelJobLocationEdits;

    expect(cancel(edited, original)).toEqual({
      draft: original,
      status: { kind: 'idle' },
    });
  });
});
