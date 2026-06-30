"""Scheduling engine — the shared action layer for the UI and the Copilot.

One source of truth: `seed.ensure_seeded()` creates + seeds the sched_* tables (in
both the SQLite fake and live Aurora), and `service` exposes the action API
(specialties, doctors, calendar, book/modify/cancel, PTO + impact). Both the
REST routes and the agent tools call `service`. FOR DEMONSTRATION ONLY — SYNTHETIC.
"""

from . import service
from .seed import augment_seed, ensure_seeded

__all__ = ["service", "ensure_seeded", "augment_seed"]
