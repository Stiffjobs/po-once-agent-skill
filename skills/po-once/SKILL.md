---
name: po-once
description: >
  Use Po Once's organization-scoped agent API to list connected accounts, upload
  media, create content, schedule or publish posts, inspect status, and delete
  eligible scheduled posts through a local helper script.
last-updated: 2026-09-03
allowed-tools: Bash(./scripts/po-once.cjs:*)
---

# Po Once Skill

Portable skill bundle for AI agents to automate Po Once through the agent API.

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
| `./scripts/po-once.cjs upload --file ./clip.mp4` | Upload media (streams from disk; any size the target platform accepts) |
| `./scripts/po-once.cjs upload --file ./clip.mp4 --background` | Start the upload as a detached background job and return a `jobId` immediately |
| `./scripts/po-once.cjs content:create --caption "..." --post-type video --storage-key <key> --size-bytes 1234` | Create content |
| `./scripts/po-once.cjs post --content-id <id> --accounts social_profile_id_1,social_profile_id_2 --mode scheduled --schedule 2026-04-17T09:00:00Z --timezone UTC` | Create post batch; `--accounts` must be comma-separated `id` or `socialProfileId` values returned by `accounts` |
| `./scripts/po-once.cjs publish --file ./clip.mp4 --caption "..." --accounts social_profile_id_1,social_profile_id_2 --mode direct` | Upload, create content, and create post; `--accounts` must be comma-separated `id` or `socialProfileId` values returned by `accounts` |
| `./scripts/po-once.cjs publish ... --background` | Same as `publish`, but runs detached; the final `{ uploads, content, post }` is stored on the job |
| `./scripts/po-once.cjs jobs:wait --id <job_id> --timeout 60` | Wait up to N seconds (max 540) for a background job; prints status, progress, result, or error |
| `./scripts/po-once.cjs jobs:status --id <job_id>` | Print a background job's state without waiting |
| `./scripts/po-once.cjs jobs:list` | List the 20 most recent background jobs |
| `./scripts/po-once.cjs posts --limit 20 --status scheduled` | List posts |
| `./scripts/po-once.cjs posts:get --id <post_id>` | Get one post |
| `./scripts/po-once.cjs posts:get --id <post_id> --status-only` | Get a minimal status view for one post |
| `./scripts/po-once.cjs posts:delete --id <post_id>` | Delete an eligible scheduled post |

## Large Media Files

Po Once does not impose a file-size limit of its own. The helper streams the file from disk directly to storage, retries failed transfers with a fresh upload URL, and prints progress to stderr every few seconds. The only size limits that apply are the destination platform's.

Rules:

- Never compress, transcode, re-encode, trim, or otherwise modify a media file to make an upload "fit". Upload the original file as-is.
- Never tell the user a file is too large to upload. If an upload fails, report the actual error message from the helper.
- Upload time depends only on the user's connection. As a guide, 300 MB takes about 4 minutes at 10 Mbps and about 25 seconds at 100 Mbps.
- For files over roughly 200 MB, or whenever the upload may outlast your tool's execution timeout, run `upload` or `publish` with `--background`:
  1. Run `./scripts/po-once.cjs publish --file ./long.mp4 --caption "..." --accounts <ids> --mode direct --background`. It returns a `jobId` immediately.
  2. Run `./scripts/po-once.cjs jobs:wait --id <job_id> --timeout 60`. It returns when the job finishes or after 60 seconds with `status: "running"` and a `progress` object (percent, bytes, speed, seconds left).
  3. Repeat `jobs:wait` until `status` is `succeeded` (the result is in `result`) or `failed` (the reason is in `error`).
- Do not start a second upload of the same file while a job is still `running`.
- If the API returns `STORAGE_LIMIT_EXCEEDED`, the organization's storage quota is full. Stop and ask the user to delete unused content in Po Once or upgrade to Pro; shrinking the file does not help.

Storage accounting: Po Once records the actual stored size of each uploaded object and counts it against the organization's storage quota. `sizeBytes` sent by the helper is only a hint used to reject over-quota uploads before the transfer starts.

## Account IDs

Agents must call `accounts` before posting unless the user already provided current Po Once `socialProfileId` values. Use the returned `id` or `socialProfileId` as the post target; those values are equivalent for posting.

When running `post` or `publish`, the CLI flag stays named `--accounts` for ergonomics, but it sends those values to the API as `socialProfileIds`. Do not use `accountIds`, `profileIds`, provider-native account IDs, handles, usernames, or display names as post targets.

For Threads keyword discovery, use the `linkedAccountId` returned by `accounts`, not the posting `id`/`socialProfileId`.

If the user gives ambiguous account input, run `accounts` and match by visible metadata such as provider, display name, username, or avatar before choosing the returned `id` or `socialProfileId`.

Treat `accounts` as a target-resolution step, not an invitation to analyze every connected account. A named account limits the task to that account, even when the user asks for an "overview". Expand only when the user explicitly requests an organization-wide comparison or a cross-platform view of the same brand; ask one short question if same-brand matching is ambiguous.

Resolve targets in this order:

1. exact provider + exact handle/username match
2. exact provider + exact display name match
3. exact provider + clear unique partial match
4. ask for clarification

State the resolved provider and `id`/`socialProfileId` before continuing, plus `linkedAccountId` for Threads discovery.

## Analytics And Discovery

Use `analytics:profile` only after resolving the target account through `accounts`.

- Fetch only the resolved target by default. Include multiple profiles only for an explicit organization-wide comparison or clearly matched same-brand cross-platform request.
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

Meta response fields (`analytics` object; lifetime totals per post, period aggregates per account):

- Instagram: `totals.{reach,followerCount,totalFollowers,likes,comments,shares,saves,accountsEngaged,totalInteractions}`, `timeSeries[].{date,reach,followerCount}`, `recentMedia[].{likeCount,commentsCount,insights.{views,reach,saved,shares,totalInteractions}}`. `totals.profileViews` and the other daily fields are always 0.
- Facebook: `totals.{views,reach,profileViews,postEngagements,followers}`, `timeSeries[].{date,views,reach,profileViews,postEngagements}`, `recentPosts[].{likes,comments,shares,views,reach,videoViews,clicks,reactions}`. `reach` means unique content viewers. `insightsUnavailable` means Meta returned no page-level insights (Pages under 100 likes or a retired metric) and only posts loaded; `error` carries Meta's message.
- Threads: `totals.{views,likes,replies,reposts,quotes,clicks,followersCount}`, `timeSeries[].{date,views}`, `recentPosts[].{views,likes,replies,reposts,quotes,shares}`. `totals.shares` and the other daily fields are always 0.
- Post lists are the most recent 25 items regardless of the window.

Threads keyword discovery rules:

- Use `keyword-search` only for the resolved Threads target
- `--linked-account-id` must come from that exact resolved Threads account
- the matched account must have provider `threads`
- `--search-type` is optional and must be `TOP` or `RECENT`
- prefer `TOP` unless the user explicitly wants recency

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

1. Run `health` when you need to confirm which config and `configPath` are active.
2. Run `accounts` to resolve the target unless the user supplied current Po Once IDs; ask one short question if the match remains ambiguous.
3. For analytics or discovery, follow the scope and provider rules above.
4. Draft content and confirm whether the user wants direct or scheduled posting.
   - YouTube profiles only accept `video` posts — before calling `post` or `publish`, drop YouTube targets from `--accounts` for image/text content, or ask the user which they want.
5. Use `publish` for the normal end-to-end posting path. Add `--background` for large files and poll with `jobs:wait` (see Large Media Files).
6. Use `posts` or `posts:get --status-only` to confirm status.
7. Before an explicitly requested deletion, inspect the post and confirm both `type === "scheduled"` and `status === "scheduled"`.

## Safety Notes

- Treat the API token like a password.
- CLI output redacts common credential fields, but avoid sharing raw command output broadly unless needed.
- Prefer one explicit request per task instead of fetching every profile.
- Use bounded analytics windows and confirm the returned response window before summarizing performance.
- Prefer scheduled posting unless the user clearly wants immediate publishing.
- Results are scoped to the organization tied to the token.
- If the API returns `SUBSCRIPTION_REQUIRED`, stop and ask the user to upgrade the organization to an active Starter or Pro plan, or switch organizations.
- If the API returns `STORAGE_LIMIT_EXCEEDED`, stop and ask the user to free storage or upgrade to Pro. Do not compress the file and retry.
- If a YouTube profile is targeted with an image or text post, the API rejects it with the error `YouTube only supports video posts. Remove the YouTube profile or pick a video.` — resolve it by adjusting the targets (remove the YouTube profile or switch to video content), not by retrying the same request.
- Before calling `DELETE /api/agent/v1/posts/:id`, inspect the post first to confirm it is still scheduled and has not started processing.
- Do not delete direct posts, published posts, failed posts, errored posts, posts already processing, or any post with another `type` or `status`.
- If the post is not still `scheduled`/`scheduled`, do not call delete and tell the user that only scheduled posts that are still in `scheduled` status can be deleted.
