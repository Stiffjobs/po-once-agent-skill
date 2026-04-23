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

## Quick Start

```bash
./skills/po-once/scripts/po-once.cjs setup --api-key po_once_org_<secret>
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

## License

Released under the MIT License. See `LICENSE`.
