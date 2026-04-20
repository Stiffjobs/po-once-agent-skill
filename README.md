# Po Once Skill

Public-ready agent skill for automating Po Once via its HTTP agent API.

## Files

- `skills/po-once/SKILL.md`: skill definition and usage guide
- `skills/po-once/scripts/po-once.cjs`: zero-dependency CLI helper

## Publish To GitHub

Put this folder in a repo like:

```text
skills/po-once/
```

or move the `po-once` folder into an existing `skills/` directory.

## Install With `npx skills add`

After pushing this repo to GitHub, install it with:

```bash
npx skills add <owner>/<repo> --skill po-once
```

You can also point directly at the repo or local checkout:

```bash
npx skills add https://github.com/<owner>/<repo> --skill po-once
npx skills add . --skill po-once
```

This works because the repository exposes a standard `skills/po-once/SKILL.md`
layout that the `skills` CLI discovers automatically.

Recommended repo structure:

```text
po-once-agent-skill/
  README.md
  skills/
    po-once/
      SKILL.md
      scripts/
        po-once.cjs
```

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
  --accounts profile_id_1,profile_id_2 \
  --mode scheduled \
  --schedule 2026-04-17T09:00:00Z \
  --timezone UTC
```

## License

Released under the MIT License. See `LICENSE`.
