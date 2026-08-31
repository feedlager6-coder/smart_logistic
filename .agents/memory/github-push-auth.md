---
name: GitHub push authentication
description: GitHub PAT authentication for HTTPS pushes in this Replit environment.
---

Для Git over HTTPS GitHub PAT нужно передавать как Basic Auth через `http.extraheader`; Bearer-заголовок в этом окружении отклоняется как invalid credentials даже при действующем токене.

**Why:** обычный push и Bearer-вариант не прошли, а Basic Auth с тем же секретом успешно отправил commit в GitHub.

**How to apply:** не выводить токен и не помещать его в remote URL; сформировать временный Basic-заголовок из `x-access-token:<GITHUB_TOKEN>` и выполнить push без интерактивного запроса пароля.