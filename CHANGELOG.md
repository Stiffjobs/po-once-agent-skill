# Changelog

Versions are identified by the `last-updated` date in `skills/po-once/SKILL.md`.
Run `npx skills update po-once` to get the latest.

## 2026-10-17

- Added `contents` to list the organization's saved content (caption search
  with `--search`, `--post-type`, `--limit` max 100, `--cursor`) and
  `contents:get` to read one content with its media and the posts made from
  it. Use them to reuse content already in Po Once instead of uploading again.
- Added `contents:update` to edit saved content's caption, title
  (`--clear-title` lets Po Once generate a new one), and profile hint. A new
  caption reaches every scheduled post of that content without its own caption
  override. Media cannot change.
- Added `contents:delete` to delete saved content, its media, and the Po Once
  records of its posts. It is refused with `409 CONTENT_HAS_ACTIVE_POSTS` while
  any post is scheduled or publishing; published posts stay on the networks.
- `posts` takes `--from` and `--to` (ISO or Unix ms, at most 93 days) to list
  posts scheduled in a window, earliest first.
- Added `usage`: plan, posts this month, storage (with bytes reserved by
  uploads in progress), and connected accounts against their limits.
- Added `analytics:post` (live metrics of one Po Once post),
  `analytics:profile-posts` (a profile's recent platform posts with metrics,
  paginated; Instagram, Facebook, Threads, TikTok), and
  `analytics:demographics` (follower age, gender, cities, countries; Instagram
  and Threads). `analytics:profile` now supports YouTube (`--days` 7, 30, 90).
- `analytics:profile-posts` reports a platform failure as an error
  (`ANALYTICS_PROVIDER_RATE_LIMITED`, `ANALYTICS_RECONNECT_REQUIRED`, ...)
  instead of an empty page.
- Hosted MCP: the tool list now includes `list_workspaces`,
  `create_account_connect_link`, `get_usage`, `get_post_analytics`,
  `list_profile_post_metrics`, `get_audience_demographics`, `list_contents`,
  `get_content`, `update_content`, and `delete_content`. A connection only lists
  the tools its approved permissions allow; `delete_content` needs the new
  `contents:delete` permission, so existing connections must reconnect for it.
- Hosted MCP: the in-chat uploader is no longer described as Claude-only. It
  renders in any client that displays MCP Apps UI with Po Once added as an app
  or connector.
- `contents:update --profile-hint` must be the exact workspace name; any other
  value is rejected and nothing changes.
- `post` at the monthly post limit now fails with `402 POST_LIMIT_EXCEEDED`
  (it was a generic 500 whose message held that code).
- Added isolated CLI tests for the new commands.

## 2026-09-22

- Hosted MCP: documented `media_open_upload`, the in-chat uploader for MCP Apps
  clients. It appears only when Po Once is added as a connector in Claude
  Desktop or claude.ai, never through an MCP config file or a CLI. It collects
  a caption and title and creates the content itself, so agents must not call
  `create_content` again for media it attached.

## 2026-09-17

- Added `comments:posts` to discover posts on a connected Instagram, Facebook
  Page, or Threads profile, including posts published outside Po Once, and
  `comments` to read one page of top-level comments on a post or, with
  `--comment-id`, the direct replies to one comment. Read-only; nothing is
  sent, moderated, or read from DMs.
- Post and comment ids are Meta platform ids; the helper rejects URLs and
  Po Once post ids before making a request. `--limit` (max 100) and `--cursor`
  follow the same rules as the monitoring commands.
- `comments` returns replies in the same page: Threads (newest first) and
  Facebook (chronological) return every comment at any depth flattened, and
  Instagram includes replies as well (at most 50 per comment).
  `parentCommentId` links each reply to its parent.
- Each comment now carries `hasReplies` and `isFromProfile` so an agent can
  find comments that still need a human reply without a call per comment.
- Documented the response envelope, null semantics (`replyCount`,
  `hasReplies`, Instagram `permalink`), coverage reporting, untrusted-content
  handling, and the reconnect / provider-rate-limit error codes.
- Listed the three hosted MCP tools (`list_comment_posts`, `get_post_comments`,
  `get_comment_replies`) and the `comments:read` scope they require.
- Added isolated CLI tests for both commands.

## 2026-09-16

- Documented the hosted MCP server at `https://po-once.com/mcp` as an
  alternative to the helper script: browser OAuth sign-in per organization, the
  eleven hosted tool names, and API-key bearer support.
- Noted that hosted MCP cannot read local files and that `create_posts` rejects
  a past `scheduledTime`; listed when the script remains the better fit.

## 2026-09-11

- Added `--limit` and `--cursor` to `keyword-monitors`; both monitoring commands
  validate positive integer limits and required option values before requests.
- Documented active filtering, response envelopes, newest-discovered ordering,
  and continuing through empty filtered pages with the same filters.
- Corrected `autoReplyEnabled`: it is always false; templates do not enable
  automatic replies.
- Added isolated CLI tests for monitoring requests, pagination, invalid filters,
  and API errors. The helper retains its production-only configuration.

## 2026-09-10

- Added `keyword-monitors` to list the organization's saved Threads keyword
  monitors (`--active` for active ones only). Read-only; monitors are still
  created and edited in the Po Once web app.
- Added `keyword-matches` to retrieve the posts those monitors already found,
  newest first, with `--monitor-id`, `--status`, `--post-age-hours`, `--limit`,
  and `--cursor` filters.
- Documented when to use `keyword-matches` (tracked keywords, pending replies)
  versus `keyword-search` (fresh ad-hoc queries), and the meaning of each
  match `status`.
- Backed by two new endpoints: `GET /api/agent/v1/keyword-monitors` and
  `GET /api/agent/v1/keyword-matches`.

## 2026-09-03

- Documented the Meta analytics response shape returned by `analytics:profile`
  for Instagram, Facebook, and Threads: `totals`, `timeSeries[]`, and the
  per-post lists, including which fields are always 0.
- Facebook `reach` now means unique content viewers (`page_total_media_view_unique`)
  and `views` means content views (`page_media_view`); the impression-based
  metrics Meta retired are no longer returned.
- Facebook responses carry `insightsUnavailable` and `error` when Meta returns
  no page-level insights (Pages under 100 likes or a retired metric). Posts
  still load in that case.
- Noted that post lists are the most recent 25 items regardless of the window.
- No script changes. Request parameters for `analytics:profile` are unchanged.

## 2026-08-30

- Uploads stream from disk with exact `Content-Length`, so file size is limited
  only by the destination platform.
- Failed transfers retry up to 3 times with a fresh upload URL;
  `STORAGE_LIMIT_EXCEEDED` fails fast.
- Added `--background` to `upload` and `publish`, plus `jobs:wait`,
  `jobs:status`, and `jobs:list` to track detached jobs.
- Added `--first-comment` for Meta link-in-comment publishing.
- Added the Large Media Files section to `SKILL.md` and the Update section to
  the README.

## 2026-08-14

- Documented that YouTube profiles only accept `video` posts and the API error
  returned otherwise.

## 2026-04-25

- The helper only accepts production `po_live_org_` keys.

## 2026-04-24

- Added `analytics:profile` (Meta and TikTok) and Threads `keyword-search`.
- Tightened `posts:delete` guidance: only posts with `type` and `status` both
  `scheduled` may be deleted.

## 2026-04-23

- Post targets are sent as `socialProfileIds`; `--accounts` accepts the `id` or
  `socialProfileId` values returned by `accounts`.
- Config resolution walks upward for `.po-once/config.json` and supports
  `--config` / `PO_ONCE_CONFIG_PATH`.
- CLI output redacts common credential fields.

## 2026-04-20

- Initial public release.
