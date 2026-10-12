"""Tests for the reference-materials feature (R3 retrieval/grounding + R4 metrics).

These tests are deliberately DB-free. Pure helpers are exercised directly, and
the pipeline test monkeypatches `load_context`, retrieval, the three modules and
`connection`, so nothing touches the shared dev DB or the network. Run with:

    venv/Scripts/python.exe manage.py test api.tests_reference_materials -v 2
"""

import json
from decimal import Decimal
from io import StringIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api import llm
from api.embeddings import cosine
from api.llm import (
    FourTierContext,
    build_reference_block,
    grounded_similarity,
    run_module_b,
    run_module_c,
    validate_citations,
)
from api.management.commands import ingest_materials as ingest_cmd
from api.materials_views import MATERIAL_UPLOAD_MAX_BYTES, validate_material_upload
from api.validation_views import (
    _by_model_row,
    _compute_metrics,
    _grounding_detail,
    _grounding_metrics,
    _zero_validation_payload,
)
from api.views import is_lecturer_for_subject


def make_ctx(**overrides) -> FourTierContext:
    base = dict(
        submission_id='sub-1',
        subject_id='subj-1',
        status='SUBMITTED',
        tier1_answer='Entropy always increases',
        tier2_confidence=5,
        tier3_reason='entropy of an isolated system never decreases spontaneously',
        tier4_confidence=5,
        heuristic_flags=[],
        question_prompt='Explain the second law of thermodynamics',
        short_answer='Entropy increases',
        model_answer='The entropy of an isolated system never decreases.',
        reference_short_answer='Entropy increases',
        reference_reason='Second law of thermodynamics',
        set_title='Set 1',
        misconceptions=[],
        rejection_notes='',
        prior_explanation='',
    )
    base.update(overrides)
    return FourTierContext(**base)


class CosineTests(SimpleTestCase):
    def test_identical_vectors(self):
        self.assertAlmostEqual(cosine([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]), 1.0, places=12)

    def test_orthogonal_vectors(self):
        self.assertEqual(cosine([1.0, 0.0], [0.0, 1.0]), 0.0)

    def test_zero_vector_returns_zero_without_exception(self):
        self.assertEqual(cosine([0.0, 0.0], [1.0, 2.0]), 0.0)
        self.assertEqual(cosine([1.0, 2.0], [0.0, 0.0]), 0.0)

    def test_clamped_to_unit_range(self):
        value = cosine([1.0, 2.0], [-2.0, -1.0])
        self.assertGreaterEqual(value, -1.0)
        self.assertLessEqual(value, 1.0)


class ValidateCitationsTests(SimpleTestCase):
    def setUp(self):
        self.retrieved = {
            'known': {
                'chunk_id': 'known', 'document_id': 'doc-1',
                'page_start': 5, 'similarity': 0.6,
            },
        }

    def test_valid_and_unknown_chunk(self):
        out = validate_citations(
            [{'chunk_id': 'known', 'kutipan': 'q1'}, {'chunk_id': 'ghost', 'kutipan': 'q2'}],
            self.retrieved,
        )
        self.assertTrue(out[0]['valid'])
        self.assertEqual(out[0]['document_id'], 'doc-1')
        self.assertEqual(out[0]['page'], 5)
        self.assertIsNone(out[0]['reason_if_invalid'])
        self.assertFalse(out[1]['valid'])
        self.assertEqual(out[1]['reason_if_invalid'], 'not_in_retrieved_set')
        self.assertIsNone(out[1]['similarity'])
        self.assertEqual(sum(1 for e in out if e['valid']), 1)

    def test_malformed_entries_are_flagged(self):
        out = validate_citations(['not-a-dict', {'kutipan': 'no id'}], self.retrieved)
        self.assertEqual([e['reason_if_invalid'] for e in out], ['malformed', 'malformed'])
        self.assertFalse(any(e['valid'] for e in out))

    def test_non_list_referensi_is_empty(self):
        self.assertEqual(validate_citations(None, self.retrieved), [])


class GroundedSimilarityTests(SimpleTestCase):
    def test_mean_over_valid_citations_only(self):
        citations = [
            {'chunk_id': 'a', 'valid': True},
            {'chunk_id': 'b', 'valid': True},
            {'chunk_id': 'c', 'valid': False},
        ]
        retrieved = {
            'a': {'embedding': [1.0, 0.0, 0.0]},
            'b': {'embedding': [0.0, 1.0, 0.0]},
            'c': {'embedding': [1.0, 0.0, 0.0]},  # invalid → must be ignored
        }
        with patch('api.llm.embed_text', return_value=[1.0, 0.0, 0.0]) as mocked:
            mean, maximum, count = grounded_similarity(citations, retrieved, 'advisory text')
        self.assertEqual(count, 2)
        self.assertAlmostEqual(maximum, 1.0, places=12)
        self.assertAlmostEqual(mean, 0.5, places=12)
        mocked.assert_called_once_with('advisory text')

    def test_zero_valid_citations_is_all_none(self):
        with patch('api.llm.embed_text') as mocked:
            result = grounded_similarity([{'chunk_id': 'x', 'valid': False}], {}, 'advisory')
        self.assertEqual(result, (None, None, None))
        mocked.assert_not_called()


class ReferenceBlockTests(SimpleTestCase):
    def test_empty_block(self):
        self.assertEqual(build_reference_block([]), '')

    def test_block_contains_chunk_details(self):
        block = build_reference_block([{
            'chunk_id': 'cid-1', 'page_start': 12,
            'document_title': 'Thermodynamics', 'content': 'entropy text',
        }])
        self.assertIn('SUMBER REFERENSI', block)
        self.assertIn('chunk_id=cid-1', block)
        self.assertIn('hal. 12', block)
        self.assertIn('Thermodynamics', block)
        self.assertIn('entropy text', block)


class PromptInjectionTests(SimpleTestCase):
    def test_modul_b_prompt_unchanged_without_references(self):
        ctx = make_ctx(reference_chunks=[])
        captured = {}

        def fake_call(system_prompt, user_prompt):
            captured['system'] = system_prompt
            captured['user'] = user_prompt
            return {'score': 'BENAR', 'reasoning': 'r', 'student_feedback': {}}

        with patch('api.llm._call_llm_json', side_effect=fake_call):
            run_module_b(ctx)

        self.assertNotIn('SUMBER REFERENSI', captured['user'])
        self.assertNotIn('ATURAN SITASI', captured['system'])
        self.assertNotIn('referensi', captured['system'])
        self.assertNotIn('what_should_be_learned', captured['system'])

    def test_modul_b_prompt_injects_references(self):
        ctx = make_ctx(reference_chunks=[{
            'chunk_id': 'cid-1', 'page_start': 12,
            'document_title': 'Thermodynamics', 'content': 'entropy text',
        }])
        captured = {}

        def fake_call(system_prompt, user_prompt):
            captured['system'] = system_prompt
            captured['user'] = user_prompt
            return {
                'score': 'BENAR', 'reasoning': 'r', 'student_feedback': {},
                'referensi': [{'chunk_id': 'cid-1', 'kutipan': 'q'}],
                'what_should_be_learned': [{'topik': 'Entropy', 'sumber_chunk_ids': ['cid-1']}],
            }

        with patch('api.llm._call_llm_json', side_effect=fake_call):
            _, _, _, referensi, wsl = run_module_b(ctx)

        self.assertIn('SUMBER REFERENSI', captured['user'])
        self.assertIn('cid-1', captured['user'])
        self.assertIn('hal. 12', captured['user'])
        self.assertIn('ATURAN SITASI', captured['system'])
        self.assertIn('referensi', captured['system'])
        self.assertIn('what_should_be_learned', captured['system'])
        self.assertEqual(referensi, [{'chunk_id': 'cid-1', 'kutipan': 'q'}])
        self.assertEqual(wsl, [{'topik': 'Entropy', 'sumber_chunk_ids': ['cid-1']}])

    def test_modul_c_prompt_gains_referensi_only_with_chunks(self):
        captured = {}

        def fake_call(system_prompt, user_prompt):
            captured['system'] = system_prompt
            captured['user'] = user_prompt
            return {'misconception_code': 'MK-LAIN'}

        with patch('api.llm._call_llm_json', side_effect=fake_call):
            run_module_c(make_ctx(reference_chunks=[]))
        self.assertNotIn('referensi', captured['system'])
        self.assertNotIn('SUMBER REFERENSI', captured['user'])

        with patch('api.llm._call_llm_json', side_effect=fake_call):
            run_module_c(make_ctx(reference_chunks=[{
                'chunk_id': 'c1', 'page_start': 1, 'document_title': 'B', 'content': 'x',
            }]))
        self.assertIn('referensi', captured['system'])
        self.assertIn('SUMBER REFERENSI', captured['user'])


class ZeroChunkPipelineTests(SimpleTestCase):
    def test_zero_chunk_subject_records_empty_and_reaches_pending_validation(self):
        ctx = make_ctx(reference_chunks=[])
        recorded = {}

        def record(sql, params=None):
            if 'sp_record_llm_analysis' in sql:
                recorded['sql'] = sql
                recorded['params'] = params

        fake_connection = MagicMock()
        cursor = fake_connection.cursor.return_value.__enter__.return_value
        cursor.execute.side_effect = record

        with patch('api.llm.connection', fake_connection), \
                patch('api.llm.load_context', return_value=ctx), \
                patch('api.llm.retrieve_reference_chunks', return_value=[]), \
                patch('api.llm.run_module_a', return_value=('BENAR', 'ok')), \
                patch('api.llm.run_module_b', return_value=(
                    'BENAR', 'ok',
                    {'poin_tepat': '', 'letak_kekeliruan': '', 'konsep_seharusnya': 'concept'},
                    [], [],
                )):
            result = llm.analyze_submission('sub-1')

        self.assertEqual(result, 'PENDING_VALIDATION')
        self.assertEqual(ctx.reference_chunks, [])
        params = recorded['params']
        self.assertEqual(params[2], 'four-tier-v2.9-rag')   # prompt_version
        self.assertEqual(params[6], json.dumps([]))         # suggested_materials
        self.assertIsNone(params[16])                       # grounding_similarity
        self.assertIsNone(params[17])                       # grounding_similarity_max
        self.assertIsNone(params[18])                       # grounding_citation_count
        payload = json.loads(params[19])
        self.assertEqual(payload['references'], [])
        self.assertIsNone(payload['grounding']['citation_count'])
        self.assertIsNone(payload['grounding']['similarity_mean'])


def make_analysis(similarity=None, citation_count=None, category=None,
                  prompt_version='four-tier-v2.9-rag', references=None,
                  confidence='0.900'):
    return SimpleNamespace(
        grounding_similarity=similarity,
        grounding_citation_count=citation_count,
        grounding_payload_json={'references': references or [], 'grounding': {}},
        four_tier_category=category,
        prompt_version=prompt_version,
        confidence=confidence,
        model_identifier='openai/gpt-oss-20b',
    )


def make_validation(analysis, status='ACCEPTED', orig_tier=2, final_tier=2,
                    orig_pct='50.00', final_pct='50.00'):
    return SimpleNamespace(
        status=status,
        original_tier_level_snapshot=orig_tier,
        final_tier_level_snapshot=final_tier,
        original_percentage=orig_pct,
        final_percentage=final_pct,
        analysis=analysis,
    )


class GroundingMetricsTests(SimpleTestCase):
    def test_aggregates_grounded_analyses(self):
        a1 = make_analysis(similarity=0.50, citation_count=2, category='SC',
                           references=[{'valid': True}, {'valid': True}])
        a2 = make_analysis(similarity=0.70, citation_count=1, category='SC',
                           references=[{'valid': True}, {'valid': False}])
        a3 = make_analysis(similarity=None, citation_count=None, category='LK')
        metrics = _grounding_metrics([a1, a2, a3])

        self.assertAlmostEqual(metrics['grounding_similarity_mean'], 0.6, places=4)
        self.assertAlmostEqual(metrics['grounding_similarity_median'], 0.6, places=4)
        self.assertEqual(metrics['citation_coverage'], round(2 / 3, 4))
        self.assertEqual(metrics['citation_validity_rate'], 0.75)       # 3 valid / 4 total
        self.assertEqual(metrics['hallucinated_citation_rate'], 0.25)
        self.assertEqual(metrics['no_grounding_count'], 1)
        self.assertEqual(metrics['grounding_by_category']['SC']['count'], 2)
        self.assertAlmostEqual(
            metrics['grounding_by_category']['SC']['similarity_mean'], 0.6, places=4)
        self.assertEqual(
            metrics['grounding_by_prompt_version']['four-tier-v2.9-rag']['count'], 2)

    def test_median_odd_count(self):
        analyses = [
            make_analysis(similarity=0.5, citation_count=1, references=[{'valid': True}]),
            make_analysis(similarity=0.9, citation_count=1, references=[{'valid': True}]),
            make_analysis(similarity=0.7, citation_count=1, references=[{'valid': True}]),
        ]
        metrics = _grounding_metrics(analyses)
        self.assertAlmostEqual(metrics['grounding_similarity_median'], 0.7, places=4)
        self.assertAlmostEqual(metrics['grounding_similarity_mean'], 0.7, places=4)

    def test_zero_citations_is_all_none(self):
        metrics = _grounding_metrics([make_analysis(category='LK')])
        self.assertIsNone(metrics['grounding_similarity_mean'])
        self.assertIsNone(metrics['grounding_similarity_median'])
        self.assertIsNone(metrics['citation_validity_rate'])
        self.assertIsNone(metrics['hallucinated_citation_rate'])
        self.assertEqual(metrics['citation_coverage'], 0.0)
        self.assertEqual(metrics['no_grounding_count'], 1)

    def test_compute_metrics_has_no_grounding_keys(self):
        # Grounding no longer comes from the validations passed to
        # _compute_metrics — it is sourced from all analyses in scope.
        analysis = make_analysis(similarity=0.8, citation_count=1, category='SC',
                                 references=[{'valid': True}])
        validation = make_validation(analysis)
        metrics = _compute_metrics([validation], [validation])
        for key in (
            'grounding_similarity_mean', 'grounding_similarity_median',
            'citation_coverage', 'citation_validity_rate',
            'hallucinated_citation_rate', 'grounding_by_category',
            'grounding_by_prompt_version', 'no_grounding_count',
        ):
            self.assertNotIn(key, metrics)


class ZeroValidationMetricsTests(SimpleTestCase):
    def test_zero_validation_payload_reports_grounding(self):
        grounded = make_analysis(similarity=0.6, citation_count=2, category='SC',
                                 references=[{'valid': True}, {'valid': True}])
        ungrounded = make_analysis(category='LK')
        payload = _zero_validation_payload([grounded, ungrounded])

        self.assertEqual(payload['total_validations'], 0)
        self.assertIn('note', payload)
        for key in (
            'grounding_similarity_mean', 'grounding_similarity_median',
            'citation_coverage', 'citation_validity_rate',
            'hallucinated_citation_rate', 'grounding_by_category',
            'grounding_by_prompt_version', 'no_grounding_count',
        ):
            self.assertIn(key, payload)
        self.assertAlmostEqual(payload['grounding_similarity_mean'], 0.6, places=4)
        self.assertEqual(payload['citation_coverage'], 0.5)
        self.assertEqual(payload['no_grounding_count'], 1)
        self.assertEqual(len(payload['by_model']), 1)
        row = payload['by_model'][0]
        self.assertIsNone(row['tier_agreement_accuracy'])       # no validations
        self.assertAlmostEqual(row['grounding_similarity_mean'], 0.6, places=4)

    def test_by_model_row_grounding_from_analyses_not_validations(self):
        analysis = make_analysis(similarity=0.7, citation_count=1,
                                 references=[{'valid': True}])
        row = _by_model_row('m1', [], [analysis])
        self.assertEqual(row['total_validations'], 0)
        self.assertIsNone(row['tier_agreement_accuracy'])
        self.assertAlmostEqual(row['grounding_similarity_mean'], 0.7, places=4)
        self.assertEqual(row['citation_coverage'], 1.0)


class GroundingDetailShapeTests(SimpleTestCase):
    def test_grounded_analysis_shape(self):
        analysis = SimpleNamespace(
            grounding_similarity=Decimal('0.5679'),
            grounding_similarity_max=Decimal('0.6123'),
            grounding_citation_count=2,
            grounding_payload_json={'references': [{'valid': True}], 'grounding': {}},
            suggested_materials_json=[{'topik': 'Entropy'}],
        )
        breakdown = {
            'references': [{'chunk_id': 'c1', 'valid': True}],
            'what_should_be_learned': [{'topik': 'Entropy'}],
        }
        detail = _grounding_detail(analysis, breakdown)
        self.assertEqual(detail['concept_breakdown_json'], breakdown)
        self.assertEqual(detail['references'], breakdown['references'])
        self.assertEqual(detail['what_should_be_learned'], breakdown['what_should_be_learned'])
        self.assertEqual(detail['suggested_materials'], analysis.suggested_materials_json)
        self.assertAlmostEqual(detail['grounding']['similarity_mean'], 0.5679, places=4)
        self.assertAlmostEqual(detail['grounding']['similarity_max'], 0.6123, places=4)
        self.assertEqual(detail['grounding']['citation_count'], 2)
        self.assertEqual(detail['grounding']['payload'], analysis.grounding_payload_json)

    def test_old_analysis_shape_is_stable(self):
        analysis = SimpleNamespace(
            grounding_similarity=None,
            grounding_similarity_max=None,
            grounding_citation_count=None,
            grounding_payload_json={},
            suggested_materials_json=[],
        )
        detail = _grounding_detail(analysis, {})
        self.assertEqual(detail['concept_breakdown_json'], {})
        self.assertEqual(detail['references'], [])
        self.assertEqual(detail['what_should_be_learned'], [])
        self.assertEqual(detail['suggested_materials'], [])
        self.assertIsNone(detail['grounding']['similarity_mean'])
        self.assertIsNone(detail['grounding']['similarity_max'])
        self.assertIsNone(detail['grounding']['citation_count'])
        self.assertEqual(detail['grounding']['payload'], {})


class MaterialUploadValidationTests(SimpleTestCase):
    def test_allowed_extensions(self):
        for name in ('notes.pdf', 'notes.md', 'notes.markdown', 'notes.txt'):
            extension, error = validate_material_upload(name, 10)
            self.assertIsNone(error, name)
            self.assertTrue(extension.startswith('.'))

    def test_rejects_other_extensions(self):
        extension, error = validate_material_upload('notes.docx', 10)
        self.assertIsNone(extension)
        self.assertIn('PDF', error)

    def test_missing_file(self):
        extension, error = validate_material_upload(None, None)
        self.assertIsNone(extension)
        self.assertIn('tidak ditemukan', error)

    def test_size_cap(self):
        extension, error = validate_material_upload('notes.pdf', MATERIAL_UPLOAD_MAX_BYTES + 1)
        self.assertIsNone(extension)
        self.assertIn('25MB', error)
        extension, error = validate_material_upload('notes.pdf', MATERIAL_UPLOAD_MAX_BYTES)
        self.assertIsNone(error)


class MaterialScopeTests(SimpleTestCase):
    def test_superuser_is_allowed(self):
        self.assertTrue(is_lecturer_for_subject(SimpleNamespace(is_superuser=True), 'subj'))

    def test_non_lecturer_subject_is_rejected(self):
        user = SimpleNamespace(is_superuser=False)
        with patch('api.views.UserSubjectRole') as role:
            role.objects.filter.return_value.exists.return_value = False
            self.assertFalse(is_lecturer_for_subject(user, 'subj'))
            role.objects.filter.return_value.exists.return_value = True
            self.assertTrue(is_lecturer_for_subject(user, 'subj'))


class PendingDrainTests(SimpleTestCase):
    def _options(self, loop=False):
        return {'loop': loop, 'interval': 10, 'batch_size': 64}

    def test_nothing_pending(self):
        out = StringIO()
        with patch.object(ingest_cmd, '_select_pending', return_value=[]):
            ingest_cmd.Command(stdout=out)._drain(self._options())
        self.assertIn('Nothing pending.', out.getvalue())

    def test_failure_isolation_marks_failed_and_continues(self):
        docs = [
            ('doc-1', 'subj-1', None, 'Broken', 'materials/broken.pdf', 'application/pdf'),
            ('doc-2', 'subj-1', None, 'Good', 'materials/good.md', 'text/markdown'),
        ]
        calls = []

        def fake_ingest(self, document_id, subject_id, topic_id, file_path, batch_size):
            calls.append(document_id)
            if document_id == 'doc-1':
                raise RuntimeError('corrupt pdf')
            return 3

        with patch.object(ingest_cmd, '_select_pending', return_value=docs), \
                patch.object(ingest_cmd.Command, '_ingest_pending_document', fake_ingest), \
                patch.object(ingest_cmd, '_mark_failed') as mark_failed:
            ingest_cmd.Command()._drain(self._options())

        self.assertEqual(calls, ['doc-1', 'doc-2'])          # both attempted
        mark_failed.assert_called_once()
        self.assertEqual(mark_failed.call_args[0][0], 'doc-1')
        self.assertIn('corrupt pdf', mark_failed.call_args[0][1])
