"""Who may read a reference document's bytes, and where those bytes live (W1).

The citation payloads already carry `document_id` + `page`; the only thing that was
missing was a way to turn that id into readable bytes without exposing the
filesystem. Both answers come from `knowledge_documents`: the row owns the path
(never the client) and the subject that scopes the access check.

Two rules, one place:

- **lecturer** of the subject → any of its documents.
- **student** → only a document that is a cited source of a reading material they
  were actually served (the citation is their entitlement, not the upload).

Admins follow the repo's existing bypass (`User.is_superuser`, as in `require_admin`
and `validation_views._scope_filter`).
"""

import logging
import os
import pathlib

from django.conf import settings
from django.db import connection

from .views import is_lecturer_for_subject

logger = logging.getLogger(__name__)

# Only the columns needed to serve a file: the path to open, the mime to decide
# whether it is viewable, the subject to authorise against, the title for the
# download name.
_DOCUMENT_SQL = (
    'SELECT subject_id, file_path, mime_type, title '
    'FROM knowledge_documents WHERE id = %s'
)

# A student may read a document only when a READY reading material *they* were
# served cites it. `sources_json` is a JSONB array of
# `{chunk_id, document_id, document_title, page}`; a NULL or wrong-typed row is
# guarded so it degrades to "no access" instead of a 500.
_CITED_SQL = """
    SELECT 1
    FROM generated_reading_materials grm
    JOIN submissions s ON s.question_version_id = grm.question_version_id
    WHERE s.student_id = %s
      AND s.status = 'VALIDATED'
      AND grm.status = 'READY'
      AND jsonb_typeof(COALESCE(grm.sources_json, '[]'::jsonb)) = 'array'
      AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(grm.sources_json, '[]'::jsonb)) AS src
          WHERE src->>'document_id' = %s
      )
    LIMIT 1
"""


def _fetch_document_row(doc_id):
    """The `knowledge_documents` row for `doc_id`, or None (patchable in tests)."""
    with connection.cursor() as cur:
        cur.execute(_DOCUMENT_SQL, [str(doc_id)])
        return cur.fetchone()


def _student_has_cited(student_id, doc_id):
    """True when a served READY reading material of this student cites the document."""
    with connection.cursor() as cur:
        cur.execute(_CITED_SQL, [str(student_id), str(doc_id)])
        return cur.fetchone() is not None


def resolve_document_file(doc_id):
    """`(pathlib.Path, {'subject_id', 'mime_type', 'title'})` or None.

    None covers every "there is nothing to serve" case — no row, no path, the path
    does not exist on disk — so the view maps it to one clean 404. The path always
    comes from the `knowledge_documents.file_path` column and never from a client.
    """
    try:
        row = _fetch_document_row(doc_id)
    except Exception as e:  # noqa: BLE001 — a DB problem must not 500 the endpoint
        logger.warning('Could not resolve document %s: %s', doc_id, e)
        return None
    if row is None:
        return None

    subject_id, file_path, mime_type, title = row
    if not file_path:
        return None

    # Both forms occur in the data: an absolute Windows path (the reference PDFs
    # ingested from `References/`) and a storage-relative `materials/<hex>.<ext>`.
    if os.path.isabs(file_path):
        path = pathlib.Path(file_path)
    else:
        path = pathlib.Path(settings.MEDIA_ROOT) / file_path

    if not path.is_file():
        return None
    return path, {'subject_id': subject_id, 'mime_type': mime_type, 'title': title}


def may_view(user, doc_id):
    """May `user` read this document's bytes?

    Never raises: a DB error is logged and read as "no".
    """
    try:
        row = _fetch_document_row(doc_id)
    except Exception as e:  # noqa: BLE001
        logger.warning('Could not authorise document %s: %s', doc_id, e)
        return False
    if row is None:
        return False

    subject_id = row[0]
    if getattr(user, 'is_superuser', False):
        return True
    if is_lecturer_for_subject(user, subject_id):
        return True

    try:
        return _student_has_cited(user.id, doc_id)
    except Exception as e:  # noqa: BLE001
        logger.warning('Could not check citation access for %s: %s', doc_id, e)
        return False
