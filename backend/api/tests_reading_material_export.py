"""Tests for the per-package reading-material PDF export (W2).

The renderer is a pure function, so most of this file needs no ORM at all. The
view tests patch `collect_export_sections`, which is the only database-touching
call the endpoint makes. Run with:

    venv/Scripts/python.exe manage.py test api.tests_reading_material_export -v 2
"""

import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pymupdf
from django.test import SimpleTestCase

from api import pdf_export_views
from api.reading_material_export import render_reading_pdf

IDENTITY = {
    'student_name': 'Budi Santoso',
    'nim': '2021001',
    'package_code': 'PAK-01',
    'package_title': 'Termodinamika Dasar',
    'subject_name': 'Fisika',
    'attempt_no': 2,
    'generated_at': '19-10-2026 14:00',
}

SECTION_ONE = {
    'order': 1,
    'prompt': 'Jelaskan hukum pertama termodinamika.',
    'content_md': (
        'Materi tentang energi dalam dan kerja.\n\n'
        '- Panas **dan** kerja memengaruhi energi dalam.\n'
        '- Entalpi naik ketika kalor masuk.'
    ),
    'sources': [{'document_title': 'Sears & Salinger', 'page': 12}],
}

SECTION_TWO = {
    'order': 2,
    'prompt': 'Apa yang dimaksud dengan entropi?',
    'content_md': 'Entropi adalah ukuran ketidakteraturan sistem.',
    'sources': [{'document_title': 'Termodinamika Modern', 'page': 44}],
}


def _extract(pdf_bytes):
    document = pymupdf.open(stream=pdf_bytes, filetype='pdf')
    try:
        return '\n'.join(page.get_text() for page in document), document.page_count
    finally:
        document.close()


class RenderReadingPdfTests(SimpleTestCase):
    def test_two_sections_produce_a_pdf(self):
        pdf_bytes = render_reading_pdf(IDENTITY, [SECTION_ONE, SECTION_TWO])
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))
        _, page_count = _extract(pdf_bytes)
        self.assertGreaterEqual(page_count, 1)

    def test_extracted_text_contains_identity_questions_and_sources(self):
        pdf_bytes = render_reading_pdf(IDENTITY, [SECTION_ONE, SECTION_TWO])
        text, _ = _extract(pdf_bytes)
        self.assertIn('Budi Santoso', text)
        self.assertIn('2021001', text)
        self.assertIn('SOAL 1', text)
        self.assertIn('SOAL 2', text)
        self.assertIn('energi dalam', text)
        self.assertIn('hal. 12', text)

    def test_markdown_heading_and_bullet_render_as_text(self):
        section = dict(SECTION_ONE)
        section['content_md'] = '## Energi Dalam\n\n- Panas dan kerja.'
        pdf_bytes = render_reading_pdf(IDENTITY, [section])
        text, _ = _extract(pdf_bytes)
        self.assertIn('Energi Dalam', text)
        self.assertIn('Panas dan kerja.', text)
        self.assertNotIn('##', text)

    def test_empty_sources_and_null_page_render(self):
        section = dict(SECTION_ONE)
        section['sources'] = [
            {'document_title': 'Tanpa Halaman', 'page': None},
        ]
        pdf_bytes = render_reading_pdf(IDENTITY, [section])
        text, _ = _extract(pdf_bytes)
        self.assertIn('Tanpa Halaman', text)
        self.assertNotIn('hal. None', text)

        empty = dict(SECTION_ONE)
        empty['sources'] = []
        pdf_bytes = render_reading_pdf(IDENTITY, [empty])
        text, _ = _extract(pdf_bytes)
        self.assertIn('SUMBER MATERI', text)

    def test_latin1_trap_em_dash_and_curly_quotes_do_not_raise(self):
        section = dict(SECTION_ONE)
        section['sources'] = [
            {'document_title': 'Sears \u2014 \u201cThermodynamics\u201d', 'page': 12},
        ]
        pdf_bytes = render_reading_pdf(IDENTITY, [section])
        text, _ = _extract(pdf_bytes)
        self.assertIn('Sears', text)
        self.assertIn('hal. 12', text)


class StudentExportViewTests(SimpleTestCase):
    def setUp(self):
        self.user = SimpleNamespace(pk=uuid.uuid4(), nim='2021001')
        self.package_id = uuid.uuid4()
        self.view = pdf_export_views.StudentReadingMaterialExportView()

    def _get(self):
        request = SimpleNamespace(user=self.user)
        return self.view.get(request, pk=self.package_id)

    def test_no_material_is_409(self):
        # The package is the student's (identity present), but nothing is ready.
        with patch.object(
            pdf_export_views, 'collect_export_sections',
            return_value=(dict(IDENTITY), []),
        ):
            response = self._get()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], pdf_export_views.EMPTY_DETAIL)

    def test_success_is_a_pdf_attachment(self):
        with patch.object(
            pdf_export_views, 'collect_export_sections',
            return_value=(dict(IDENTITY), [SECTION_ONE]),
        ):
            response = self._get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertTrue(response['Content-Disposition'].startswith('attachment'))
        self.assertTrue(response.content.startswith(b'%PDF'))

    def test_package_that_is_not_the_students_is_404(self):
        # `(None, [])` is the collector's "not this student's package" answer.
        # The message must be distinguishable from the 409 "nothing ready" one.
        with patch.object(
            pdf_export_views, 'collect_export_sections',
            return_value=(None, []),
        ):
            response = self._get()
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['detail'], pdf_export_views.NOT_FOUND_DETAIL)
        self.assertNotEqual(response.data['detail'], pdf_export_views.EMPTY_DETAIL)
