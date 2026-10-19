"""DB-free tests for serving a reference PDF (`GET /api/materials/<uuid>/file`, W1).

`resolve_document_file` / `may_view` are patched at the view's namespace and the
document bytes live in a real temp file — the view never parses them, so a few
bytes are enough. `may_view` itself is exercised against its two patchable SQL
helpers. Nothing here touches the database, the shared dev DB or the network.

    venv/Scripts/python.exe manage.py test api.tests_material_file -v 2
"""

import tempfile
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory, force_authenticate

from api.material_access import may_view, resolve_document_file
from api.materials_views import MaterialFileView

PDF_BYTES = b"%PDF-1.4\n% test bytes for the range reader\n%%EOF\n"


def _body(response):
    """The streamed body of a `FileResponse` / `StreamingHttpResponse`.

    Closes the response so the temp file handle is released before cleanup.
    """
    body = b"".join(response.streaming_content)
    response.close()
    return body


class MaterialFileViewTests(SimpleTestCase):
    """`MaterialFileView` status, headers and range handling."""

    def setUp(self):
        self.factory = APIRequestFactory()
        self.user = SimpleNamespace(id=uuid.uuid4(), is_superuser=False, is_authenticated=True)
        self.doc_id = uuid.uuid4()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'reference.pdf'
        self.path.write_bytes(PDF_BYTES)

    def _get(self, *, may_view_allowed=True, resolved=True, mime_type='application/pdf',
             range_header=None):
        request = self.factory.get(f'/api/materials/{self.doc_id}/file')
        if range_header:
            request.META['HTTP_RANGE'] = range_header
        force_authenticate(request, self.user)

        resolved_value = None
        if resolved:
            resolved_value = (
                self.path,
                {
                    'subject_id': uuid.uuid4(),
                    'mime_type': mime_type,
                    'title': 'Sears & Zemansky — Fisika/1',
                },
            )
        with patch('api.materials_views.resolve_document_file', return_value=resolved_value), \
                patch('api.materials_views.may_view', return_value=may_view_allowed):
            return MaterialFileView.as_view()(request, pk=self.doc_id)

    def test_authorised_lecturer_gets_the_bytes(self):
        response = self._get(may_view_allowed=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertEqual(response['Content-Disposition'].split(';')[0], 'inline')
        self.assertEqual(_body(response), PDF_BYTES)

    def test_lecturer_of_another_subject_is_forbidden(self):
        response = self._get(may_view_allowed=False)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], 'Anda tidak memiliki akses ke dokumen ini.')

    def test_student_whose_material_cites_the_document_gets_the_bytes(self):
        response = self._get(may_view_allowed=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(_body(response), PDF_BYTES)

    def test_student_not_cited_is_forbidden(self):
        response = self._get(may_view_allowed=False)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], 'Anda tidak memiliki akses ke dokumen ini.')

    def test_missing_file_on_disk_is_not_found(self):
        response = self._get(resolved=False)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['detail'], 'Dokumen tidak ditemukan.')

    def test_non_pdf_document_degrades_to_not_found(self):
        response = self._get(mime_type='text/markdown')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['detail'], 'Berkas ini tidak dapat ditampilkan sebagai PDF.')

    def test_range_request_returns_206_with_exactly_ten_bytes(self):
        response = self._get(range_header='bytes=0-9')
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response['Content-Range'], f'bytes 0-9/{len(PDF_BYTES)}')
        self.assertEqual(response['Content-Length'], '10')
        body = _body(response)
        self.assertEqual(len(body), 10)
        self.assertEqual(body, PDF_BYTES[:10])

    def test_unsatisfiable_range_returns_416(self):
        response = self._get(range_header='bytes=999999-')
        self.assertEqual(response.status_code, 416)
        self.assertEqual(response['Content-Range'], f'bytes */{len(PDF_BYTES)}')


class DocumentPathResolutionTests(SimpleTestCase):
    """`resolve_document_file` handles both path forms found in the data."""

    def test_absolute_path_used_as_is_and_relative_joined_onto_media_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            absolute = root / 'absolute.pdf'
            absolute.write_bytes(b'abs')
            media_root = root / 'media'
            material = media_root / 'materials'
            material.mkdir(parents=True)
            (material / 'note.md').write_bytes(b'rel')

            subject_id = uuid.uuid4()
            with override_settings(MEDIA_ROOT=media_root):
                with patch(
                    'api.material_access._fetch_document_row',
                    return_value=(subject_id, str(absolute), 'application/pdf', 'Abs'),
                ):
                    resolved = resolve_document_file(uuid.uuid4())
                self.assertIsNotNone(resolved)
                self.assertEqual(resolved[0], absolute)
                self.assertEqual(resolved[1]['subject_id'], subject_id)

                with patch(
                    'api.material_access._fetch_document_row',
                    return_value=(subject_id, 'materials/note.md', 'text/markdown', 'Rel'),
                ):
                    resolved = resolve_document_file(uuid.uuid4())
                self.assertIsNotNone(resolved)
                self.assertEqual(resolved[0], media_root / 'materials' / 'note.md')

    def test_absent_row_empty_path_and_missing_file_all_resolve_to_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(MEDIA_ROOT=Path(tmp)):
                with patch('api.material_access._fetch_document_row', return_value=None):
                    self.assertIsNone(resolve_document_file(uuid.uuid4()))
                with patch(
                    'api.material_access._fetch_document_row',
                    return_value=(uuid.uuid4(), '', 'application/pdf', 'Empty'),
                ):
                    self.assertIsNone(resolve_document_file(uuid.uuid4()))
                with patch(
                    'api.material_access._fetch_document_row',
                    return_value=(uuid.uuid4(), 'materials/gone.pdf', 'application/pdf', 'Gone'),
                ):
                    self.assertIsNone(resolve_document_file(uuid.uuid4()))


class MayViewTests(SimpleTestCase):
    """The entitlement rule, with the two SQL helpers patched out."""

    def setUp(self):
        self.doc_id = uuid.uuid4()
        self.row = (uuid.uuid4(), 'materials/x.pdf', 'application/pdf', 'Title')

    def _may_view(self, *, absent=False, cited=False, lecturer=False, superuser=False,
                  fetch_error=False):
        user = SimpleNamespace(id=uuid.uuid4(), is_superuser=superuser)
        if fetch_error:
            fetch = patch('api.material_access._fetch_document_row', side_effect=RuntimeError('db down'))
        else:
            fetch = patch('api.material_access._fetch_document_row',
                          return_value=None if absent else self.row)
        with fetch, \
                patch('api.material_access.is_lecturer_for_subject', return_value=lecturer), \
                patch('api.material_access._student_has_cited', return_value=cited):
            return may_view(user, self.doc_id)

    def test_admin_is_allowed(self):
        self.assertTrue(self._may_view(superuser=True))

    def test_lecturer_of_the_subject_is_allowed(self):
        self.assertTrue(self._may_view(lecturer=True))

    def test_student_cited_by_a_served_material_is_allowed(self):
        self.assertTrue(self._may_view(cited=True))

    def test_student_not_cited_is_denied(self):
        self.assertFalse(self._may_view(cited=False))

    def test_absent_row_is_denied(self):
        self.assertFalse(self._may_view(absent=True))

    def test_db_error_is_denied_not_raised(self):
        self.assertFalse(self._may_view(fetch_error=True))
