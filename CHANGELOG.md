# Changelog

Versions are identified by the `last-updated` date in `skills/po-once/SKILL.md`.
Run `npx skills update po-once` to get the latest.

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
