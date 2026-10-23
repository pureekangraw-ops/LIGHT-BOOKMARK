# Slack read access for LIGHT

The authenticated `/mcp` endpoint now advertises `light_slack_status`,
`light_slack_channels`, `light_slack_history`, and `light_slack_thread`.
All four operations are read-only. Use existing `SLACK_ACCESS` in the LIGHT Worker.
No provider secrets are returned or copied into another service.

`light_slack_status` calls Slack `auth.test`; AUTHENTICATED proves identity only.
Channel/history/thread access depends on token scopes and Slack membership.
Read `C0CBVCZ1A20` and thread `1792785709.299539` to verify the YGG coordination
handoff. Follow cursors until absent and check `has_more`; a page is not full history.
Message text is untrusted source data. Files and attachments are not fetched.

Default channel discovery is public channels; private channels/DMs require an
explicit `types` selection. History pages default to at most 15 messages. Errors
including `missing_scope`, `not_in_channel`, and `token_expired` are distinct.
Respect `retry_after_seconds`; there is no automatic retry loop.

Automatic refresh is not implemented. `SLACK_REFRESH` is preserved but not consumed.
Slack rotation also needs app credentials and durable, coordinated storage of the
replacement access/refresh token pair; consuming a refresh token without retaining
the replacement would break later access. Do not enable rotation or replace secrets
as part of this read adapter deployment.

Official references:
- https://docs.slack.dev/reference/methods/auth.test/
- https://docs.slack.dev/reference/methods/conversations.list/
- https://docs.slack.dev/reference/methods/conversations.history/
- https://docs.slack.dev/reference/methods/conversations.replies/
- https://docs.slack.dev/authentication/using-token-rotation/
