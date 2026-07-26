import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLocaleStore } from '../stores/locale-store';
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

export function parseJobLocation(location: string | null | undefined): {
  street: string;
  suburb: string;
  state: string;
} {
  const result = { street: '', suburb: '', state: '' };
  if (!location) return result;

  const lines = location.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return result;

  const lastLine = lines[lines.length - 1];
  const match = /(?<suburb>[A-Z\s]+)\s+(?<state>[A-Z]{2,3})\s+(?<postcode>\d{4})$/i.exec(lastLine);

  if (match && match.groups) {
    result.state = match.groups.state.trim();
    result.suburb = match.groups.suburb.trim();
    result.street = lines.slice(0, lines.length - 1).join('\n');
  } else {
    result.street = lines.join('\n');
  }

  return result;
}

export function formatJobLocation(
  street: string,
  suburb: string,
  state: string,
  postcode: string,
): string {
  const lines: string[] = [];
  if (street.trim()) {
    lines.push(street.trim());
  }
  const suburbStatePostcode = `${suburb.trim().toUpperCase()} ${state.trim().toUpperCase()} ${postcode.trim()}`;
  if (suburbStatePostcode.trim()) {
    lines.push(suburbStatePostcode);
  }
  return lines.join('\n');
}

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
  builderAddress?: string | null;
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
  builderAddress = null,
}: JobLocationFieldsProps) {
  const id = useId();
  const requestId = useRef(0);
  const { profile } = useLocaleStore();
  const isAU = profile.id === 'en-AU';

  const [street, setStreet] = useState('');
  const [suburb, setSuburb] = useState('');
  const [stateVal, setStateVal] = useState('');
  const lastFormattedRef = useRef('');

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

    if (isAU) {
      if (location !== lastFormattedRef.current) {
        const parsed = parseJobLocation(location);
        setStreet(parsed.street);
        setSuburb(parsed.suburb);
        setStateVal(parsed.state);
        lastFormattedRef.current = location;
      }
    }
  }, [location, postalCode, country, isAU]);

  const changeLocation = (value: string) => {
    setState((current) => updateJobLocationDraft(current, { location: value }));
    onLocationChange(value);
  };
  const changePostalCode = (value: string) => {
    setState((current) =>
      updateJobLocationDraft(current, { sitePostcode: value }));
    onPostalCodeChange(value);
    if (isAU) {
      const combined = formatJobLocation(street, suburb, stateVal, value);
      lastFormattedRef.current = combined;
      onLocationChange(combined);
    }
  };
  const changeCountry = (value: string) => {
    setState((current) =>
      updateJobLocationDraft(current, { siteCountry: value }));
    onCountryChange(value);
  };

  const handleStreetChange = (val: string) => {
    setStreet(val);
    const combined = formatJobLocation(val, suburb, stateVal, postalCode);
    lastFormattedRef.current = combined;
    onLocationChange(combined);
  };

  const handleSuburbChange = (val: string) => {
    setSuburb(val);
    const combined = formatJobLocation(street, val, stateVal, postalCode);
    lastFormattedRef.current = combined;
    onLocationChange(combined);
  };

  const handleStateChange = (val: string) => {
    setStateVal(val);
    const combined = formatJobLocation(street, suburb, val, postalCode);
    lastFormattedRef.current = combined;
    onLocationChange(combined);
  };

  const handleUseBuilderAddress = () => {
    if (!builderAddress) return;

    const lines = builderAddress.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    const lastLine = lines[lines.length - 1];
    const match = /(?<suburb>[A-Z\s]+)\s+(?<state>[A-Z]{2,3})\s+(?<postcode>\d{4})$/i.exec(lastLine);

    let parsedLocation = '';
    let parsedPostcode = '';
    let parsedCountry = 'Australia';

    if (match && match.groups) {
      const streetVal = lines.length >= 2 ? lines[lines.length - 2] : '';
      const suburbVal = match.groups.suburb.trim();
      const stateCode = match.groups.state.trim();
      const pc = match.groups.postcode.trim();

      parsedLocation = formatJobLocation(streetVal, suburbVal, stateCode, pc);
      parsedPostcode = pc;

      if (isAU) {
        setStreet(streetVal);
        setSuburb(suburbVal);
        setStateVal(stateCode);
        lastFormattedRef.current = parsedLocation;
      }
    } else {
      parsedLocation = lines.join('\n');
      if (isAU) {
        setStreet(parsedLocation);
        setSuburb('');
        setStateVal('');
        lastFormattedRef.current = parsedLocation;
      }
    }

    onLocationChange(parsedLocation);
    onPostalCodeChange(parsedPostcode);
    onCountryChange(parsedCountry);
  };

  const findSuggestions = async () => {
    if (!postalCode.trim() || disabled) return;
    const activeRequest = ++requestId.current;
    setState((current) => beginJobLocationLookup(current, activeRequest));
    try {
      const result = await window.api.findJobLocationSuggestions({
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
      {isAU ? (
        <>
          <div className="form-group">
            <label htmlFor={`${id}-street`}>Street Address</label>
            <input
              id={`${id}-street`}
              className="form-control"
              type="text"
              value={street}
              onChange={(e) => handleStreetChange(e.target.value)}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor={`${id}-suburb`}>Suburb / Locality</label>
              <input
                id={`${id}-suburb`}
                className="form-control"
                type="text"
                value={suburb}
                onChange={(e) => handleSuburbChange(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor={`${id}-state`}>State</label>
              <input
                id={`${id}-state`}
                className="form-control"
                type="text"
                value={stateVal}
                onChange={(e) => handleStateChange(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor={`${id}-postcode`}>Postcode</label>
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
        </>
      ) : (
        <>
          <div className="form-group">
            <label htmlFor={`${id}-location`}>Project Location</label>
            <textarea
              id={`${id}-location`}
              className="form-control"
              value={location}
              rows={3}
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
        </>
      )}
      <div className="flex gap-8">
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          disabled={disabled || !postalCode.trim() || state.status.kind === 'loading'}
          onClick={() => void findSuggestions()}
        >
          {state.status.kind === 'loading' ? 'Finding…' : 'Find saved locations'}
        </button>
        {builderAddress && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={disabled}
            onClick={handleUseBuilderAddress}
          >
            Use Builder Address
          </button>
        )}
      </div>
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
