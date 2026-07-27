import type { ClientRow } from '../../../shared/types/ipc';
import type { LocaleProfile } from '../../../shared/localeProfiles';
import { parseClientAddress } from '../../components/clients/clientForm';
import { formatJobLocation } from '../../components/JobLocationFields';

/** The job-site fields a client selection is allowed to touch. */
export interface JobSiteDraft {
  location: string;
  sitePostcode: string;
  siteCountry: string;
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim() === '';
}

/**
 * Job-site fields to apply when a saved client is picked.
 *
 * A client address is the GC/builder's *office*; for an underground sub the
 * dig site is somewhere else entirely. So this only ever fills blanks —
 * anything the estimator already typed wins, and re-picking a client (or
 * editing that client's phone number) can never overwrite a real site
 * address. "Use Builder Address" in JobLocationFields stays the explicit
 * opt-in for deliberately copying the office address across.
 */
export function clientSiteDefaults(
  current: JobSiteDraft,
  client: Pick<ClientRow, 'address'>,
  profile: LocaleProfile,
): JobSiteDraft {
  const address = client.address ?? '';
  if (isBlank(address)) return current;

  if (profile.id === 'en-AU') {
    const parsed = parseClientAddress(address);
    return {
      location: isBlank(current.location)
        ? formatJobLocation(parsed.street, parsed.suburb, parsed.state, parsed.postcode)
        : current.location,
      sitePostcode: isBlank(current.sitePostcode) ? parsed.postcode : current.sitePostcode,
      siteCountry: isBlank(current.siteCountry) ? 'Australia' : current.siteCountry,
    };
  }

  return {
    location: isBlank(current.location) ? address : current.location,
    sitePostcode: current.sitePostcode,
    siteCountry: current.siteCountry,
  };
}
