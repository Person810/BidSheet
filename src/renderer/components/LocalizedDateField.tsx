import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useDateFormat } from '../contexts/DateFormatContext';
import {
  cancelLocalizedDateEdit,
  createLocalizedDateFieldState,
  describeLocalizedDateField,
  editLocalizedDateDraft,
} from './localizedDateFieldState';
import {
  buildCalendarMonth,
  nextMonth,
  parseYearMonth,
  prevMonth,
} from './calendarGrid';

interface LocalizedDateFieldProps {
  value: string | null;
  onChange: (canonical: string | null) => void;
  onValidityChange?: (valid: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  required?: boolean;
}

export function LocalizedDateField({
  value,
  onChange,
  onValidityChange,
  label,
  id,
  disabled,
  autoFocus,
  required,
}: LocalizedDateFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const { preference, systemLocale } = useDateFormat();
  const [state, setState] = useState(
    () => createLocalizedDateFieldState(value, preference, systemLocale),
  );
  const descriptor = describeLocalizedDateField(preference, systemLocale);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [viewYM, setViewYM] = useState(() => parseYearMonth(value));
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = createLocalizedDateFieldState(value, preference, systemLocale);
    setState(next);
    onValidityChange?.(!next.error);
  }, [value, preference, systemLocale, onValidityChange]);

  // Sync calendar view to current value when it changes
  useEffect(() => {
    if (value) setViewYM(parseYearMonth(value));
  }, [value]);

  const updateDraft = (draft: string) => {
    const next = editLocalizedDateDraft(state, draft, preference, systemLocale);
    setState(next);
    onValidityChange?.(!next.error);
    if (!next.error) onChange(next.canonical);
  };

  const cancelDraft = () => {
    const next = cancelLocalizedDateEdit(
      { ...state, initialCanonical: value },
      preference,
      systemLocale,
    );
    setState(next);
    onValidityChange?.(true);
  };

  const selectDate = useCallback((isoDate: string) => {
    onChange(isoDate);
    setCalendarOpen(false);
  }, [onChange]);

  // Close calendar when clicking outside
  useEffect(() => {
    if (!calendarOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setCalendarOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [calendarOpen]);

  const calendar = calendarOpen ? buildCalendarMonth(viewYM.year, viewYM.month) : null;

  return (
    <div className="form-group date-field-wrapper" ref={wrapperRef}>
      <label htmlFor={inputId}>{label}</label>
      <div className="date-input-row">
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          className="form-control"
          value={state.draft}
          placeholder={descriptor.placeholder}
          aria-describedby={`${hintId}${state.error ? ` ${errorId}` : ''}`}
          aria-invalid={state.error ? 'true' : undefined}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              if (calendarOpen) {
                event.preventDefault();
                setCalendarOpen(false);
              } else {
                event.preventDefault();
                cancelDraft();
              }
            }
          }}
          disabled={disabled}
          autoFocus={autoFocus}
          required={required}
        />
        <button
          type="button"
          className="btn-calendar-toggle"
          disabled={disabled}
          tabIndex={-1}
          aria-label="Open date picker"
          onClick={() => {
            if (!calendarOpen && value) setViewYM(parseYearMonth(value));
            setCalendarOpen(!calendarOpen);
          }}
        >
          📅
        </button>
      </div>
      <div id={hintId} className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>
        {descriptor.hint}
      </div>
      {state.error && (
        <div id={errorId} role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 3 }}>
          {state.error}
        </div>
      )}
      {calendar && (
        <div className="calendar-dropdown" role="dialog" aria-label="Date picker">
          <div className="calendar-header">
            <button
              type="button"
              className="calendar-nav"
              onClick={() => setViewYM(prevMonth(viewYM.year, viewYM.month))}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="calendar-title">{calendar.label}</span>
            <button
              type="button"
              className="calendar-nav"
              onClick={() => setViewYM(nextMonth(viewYM.year, viewYM.month))}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          <div className="calendar-grid">
            {calendar.weekdayHeaders.map((h) => (
              <div key={h} className="calendar-weekday">{h}</div>
            ))}
            {calendar.days.map((d) => (
              <button
                key={d.date}
                type="button"
                className={[
                  'calendar-day',
                  d.inMonth ? '' : 'calendar-day-outside',
                  d.isToday ? 'calendar-day-today' : '',
                  d.date === value ? 'calendar-day-selected' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => selectDate(d.date)}
              >
                {d.day}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
