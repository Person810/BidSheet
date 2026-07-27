import { describe, expect, it } from 'vitest';

import {
  cancelLocalizedDateEdit,
  changeLocalizedDatePreference,
  clearLocalizedDate,
  commitLocalizedDate,
  createLocalizedDateFieldState,
  describeLocalizedDateField,
  editLocalizedDateDraft,
} from './localizedDateFieldState';

describe('localized date field state', () => {
  it('starts with separate canonical and localized draft values', () => {
    expect(createLocalizedDateFieldState('2026-07-08', 'dmy', 'en-AU')).toMatchObject({
      initialCanonical: '2026-07-08',
      canonical: '2026-07-08',
      draft: '08/07/2026',
      error: null,
    });
  });

  it('preserves full malformed legacy text but initializes it as invalid', () => {
    const legacy = 'legacy date value that must not be truncated';
    const state = createLocalizedDateFieldState(legacy, 'dmy', 'en-AU');

    expect(state.initialCanonical).toBe(legacy);
    expect(state.canonical).toBe(legacy);
    expect(state.draft).toBe(legacy);
    expect(state.error).toEqual(expect.stringMatching(/valid|date|replace/i));
    expect(commitLocalizedDate(state)).toMatchObject({
      ok: false,
      error: state.error,
    });
  });

  it('allows malformed legacy text to become valid only by clearing or replacement', () => {
    const invalid = createLocalizedDateFieldState(
      '2026-02-30 legacy suffix',
      'dmy',
      'en-AU',
    );
    const cleared = clearLocalizedDate(invalid);
    const replaced = editLocalizedDateDraft(
      invalid,
      '08/07/2026',
      'dmy',
      'en-AU',
    );

    expect(commitLocalizedDate(cleared)).toEqual({ ok: true, value: null });
    expect(commitLocalizedDate(replaced)).toEqual({
      ok: true,
      value: '2026-07-08',
    });
  });

  it('parses a valid localized edit into canonical state', () => {
    const initial = createLocalizedDateFieldState(null, 'mdy', 'en-US');
    const edited = editLocalizedDateDraft(initial, '07/08/2026', 'mdy', 'en-US');

    expect(edited).toMatchObject({
      canonical: '2026-07-08',
      draft: '07/08/2026',
      error: null,
    });
  });

  it('retains invalid draft text and exposes a correction without changing canonical', () => {
    const initial = createLocalizedDateFieldState('2026-07-08', 'dmy', 'en-AU');
    const edited = editLocalizedDateDraft(initial, '31/02/2026', 'dmy', 'en-AU');

    expect(edited.canonical).toBe('2026-07-08');
    expect(edited.draft).toBe('31/02/2026');
    expect(edited.error).toMatch(/valid|date|day/i);
  });

  it('clears optional state without persisting until parent commit', () => {
    const initial = createLocalizedDateFieldState('2026-07-08', 'dmy', 'en-AU');
    expect(clearLocalizedDate(initial)).toMatchObject({
      initialCanonical: '2026-07-08',
      canonical: null,
      draft: '',
      error: null,
    });
  });

  it('reformats canonical components when preference changes without reinterpreting them', () => {
    const dmy = createLocalizedDateFieldState('2026-07-08', 'dmy', 'en-AU');
    const mdy = changeLocalizedDatePreference(dmy, 'mdy', 'en-US');

    expect(mdy.canonical).toBe('2026-07-08');
    expect(mdy.draft).toBe('07/08/2026');
  });

  it('blocks commit while invalid and allows canonical or null values', () => {
    const valid = editLocalizedDateDraft(
      createLocalizedDateFieldState(null, 'dmy', 'en-AU'),
      '08/07/2026',
      'dmy',
      'en-AU',
    );
    const invalid = editLocalizedDateDraft(valid, '31/02/2026', 'dmy', 'en-AU');
    const blank = clearLocalizedDate(valid);

    expect(commitLocalizedDate(valid)).toEqual({ ok: true, value: '2026-07-08' });
    expect(commitLocalizedDate(blank)).toEqual({ ok: true, value: null });
    expect(commitLocalizedDate(invalid)).toMatchObject({ ok: false, error: invalid.error });
  });

  it('cancel restores the original canonical value and its current-format presentation', () => {
    const initial = createLocalizedDateFieldState('2026-07-08', 'dmy', 'en-AU');
    const edited = editLocalizedDateDraft(initial, '09/07/2026', 'dmy', 'en-AU');

    expect(cancelLocalizedDateEdit(edited, 'mdy', 'en-US')).toMatchObject({
      canonical: '2026-07-08',
      draft: '07/08/2026',
      error: null,
    });
  });
});

describe('localized date accessibility descriptors', () => {
  it.each([
    ['dmy', 'en-AU', 'DD/MM/YYYY', '08/07/2026'],
    ['mdy', 'en-US', 'MM/DD/YYYY', '07/08/2026'],
    ['ymd', 'en-AU', 'YYYY-MM-DD', '2026-07-08'],
    ['system', 'ja-JP', 'YYYY-MM-DD', '2026-07-08'],
  ] as const)('describes %s/%s entry order and example', (preference, locale, order, example) => {
    expect(describeLocalizedDateField(preference, locale)).toEqual({
      order,
      placeholder: order,
      example,
      hint: `Enter date as ${order}, for example ${example}`,
    });
  });
});
