"""Tests for the .docx instrument parser and the downloadable Word template.

The real TOPIK files live outside the repository, so these tests build XML snippets
and round-trip the generated template instead of depending on those files.
"""
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from django.test import SimpleTestCase

from api.docx_template import build_instrument_template
from api.docx_test_fixtures import (
    INSTRUMENT_HEADER,
    cell,
    cell_with_table,
    instrument_document,
    instrument_row,
    para,
    review_table,
    table,
    write_docx,
)
from api.question_bank import (
    InstrumentParseError,
    M,
    cell_to_html,
    cell_to_paragraphs,
    detect_document_topic,
    detect_sub_questions,
    has_math,
    needs_rich_html,
    parse_instrument,
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


class DocxDiagnosticsTests(SimpleTestCase):
    """Every rejection and warning must say WHERE in the document it happened."""

    def _parse(self, blocks):
        path = write_docx(blocks)
        try:
            return parse_instrument(path)
        finally:
            path.unlink()

    def _error(self, blocks):
        with self.assertRaises(InstrumentParseError) as caught:
            self._parse(blocks)
        return caught.exception

    def test_clean_document_has_no_warnings(self):
        blocks = instrument_document([
            instrument_row(no='1'),
            instrument_row(no='2'),
        ])
        parsed = self._parse(blocks)
        self.assertEqual(parsed.topic, 'Kalor dan Perpindahan Kalor')
        self.assertEqual(parsed.topic_source, 'label')
        self.assertEqual(len(parsed.rows), 2)
        self.assertEqual(parsed.warnings, [])

    def test_misspelled_header_names_the_column_and_the_cell(self):
        header = [
            cell('No'), cell('Tujuan Pembelajaran'), cell('No Soal'),
            cell('Level Soal'), cell('Soal'), cell('Jawaban'), cell('Alasan Jawabn'),
        ]
        error = self._error([para('Topik: Kalor'), table([header])])
        self.assertEqual(error.code, 'header_missing')
        self.assertIn('Alasan jawaban', error.detail)
        message = error.issues[0]['message']
        self.assertIn('Tabel 1 baris 1', message)
        self.assertIn('Alasan Jawabn', message)
        self.assertEqual(error.issues[0]['location'], {'table': 1, 'row': 1})

    def test_unknown_tables_are_listed_with_their_headers(self):
        error = self._error([review_table(), review_table()])
        self.assertEqual(error.code, 'no_instrument_table')
        self.assertIn('Tabel 1', error.issues[0]['message'])
        self.assertIn('Miskonsepsi', error.issues[0]['message'])
        self.assertIn('Tabel 2', error.issues[1]['message'])

    def test_second_instrument_is_rejected(self):
        header = [[cell(name) for name in INSTRUMENT_HEADER]]
        blocks = instrument_document(
            [instrument_row()],
            extra=[table(header + [instrument_row(no='1')])],
        )
        error = self._error(blocks)
        self.assertEqual(error.code, 'second_instrument')
        self.assertIn('satu topik', error.detail)
        self.assertEqual(error.issues[0]['location']['table'], 2)

    def test_section_after_instrument_is_reported_not_absorbed(self):
        legacy = table([
            [cell('2'), cell('Tujuan lama'), cell(''), cell(''), cell('Soal lama'),
             cell(''), cell('')],
            [cell(''), cell(''), cell(''), cell(''), cell('Soal lama 2'),
             cell(''), cell('')],
        ])
        blocks = instrument_document(
            [instrument_row(no='1')],
            extra=[para('YANG LAMA'), legacy],
        )
        parsed = self._parse(blocks)
        self.assertEqual(len(parsed.rows), 1)
        section = [w for w in parsed.warnings if w['code'] == 'section_ignored']
        self.assertEqual(len(section), 1)
        self.assertIn('YANG LAMA', section[0]['message'])
        self.assertIn('tabel 2', section[0]['message'])
        self.assertEqual(section[0]['location']['table'], 2)

    def test_merged_answer_cell_is_split_by_headings(self):
        merged = cell('Soal panjang\nJawaban: J singkat\nAlasan: A panjang', span=3)
        blocks = instrument_document([
            [cell(''), cell('Tujuan'), cell('1'), cell('C4'), merged],
        ])
        parsed = self._parse(blocks)
        row = parsed.rows[0]
        self.assertEqual(row['soal'], 'Soal panjang')
        self.assertEqual(row['jawaban'], 'J singkat')
        self.assertEqual(row['alasan'], 'A panjang')
        codes = [w['code'] for w in parsed.warnings]
        self.assertNotIn('merged_cell_split', codes)

    def test_swapped_number_and_level_are_corrected(self):
        blocks = instrument_document([
            instrument_row(no='1'),
            instrument_row(no='C4\nC5', level='7'),
        ])
        parsed = self._parse(blocks)
        self.assertEqual(parsed.rows[1]['no_soal'], '7')
        self.assertEqual(parsed.rows[1]['level'], 'C4\nC5')
        mismatch = [w for w in parsed.warnings if w['code'] == 'column_order_mismatch']
        self.assertEqual(len(mismatch), 1)
        self.assertIn('Tabel 1 baris 3', mismatch[0]['message'])

    def test_placeholder_and_missing_answer_are_reported(self):
        blocks = instrument_document([
            instrument_row(no='1', soal='Soal lengkap'),
            instrument_row(no='2', soal='Soal tanpa jawaban', jawaban='', alasan=''),
            [cell(''), cell(''), cell('3'), cell(''), cell(''), cell(''), cell('')],
        ])
        parsed = self._parse(blocks)
        self.assertEqual(len(parsed.rows), 3)
        codes = [w['code'] for w in parsed.warnings]
        self.assertIn('rows_incomplete', codes)
        self.assertIn('placeholder_rows', codes)
        placeholder = next(w for w in parsed.warnings
                           if w['code'] == 'placeholder_rows')
        self.assertIn('No 3', placeholder['message'])
        incomplete = next(w for w in parsed.warnings
                          if w['code'] == 'rows_incomplete')
        self.assertIn('Tabel 1', incomplete['message'])
        self.assertIn('No 2', incomplete['message'])
        self.assertIn('jawaban dan alasan', incomplete['message'])

    def test_nested_table_is_flattened_not_dropped(self):
        blocks = instrument_document([[
            cell(''), cell('Tujuan'), cell('1'), cell('C4'),
            cell_with_table('Perhatikan data berikut:', [
                ['Sampel', 'Massa (g)', 'Kalor (J)'],
                ['A', '100', '900'],
                ['B', '200', '1.800'],
            ]),
            cell('Jawaban'), cell('Alasan'),
        ]])
        parsed = self._parse(blocks)
        row = parsed.rows[0]
        self.assertIn('Perhatikan data berikut:', row['soal'])
        self.assertIn('Sampel | Massa (g) | Kalor (J)', row['soal'])
        self.assertIn('B | 200 | 1.800', row['soal'])
        codes = [w['code'] for w in parsed.warnings]
        self.assertNotIn('nested_table_flattened', codes)

    def test_nested_table_in_answer_keeps_its_text(self):
        blocks = instrument_document([[
            cell(''), cell('Tujuan'), cell('1'), cell('C4'), cell('Soal'),
            cell_with_table('Dengan data, diperoleh:', [
                ['Sampel', 'Kapasitas'],
                ['A', '90'],
            ]),
            cell('Alasan'),
        ]])
        parsed = self._parse(blocks)
        self.assertIn('Dengan data, diperoleh:', parsed.rows[0]['jawaban'])
        self.assertIn('A | 90', parsed.rows[0]['jawaban'])
        codes = [w['code'] for w in parsed.warnings]
        self.assertNotIn('nested_table_flattened', codes)

    def test_bare_paragraph_topic_is_flagged(self):
        blocks = [
            para('Perubahan Wujud dan Kekekalan Massa'),
            table([[cell(name) for name in INSTRUMENT_HEADER], instrument_row()]),
        ]
        parsed = self._parse(blocks)
        self.assertEqual(parsed.topic_source, 'paragraph')
        codes = [w['code'] for w in parsed.warnings]
        self.assertIn('topic_guessed', codes)

    def test_missing_topic_is_an_error(self):
        error = self._error([
            table([[cell(name) for name in INSTRUMENT_HEADER], instrument_row()]),
        ])
        self.assertEqual(error.code, 'no_topic')
        self.assertIn('Topik:', error.detail)

    def test_document_without_tables_is_an_error(self):
        error = self._error([para('Topik: Kalor')])
        self.assertEqual(error.code, 'no_tables')

    def test_no_temp_path_leaks_into_messages(self):
        error = self._error([review_table()])
        payload = str(error.as_payload())
        self.assertNotIn(tempfile.gettempdir(), payload)
        self.assertNotIn('/tmp/', payload)
