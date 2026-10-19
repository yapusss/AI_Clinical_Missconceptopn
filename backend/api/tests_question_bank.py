"""Tests for the .docx instrument parser and the downloadable Word template.

The real TOPIK files live outside the repository, so these tests build XML snippets
and round-trip the generated template instead of depending on those files.
"""
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from django.test import SimpleTestCase

from api.docx_template import build_instrument_template
from api.question_bank import (
    M,
    cell_to_html,
    cell_to_paragraphs,
    detect_document_topic,
    detect_sub_questions,
    has_math,
    needs_rich_html,
    parse_instrument_docx,
)


def _omml(xml):
    return ET.fromstring(xml)


class OmmlConversionTests(SimpleTestCase):
    def test_fraction_subscript_and_superscript(self):
        node = _omml(
            f'<m:oMath xmlns:m="{M[1:-1]}">'
            '<m:f><m:num><m:r><m:t>s</m:t></m:r></m:num>'
            '<m:den><m:r><m:t>t</m:t></m:r></m:den></m:f>'
            '<m:sSub><m:e><m:r><m:t>T</m:t></m:r></m:e>'
            '<m:sub><m:r><m:t>i</m:t></m:r></m:sub></m:sSub>'
            '<m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e>'
            '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>'
            '</m:oMath>'
        )
        from api.question_bank import _omml_latex

        latex = _omml_latex(node)
        self.assertIn(r'\frac{s}{t}', latex)
        self.assertIn('T_{i}', latex)
        self.assertIn('x^{2}', latex)

    def test_root_and_delimiters(self):
        node = _omml(
            f'<m:oMath xmlns:m="{M[1:-1]}">'
            '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>'
            '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad>'
            '<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr>'
            '<m:e><m:r><m:t>a+b</m:t></m:r></m:e></m:d>'
            '</m:oMath>'
        )
        from api.question_bank import _omml_latex

        latex = _omml_latex(node)
        self.assertIn(r'\sqrt{x}', latex)
        self.assertIn(r'\left(a+b\right)', latex)


class CellHtmlTests(SimpleTestCase):
    def test_latex_spans_become_math_fields(self):
        text = r'Kelajuan $v = \frac{s}{t}$ dari jarak $s = 120$ m.'
        self.assertTrue(has_math(text))
        html = cell_to_html(text)
        self.assertEqual(html.count('<math-field read-only>'), 2)
        self.assertIn(r'<math-field read-only>v = \frac{s}{t}</math-field>', html)
        self.assertNotIn('$', html)

    def test_plain_text_is_escaped_and_keeps_line_breaks(self):
        html = cell_to_html('a < b\nbaris dua')
        self.assertIn('a &lt; b', html)
        self.assertIn('<br />', html)

    def test_each_source_line_becomes_a_paragraph(self):
        html = cell_to_paragraphs(
            'Diketahui:\n$P_1 = 100$ kPa\nJadi:\n$P_2 = 150$ kPa'
        )
        self.assertEqual(html.count('<p>'), 4)
        self.assertIn('<p>Diketahui:</p>', html)
        self.assertIn(
            '<p><math-field read-only>P_1 = 100</math-field> kPa</p>', html
        )
        self.assertTrue(needs_rich_html('satu\ndua'))
        self.assertFalse(needs_rich_html('satu dua'))


class SubQuestionDetectionTests(SimpleTestCase):
    def test_sequential_numbering_is_clean(self):
        self.assertIsNone(detect_sub_questions(['1', '2', '3', '4']))

    def test_decimal_and_repeated_numbers_are_grouped(self):
        # TOPIK 1: question 5 is written as 5.1/5.2 and question 18 repeats.
        labels = ['1', '2', '3', '4', '5.1', '5.2', '6']
        labels += [str(n) for n in range(7, 18)]
        labels += ['18', '18.2'] + [str(n) for n in range(19, 51)]

        warning = detect_sub_questions(labels)

        self.assertEqual(warning['total_rows'], 52)
        self.assertEqual(warning['total_numbers'], 50)
        self.assertEqual(warning['blank_number_rows'], 0)
        self.assertEqual(
            warning['groups'],
            [
                {'number': '5', 'labels': ['5.1', '5.2']},
                {'number': '18', 'labels': ['18', '18.2']},
            ],
        )

    def test_repeated_number_and_blank_rows_warn(self):
        warning = detect_sub_questions(['1', '7', '7', ''])
        self.assertEqual(warning['groups'], [{'number': '7', 'labels': ['7', '7']}])
        self.assertEqual(warning['blank_number_rows'], 1)

    def test_dash_separator_counts_as_sub_question(self):
        warning = detect_sub_questions(['1', '5-1', '5-2'])
        self.assertEqual(
            warning['groups'], [{'number': '5', 'labels': ['5-1', '5-2']}]
        )
        self.assertEqual(warning['total_numbers'], 2)

    def test_whole_number_from_a_text_cell_is_not_a_sub_question(self):
        # A lone `5.0` is question 5, so the numbering stays clean...
        self.assertIsNone(detect_sub_questions(['1', '2', '5.0']))
        # ...but it still collides with a plain `5` on another row.
        warning = detect_sub_questions(['1', '5', '5.0'])
        self.assertEqual(warning['groups'], [{'number': '5', 'labels': ['5', '5.0']}])


class TopicDetectionTests(SimpleTestCase):
    def test_topic_label_alone_then_value(self):
        root = _omml(
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main"><w:body>'
            '<w:p><w:r><w:t>Instrumen Tes Miskonsepsi IPA untuk Mahasiswa</w:t></w:r></w:p>'
            '<w:p><w:r><w:t>Topik:</w:t></w:r></w:p>'
            '<w:p><w:r><w:t>Kalor dan Perpindahan Kalor</w:t></w:r></w:p>'
            '<w:p><w:r><w:t>Cakupan materi:</w:t></w:r></w:p>'
            '</w:body></w:document>'
        )
        self.assertEqual(detect_document_topic(root), 'Kalor dan Perpindahan Kalor')

    def test_numbered_topic_line(self):
        root = _omml(
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main"><w:body>'
            '<w:p><w:r><w:t>TOPIK 3. Kalor dan Perpindahan Kalor</w:t></w:r></w:p>'
            '</w:body></w:document>'
        )
        self.assertEqual(detect_document_topic(root), 'Kalor dan Perpindahan Kalor')


class TemplateRoundTripTests(SimpleTestCase):
    def test_generated_template_parses_back(self):
        data = build_instrument_template()
        self.assertTrue(data.startswith(b'PK'))
        path = Path(tempfile.gettempdir()) / 'instrument-template-test.docx'
        path.write_bytes(data)
        topic, rows = parse_instrument_docx(path)
        self.assertEqual(topic, 'Tulis topik materi di sini (mis. Kalor dan Perpindahan Kalor)')
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row['no_soal'], '1')
        self.assertIn(r'$v = \frac{s}{t}$', row['soal'])
        self.assertIn(r'$v = \frac{s}{t} = \frac{120}{15} = 8$ m/s', row['alasan'])
        path.unlink()
