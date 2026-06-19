---
name: Admin cascade delete wipes all user data
description: admin_delete_user deletes all user data (stores, sessions, settings, users) manually because FK is NO ACTION.
---

## Rule
`admin_delete_user` performs a manual cascade in this order:
1. `DELETE FROM route_session_stores WHERE session_id IN (SELECT id FROM route_sessions WHERE owner_id=%s)`
2. `DELETE FROM route_sessions WHERE owner_id=%s`
3. `DELETE FROM stores WHERE owner_id=%s`
4. `DELETE FROM company_settings WHERE owner_id=%s`
5. `DELETE FROM users WHERE id=%s`

**Why:** All owner_id FK constraints use `ON DELETE NO ACTION` (not CASCADE). DB enforces referential integrity — cannot delete user while they have stores/sessions without manually cleaning up first.

**How to apply:** Never test destructive admin operations (delete user) against real accounts with live data. Use disposable test accounts created specifically for the test.

## Warning
- admin (id=1) was accidentally deleted during testing → cascade deleted 452 stores + all route sessions. Account was recreated (id=6) with same password but data was lost.
- Always test with fresh throwaway users, not accounts that hold real data.
