---
name: quick-setup key rotation
description: How /api/integrations/quick-setup handles key replacement atomically with revocation.
---

## Rule
When quick-setup is called and existing 1C integration exists:
1. Reads old api_key_id from integration.config
2. Sets old key is_active=FALSE (atomic revoke)
3. Creates new api_key with orders:write + webhooks:receive
4. Updates integration config with new api_key_id
5. Returns package_b64 (base64 ZIP) + full_key once

**Why:** Without revocation, reconnect creates orphan active keys. UI says "old key no longer works" so must be true.

**How to apply:** Any future reconnect flow changes must also update the revocation step. Frontend downloads ZIP from package_b64 in the quick-setup response — avoids needing to store or re-derive the full key.
