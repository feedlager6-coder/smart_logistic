---
name: 1C integration format decision
description: Why BSL+ZIP is used instead of EPF/CFE binary generation for the 1C integration package.
---

## Rule
Distribute 1C integration as a ZIP containing SmartRoute.bsl + Инструкция.txt. Never attempt to generate .epf binary programmatically.

**Why:** The .epf file is a proprietary V8 binary container format. The XML "export" format used by Configurator's "Загрузить из файлов" is different from the runnable binary and still requires a programmer. OData requires server admin + web publishing setup. BSL is the most universal approach — works with any 1C 8.3+ without Configurator changes.

**How to apply:** If asked "why not EPF?" — pre-building a static .epf in a real 1C Configurator and storing it as a static asset is the only way (like МойСклад does). That requires owning a licensed 1C instance.
