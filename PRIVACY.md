# Privacy Policy — Command Center

Command Center is a personal dashboard built and used by a single individual
(Jack Scanlon) to track the status of his own projects. It is not a public
product, is not distributed to other users, and is not intended for use by
anyone other than its developer.

## What data this app accesses

Command Center uses the Google Drive API, authorized via OAuth, to read and
write JSON status-snapshot files inside a single Drive folder named
`ClaudeCommandCenter` that the app itself creates. It does not access, read,
or modify any other files or folders in the connected Google account.

## How that data is used

The snapshot files store short text summaries of the developer's own personal
and professional projects (status, last-updated date, brief notes). This data
is used only to render the developer's local dashboard at `localhost` and is
never transmitted to any third party.

## Data sharing

No data is shared with, sold to, or processed by any third party. The only
network calls this app makes with Drive data are to Google's own Drive API,
and (separately, for an in-app chat feature) to Anthropic's API using a
project-status summary as context for that single request.

## Data retention and revocation

Snapshot files persist in the developer's own Google Drive until manually
deleted. Access can be revoked at any time via
[Google Account permissions](https://myaccount.google.com/permissions).

## Contact

Questions about this app can be sent to jscanlon001@csbsju.edu.
