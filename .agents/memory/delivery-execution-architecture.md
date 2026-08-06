---
name: Delivery execution architecture
description: Operational delivery tracking is layered on top of immutable route optimization.
---

The delivery execution model separates an immutable optimization result from its operational lifecycle: one route session can have assignments per vehicle, and each assignment owns point executions with driver-visible status, planned/actual quantities, and payment data.

**Why:** A route is a plan/history record, while a real trip may be reassigned, executed partially, or repeated without changing routing quality, loading sheets, or historical optimization results.

**How to apply:** Keep driver/vehicle assignment and delivery status changes out of route_sessions/result_json; keep planned quantity immutable and record actual quantity separately; keep payment method separate from payment status; use token-scoped driver access and owner-scoped dispatcher APIs, with polling before introducing realtime infrastructure.