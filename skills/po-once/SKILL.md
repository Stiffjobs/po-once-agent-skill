---
name: po-once
description: >
  Use Po Once's organization-scoped agent API to list connected accounts, upload
  media, create content, schedule or publish posts, inspect status, and delete
  eligible scheduled posts through a local helper script.
last-updated: 2026-04-25
allowed-tools: Bash(./scripts/po-once.cjs:*)
---

# Po Once Skill

Portable skill bundle for AI agents to automate Po Once through the agent API.

Interpretation rule: when a user provides both a target account and a broad noun like "overview", "analytics", or "performance", the named target wins unless the user explicitly asks for broader comparison.

## Setup

Create an API key in Po Once and run the bundled setup command:

```bash
./scripts/po-once.cjs setup --api-key po_live_org_<secret>
```

If setup is needed and you are invoking the script without first switching into the skill directory, run:

```bash
<skill-path>/scripts/po-once.cjs setup --api-key po_live_org_<secret>
```

Default base URL:

- The skill uses the production base URL by default: `https://dynamic-lapwing-647.convex.site`

By default, `setup` verifies the configuration with `accounts` before saving it.

Config resolution order:

- `PO_ONCE_AGENT_API_KEY`
- `--config /absolute/path/to/config.json` or `PO_ONCE_CONFIG_PATH=/absolute/path/to/config.json`
- nearest project `.po-once/config.json`, discovered by walking upward from the current working directory
- global config at `~/.config/po-once/config.json`

That means the helper no longer assumes local config only exists at the current directory root. Running the bundled script from the installed skill directory, a nested repo folder, or another subdirectory is safe as long as the project-local `.po-once/config.json` exists somewhere above the invocation directory.

Use an explicit config path when you need deterministic behavior in automation or CI:

```bash
./scripts/po-once.cjs health --config /absolute/path/to/config.json
PO_ONCE_CONFIG_PATH=/absolute/path/to/config.json ./scripts/po-once.cjs accounts
```

**Note for agents**: All script paths in this document are relative to the directory where this `SKILL.md` is installed. For example, `./scripts/po-once.cjs` refers to the script bundled with this skill, not a repository-root `./scripts/po-once.cjs`. Resolve paths from the installed skill directory.

## Commands

| Command | Description |
|---------|-------------|
| `./scripts/po-once.cjs setup --api-key <token>` | Save credentials and verify `accounts` |
| `./scripts/po-once.cjs config` | Show resolved config, source, and `configPath` |
| `./scripts/po-once.cjs health` | Show active config, `configPath`, and whether `accounts` succeeds |
| `./scripts/po-once.cjs whoami` | Alias for `health` |
| `./scripts/po-once.cjs accounts` | List connected accounts |
| `./scripts/po-once.cjs accounts --provider instagram --match relation` | Filter connected accounts |
| `./scripts/po-once.cjs analytics:profile --profile-id <social_profile_id> --days 28` | Fetch profile analytics; defaults to `days=28` for Meta profiles |
| `./scripts/po-once.cjs analytics:profile --profile-id <social_profile_id> --cursor <cursor> --max-count 20` | Fetch TikTok analytics with TikTok-only pagination params |
| `./scripts/po-once.cjs keyword-search --linked-account-id <threads_linked_account_id> --keyword "launch tips" --search-type RECENT` | Run ad-hoc Threads keyword discovery |
| `./scripts/po-once.cjs upload --file ./clip.mp4` | Upload media |
| `./scripts/po-once.cjs content:create --caption "..." --post-type video --storage-key <key> --size-bytes 1234` | Create content |
| `./scripts/po-once.cjs post --content-id <id> --accounts social_profile_id_1,social_profile_id_2 --mode scheduled --schedule 2026-04-17T09:00:00Z --timezone UTC` | Create post batch; `--accounts` must be comma-separated `id` or `socialProfileId` values returned by `accounts` |
| `./scripts/po-once.cjs publish --file ./clip.mp4 --caption "..." --accounts social_profile_id_1,social_profile_id_2 --mode direct` | Upload, create content, and create post; `--accounts` must be comma-separated `id` or `socialProfileId` values returned by `accounts` |
| `./scripts/po-once.cjs posts --limit 20 --status scheduled` | List posts |
| `./scripts/po-once.cjs posts:get --id <post_id>` | Get one post |
| `./scripts/po-once.cjs posts:get --id <post_id> --status-only` | Get a minimal status view for one post |
| `./scripts/po-once.cjs posts:delete --id <post_id>` | Delete an eligible scheduled post |

## Account IDs

Agents must call `accounts` before posting unless the user already provided current Po Once `socialProfileId` values. Use the returned `id` or `socialProfileId` as the post target; those values are equivalent for posting.

When running `post` or `publish`, the CLI flag stays named `--accounts` for ergonomics, but it sends those values to the API as `socialProfileIds`. Do not use `accountIds`, `profileIds`, provider-native account IDs, handles, usernames, or display names as post targets.

For Threads keyword discovery, use the `linkedAccountId` returned by `accounts`, not the posting `id`/`socialProfileId`.

If the user gives ambiguous account input, run `accounts` and match by visible metadata such as provider, display name, username, or avatar before choosing the returned `id` or `socialProfileId`.

When the user gives a named target such as `poonce_official`, resolve that target first and stop there unless the user explicitly requests comparison.
Do not treat `accounts` output as a list to analyze broadly by default. It is a resolution step, not a signal to fan out.

For analytics:

- use the resolved target's `id` or `socialProfileId`
- only analyze additional profiles if they are clearly the same brand/account identity and the user requested a cross-platform view

For Threads keyword discovery:

- use the resolved Threads target's `linkedAccountId`
- never use another Threads linked account from the same organization unless the user explicitly switches targets

## Scope And Target Resolution

Always resolve the user's intended scope before fetching analytics, keyword discovery, or posting data.

Scope rules:

- If the user names a specific account, handle, username, display name, or provider-specific profile, all analysis must stay scoped to that target unless the user explicitly asks for comparison across other accounts.
- Do not broaden analysis to other connected accounts in the same organization just because they are returned by `accounts`.
- If the user says "overview" and also names a target account, interpret "overview" as an overview of that target only, not an organization-wide overview.
- Only perform organization-wide or multi-account comparisons when the user explicitly asks for "all accounts", "org-wide", "compare accounts", or equivalent wording.
- If the user names a Threads profile and asks for keyword discovery, use that exact Threads target for keyword search and keep any supporting analytics scoped to that same target.
- If the user wants cross-platform analysis for one brand or creator identity, limit results to clearly matching same-brand profiles only. Do not infer brand grouping loosely from being in the same organization.
- If same-brand matching is ambiguous, ask one short clarification question before proceeding.

Target resolution priority:

1. exact provider + exact handle/username match
2. exact provider + exact display name match
3. exact provider + clear unique partial match
4. ask for clarification

When a target is resolved, state it clearly before continuing, including:

- provider
- `socialProfileId` or `id`
- `linkedAccountId` when relevant for Threads keyword discovery

## Analytics And Discovery

Use `analytics:profile` only after resolving the target account through `accounts`.

- If the user names a specific target, fetch analytics only for that target by default.
- If the user asks for an "overview" and names a target, return an overview of that target only.
- If the user asks for a cross-platform overview for one brand, include only clearly matching same-brand profiles.
- If the user asks for organization-wide analytics, state that you are analyzing multiple accounts before proceeding.
- Compare only like-for-like profiles using the same time window.
- Call out missing metrics instead of inferring them.
- Do not compare unrelated accounts that happen to live in the same organization.
- Do not use other accounts as benchmark context unless the user explicitly asks for comparison.
- Meta analytics profiles support `--days`, `--period`, `--since`, and `--until`
- TikTok analytics profiles support `--cursor` and `--max-count`
- Do not combine `--days` with `--period`, `--since`, or `--until`
- Do not combine `--period` with `--since` or `--until`
- Do not send `--cursor` or `--max-count` for non-TikTok analytics requests
- When no analytics window is provided for a Meta profile, the helper defaults to `--days 28`

Threads keyword discovery rules:

- Use `keyword-search` only for the resolved Threads target
- `--linked-account-id` must come from that exact resolved Threads account
- the matched account must have provider `threads`
- `--search-type` is optional and must be `TOP` or `RECENT`
- prefer `TOP` unless the user explicitly wants recency

If a Threads target is named and the user asks for both analytics and keyword search:

- resolve that Threads target first
- fetch analytics for that target only
- run keyword search using that same target's `linkedAccountId`
- do not include other Threads accounts unless explicitly requested

## API Surface

The helper script wraps these endpoints:

- `GET /api/agent/v1/accounts`
- `GET /api/agent/v1/analytics/profiles/:profileId`
- `POST /api/agent/v1/keyword-search`
- `POST /api/agent/v1/media/create-upload-url`
- `POST /api/agent/v1/contents`
- `GET /api/agent/v1/posts`
- `POST /api/agent/v1/posts`
- `GET /api/agent/v1/posts/:id`
- `DELETE /api/agent/v1/posts/:id`

## Recommended Agent Workflow

1. Determine scope first:
   - named target account
   - same-brand cross-platform overview
   - organization-wide comparison
2. Run `health` if you need to confirm which config source and `configPath` are active.
3. Run `accounts` to resolve the exact target account unless the user already provided current Po Once IDs.
4. State the resolved target before analysis:
   - provider
   - display name or handle
   - `id` / `socialProfileId`
   - `linkedAccountId` for Threads keyword discovery
5. If the task is analysis:
   - for a named target, fetch only that target's analytics by default
   - for same-brand cross-platform analysis, include only clearly matching related profiles
   - for organization-wide analysis, say explicitly that multiple accounts will be included
6. If the task includes Threads keyword discovery:
   - use the resolved Threads target's `linkedAccountId`
   - do not switch to another Threads account in the same organization
7. Draft conclusions that stay within the resolved scope.
   - Do not cite unrelated connected accounts as context unless the user asked for comparison.
8. If ambiguity remains after `accounts`, ask one short clarification question before proceeding.
9. Draft content and confirm whether the user wants direct or scheduled posting.
10. Use `publish` for the normal end-to-end posting path.
11. Use `posts` or `posts:get --status-only` to confirm status.
12. Only use `posts:delete` when the user explicitly wants a scheduled post removed.
13. Before deleting, inspect the post first and confirm both `type === "scheduled"` and `status === "scheduled"`.

## Safety Notes

- Treat the API token like a password.
- CLI output redacts common credential fields, but avoid sharing raw command output broadly unless needed.
- Start with `accounts` before using profile analytics, Threads keyword search, or posting endpoints.
- Prefer one explicit request per task instead of fetching every profile.
- Use bounded analytics windows and confirm the returned response window before summarizing performance.
- Prefer scheduled posting unless the user clearly wants immediate publishing.
- Results are scoped to the organization tied to the token.
- Do not broaden from a named target to other connected accounts without explicit user consent.
- Organization membership does not imply analytical relevance.
- `accounts` may return multiple brands, clients, or experiments; do not treat them as one analysis group by default.
- If the user names one Threads profile, keep both analytics and keyword discovery tied to that exact target.
- If the API returns `SUBSCRIPTION_REQUIRED`, stop and ask the user to upgrade the organization to an active Starter or Pro plan, or switch organizations.
- Only delete a post when both `type === "scheduled"` and `status === "scheduled"`.
- Before calling `DELETE /api/agent/v1/posts/:id`, inspect the post first to confirm it is still scheduled and has not started processing.
- Do not delete direct posts, published posts, failed posts, errored posts, posts already processing, or any post with another `type` or `status`.
- If the post is not still `scheduled`/`scheduled`, do not call delete and tell the user that only scheduled posts that are still in `scheduled` status can be deleted.

## Scope Examples

Example: named Threads target

- User: "Use the Threads profile `poonce_official` and check analytics, then do keyword search"
- Correct behavior:
  1. run `accounts`
  2. resolve the Threads account for `poonce_official`
  3. run `analytics:profile` only for that target
  4. run `keyword-search` with that target's `linkedAccountId`
- Incorrect behavior:
  - fetching analytics for unrelated accounts in the organization
  - using another Threads account's `linkedAccountId`

Example: target overview

- User: "Give me an overview for `poonce_official`"
- Correct behavior: overview means that target only, not all connected accounts.

Example: explicit org-wide comparison

- User: "Compare analytics across all connected accounts"
- Correct behavior: analyze multiple accounts and say explicitly that the result is organization-wide.

Example: same-brand cross-platform

- User: "Compare Threads and Instagram for `poonce_official`"
- Correct behavior: include only the clearly matching `poonce_official` Threads and Instagram profiles, excluding unrelated brands or clients.
