# Changelog

Versions are identified by the `last-updated` date in `skills/po-once/SKILL.md`.
Run `npx skills update po-once` to get the latest.

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
