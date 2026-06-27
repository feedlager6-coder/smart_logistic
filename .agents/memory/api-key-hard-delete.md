---
name: API key hard-delete pattern
description: How API key lifecycle works — soft revoke vs hard delete, purge endpoint, admin cleanup.
---

## Rule
DELETE /api/auth/api-keys/{id} has two modes:
- Default (no params): soft revoke — sets is_active=FALSE, keeps audit trail
- ?permanent=true: hard delete — removes row from DB entirely

DELETE /api/auth/api-keys (no ID) = purge ALL revoked (is_active=FALSE) keys for current user. Active keys not touched.

Admin test-key cleanup: DELETE /api/admin/api-keys/cleanup-test — pattern-matches test key names (test_*, smoke_*, rc_*, etc.).

api_keys.owner_id has ON DELETE CASCADE → user deletion auto-cascades to all their keys.

## Why
Soft revoke preserves audit trail (who had what key, when it was active). Hard delete is needed for GDPR / cleanup after tests. Purge endpoint batch-cleans test debris without requiring individual deletes.

## How to apply
- After smoke/release tests: soft revoke → hard delete via ?permanent=true, OR use admin cleanup endpoint
- In tests: test user deletion cascades keys automatically (no explicit cleanup needed for keys)
- Frontend: revoked keys show "Удалить" button (permanent delete); active keys show "Отозвать"; "Удалить отозванные" batch button appears when any revoked key exists
