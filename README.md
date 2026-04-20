# Po Once Agent API Skill

Public-ready agent skill for automating Po Once via its HTTP agent API.

## Files

- `SKILL.md`: skill definition and usage guide
- `scripts/po-once.cjs`: zero-dependency CLI helper

## Publish To GitHub

Put this folder in a repo like:

```text
skills/po-once-agent-api/
```

or make it the root of a dedicated repo.

Recommended repo structure:

```text
po-once-agent-skill/
  SKILL.md
  README.md
  scripts/
    po-once.cjs
```

## Quick Start

```bash
./scripts/po-once.cjs setup --api-key po_once_org_<secret>
./scripts/po-once.cjs accounts
```

Default base URL:

```text
https://dynamic-lapwing-647.convex.site
```

## Example

```bash
./scripts/po-once.cjs publish \
  --file ./launch.mp4 \
  --caption "Shipping this week." \
  --accounts profile_id_1,profile_id_2 \
  --mode scheduled \
  --schedule 2026-04-17T09:00:00Z \
  --timezone UTC
```

## License

Released under the MIT License. See `LICENSE`.
