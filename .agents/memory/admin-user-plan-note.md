---
name: Admin user plan and note fields
description: users table has plan (trial/basic/pro/enterprise) and admin_note TEXT fields for SaaS tier management.
---

## Rule
`plan` and `admin_note` were added to the users table via `init_db()` migrations:
- `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'trial'`
- `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT ''`

**Valid plans:** `_VALID_PLANS = {"trial", "basic", "pro", "enterprise"}`. Invalid values silently fall back to "trial".

**How to apply:**
- All admin API responses include `plan` and `admin_note`
- AdminUserCreate and AdminUserUpdate Pydantic models both include these fields
- Frontend: plan is editable inline via dropdown (click badge), admin_note via inline textarea
- Delete confirmation requires user to type the username manually (double-confirmation)
