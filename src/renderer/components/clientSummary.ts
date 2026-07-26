import type { ClientRow } from '../../shared/types/ipc';

/**
 * The one-line "who is this client" summary (#110).
 *
 * The job form's client field showed this the moment you picked a known
 * client, but the job itself only ever showed the bare name — so the details
 * you'd just confirmed disappeared as soon as you started estimating. Both
 * surfaces now build the line from here, so they can't drift.
 *
 * Contact first (a name to ask for, a number to call, then an address);
 * blank fields drop out rather than leaving gaps, so a client with only a
 * phone number reads as cleanly as a fully filled-in one.
 */
export type ClientSummarySource = Pick<
  ClientRow,
  'contact_name' | 'contact_phone' | 'contact_email' | 'address'
>;

export function clientSummaryParts(
  client: ClientSummarySource | null | undefined
): string[] {
  if (!client) return [];
  return [client.contact_name, client.contact_phone, client.contact_email, client.address]
    .map((value) => (value ?? '').trim())
    .filter((value) => value !== '');
}
