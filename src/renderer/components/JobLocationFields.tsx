import React, { useEffect, useId, useRef, useState } from 'react';
import type { JobLocationSuggestion } from '../../shared/types/ipc/job-locations';
import {
  beginJobLocationLookup,
  completeJobLocationLookup,
  createJobLocationFieldState,
  dismissJobLocationLookup,
  failJobLocationLookup,
  selectJobLocationSuggestion,
  updateJobLocationDraft,
} from './jobLocationFieldState';

export interface JobLocationFieldsProps {
  location: string;
  postalCode: string;
  country: string;
  onLocationChange: (value: string) => void;
  onPostalCodeChange: (value: string) => void;
  onCountryChange: (value: string) => void;
  disabled?: boolean;
  postalCodeError?: string | null;
  countryError?: string | null;
}

export function JobLocationFields({
  location,
  postalCode,
  country,
  onLocationChange,
  onPostalCodeChange,
  onCountryChange,
  disabled = false,
  postalCodeError = null,
  countryError = null,
}: JobLocationFieldsProps) {
  const id = useId();
  const requestId = useRef(0);
  const [state, setState] = useState(() =>
    createJobLocationFieldState({
      location,
      sitePostcode: postalCode,
      siteCountry: country,
    }));

  useEffect(() => {
    setState((current) => ({
      ...current,
      draft: {
        location,
        sitePostcode: postalCode,
        siteCountry: country,
      },
    }));
  }, [location, postalCode, country]);

  const changeLocation = (value: string) => {
    setState((current) => updateJobLocationDraft(current, { location: value }));
    onLocationChange(value);
  };
  const changePostalCode = (value: string) => {
    setState((current) =>
      updateJobLocationDraft(current, { sitePostcode: value }));
    onPostalCodeChange(value);
  };
  const changeCountry = (value: string) => {
    setState((current) =>
      updateJobLocationDraft(current, { siteCountry: value }));
    onCountryChange(value);
  };

  const findSuggestions = async () => {
    if (!postalCode.trim() || disabled) return;
    const activeRequest = ++requestId.current;
    setState((current) => beginJobLocationLookup(current, activeRequest));
    try {
      // TODO: wire up IPC handler for job location suggestions
      const result = await (window.api as any).findJobLocationSuggestions({
        postalCode,
        country: country || null,
      });
      setState((current) =>
        completeJobLocationLookup(current, activeRequest, result));
    } catch (reason) {
      setState((current) =>
        failJobLocationLookup(current, activeRequest, reason));
    }
  };

  const selectSuggestion = (suggestion: JobLocationSuggestion) => {
    const selected = selectJobLocationSuggestion(state, suggestion);
    setState(selected);
    onLocationChange(selected.draft.location);
    if (!country.trim()) onCountryChange(selected.draft.siteCountry);
  };

  const dismissLookup = () => {
    setState((current) => dismissJobLocationLookup(current));
  };

  return (
    <fieldset
      disabled={disabled}
      style={{ border: 0, padding: 0, margin: 0 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && state.status.kind !== 'idle') {
          event.preventDefault();
          event.stopPropagation();
          dismissLookup();
        }
      }}
    >
      <div className="form-group">
        <label htmlFor={`${id}-location`}>Project Location</label>
        <input
          id={`${id}-location`}
          className="form-control"
          value={location}
          onChange={(event) => changeLocation(event.target.value)}
        />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor={`${id}-postcode`}>Postal code / postcode</label>
          <input
            id={`${id}-postcode`}
            className="form-control"
            value={postalCode}
            maxLength={40}
            autoComplete="postal-code"
            aria-invalid={Boolean(postalCodeError)}
            aria-describedby={postalCodeError ? `${id}-postcode-error` : undefined}
            onChange={(event) => changePostalCode(event.target.value)}
          />
          {postalCodeError && (
            <div id={`${id}-postcode-error`} className="form-error" role="alert">
              {postalCodeError}
            </div>
          )}
        </div>
        <div className="form-group">
          <label htmlFor={`${id}-country`}>Country</label>
          <input
            id={`${id}-country`}
            className="form-control"
            value={country}
            maxLength={100}
            autoComplete="country-name"
            aria-invalid={Boolean(countryError)}
            aria-describedby={countryError ? `${id}-country-error` : undefined}
            onChange={(event) => changeCountry(event.target.value)}
          />
          {countryError && (
            <div id={`${id}-country-error`} className="form-error" role="alert">
              {countryError}
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        className="btn btn-sm btn-secondary"
        disabled={disabled || !postalCode.trim() || state.status.kind === 'loading'}
        onClick={() => void findSuggestions()}
      >
        {state.status.kind === 'loading' ? 'Finding…' : 'Find saved locations'}
      </button>
      <div aria-live="polite" role="status" style={{ marginTop: 8 }}>
        {state.status.kind === 'empty' && 'No saved locations found. You can enter one manually.'}
        {state.status.kind === 'error' && state.status.message}
        {state.status.kind === 'results' && (
          <>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Suggestions are from saved local records. Choose one to use it.
            </div>
            <ul aria-label="Saved location suggestions" style={{ listStyle: 'none', padding: 0 }}>
              {state.status.suggestions.map((suggestion, index) => (
                <li key={`${suggestion.location}|${suggestion.postalCode}|${suggestion.country}|${index}`}>
                  <span>{suggestion.location}</span>
                  {suggestion.country && <span> · {suggestion.country}</span>}
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => selectSuggestion(suggestion)}
                  >
                    Use this location
                  </button>
                </li>
              ))}
            </ul>
            {state.status.truncated && (
              <div className="text-muted">Add a country to narrow the saved results.</div>
            )}
          </>
        )}
        {state.status.kind !== 'idle' && state.status.kind !== 'loading' && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={dismissLookup}
          >
            Dismiss saved locations
          </button>
        )}
      </div>
    </fieldset>
  );
}
