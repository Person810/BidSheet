# Security Policy

BidSheet is desktop estimating software that stores your catalog, bids, and
plans in a local SQLite database. The optional cloud sync encrypts your data on
your computer with a passphrase only you know before it is uploaded, so the
server only ever stores opaque ciphertext. Security reports are taken seriously.

## Supported Versions

Only the latest released version receives security fixes. Please upgrade to the
most recent release before reporting an issue.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/Person810/BidSheet/security/advisories/new)
(Security → Advisories → "Report a vulnerability" on this repository). This
keeps the details confidential until a fix is available.

When reporting, please include:

- A description of the issue and its impact
- Steps to reproduce (a minimal proof of concept if possible)
- The affected version and platform (Windows / Linux)
- Any relevant logs (scrub anything sensitive first)

## What to Expect

- We aim to acknowledge a report within a few days.
- We will confirm the issue, work on a fix, and keep you updated on progress.
- Once a fix is released, we are happy to credit you in the advisory unless you
  prefer to remain anonymous.

## Scope

In-scope areas include:

- The desktop application (Electron main process, IPC surface, preload)
- Local data handling and the SQLite database
- The client-side backup/sync encryption (the "we can never read your data"
  guarantee)
- The auto-updater

The cloud backend lives in a separate repository. If your report concerns the
hosted service, note that in your advisory and we will route it appropriately.

Thank you for helping keep BidSheet and its users safe.
