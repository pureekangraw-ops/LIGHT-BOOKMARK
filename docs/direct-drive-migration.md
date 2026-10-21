# LIGHT Direct Google Drive

Target: LIGHT-BOOKMARK calls Google Drive directly. GO Hub and PANTHEON are not part of the Drive data path.

Runtime configuration: dedicated Google OAuth client and refresh grant held only in LIGHT-BOOKMARK Worker secrets. Never store credentials in GitHub. OAuth scope and file permissions must be checked server-side.

Acceptance checks:
1. Fail closed if dedicated OAuth configuration is missing.
2. Refresh access tokens on the server; never return them in MCP results or logs.
3. List files and read bounded text through Google Drive API.
4. Create, edit, rename, move, copy and share only on explicit user request.
5. No delete or ownership-transfer tool.
6. Run unit tests and staging smoke tests before production deployment.
7. Remove legacy PANTHEON Drive routing only after parity verification.

Status: implementation and live tests pending.
