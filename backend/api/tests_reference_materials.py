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

from django.test import SimpleTestCase, override_settings

from api import llm
from api.embeddings import answer_similarity, cosine
from api.llm import (
    FourTierContext,
    build_reference_block,
    classify_tiers,
    grounded_similarity,
    run_module_b,
    run_module_c,
    validate_citations,
)
from api.management.commands import ingest_materials as ingest_cmd
from api.materials_views import MATERIAL_UPLOAD_MAX_BYTES, validate_material_upload
from api.reading_materials import (
    _filter_sources,
    enqueue_reading_material,
    generate_reading_material,
    input_fingerprint,
)
from api.validation_views import (
    _attach_document_titles,
    _by_model_row,
    _compute_metrics,
    _filter_analyses_by_model,
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

        def fake_call(system_prompt, user_prompt, model_identifier):
            captured['system'] = system_prompt
            captured['user'] = user_prompt
            return {'score': 'BENAR', 'reasoning': 'r', 'student_feedback': {}}

        with patch('api.llm._call_llm_json', side_effect=fake_call):
            run_module_b(ctx, 'test-model')

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

        def fake_call(system_prompt, user_prompt, model_identifier):
            captured['system'] = system_prompt
            captured['user'] = user_prompt
            return {
                'score': 'BENAR', 'reasoning': 'r', 'student_feedback': {},
                'referensi': [{'chunk_id': 'cid-1', 'kutipan': 'q'}],
                'what_should_be_learned': [{'topik': 'Entropy', 'sumber_chunk_ids': ['cid-1']}],
            }

        with patch('api.llm._call_llm_json', side_effect=fake_call):
            _, _, _, referensi, wsl = run_module_b(ctx, 'test-model')

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

        def fake_call(system_prompt, user_prompt, model_identifier):
            captured['system'] = system_prompt
            captured['user'] = user_prompt
            return {'misconception_code': 'MK-LAIN'}

        with patch('api.llm._call_llm_json', side_effect=fake_call):
            run_module_c(make_ctx(reference_chunks=[]), 'test-model')
        self.assertNotIn('referensi', captured['system'])
        self.assertNotIn('SUMBER REFERENSI', captured['user'])

        with patch('api.llm._call_llm_json', side_effect=fake_call):
            run_module_c(make_ctx(reference_chunks=[{
                'chunk_id': 'c1', 'page_start': 1, 'document_title': 'B', 'content': 'x',
            }]), 'test-model')
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
        self.assertEqual(params[2], llm.PROMPT_VERSION)      # source-derived prompt_version
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
                  confidence='0.900', model_identifier='openai/gpt-oss-20b'):
    return SimpleNamespace(
        grounding_similarity=similarity,
        grounding_citation_count=citation_count,
        grounding_payload_json={'references': references or [], 'grounding': {}},
        four_tier_category=category,
        prompt_version=prompt_version,
        confidence=confidence,
        model_identifier=model_identifier,
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
        self.assertEqual(len(detail['references']), 1)
        self.assertEqual(detail['references'][0]['chunk_id'], 'c1')
        self.assertIsNone(detail['references'][0]['document_title'])
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


class ModelFilterTests(SimpleTestCase):
    """`?model=` must restrict the grounding block, not just echo the filter."""

    def _analyses(self):
        return [
            make_analysis(similarity=0.5, citation_count=1, references=[{'valid': True}],
                          model_identifier='model-a'),
            make_analysis(similarity=0.7, citation_count=1, references=[{'valid': True}],
                          model_identifier='model-b'),
        ]

    def test_no_filter_keeps_every_analysis(self):
        analyses = self._analyses()
        self.assertEqual(len(_filter_analyses_by_model(analyses, None)), 2)
        self.assertEqual(len(_filter_analyses_by_model(analyses, '')), 2)

    def test_matching_filter_keeps_only_that_model(self):
        kept = _filter_analyses_by_model(self._analyses(), 'model-a')
        self.assertEqual([a.model_identifier for a in kept], ['model-a'])

    def test_non_matching_filter_is_zero_analyses_shape(self):
        kept = _filter_analyses_by_model(self._analyses(), 'does-not-exist')
        self.assertEqual(kept, [])

        payload = _zero_validation_payload(kept, 'does-not-exist')
        self.assertEqual(payload['total_validations'], 0)
        self.assertEqual(payload['model_filter'], 'does-not-exist')
        self.assertIsNone(payload['grounding_similarity_mean'])
        self.assertIsNone(payload['grounding_similarity_median'])
        self.assertIsNone(payload['citation_coverage'])
        self.assertIsNone(payload['citation_validity_rate'])
        self.assertIsNone(payload['hallucinated_citation_rate'])
        self.assertEqual(payload['grounding_by_category'], {})
        self.assertEqual(payload['grounding_by_prompt_version'], {})
        self.assertEqual(payload['no_grounding_count'], 0)
        self.assertEqual(payload['by_model'], [])


class DocumentTitleMappingTests(SimpleTestCase):
    def test_document_title_present_and_null_safe(self):
        refs = [
            {'chunk_id': 'c1', 'document_id': 'doc-known'},
            {'chunk_id': 'c2', 'document_id': 'doc-unknown'},
            {'chunk_id': 'c3', 'document_id': None},
            {'chunk_id': 'c4'},
            'not-a-dict',
        ]
        with patch('api.validation_views._document_titles',
                   return_value={'doc-known': 'Sears & Salinger — Thermodynamics'}):
            out = _attach_document_titles(refs)

        self.assertEqual(out[0]['document_title'], 'Sears & Salinger — Thermodynamics')
        self.assertEqual(out[0]['chunk_id'], 'c1')          # existing keys kept
        self.assertIsNone(out[1]['document_title'])         # unknown id
        self.assertIsNone(out[2]['document_title'])         # malformed (None id)
        self.assertIsNone(out[3]['document_title'])         # missing id
        self.assertIsNone(out[4]['document_title'])         # non-dict entry
        self.assertTrue(all('document_title' in e for e in out))

    def test_empty_references_do_not_query(self):
        with patch('api.validation_views.connection') as conn:
            self.assertEqual(_attach_document_titles([]), [])
        conn.cursor.assert_not_called()


class AnswerSimilarityTests(SimpleTestCase):
    def test_identical_texts_are_one_with_two_calls(self):
        with patch('api.embeddings.embed_text', return_value=[1.0, 0.0, 0.0]) as mocked:
            sim1, sim3 = answer_similarity('t1', 't3', [1.0, 0.0, 0.0], [1.0, 0.0, 0.0])
        self.assertEqual(sim1, 1.0)
        self.assertEqual(sim3, 1.0)
        self.assertEqual(mocked.call_count, 2)   # only the student's two texts

    def test_orthogonal_texts_are_zero(self):
        def fake_embed(text):
            return [1.0, 0.0] if text == 't1' else [0.0, 1.0]

        with patch('api.embeddings.embed_text', side_effect=fake_embed):
            sim1, sim3 = answer_similarity('t1', 't3', [0.0, 1.0], [1.0, 0.0])
        self.assertEqual(sim1, 0.0)
        self.assertEqual(sim3, 0.0)

    def test_blank_text_is_none_and_never_embedded(self):
        with patch('api.embeddings.embed_text', return_value=[1.0, 0.0]) as mocked:
            sim1, sim3 = answer_similarity('   ', 'some reason', [1.0, 0.0], [1.0, 0.0])
        self.assertIsNone(sim1)
        self.assertEqual(sim3, 1.0)
        mocked.assert_called_once_with('some reason')

    def test_missing_cached_reference_vector_is_none_without_embedding(self):
        with patch('api.embeddings.embed_text') as mocked:
            sim1, sim3 = answer_similarity('t1', 't3', None, None)
        self.assertIsNone(sim1)
        self.assertIsNone(sim3)
        mocked.assert_not_called()               # never embed the reference on the fly

    def test_missing_one_reference_side_only_nulls_that_tier(self):
        with patch('api.embeddings.embed_text', return_value=[1.0, 0.0]) as mocked:
            sim1, sim3 = answer_similarity('t1', 't3', None, [1.0, 0.0])
        self.assertIsNone(sim1)
        self.assertEqual(sim3, 1.0)
        mocked.assert_called_once_with('t3')


class ClassifyTiersTests(SimpleTestCase):
    def test_at_threshold_is_benar(self):
        self.assertEqual(classify_tiers(0.75, 0.75, 0.75, 0.75), ('BENAR', 'BENAR'))

    def test_above_threshold_is_benar(self):
        self.assertEqual(classify_tiers(0.9, 0.8, 0.75, 0.75), ('BENAR', 'BENAR'))

    def test_below_threshold_is_salah(self):
        self.assertEqual(classify_tiers(0.74, 0.0, 0.75, 0.75), ('SALAH', 'SALAH'))

    def test_none_similarity_is_none_verdict_not_salah(self):
        self.assertEqual(classify_tiers(None, 0.9, 0.75, 0.75), (None, 'BENAR'))
        self.assertEqual(classify_tiers(0.9, None, 0.75, 0.75), ('BENAR', None))

    def test_separate_thresholds_per_tier(self):
        self.assertEqual(classify_tiers(0.7, 0.7, 0.75, 0.5), ('SALAH', 'BENAR'))


@override_settings(SHADOW_RULE_VERDICT=True, TIER_VERDICT_SOURCE='llm',
                   ANSWER_SIM_T1_THRESHOLD=0.75, ANSWER_SIM_T3_THRESHOLD=0.75)
class ShadowPipelineTests(SimpleTestCase):
    def _run_pipeline(self):
        ctx = make_ctx(reference_chunks=[])
        recorded = {}

        def record(sql, params=None):
            if 'sp_record_llm_analysis' in sql:
                recorded['sql'] = sql
                recorded['params'] = params

        fake_connection = MagicMock()
        cursor = fake_connection.cursor.return_value.__enter__.return_value
        cursor.execute.side_effect = record

        similarity = MagicMock(return_value=(0.9, 0.4))
        with patch('api.llm.connection', fake_connection), \
                patch('api.llm.load_context', return_value=ctx), \
                patch('api.llm.retrieve_reference_chunks', return_value=[]), \
                patch('api.llm.answer_similarity', similarity), \
                patch('api.llm.run_module_a', return_value=('BENAR', 'ok')), \
                patch('api.llm.run_module_b', return_value=(
                    'BENAR', 'ok',
                    {'poin_tepat': 'p', 'letak_kekeliruan': 'l', 'konsep_seharusnya': 'concept'},
                    [], [],
                )):
            result = llm.analyze_submission('sub-1')
        return result, recorded, similarity

    def test_shadow_recorded_and_call_has_26_placeholders(self):
        result, recorded, similarity = self._run_pipeline()

        self.assertEqual(result, 'PENDING_VALIDATION')
        # 25 bound %s values + 1 literal NULL (OUT p_analysis_id) = 26 slots.
        self.assertEqual(recorded['sql'].count('%s') + recorded['sql'].count('NULL'), 26)
        self.assertEqual(len(recorded['params']), 25)

        params = recorded['params']
        # Driving verdict (module_a/b) equals the LLM verdict under 'llm'.
        self.assertEqual(params[11], 'BENAR')
        self.assertEqual(params[12], 'BENAR')
        # llm_* is the LLM's own verdict, always recorded.
        self.assertEqual(params[22], 'BENAR')
        self.assertEqual(params[23], 'BENAR')
        # similarities.
        self.assertEqual(params[20], 0.9)
        self.assertEqual(params[21], 0.4)

        shadow = json.loads(params[24])
        self.assertEqual(shadow['rule_t1'], 'BENAR')
        self.assertEqual(shadow['rule_t3'], 'SALAH')
        self.assertEqual(shadow['sim_t1'], 0.9)
        self.assertEqual(shadow['sim_t3'], 0.4)
        self.assertEqual(shadow['threshold_t1'], 0.75)
        self.assertEqual(shadow['threshold_t3'], 0.75)
        self.assertEqual(shadow['source'], 'llm')

        # D17: student_feedback is still written into concept_breakdown_json.
        breakdown = json.loads(params[5])
        self.assertIn('student_feedback', breakdown)
        self.assertEqual(breakdown['student_feedback']['konsep_seharusnya'], 'concept')

    @override_settings(SHADOW_RULE_VERDICT=False)
    def test_shadow_disabled_skips_embedding_and_records_nulls(self):
        result, recorded, similarity = self._run_pipeline()

        self.assertEqual(result, 'PENDING_VALIDATION')
        similarity.assert_not_called()            # zero embed calls when off

        params = recorded['params']
        self.assertIsNone(params[20])
        self.assertIsNone(params[21])
        shadow = json.loads(params[24])
        self.assertIsNone(shadow['rule_t1'])
        self.assertIsNone(shadow['rule_t3'])
        self.assertIsNone(shadow['sim_t1'])
        self.assertIsNone(shadow['sim_t3'])


class EnqueueReadingMaterialTests(SimpleTestCase):
    def test_non_sc_inserts_pending_with_conflict_guard(self):
        fake = MagicMock()
        cursor = fake.cursor.return_value.__enter__.return_value
        cursor.rowcount = 1
        with patch('api.reading_materials.connection', fake):
            created = enqueue_reading_material('qv-1', 'FP')
        self.assertTrue(created)
        sql = cursor.execute.call_args[0][0]
        self.assertIn('INSERT INTO generated_reading_materials', sql)
        self.assertIn("'PENDING'", sql)
        self.assertIn('ON CONFLICT (question_version_id, category) DO NOTHING', sql)

    def test_existing_row_returns_false(self):
        fake = MagicMock()
        cursor = fake.cursor.return_value.__enter__.return_value
        cursor.rowcount = 0
        with patch('api.reading_materials.connection', fake):
            self.assertFalse(enqueue_reading_material('qv-1', 'FP'))

    def test_sc_skips_without_touching_the_database(self):
        fake = MagicMock()
        with patch('api.reading_materials.connection', fake):
            self.assertFalse(enqueue_reading_material('qv-1', 'SC'))
        fake.cursor.assert_not_called()


class InputFingerprintTests(SimpleTestCase):
    def test_deterministic_64_char_lowercase_hex(self):
        args = ('reading-material-v1.0', 'model', 'qv-1', 'FP', 'prompt', 'short', 'reason')
        digest = input_fingerprint(*args)
        self.assertEqual(len(digest), 64)
        self.assertEqual(digest, digest.lower())
        self.assertEqual(digest, input_fingerprint(*args))
        # every component participates
        self.assertNotEqual(
            digest,
            input_fingerprint('reading-material-v1.0', 'model', 'qv-1', 'FN', 'prompt', 'short', 'reason'),
        )


class FilterSourcesTests(SimpleTestCase):
    def setUp(self):
        self.retrieved = {
            'c1': {'chunk_id': 'c1', 'document_id': 'd1', 'document_title': 'T1', 'page_start': 3},
            'c2': {'chunk_id': 'c2', 'document_id': 'd2', 'document_title': 'T2', 'page_start': 7},
        }

    def test_keeps_only_retrieved_and_counts_residue(self):
        sources, ungrounded = _filter_sources(
            [
                {'chunk_id': 'c1', 'document_title': 'lying-title'},
                {'chunk_id': 'ghost'},
                {'chunk_id': 'c1'},          # duplicate — neither kept nor counted
                {'chunk_id': 'c2'},
                'not-a-dict',
                {},
            ],
            self.retrieved,
        )
        self.assertEqual([s['chunk_id'] for s in sources], ['c1', 'c2'])
        # provenance is re-materialised from the retrieved chunk, not the model's claim
        self.assertEqual(sources[0]['document_title'], 'T1')
        self.assertEqual(sources[0]['document_id'], 'd1')
        self.assertEqual(sources[1]['page'], 7)
        self.assertEqual(ungrounded, 3)  # ghost + not-a-dict + {} 

    def test_non_list_is_empty(self):
        self.assertEqual(_filter_sources(None, self.retrieved), ([], 0))


@override_settings(READING_MATERIAL_TEMPERATURE=0.0)
class ReadingMaterialGenerationTests(SimpleTestCase):
    def test_zero_chunk_still_ready_ungrounded_no_sources(self):
        ctx = make_ctx(question_version_id='qv-1')
        with patch('api.reading_materials.retrieve_reference_chunks', return_value=[]) as retrieve, \
                patch('api.reading_materials.get_active_model_identifier', return_value='test-model'), \
                patch('api.reading_materials._call_llm_json',
                      return_value={'reading_material_md': 'Materi.', 'sources': []}) as call, \
                patch('api.reading_materials._mark_ready') as mark_ready, \
                patch('api.reading_materials._mark_failed') as mark_failed:
            result = generate_reading_material(ctx, 'FP')

        self.assertEqual(result['status'], 'READY')
        self.assertFalse(result['grounded'])
        self.assertEqual(result['sources_count'], 0)
        retrieve.assert_called_once()
        mark_failed.assert_not_called()
        mark_ready.assert_called_once()
        kwargs = mark_ready.call_args.kwargs
        self.assertFalse(kwargs['grounded'])              # D8: zero chunks -> not grounded
        self.assertEqual(kwargs['sources'], [])
        self.assertEqual(kwargs['ungrounded_source_count'], 0)
        # generation temperature is 0.0, not the pipeline's 0.1
        self.assertEqual(call.call_args.kwargs.get('temperature'), 0.0)

    def test_failure_marks_failed_and_never_raises(self):
        ctx = make_ctx(question_version_id='qv-1')
        with patch('api.reading_materials.retrieve_reference_chunks', return_value=[]), \
                patch('api.reading_materials.get_active_model_identifier', return_value='test-model'), \
                patch('api.reading_materials._call_llm_json', side_effect=RuntimeError('boom')), \
                patch('api.reading_materials._mark_ready') as mark_ready, \
                patch('api.reading_materials._mark_failed') as mark_failed:
            result = generate_reading_material(ctx, 'MSC')   # must not raise

        self.assertEqual(result['status'], 'FAILED')
        self.assertIn('boom', result['error'])
        mark_ready.assert_not_called()
        mark_failed.assert_called_once()
        args = mark_failed.call_args[0]
        self.assertEqual(args[0], 'qv-1')
        self.assertEqual(args[1], 'MSC')
        self.assertIn('boom', args[2])


@override_settings(SHADOW_RULE_VERDICT=True, TIER_VERDICT_SOURCE='llm',
                   ANSWER_SIM_T1_THRESHOLD=0.75, ANSWER_SIM_T3_THRESHOLD=0.75)
class ReadingMaterialQueueTests(SimpleTestCase):
    """The analysis path queues material and makes no generation call (C4)."""

    def _run_pipeline(self, mod_a, mod_b, enqueue_side_effect=None):
        ctx = make_ctx(reference_chunks=[], question_version_id='qv-1')
        recorded = {}

        def record(sql, params=None):
            if 'sp_record_llm_analysis' in sql:
                recorded['params'] = params

        fake_connection = MagicMock()
        cursor = fake_connection.cursor.return_value.__enter__.return_value
        cursor.execute.side_effect = record

        module_b_return = (
            mod_b, 'ok',
            {'poin_tepat': 'p', 'letak_kekeliruan': 'l', 'konsep_seharusnya': 'c'},
            [], [],
        )
        with patch('api.llm.connection', fake_connection), \
                patch('api.llm.load_context', return_value=ctx), \
                patch('api.llm.retrieve_reference_chunks', return_value=[]), \
                patch('api.llm.answer_similarity', MagicMock(return_value=(0.9, 0.4))), \
                patch('api.llm.run_module_a', return_value=(mod_a, 'ok')), \
                patch('api.llm.run_module_b', return_value=module_b_return), \
                patch('api.llm.run_module_c', return_value=('MK-LAIN', 'MK-LAIN', 0.5, '', [])), \
                patch('api.reading_materials.enqueue_reading_material',
                      side_effect=enqueue_side_effect) as enqueue, \
                patch('api.reading_materials.generate_reading_material') as generate:
            result = llm.analyze_submission('sub-1')
        return result, enqueue, generate

    def test_non_sc_queues_pending_and_makes_no_generation_call(self):
        result, enqueue, generate = self._run_pipeline('BENAR', 'SALAH')  # (B,y,S,y) -> FP
        self.assertEqual(result, 'PENDING_VALIDATION')
        enqueue.assert_called_once()
        args = enqueue.call_args[0]
        self.assertEqual(args[0], 'qv-1')
        self.assertEqual(args[1], 'FP')
        generate.assert_not_called()

    def test_sc_queues_nothing(self):
        result, enqueue, generate = self._run_pipeline('BENAR', 'BENAR')  # (B,y,B,y) -> SC
        self.assertEqual(result, 'PENDING_VALIDATION')
        enqueue.assert_not_called()
        generate.assert_not_called()

    def test_queue_failure_does_not_fail_the_analysis(self):
        result, enqueue, generate = self._run_pipeline(
            'BENAR', 'SALAH', enqueue_side_effect=RuntimeError('queue down'),
        )
        self.assertEqual(result, 'PENDING_VALIDATION')
        enqueue.assert_called_once()
        generate.assert_not_called()
