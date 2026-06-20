"""Reversible deterministic tokenization.

token  = "[ENTITY:hex12]"  where hex12 = HMAC(value) — SAME value -> SAME token,
          so the model can reason about an entity across both reports without
          ever seeing it.
reverse = Vault-transit ciphertext of the original value, stored in token_vault;
          decrypted ONLY in the app tier, gated + audited (never by the LLM).

Two backends:
  * vault  (default / prod) — HMAC + encrypt/decrypt via Vault transit.
  * local  (offline tests)  — deterministic HMAC via hashlib + a static demo key;
            reversible "ciphertext" is base64 (NOT secure — test only).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

from . import config

_TOKEN_HEX_LEN = 12


def _fmt_token(entity_type: str, hexdigest: str) -> str:
    return f"[{entity_type}:{hexdigest[:_TOKEN_HEX_LEN]}]"


class Tokenizer:
    def __init__(self, backend: str | None = None):
        self.backend = backend or os.environ.get("AMBOY_TOKENIZER_BACKEND", "vault")
        self._vault = None
        if self.backend == "vault":
            import hvac  # imported lazily so offline tests need no hvac/cluster
            self._vault = hvac.Client(url=config.VAULT_ADDR, token=config.VAULT_TOKEN)
            self._key = config.VAULT_TRANSIT_KEY
        else:
            # Deterministic demo key — local/offline only.
            self._local_key = os.environ.get(
                "AMBOY_LOCAL_HMAC_KEY", "amboy-demo-local-key").encode()

    # ── deterministic token (HMAC) ───────────────────────────────────────────
    def token(self, entity_type: str, value: str) -> str:
        value = (value or "").strip()
        if self.backend == "vault":
            b64 = base64.b64encode(value.encode()).decode()
            resp = self._vault.secrets.transit.generate_hmac(
                name=self._key, hash_input=b64, algorithm="sha2-256")
            mac = resp["data"]["hmac"]            # 'vault:v1:<base64>'
            raw = base64.b64decode(mac.split(":")[-1])
            hexd = raw.hex()
        else:
            hexd = hmac.new(self._local_key, value.encode(), hashlib.sha256).hexdigest()
        return _fmt_token(entity_type, hexd)

    # ── reversible storage (encrypt / decrypt) ───────────────────────────────
    def encrypt(self, value: str) -> str:
        if self.backend == "vault":
            b64 = base64.b64encode((value or "").encode()).decode()
            resp = self._vault.secrets.transit.encrypt_data(
                name=self._key, plaintext=b64)
            return resp["data"]["ciphertext"]
        return "local:" + base64.b64encode((value or "").encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        if self.backend == "vault":
            resp = self._vault.secrets.transit.decrypt_data(
                name=self._key, ciphertext=ciphertext)
            return base64.b64decode(resp["data"]["plaintext"]).decode()
        return base64.b64decode(ciphertext.split("local:", 1)[-1]).decode()
