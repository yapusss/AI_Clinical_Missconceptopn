"""Invalidation hooks for generated reading material (Phase C4, D13).

`QuestionVersion` and `ReferenceAnswer` are `managed = False`, but Django
`post_save` still fires for ORM writes. A save through the ORM marks the affected
question version's material rows `STALE`; the drain regenerates them on its next
pass.

This does **not** fire for raw-SQL writes (stored procs, `psql`, migrations,
`ingest_materials`, `sync_reference_embeddings`) — that is exactly what the
drain's `--refresh` fingerprint sweep is for. Reference *embeddings* are not
invalidated here: C2's `answer_hash` sweep already covers them and is cheaper.
"""

import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

from api.models import QuestionVersion, ReferenceAnswer
from api.reading_materials import mark_stale_for_question_version

logger = logging.getLogger(__name__)


@receiver(post_save, sender=QuestionVersion)
def _question_version_saved(sender, instance, **kwargs):
    mark_stale_for_question_version(instance.id)


@receiver(post_save, sender=ReferenceAnswer)
def _reference_answer_saved(sender, instance, **kwargs):
    mark_stale_for_question_version(instance.question_version_id)
