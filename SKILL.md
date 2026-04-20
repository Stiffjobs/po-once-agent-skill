---
name: po-once-agent-api
description: >
  Use Po Once's organization-scoped agent API to list connected accounts, upload
  media, create content, schedule or publish posts, inspect status, and delete
  eligible posts through a local helper script.
last-updated: 2026-04-16
allowed-tools: Bash(./scripts/po-once.cjs:*)
---

# Po Once Agent API Skill

Portable skill bundle for AI agents to automate Po Once through the agent API.

## Setup

Create an API key in Po Once and run:

```bash
./scripts/po-once.cjs setup --api-key po_once_org_<secret>
```

Default base URL:

```text
https://dynamic-lapwing-647.convex.site
```

Override it if needed:

```bash
./scripts/po-once.cjs setup \
  --api-key po_once_org_<secret> \
  --base-url https://your-other-convex-host.convex.site
```

## Commands

| Command | Description |
|---------|-------------|
| `./scripts/po-once.cjs setup --api-key <token>` | Save credentials |
| `./scripts/po-once.cjs config` | Show resolved config |
| `./scripts/po-once.cjs accounts` | List connected accounts |
| `./scripts/po-once.cjs upload --file ./clip.mp4` | Upload media |
| `./scripts/po-once.cjs content:create --caption "..." --post-type video --storage-key <key> --size-bytes 1234` | Create content |
| `./scripts/po-once.cjs post --content-id <id> --accounts profile1,profile2 --mode scheduled --schedule 2026-04-17T09:00:00Z --timezone UTC` | Create post batch |
| `./scripts/po-once.cjs publish --file ./clip.mp4 --caption "..." --accounts profile1,profile2 --mode direct` | Upload, create content, and create post |
| `./scripts/po-once.cjs posts --limit 20 --status scheduled` | List posts |
| `./scripts/po-once.cjs posts:get --id <post_id>` | Get one post |
| `./scripts/po-once.cjs posts:delete --id <post_id>` | Delete eligible post |

## API Surface

The helper script wraps these endpoints:

- `GET /api/agent/v1/accounts`
- `POST /api/agent/v1/media/create-upload-url`
- `POST /api/agent/v1/contents`
- `GET /api/agent/v1/posts`
- `POST /api/agent/v1/posts`
- `GET /api/agent/v1/posts/:id`
- `DELETE /api/agent/v1/posts/:id`

## Recommended Agent Workflow

1. Call `accounts` to get valid profile IDs.
2. Draft content and confirm whether the user wants direct or scheduled posting.
3. Use `publish` for the normal end-to-end path.
4. Use `posts` or `posts:get` to confirm status.
5. Only use `posts:delete` when the user explicitly wants a scheduled post removed.

## Safety Notes

- Treat the API token like a password.
- Prefer scheduled posting unless the user clearly wants immediate publishing.
- Results are scoped to the organization tied to the token.
- Some posts cannot be deleted once processing has started.
