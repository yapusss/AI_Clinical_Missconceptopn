"""Materials API (R5) — lecturer-scoped upload / list / delete of reference documents.

Uploads are **staged**: `POST /api/materials` only stores the file and inserts a
`PENDING` `knowledge_documents` row. `manage.py ingest_materials --pending`
drains the queue (extract → chunk → embed → READY), so nothing embeds inside a
web request and a corrupt document never blocks the request.

`knowledge_documents` / `knowledge_chunks` are `managed = False` read-models, so
all writes here are raw SQL (no ORM `save()` / `delete()`).
"""

import logging
import os
import uuid

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import connection
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import TokenAuthentication
from .models import UserSubjectRole
from .views import is_lecturer_for_subject

logger = logging.getLogger(__name__)

# PDF/MD/TXT only. No size cap (user decision 2026-10-18): reference PDFs can be
# large. Deliberately separate from MediaUploadView's 5 MB image cap — do not
# reuse or modify that one.
ALLOWED_MATERIAL_EXTENSIONS = {'.pdf', '.md', '.markdown', '.txt'}
MIME_BY_EXTENSION = {
    '.pdf': 'application/pdf',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.txt': 'text/plain',
}

_DOCUMENT_COLUMNS = (
    'id, subject_id, topic_id, title, mime_type, ingest_status, '
    'ingest_error, chunk_count, created_at, file_path'
)


def _valid_uuid(value):
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        return None


def validate_material_upload(filename, size):
    """Return `(extension, error_message)`; `error_message` is None on success.

    Pure helper (no request/DB) so the extension allow-list is unit-testable.
    There is **no size cap**: any file size is accepted (the size argument is
    kept for the caller's logging and for the `None` sanity check — a missing
    size means the upload could not be read at all).
    """
    if not filename:
        return None, 'File tidak ditemukan.'
    extension = os.path.splitext(filename)[1].lower()
    if extension not in ALLOWED_MATERIAL_EXTENSIONS:
        return None, 'Hanya file PDF, MD, atau TXT yang diizinkan.'
    if size is None:
        return None, 'File tidak dapat dibaca.'
    return extension, None


def _material_subject_ids(user):
    """Subject ids the caller lectures, or None for 'all' (superuser)."""
    if user.is_superuser:
        return None
    return [
        str(sid) for sid in UserSubjectRole.objects.filter(
            user=user, role=UserSubjectRole.Role.LECTURER
        ).values_list('subject_id', flat=True)
    ]


def _document_payload(row):
    (doc_id, subject_id, topic_id, title, mime_type, ingest_status,
     ingest_error, chunk_count, created_at, file_path) = row
    return {
        'id': str(doc_id),
        'subject_id': str(subject_id),
        'topic_id': str(topic_id) if topic_id else None,
        'title': title,
        'mime_type': mime_type,
        'ingest_status': ingest_status,
        'ingest_error': ingest_error,
        'chunk_count': chunk_count,
        'created_at': created_at,
        # basename only — never an absolute filesystem path, never raw_text
        'file_name': os.path.basename(file_path) if file_path else None,
    }


def _list_documents(subject_id=None, subject_ids=None):
    sql = f'SELECT {_DOCUMENT_COLUMNS} FROM knowledge_documents'
    params = []
    if subject_id is not None:
        sql += ' WHERE subject_id = %s'
        params.append(subject_id)
    elif subject_ids is not None:
        sql += ' WHERE subject_id = ANY(%s)'
        params.append(subject_ids)
    sql += ' ORDER BY created_at DESC'
    with connection.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def _get_document(document_id):
    with connection.cursor() as cur:
        cur.execute(
            f'SELECT {_DOCUMENT_COLUMNS} FROM knowledge_documents WHERE id = %s',
            [document_id],
        )
        return cur.fetchone()


def _insert_pending_document(subject_id, topic_id, uploaded_by, title, file_path, mime_type):
    with connection.cursor() as cur:
        cur.execute(
            """INSERT INTO knowledge_documents
                   (subject_id, topic_id, uploaded_by, title, file_path, mime_type,
                    raw_text, ingest_status)
               VALUES (%s, %s, %s, %s, %s, %s, NULL, 'PENDING')
               RETURNING id""",
            [subject_id, topic_id, uploaded_by, title, file_path, mime_type],
        )
        return str(cur.fetchone()[0])


class MaterialListCreateView(APIView):
    """List / upload reference materials for the subjects the caller lectures."""

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        subject_id = request.query_params.get('subject_id')
        if subject_id:
            subject_id = _valid_uuid(subject_id)
            if subject_id is None:
                return Response({'detail': 'subject_id tidak valid.'}, status=status.HTTP_400_BAD_REQUEST)
            if not is_lecturer_for_subject(request.user, subject_id):
                return Response(
                    {'detail': 'Anda tidak mengajar mata kuliah ini.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            rows = _list_documents(subject_id=subject_id)
        else:
            rows = _list_documents(subject_ids=_material_subject_ids(request.user))
        return Response([_document_payload(r) for r in rows])

    def post(self, request):
        subject_id = _valid_uuid(request.data.get('subject_id'))
        if subject_id is None:
            return Response({'detail': 'subject_id wajib diisi dan valid.'}, status=status.HTTP_400_BAD_REQUEST)
        if not is_lecturer_for_subject(request.user, subject_id):
            return Response(
                {'detail': 'Anda tidak mengajar mata kuliah ini.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        upload = request.FILES.get('file')
        extension, error = validate_material_upload(
            upload.name if upload else None, upload.size if upload else None
        )
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        topic_id_raw = request.data.get('topic_id')
        topic_id = _valid_uuid(topic_id_raw) if topic_id_raw else None
        if topic_id_raw and topic_id is None:
            return Response({'detail': 'topic_id tidak valid.'}, status=status.HTTP_400_BAD_REQUEST)

        title = (request.data.get('title') or '').strip() or os.path.splitext(
            os.path.basename(upload.name)
        )[0]
        mime_type = MIME_BY_EXTENSION.get(extension, 'application/octet-stream')

        # Staged: store the bytes only; extraction/embedding happen in the
        # `ingest_materials --pending` drain.
        saved_path = default_storage.save(
            f'materials/{uuid.uuid4().hex}{extension}', ContentFile(upload.read())
        )
        document_id = _insert_pending_document(
            subject_id, topic_id, str(request.user.id), title, saved_path, mime_type,
        )
        return Response(_document_payload(_get_document(document_id)), status=status.HTTP_201_CREATED)


class MaterialDetailView(APIView):
    """Delete one reference document (lecturer-scoped)."""

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        with connection.cursor() as cur:
            cur.execute(
                'SELECT subject_id, file_path FROM knowledge_documents WHERE id = %s',
                [str(pk)],
            )
            row = cur.fetchone()
        if row is None:
            return Response({'detail': 'Dokumen tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        subject_id, file_path = row
        if not is_lecturer_for_subject(request.user, str(subject_id)):
            return Response(
                {'detail': 'Anda tidak mengajar mata kuliah ini.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Delete the document only; knowledge_chunks rows cascade via the FK.
        with connection.cursor() as cur:
            cur.execute('DELETE FROM knowledge_documents WHERE id = %s', [str(pk)])

        if file_path:
            try:
                default_storage.delete(file_path)
            except Exception as e:  # noqa: BLE001 — the row is already gone
                logger.warning('Could not delete stored material %s: %s', file_path, e)

        return Response(status=status.HTTP_204_NO_CONTENT)


def _material_subject_id(material_id):
    """Resolve a reading material to its subject (one query), or None."""
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT qs.subject_id
            FROM generated_reading_materials m
            JOIN question_versions qv ON qv.id = m.question_version_id
            JOIN questions q ON q.id = qv.question_id
            JOIN question_sets qs ON qs.id = q.question_set_id
            WHERE m.id = %s
            """,
            [str(material_id)],
        )
        row = cur.fetchone()
    return row[0] if row else None


def _flag_material_row(material_id, note, user_id):
    """Write the flag/regenerate state and return the updated key fields.

    Lifecycle-ish review write performed with raw SQL because
    `generated_reading_materials` is `managed = False`. `status = 'STALE'` puts
    the artifact back in the drain queue; `flagged_by`/`flagged_at`/`flag_note`
    are the audit trail (no separate table, D14).
    """
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE generated_reading_materials
            SET review_status = 'FLAGGED',
                flag_note = %s,
                flagged_by = %s,
                flagged_at = CURRENT_TIMESTAMP,
                status = 'STALE',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            RETURNING status, review_status, flag_note, flagged_at, attempts,
                      question_version_id, category
            """,
            [note, str(user_id), str(material_id)],
        )
        return cur.fetchone()


class ReadingMaterialFlagView(APIView):
    """Flag a generated reading material for regeneration (C6, D14).

    **Review, not editing.** A lecturer of the material's subject can mark an
    artifact as needing repair and have the drain regenerate it; there is no
    endpoint that writes `content_md` (D7). The row's own `flagged_by` /
    `flagged_at` / `flag_note` are the audit trail — no separate audit table —
    and `status = 'STALE'` puts it back in the drain queue. `note` is optional
    and recorded verbatim.
    """

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        subject_id = _material_subject_id(pk)
        if subject_id is None:
            return Response(
                {'detail': 'Materi bacaan tidak ditemukan.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not is_lecturer_for_subject(request.user, str(subject_id)):
            return Response(
                {'detail': 'Anda tidak mengajar mata kuliah ini.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        note = request.data.get('note')
        updated = _flag_material_row(pk, note, request.user.id)

        logger.info(
            'Reading material %s flagged by %s (subject %s): %s',
            pk, getattr(request.user, 'username', None) or request.user.id,
            subject_id, note,
        )

        return Response({
            'id': str(pk),
            'status': updated[0],
            'review_status': updated[1],
            'flag_note': updated[2],
            'flagged_at': updated[3],
            'attempts': updated[4],
            'question_version_id': str(updated[5]),
            'category': updated[6],
        })

