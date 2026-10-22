# LIGHT Direct Google Drive

Current source: LIGHT-BOOKMARK calls Google Drive directly. GO Hub and PANTHEON
are not part of the Drive data path. LIGHT-owned OAuth configuration stays in
Worker secrets and is never returned in MCP results or committed to GitHub.

## Implemented in source

- Read root children, list files, read bounded UTF-8/ZIP content, and list permissions.
- Create file metadata or folders only when `text` is absent; rename and copy.
- No delete or ownership-transfer tool.

## Not implemented

Creation with text, content updates, move, share, and permission updates return
`LIGHT_DRIVE_OPERATION_NOT_IMPLEMENTED` for valid arguments, before OAuth or
provider calls. Existing tool names remain for compatibility; do not claim those
operations succeeded. This change only corrects descriptions and diagnostics;
it does not implement new writes.

## Remaining verification and authority

`light_connections_status` only checks local configuration presence, not a live
grant. Refresh-token validity, scopes, file permissions, and live API access need
separate authorized verification. Run synthetic tests before review; staging
smoke tests must use authorized test files and must not mutate production.
Implemented writes still require explicit user requests. New OAuth grants,
permissions, credentials, production deployment, and production merge require
owner approval; do not infer them from an advertised tool or a configuration flag.
