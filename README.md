# Po Once Skill

Public-ready agent skill for automating Po Once via its HTTP agent API.

## Files

- `skills/po-once/SKILL.md`: skill definition and usage guide
- `skills/po-once/scripts/po-once.cjs`: zero-dependency CLI helper

## Install With `npx skills add`

After pushing this repo to GitHub, install it with:

```bash
npx skills add Stiffjobs/po-once-agent-skill
```

This works because the repository exposes a standard `skills/po-once/SKILL.md`
layout that the `skills` CLI discovers automatically.

## Update

Pull the latest version of an installed skill with:

```bash
npx skills update po-once
```

Run `npx skills update` with no arguments to update every installed skill.
Add `-g` to target a global install or `-p` for a project install.

Re-running `npx skills add Stiffjobs/po-once-agent-skill` also works and
overwrites the installed copy. The `last-updated` date in
`skills/po-once/SKILL.md` shows which version you have. See `CHANGELOG.md`
for what changed in each version.

## Quick Start

```bash
./skills/po-once/scripts/po-once.cjs setup --api-key po_live_org_<secret>
./skills/po-once/scripts/po-once.cjs accounts
```

## Example

```bash
./skills/po-once/scripts/po-once.cjs publish \
  --file ./launch.mp4 \
  --caption "Shipping this week." \
  --accounts social_profile_id_1,social_profile_id_2 \
  --mode scheduled \
  --schedule 2026-04-17T09:00:00Z \
  --timezone UTC
```

`--accounts` means comma-separated `id` or `socialProfileId` values returned by
`./skills/po-once/scripts/po-once.cjs accounts`; the helper sends them as
`socialProfileIds`.

## Large Files

The helper streams media from disk, so file size is limited only by the
destination platform. For long videos (roughly 200 MB and up) or slow
connections, run `upload`/`publish` with `--background` and poll:

```bash
./skills/po-once/scripts/po-once.cjs publish --file ./long.mp4 --caption "..." --accounts <ids> --mode direct --background
./skills/po-once/scripts/po-once.cjs jobs:wait --id <job_id> --timeout 60
```

Never compress or re-encode a file to make an upload "fit"; see the Large
Media Files section in `skills/po-once/SKILL.md`.

## License

Released under the MIT License. See `LICENSE`.
