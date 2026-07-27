export type JobLocationSuggestionSource = 'job' | 'client';

export interface JobLocationLookupRequest {
  postalCode: string;
  country?: string | null;
  limit?: number;
}

export interface JobLocationSuggestion {
  location: string;
  postalCode: string;
  country: string | null;
  sourceKind: JobLocationSuggestionSource;
}

export interface JobLocationLookupResult {
  suggestions: JobLocationSuggestion[];
  truncated: boolean;
}
