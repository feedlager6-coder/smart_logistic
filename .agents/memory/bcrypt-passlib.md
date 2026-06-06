---
name: bcrypt passlib incompatibility
description: bcrypt≥4.0 is incompatible with passlib — use bcrypt directly for password hashing/verification.
---

# bcrypt≥4.0 + passlib incompatibility

## The rule
Never use `passlib.context.CryptContext` with bcrypt backend. Use the `bcrypt` library directly.

## Why
bcrypt≥4.0 removed `__about__.__version__`, which passlib reads during backend initialization. This causes `AttributeError: module 'bcrypt' has no attribute '__about__'` and then `ValueError: password cannot be longer than 72 bytes` when passlib tries to run its wrap-bug detection with an uninitialized backend.

## How to apply
```python
import bcrypt as _bcrypt_lib

def _truncate_password(password: str) -> bytes:
    return password.encode("utf-8")[:72]  # bcrypt hard limit

def _hash_password(password: str) -> str:
    pw = _truncate_password(password)
    return _bcrypt_lib.hashpw(pw, _bcrypt_lib.gensalt(rounds=12)).decode("utf-8")

def _verify_password(plain: str, hashed: str) -> bool:
    try:
        pw = _truncate_password(plain)
        return _bcrypt_lib.checkpw(pw, hashed.encode("utf-8"))
    except Exception:
        return False
```

The 72-byte truncation must be done explicitly — bcrypt silently truncates but passlib raises before reaching that point.
