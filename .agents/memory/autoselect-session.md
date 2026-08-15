---
name: autoSelect sessionStorage
description: route.tsx auto-select from orders must use sessionStorage, not just useRef, to survive SPA remounts.
---

## Rule

`autoSelectedRef = useRef(false)` resets every time the React component unmounts and remounts (SPA navigate away → back). This causes repeated auto-select toasts and overrides manual store selection.

**Fix:** persist the flag in `sessionStorage` with a date key:

```typescript
const TODAY_KEY = `smartroute_autoselect_${new Date().toISOString().slice(0, 10)}`;
const autoSelectedRef = useRef(false);

useEffect(() => {
  if (!fromOrders) return;
  if (autoSelectedRef.current || sessionStorage.getItem(TODAY_KEY)) return; // ← both checks
  if (!todayOrders || !stores || stores.length === 0) return;

  autoSelectedRef.current = true;
  sessionStorage.setItem(TODAY_KEY, "1"); // ← persist across remounts
  // ... rest of logic
}, [fromOrders, todayOrders, stores, toast, TODAY_KEY]);
```

**Why:** sessionStorage survives React unmount/remount within the same browser tab. The date key ensures it resets daily (next day = new key = auto-select fires again for new orders).

**How to apply:** Any "fire exactly once per day" effect in route.tsx should use this pattern. The ref is still needed for the within-render guard; sessionStorage covers the remount case.
