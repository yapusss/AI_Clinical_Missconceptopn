"""View-level tests for the Word (.docx) question-bank import.

The parser has its own unit tests; these prove the API turns a failed parse into
a located, lecturer-readable 400 instead of an opaque sentence, and that a
successful parse carries its warnings to the preview.
"""
import json
import uuid
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient

from .docx_test_fixtures import (
    cell,
    docx_bytes,
    instrument_document,
    instrument_row,
    para,
    review_table,
    table,
)
from .models import AuthToken, Subject, User, UserSubjectRole

V2_SQL = Path(__file__).resolve().parent.parent.parent / 'V2_Full_Script.sql'

DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'


class DocxImportViewTests(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass('public.users')")
            if cursor.fetchone()[0] is None:
                cursor.execute(V2_SQL.read_text(encoding='utf-8'))

    def setUp(self):
        self.client = APIClient()
        self.subject = Subject.objects.create(
            id=uuid.uuid4(),
            name=f'Docx Import {uuid.uuid4().hex[:8]}',
            slug=f'docx-import-{uuid.uuid4().hex[:8]}',
            description='',
        )
        self.lecturer = User.objects.create(
            id=uuid.uuid4(),
            email=f'docx-lecturer-{uuid.uuid4().hex[:8]}@test.local',
            full_name='Lecturer',
            password_hash='!',
            is_active=True,
        )
        UserSubjectRole.objects.create(
            user=self.lecturer,
            subject=self.subject,
            role=UserSubjectRole.Role.LECTURER,
        )
        token = AuthToken.generate(self.lecturer)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token.key}')
        self.url = reverse('question-import-create')

    def _post(self, blocks, name='instrumen.docx'):
        upload = SimpleUploadedFile(name, docx_bytes(blocks), content_type=DOCX_MIME)
        return self.client.post(
            self.url,
            {'file': upload, 'subject_id': str(self.subject.id)},
            format='multipart',
        )

    def test_failed_parse_returns_located_issues_without_temp_path(self):
        header = [
            cell('No'), cell('Tujuan Pembelajaran'), cell('No Soal'),
            cell('Level Soal'), cell('Soal'), cell('Jawaban'), cell('Alasan Jawabn'),
        ]
        response = self._post([para('Topik: Kalor'), table([header])])

        self.assertEqual(response.status_code, 400)
        self.assertIn('Alasan jawaban', response.data['detail'])
        self.assertTrue(response.data['issues'])
        first = response.data['issues'][0]
        self.assertEqual(first['code'], 'header_missing')
        self.assertEqual(first['location'], {'table': 1, 'row': 1})
        body = json.dumps(response.data, ensure_ascii=False)
        self.assertNotIn('/tmp/', body)
        self.assertNotIn('instrument-fixture-', body)

    def test_review_tables_report_the_headers_that_were_found(self):
        response = self._post([review_table()])

        self.assertEqual(response.status_code, 400)
        message = response.data['issues'][0]['message']
        self.assertIn('Tabel 1', message)
        self.assertIn('Miskonsepsi', message)

    def test_second_instrument_is_rejected_with_both_tables(self):
        header = [[cell(name) for name in (
            'No', 'Tujuan Pembelajaran', 'No Soal', 'Level Soal',
            'Soal', 'Jawaban', 'Alasan jawaban',
        )]]
        blocks = instrument_document(
            [instrument_row()],
            extra=[table(header + [instrument_row()])],
        )
        response = self._post(blocks)

        self.assertEqual(response.status_code, 400)
        self.assertIn('lebih dari satu instrumen', response.data['detail'])
        self.assertEqual(response.data['issues'][0]['location']['table'], 2)

    def test_successful_import_carries_warnings(self):
        blocks = instrument_document([
            instrument_row(no='1'),
            instrument_row(no='2', soal='Soal tanpa jawaban', jawaban='', alasan=''),
        ])
        response = self._post(blocks)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['detected_topic_name'], 'Kalor dan Perpindahan Kalor')
        self.assertEqual(len(response.data['package']['questions']), 2)
        self.assertEqual(response.data['skipped_rows'], 0)
        codes = [warning['code'] for warning in response.data['warnings']]
        self.assertIn('rows_incomplete', codes)

    def test_placeholder_rows_are_counted_and_reported(self):
        blocks = instrument_document([
            instrument_row(no='1'),
            [cell(''), cell(''), cell('2'), cell(''), cell(''), cell(''), cell('')],
        ])
        response = self._post(blocks)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['skipped_rows'], 1)
        self.assertEqual(len(response.data['package']['questions']), 1)
        codes = [warning['code'] for warning in response.data['warnings']]
        self.assertIn('placeholder_rows', codes)

    def test_too_large_upload_is_rejected_before_parsing(self):
        with patch('api.views.DOCX_IMPORT_MAX_BYTES', 10):
            response = self._post(instrument_document([instrument_row()]))

        self.assertEqual(response.status_code, 400)
        self.assertIn('maksimal', response.data['detail'])
        self.assertIn('Kompres gambar', response.data['detail'])
        self.assertNotIn('/tmp/', json.dumps(response.data))

    def test_broken_docx_is_unreadable_not_a_traceback(self):
        upload = SimpleUploadedFile('rusak.docx', b'not a zip', content_type=DOCX_MIME)
        response = self.client.post(
            self.url,
            {'file': upload, 'subject_id': str(self.subject.id)},
            format='multipart',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('tidak dapat dibuka', response.data['detail'])
