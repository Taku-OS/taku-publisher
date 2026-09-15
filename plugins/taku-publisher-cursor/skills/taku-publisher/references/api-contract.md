# Taku Publisher API Contract

The Python client implements the following provisional Worker contract. Worker remains authoritative for authentication, creator ownership, item identity, version state, storage keys, artifact digests, and review state.

## Routes

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/stax/publisher/drafts` | Create a new-item or update-item draft |
| `GET` | `/stax/publisher/drafts/{draftId}` | Read the current platform draft |
| `PATCH` | `/stax/publisher/drafts/{draftId}` | Update editable listing metadata |
| `POST` | `/stax/publisher/drafts/{draftId}/scan-report` | Store redacted scan, requirements, and deep review |
| `POST` | `/stax/publisher/drafts/{draftId}/artifacts/presign` | Issue a short-lived private ZIP upload URL and `artifactId` |
| `PUT` | `<signed upload URL>` | Upload raw `application/zip` bytes without Taku bearer auth |
| `POST` | `/stax/publisher/drafts/{draftId}/artifacts/{artifactId}/complete` | Verify object existence, ownership, size, and SHA-256; start server scan |
| `POST` | `/stax/publisher/drafts/{draftId}/submit` | Submit after final Taku Web human confirmation |
| `GET` | `/stax/publisher/drafts/{draftId}/status` | Read server scan, review, and publication state |
| `GET` | `/stax/items/me` | List the authenticated creator's owned items with filters and trusted install counts |
| `GET` | `/stax/items/{itemId}/management` | Read one owner-scoped item and its available management actions |
| `PATCH` | `/stax/items/{itemId}/management` | Update safe listing fields on an owner-scoped private draft |
| `POST` | `/stax/items/{itemId}/unpublish` | Move one owner-scoped published item back to a private draft without deleting versions, packages, or install records |
| `GET` | `/stax/creators/me/stats` | Read trusted server-side Creator Center statistics |
| `GET` | `/stax/items` | Search public Marketplace items without authorization |
| `GET` | `/stax/items/{itemId}` | Read one public Marketplace item without authorization |
| `GET` | `/stax/installs/package/{itemId}` | Read the authenticated package/access contract for one selected install |
| `POST` | `/stax/installs` | Record a successful local install |

The host workflow does not directly call `submit`; Taku Web owns that human action. The API method exists for the web/server integration contract.

Creator Center routes accept short-lived browser PKCE grants. The ordinary
`creator_center` grant separates item read, item write, profile read, and stats
read scopes. Unpublishing requires the separate `creator_center_unpublish`
intent and `creator.items.unpublish` scope; ordinary item write access is not
enough. The management patch route accepts only title, short description,
description, tags, and categories, and rejects non-draft or non-owner items.
Published item changes must create a Publisher update draft instead.

Marketplace search/show requests do not send an authorization token. Installing
uses a separate browser PKCE grant with only `marketplace.packages.read` and
`marketplace.installs.write`. The package contract supplies the exact item,
version, access result, expected size/SHA-256, and a public package download URL.
The package download is cross-origin and must never receive the Taku bearer
token. The client records the install only after atomic local extraction
succeeds.

## Create semantics

`mode: create` must not carry `itemId`. `mode: update` must carry an existing
item ID owned by the authenticated creator. Worker must never resolve update
identity from display name, slug, local path, or artifact contents.

For `mode: update`, Taku Publisher sends `inheritListing: true` and an empty
listing unless the creator explicitly supplied metadata overrides. Worker
reconstructs the listing from the server-owned item, then merges only the
provided patch. This preserves Marketplace identity, rights and support fields
while allowing intentional edits. Update submission still requires a
changelog.

The create payload may include listing metadata but must not include local absolute paths, secrets, auth tokens, or archive Base64. Plugin capabilities use relative paths only.

Canonical create shape:

```json
{
  "mode": "create",
  "toolType": "skill",
  "tool": {
    "id": "stable-local-id",
    "type": "skill",
    "name": "Example Skill",
    "description": "Short detected summary",
    "capabilities": []
  },
  "listing": {
    "title": "Example Skill",
    "shortDescription": "Short detected summary",
    "sourceKind": "local_upload"
  }
}
```

The response contains `draft`, plus top-level `draftId`, `reviewUrl`, and
`reviewPath` aliases. The review path is `/publish/{draftId}`. The first visit
edits listing/source metadata while status is `draft`; after package verification
the same page becomes read-only and owns final submission.

Worker responses also carry an `assetIdentity` relationship envelope once a
server resource exists:

```json
{
  "schemaVersion": "taku.asset.identity.v1",
  "resourceKind": "skill",
  "resourceId": "<server resource id>",
  "localResourceId": "<optional stable local id>",
  "serverResourceId": "<server resource id>",
  "origin": "created",
  "sourceSessionId": "<optional Taku session id>",
  "ownerId": "<creator id>",
  "visibility": "private",
  "currentVersionId": "<optional version id>",
  "currentVersionNumber": 1,
  "publishedVersionId": null,
  "listingId": null,
  "parentResourceId": null
}
```

The Publisher host treats this envelope as read-only. It must never infer or
overwrite resource identity from a display name, slug, local path, draft ID, or
package contents. In the current Worker storage model a published `listingId`
may equal `resourceId`; callers must still keep the fields separate because the
listing can become an independent entity later.

## Local scan request

```json
{
  "packageSha256": "<64 lowercase hex characters>",
  "report": {
    "deterministic": {
      "status": "passed",
      "scanner": "taku-publisher-deterministic@1",
      "filesScanned": 12,
      "findings": []
    },
    "deep": {
      "status": "passed",
      "scanner": "host-semantic-review@1",
      "findings": []
    }
  },
  "requirements": { "secrets": [], "env": [] }
}
```

Findings contain only rule, severity, disposition, relative path/line, and a
redacted message. Local evidence snippets, source paths, requirement evidence,
and credential values are never sent.

## Presign request

```json
{
  "size": 12345,
  "sha256": "<64 lowercase hex characters>",
  "contentType": "application/zip"
}
```

Expected response fields are `artifactId`, `uploadUrl`, and optional storage-required `headers`. The client sends no Taku `Authorization` header to `uploadUrl`.

Artifact completion sends only the platform-issued `artifactId`, size, and SHA-256. Do not accept an arbitrary client-provided `packageUrl`; this avoids external URL substitution and SSRF-style fetch behavior.

Before artifact completion, the host reads the same remote draft and writes its
current listing back through `PATCH`. This preserves Web edits such as the icon
and detailed description when the draft moves from editable state to final
confirmation. After completion, the host reads the draft again and rejects the
transition if those fields changed or disappeared.

## Server checks

Before returning the final `reviewUrl`, Worker should:

1. Verify creator ownership and draft state.
2. Verify the storage object belongs to the issued artifact and has not expired.
3. Recompute size and SHA-256.
4. Check ZIP traversal, duplicate paths, encryption, symlinks, file count, and uncompressed limits.
5. Re-run deterministic and server-side semantic/policy scans.
6. Compare manifest type/capabilities with the draft.
7. Store findings and move the draft to web confirmation, not directly to `published`.

## Web dependencies

Taku Web should edit title, description, icon, categories, tags, details, examples/media, runtime support, version/changelog, license/source rights, support/privacy links, dependencies, permissions, network access, and requirement declarations. It should show immutable file/digest/scan data read-only and submit through the authenticated Worker route.

Database schema and migrations are intentionally outside this skill and remain operator-managed.
