---
name: Store matching algorithm
description: Safe algorithm for matching order store names to DB stores — no substring, no 50% overlap.
---

## Rule

`_match_store_to_db` uses two passes only:

**Pass 1 — Exact normalized name:**  
`_normalize_name(raw) == _normalize_name(db_name)` → guaranteed match.

**Pass 2 — Jaccard ≥ 0.85 on significant words:**  
`_significant_words()` strips stop-words and tokens shorter than 3 chars.  
If multiple stores tie → return `None` (ambiguous, safer than wrong match).

**Why:**  
Old algorithm had substring pass ("центр" matched both "Мебельный Центр" and "Продукты Центр") and word-overlap ≥ 50% ("Супермаркет 24" matched "Супермаркет Каспийск"). These caused silent wrong deliveries.

**How to apply:**  
- Do NOT add back substring matching — it was the root cause of false positives.
- Do NOT lower Jaccard below 0.85 — 0.5 is too loose.
- When adding new stop-words to `_MATCH_STOP_WORDS`, verify existing test cases still pass.

## _normalize_name critical detail

Punctuation is replaced with a SPACE, not removed:
```python
s = re.sub(r"[^\w\s]", " ", s)   # space, not ""
s = re.sub(r"\s+", " ", s)        # collapse multiple spaces
```

**Why:** Removing `-` turns "Магазин-Приморский" into "магазинприморский" (one unrecognizable word). With space replacement it becomes "магазин приморский" → exact match.

## Stop-words list

Located in `_MATCH_STOP_WORDS` frozenset in `main.py` near `_match_store_to_db`. Includes: магазин, супермаркет, маркет, мини, центр, аптека, рынок, базар, торговый/ая, дом, склад, точка, продукты, универсам, универмаг, павильон, киоск, салон, бутик, ларек, лавка, отдел, гипермаркет, ип, ооо, зао, ао.
