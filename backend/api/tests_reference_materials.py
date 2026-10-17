"""Tests for the reference-materials feature (R3 retrieval/grounding + R4 metrics).

These tests are deliberately DB-free. Pure helpers are exercised directly, and
the pipeline test monkeypatches `load_context`, retrieval, the three modules and
`connection`, so nothing touches the shared dev DB or the network. Run with:

    venv/Scripts/python.exe manage.py test api.tests_reference_materials -v 2
"""

import json
from contextlib import ExitStack
from datetime import datetime
from decimal import Decimal
from io import StringIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from api import llm
from api import reading_materials
from api.models import ExamPackage
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
from api.materials_views import (
    MATERIAL_UPLOAD_MAX_BYTES,
    ReadingMaterialFlagView,
    validate_material_upload,
)
from api.reading_materials import (
    _filter_sources,
    enqueue_reading_material,
    generate_reading_material,
    input_fingerprint,
    lecturer_category,
)
from api.validation_views import (
    ValidationSubmitView,
    _analysis_metrics,
    _answer_similarity_metrics,
    _attach_document_titles,
    _bucket_similarities,
    _by_model_row,
    _compute_metrics,
    _filter_analyses_by_model,
    _grounding_detail,
    _reading_material_counts,
    _reading_material_detail,
    _reading_material_staleness,
    _zero_validation_payload,
)
from api.views import (
    _STUDENT_HIDDEN_ANALYSIS_KEYS,
    _build_submission_package_groups,
    _student_analysis_detail,
    _student_reading_material,
    is_lecturer_for_subject,
)


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


class PromptNeutralityTests(SimpleTestCase):
    """The module prompts must not assume a field of study.

    v3.0 was written for physics — "penalaran fisis", "penurunan matematis/aljabar",
    "rumus keliru" — so a chemistry answer that is conceptually right but contains no
    formula was judged against a framework that does not apply to it, and the prompt
    actively invited formula-derivation while deprioritising narrative reasoning. The
    prompts are local variables inside `run_module_b/c`, so this captures them exactly
    as the provider sees them by stubbing only the transport.
    """

    def _capture(self, module_callable, **ctx_over):
        captured = {}

        def fake(sys_prompt, user_prompt, model_identifier):
            captured['sys'] = sys_prompt
            return {'score': 'BENAR', 'misconception_code': 'MK-LAIN'}

        with patch('api.llm._call_llm_json', side_effect=fake):
            module_callable(make_ctx(**ctx_over), 'test-model')
        return captured['sys']

    def test_module_b_prompt_is_subject_agnostic(self):
        low = self._capture(run_module_b).lower()
        # Ban only physics-EXCLUSIVE framing. Do not ban bare nouns/phrases that the
        # rewrite legitimately names as equally acceptable ("penurunan matematis" and
        # "rumus" both appear inside inclusive clauses — banning them asserted the
        # opposite of what the prompt now says).
        for banned in ('fisis', 'prinsip fisis', 'aljabar', 'penurunan rumus'):
            self.assertNotIn(
                banned, low, f'Modul B assumes a physics framing again: {banned!r}')
        # The de-bias signals: no assumed field, all valid reasoning forms equal, and
        # the anti-hallucination rule surviving the rewrite.
        self.assertIn('jangan mengasumsikan bidang ilmu', low)
        self.assertIn('diterima setara', low)
        self.assertIn('anti-halusinasi', low)

    def test_module_c_prompt_is_subject_agnostic(self):
        low = self._capture(run_module_c).lower()
        self.assertNotIn('menurunkan rumus', low)
        self.assertIn('mk-lain', low)

    def test_reading_material_prompt_is_subject_agnostic(self):
        self.assertIn('jangan mengasumsikan bidang ilmu',
                      reading_materials._SYSTEM_PROMPT.lower())

    def test_prompt_versions_carry_the_de_bias(self):
        # A prompt edit without a version bump pools two different prompts into one
        # metrics bucket, and for materials it means the old rows never regenerate.
        self.assertIn('v3.1', llm.PROMPT_VERSION)
        self.assertEqual(reading_materials.READING_MATERIAL_PROMPT_VERSION,
                         'reading-material-v1.2')

    def test_material_prompt_demands_a_short_misconception_summary(self):
        # v1.2: the material is a summary around the misconception, not an essay.
        # Without these rules in the prompt the model writes 400+ words again, and
        # the version bump alone would not have changed the output shape.
        low = reading_materials._SYSTEM_PROMPT.lower()
        self.assertIn('120-200 kata', low)
        self.assertIn('1200 karakter', low)
        self.assertIn('maksimum 3 poin bullet', low)
        self.assertIn('jangan menulis paragraf penutup', low)


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
            _, referensi, wsl = run_module_b(ctx, 'test-model')

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
                patch('api.llm.run_module_b', return_value=('BENAR', [], [])):
            result = llm.analyze_submission('sub-1')

        self.assertEqual(result, 'PENDING_VALIDATION')
        self.assertEqual(ctx.reference_chunks, [])
        params = recorded['params']
        self.assertEqual(params[2], llm.PROMPT_VERSION)      # source-derived prompt_version
        self.assertEqual(params[6], json.dumps([]))         # suggested_materials
        # C8: no new analysis writes grounding (metric + input left together).
        self.assertIsNone(params[16])                       # grounding_similarity
        self.assertIsNone(params[17])                       # grounding_similarity_max
        self.assertIsNone(params[18])                       # grounding_citation_count
        self.assertEqual(json.loads(params[19]), {})        # grounding_payload_json
        breakdown = json.loads(params[5])
        self.assertNotIn('student_feedback', breakdown)
        self.assertNotIn('grounding', breakdown)


def make_analysis(similarity=None, citation_count=None, category=None,
                  prompt_version='four-tier-v2.9-rag', references=None,
                  confidence='0.900', model_identifier='openai/gpt-oss-20b',
                  sim_t1=None, sim_t3=None, llm_t1=None, llm_t3=None,
                  shadow=None, submission=None):
    return SimpleNamespace(
        grounding_similarity=similarity,
        grounding_citation_count=citation_count,
        grounding_payload_json={'references': references or [], 'grounding': {}},
        four_tier_category=category,
        prompt_version=prompt_version,
        confidence=confidence,
        model_identifier=model_identifier,
        answer_similarity_t1=sim_t1,
        answer_similarity_t3=sim_t3,
        llm_t1_score=llm_t1,
        llm_t3_score=llm_t3,
        verdict_shadow_json=shadow if shadow is not None else {},
        submission=submission,
    )


def make_validation(analysis, status='ACCEPTED', orig_tier=2, final_tier=2,
                    orig_pct='50.00', final_pct='50.00', final_category=None):
    return SimpleNamespace(
        status=status,
        original_tier_level_snapshot=orig_tier,
        final_tier_level_snapshot=final_tier,
        original_percentage=orig_pct,
        final_percentage=final_pct,
        final_category=final_category,
        analysis=analysis,
    )


class AnalysisMetricsContractTests(SimpleTestCase):
    """C8: the superseded grounding keys are gone from the analysis metrics."""

    REMOVED_KEYS = (
        'grounding_similarity_mean', 'grounding_similarity_median',
        'citation_coverage', 'citation_validity_rate',
        'hallucinated_citation_rate', 'grounding_by_category',
        'grounding_by_prompt_version', 'no_grounding_count',
    )
    KEPT_KEYS = (
        'answer_similarity_t1_mean', 'answer_similarity_t1_median',
        'answer_similarity_t3_mean', 'answer_similarity_t3_median',
        'answer_similarity_coverage', 'no_similarity_count',
        'answer_similarity_by_category', 'answer_similarity_by_prompt_version',
        'verdict_agreement_rate', 'verdict_disagreement_count',
        'verdict_comparable_count', 'reading_material_counts',
    )

    def test_analysis_metrics_drops_removed_keys_keeps_kept_keys(self):
        m = _analysis_metrics([make_analysis(category='SC', sim_t1=0.6, sim_t3=0.7)])
        for key in self.REMOVED_KEYS:
            self.assertNotIn(key, m, key)
        for key in self.KEPT_KEYS:
            self.assertIn(key, m, key)
        self.assertEqual(m['reading_material_counts']['total'], 0)

    def test_compute_metrics_has_no_grounding_keys(self):
        # Grounding is not a validation-derived metric; C8 also removed it from
        # the analysis metrics. It must never reappear in either payload.
        analysis = make_analysis(similarity=0.8, citation_count=1, category='SC',
                                 references=[{'valid': True}])
        validation = make_validation(analysis)
        metrics = _compute_metrics([validation], [validation])
        for key in self.REMOVED_KEYS:
            self.assertNotIn(key, metrics)


class ZeroValidationMetricsTests(SimpleTestCase):
    def test_zero_validation_payload_reports_analysis_metrics(self):
        first = make_analysis(category='SC', sim_t1=0.6, sim_t3=0.7)
        second = make_analysis(category='LK')
        payload = _zero_validation_payload([first, second])

        self.assertEqual(payload['total_validations'], 0)
        self.assertIn('note', payload)
        for key in AnalysisMetricsContractTests.REMOVED_KEYS:
            self.assertNotIn(key, payload)
        for key in AnalysisMetricsContractTests.KEPT_KEYS:
            self.assertIn(key, payload)
        self.assertAlmostEqual(payload['answer_similarity_t1_mean'], 0.6, places=4)
        self.assertEqual(payload['no_similarity_count'], 1)
        self.assertEqual(len(payload['by_model']), 1)
        row = payload['by_model'][0]
        self.assertIsNone(row['tier_agreement_accuracy'])       # no validations
        self.assertAlmostEqual(row['answer_similarity_t1_mean'], 0.6, places=4)

    def test_by_model_row_similarity_from_analyses_not_validations(self):
        analysis = make_analysis(sim_t1=0.7, sim_t3=0.8)
        row = _by_model_row('m1', [], [analysis])
        self.assertEqual(row['total_validations'], 0)
        self.assertIsNone(row['tier_agreement_accuracy'])
        self.assertAlmostEqual(row['answer_similarity_t1_mean'], 0.7, places=4)
        self.assertAlmostEqual(row['answer_similarity_t3_mean'], 0.8, places=4)
        self.assertEqual(row['answer_similarity_coverage'], 1.0)
        for key in AnalysisMetricsContractTests.REMOVED_KEYS:
            self.assertNotIn(key, row)


class ByModelPerModelKeysTests(SimpleTestCase):
    """C5F: each `by_model` row carries its OWN similarity + shadow agreement.

    The dev DB has a single `model_identifier`, so the per-model defect is
    invisible there. This test is the discriminating combination: two models
    with different numbers, and a third with no analyses. A row that pooled
    the other model's rows, or defaulted an empty agreement to 1.0, fails.
    """

    PER_MODEL_KEYS = (
        'answer_similarity_t1_mean', 'answer_similarity_t3_mean',
        'answer_similarity_coverage', 'verdict_agreement_rate',
        'verdict_comparable_count',
    )

    def _model_a(self):
        return [
            make_analysis(model_identifier='model-a', sim_t1=0.6, sim_t3=0.7,
                          llm_t1='BENAR', llm_t3='SALAH',
                          shadow={'rule_t1': 'BENAR', 'rule_t3': 'SALAH'}),
            make_analysis(model_identifier='model-a'),
        ]

    def _model_b(self):
        return [
            make_analysis(model_identifier='model-b', sim_t1=0.9, sim_t3=0.9,
                          llm_t1='SALAH', llm_t3='SALAH',
                          shadow={'rule_t1': 'BENAR', 'rule_t3': 'SALAH'}),
        ]

    def test_row_carries_new_keys_and_drops_removed_grounding_keys(self):
        row = _by_model_row('model-a', [], self._model_a())
        self.assertIn('model_identifier', row)
        for key in self.PER_MODEL_KEYS:
            self.assertIn(key, row)
        # C8: the superseded grounding keys are gone from the per-model row.
        for key in ('grounding_similarity_mean', 'citation_coverage',
                    'citation_validity_rate', 'hallucinated_citation_rate'):
            self.assertNotIn(key, row)

    def test_each_row_uses_only_its_own_model_analyses(self):
        a = _by_model_row('model-a', [], self._model_a())
        b = _by_model_row('model-b', [], self._model_b())
        # model-a: 1 of 2 rows has a similarity, 1 comparable sees agreement.
        self.assertAlmostEqual(a['answer_similarity_t1_mean'], 0.6, places=4)
        self.assertAlmostEqual(a['answer_similarity_t3_mean'], 0.7, places=4)
        self.assertEqual(a['answer_similarity_coverage'], 0.5)
        self.assertEqual(a['verdict_comparable_count'], 1)
        self.assertAlmostEqual(a['verdict_agreement_rate'], 1.0, places=4)
        # model-b: its own (different) numbers, not pooled with model-a.
        self.assertAlmostEqual(b['answer_similarity_t1_mean'], 0.9, places=4)
        self.assertAlmostEqual(b['answer_similarity_t3_mean'], 0.9, places=4)
        self.assertEqual(b['answer_similarity_coverage'], 1.0)
        self.assertEqual(b['verdict_comparable_count'], 1)
        self.assertAlmostEqual(b['verdict_agreement_rate'], 0.0, places=4)

    def test_model_with_no_analyses_is_null_not_zero_or_one(self):
        row = _by_model_row('ghost', [], [])
        self.assertIsNone(row['answer_similarity_t1_mean'])
        self.assertIsNone(row['answer_similarity_t3_mean'])
        self.assertIsNone(row['answer_similarity_coverage'])
        self.assertIsNone(row['verdict_agreement_rate'])   # never 0.0, never 1.0
        self.assertEqual(row['verdict_comparable_count'], 0)


class GroundingDetailShapeTests(SimpleTestCase):
    def test_references_kept_grounding_dropped(self):
        analysis = SimpleNamespace(
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
        # C8: `references` is the provenance of the reading material and stays;
        # the superseded grounding keys are gone.
        for key in ('grounding_similarity', 'grounding_payload', 'grounding'):
            self.assertNotIn(key, detail)

    def test_old_analysis_shape_is_stable(self):
        analysis = SimpleNamespace(suggested_materials_json=[])
        detail = _grounding_detail(analysis, {})
        self.assertEqual(detail['concept_breakdown_json'], {})
        self.assertEqual(detail['references'], [])
        self.assertEqual(detail['what_should_be_learned'], [])
        self.assertEqual(detail['suggested_materials'], [])
        for key in ('grounding_similarity', 'grounding_payload', 'grounding'):
            self.assertNotIn(key, detail)


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
        self.assertIsNone(payload['answer_similarity_t1_mean'])
        self.assertIsNone(payload['answer_similarity_t1_median'])
        self.assertIsNone(payload['answer_similarity_t3_mean'])
        self.assertIsNone(payload['answer_similarity_coverage'])
        self.assertEqual(payload['no_similarity_count'], 0)
        self.assertEqual(payload['answer_similarity_by_category'], {})
        self.assertEqual(payload['answer_similarity_by_prompt_version'], {})
        self.assertEqual(payload['verdict_comparable_count'], 0)
        self.assertIsNone(payload['verdict_agreement_rate'])
        for key in AnalysisMetricsContractTests.REMOVED_KEYS:
            self.assertNotIn(key, payload)
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
                patch('api.llm.run_module_b', return_value=('BENAR', [], [])):
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

        # C8/D17: student_feedback and Modul B reasoning are gone, and no new
        # row writes the grounding they used to feed.
        self.assertIsNone(params[16])            # grounding_similarity
        self.assertIsNone(params[17])            # grounding_similarity_max
        self.assertIsNone(params[18])            # grounding_citation_count
        self.assertEqual(json.loads(params[19]), {})   # grounding_payload_json
        breakdown = json.loads(params[5])
        self.assertNotIn('student_feedback', breakdown)
        self.assertNotIn('grounding', breakdown)
        self.assertEqual(breakdown['module_b'], {'score': 'BENAR'})

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

        module_b_return = (mod_b, [], [])
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


class AnswerSimilarityMetricsTests(SimpleTestCase):
    """C5: answer-similarity aggregates, always with their denominators."""

    def _rows(self):
        return [
            make_analysis(category='SC', prompt_version='four-tier-v2.9-rag',
                          sim_t1=0.5, sim_t3=0.6),
            make_analysis(category='SC', prompt_version='four-tier-v2.9-rag',
                          sim_t1=0.7, sim_t3=None),
            make_analysis(category='LK', prompt_version='four-tier-v3.0-llm',
                          sim_t1=None, sim_t3=0.8),
            make_analysis(category='LK', prompt_version='four-tier-v3.0-llm'),
        ]

    def test_means_medians_and_denominators(self):
        m = _answer_similarity_metrics(self._rows())
        self.assertAlmostEqual(m['answer_similarity_t1_mean'], 0.6, places=4)
        self.assertAlmostEqual(m['answer_similarity_t1_median'], 0.6, places=4)
        self.assertAlmostEqual(m['answer_similarity_t3_mean'], 0.7, places=4)
        self.assertAlmostEqual(m['answer_similarity_t3_median'], 0.7, places=4)
        # coverage is over answer_similarity_t1 (the primary tier).
        self.assertEqual(m['answer_similarity_coverage'], 0.5)
        self.assertEqual(m['no_similarity_count'], 2)

    def test_buckets_never_pool_prompt_versions(self):
        m = _answer_similarity_metrics(self._rows())
        by_cat = m['answer_similarity_by_category']
        self.assertEqual(by_cat['SC']['count'], 2)
        self.assertAlmostEqual(by_cat['SC']['t1_mean'], 0.6, places=4)
        self.assertAlmostEqual(by_cat['SC']['t3_mean'], 0.6, places=4)
        self.assertEqual(by_cat['LK']['count'], 1)
        self.assertIsNone(by_cat['LK']['t1_mean'])
        self.assertAlmostEqual(by_cat['LK']['t3_mean'], 0.8, places=4)

        by_pv = m['answer_similarity_by_prompt_version']
        self.assertEqual(set(by_pv), {'four-tier-v2.9-rag', 'four-tier-v3.0-llm'})
        self.assertEqual(by_pv['four-tier-v2.9-rag']['count'], 2)
        self.assertEqual(by_pv['four-tier-v3.0-llm']['count'], 1)

    def test_unlabelled_category_buckets_as_unknown(self):
        buckets = _bucket_similarities(
            [make_analysis(sim_t1=0.4)], lambda a: a.four_tier_category)
        self.assertEqual(buckets, {'UNKNOWN': {'count': 1, 't1_mean': 0.4, 't3_mean': None}})

    def test_empty_scope_is_none_and_zero_not_a_number(self):
        m = _answer_similarity_metrics([])
        self.assertIsNone(m['answer_similarity_t1_mean'])
        self.assertIsNone(m['answer_similarity_t1_median'])
        self.assertIsNone(m['answer_similarity_t3_mean'])
        self.assertIsNone(m['answer_similarity_t3_median'])
        self.assertIsNone(m['answer_similarity_coverage'])
        self.assertEqual(m['no_similarity_count'], 0)
        self.assertEqual(m['answer_similarity_by_category'], {})
        self.assertEqual(m['answer_similarity_by_prompt_version'], {})


class VerdictAgreementTests(SimpleTestCase):
    """C5: shadow-vs-LLM agreement is a diagnostic with an explicit denominator."""

    def test_no_shadow_is_null_rate_and_zero_comparable(self):
        m = _answer_similarity_metrics([make_analysis(), make_analysis()])
        self.assertEqual(m['verdict_comparable_count'], 0)
        self.assertEqual(m['verdict_disagreement_count'], 0)
        self.assertIsNone(m['verdict_agreement_rate'])   # not 0.0 and not 1.0

    def test_agreement_and_disagreement_counts(self):
        agree = make_analysis(
            llm_t1='BENAR', llm_t3='SALAH',
            shadow={'rule_t1': 'BENAR', 'rule_t3': 'SALAH', 'source': 'llm'})
        disagree = make_analysis(
            llm_t1='SALAH', llm_t3='SALAH',
            shadow={'rule_t1': 'BENAR', 'rule_t3': 'SALAH', 'source': 'llm'})
        m = _answer_similarity_metrics([agree, disagree, make_analysis()])
        self.assertEqual(m['verdict_comparable_count'], 2)
        self.assertEqual(m['verdict_disagreement_count'], 1)
        self.assertAlmostEqual(m['verdict_agreement_rate'], 0.5, places=4)

    def test_partial_verdict_is_not_comparable(self):
        partial = make_analysis(
            llm_t1='BENAR', llm_t3='BENAR',
            shadow={'rule_t1': 'BENAR', 'rule_t3': None})
        m = _answer_similarity_metrics([partial])
        self.assertEqual(m['verdict_comparable_count'], 0)
        self.assertIsNone(m['verdict_agreement_rate'])


class ReadingMaterialCountsTests(SimpleTestCase):
    """C5: reading-material status histogram, scoped to the analyses' versions."""

    def test_no_question_versions_is_all_zero_shape(self):
        counts = _reading_material_counts(set())
        self.assertEqual(counts, {'READY': 0, 'PENDING': 0, 'STALE': 0, 'FAILED': 0, 'total': 0})

    def test_status_histogram_scoped_to_versions(self):
        fake = MagicMock()
        fake.objects.filter.return_value.values.return_value.annotate.return_value = [
            {'status': 'READY', 'count': 1},
            {'status': 'FAILED', 'count': 1},
        ]
        with patch('api.validation_views.GeneratedReadingMaterial', fake):
            counts = _reading_material_counts({'qv-1'})
        self.assertEqual(counts, {'READY': 1, 'PENDING': 0, 'STALE': 0, 'FAILED': 1, 'total': 2})
        fake.objects.filter.assert_called_once_with(question_version_id__in={'qv-1'})


class ZeroValidationPayloadShapeTests(SimpleTestCase):
    """C8: the zero-validations payload keeps the C5 keys and drops the removed ones."""

    def test_zero_validation_payload_carries_kept_keys_only(self):
        payload = _zero_validation_payload([make_analysis(category='LK')])
        self.assertEqual(payload['total_validations'], 0)
        for key in AnalysisMetricsContractTests.REMOVED_KEYS:
            self.assertNotIn(key, payload)
        for key in AnalysisMetricsContractTests.KEPT_KEYS:
            self.assertIn(key, payload)
        self.assertIsNone(payload['answer_similarity_t1_mean'])
        self.assertEqual(payload['no_similarity_count'], 1)
        self.assertEqual(payload['verdict_comparable_count'], 0)
        self.assertIsNone(payload['verdict_agreement_rate'])
        self.assertEqual(
            payload['reading_material_counts'],
            {'READY': 0, 'PENDING': 0, 'STALE': 0, 'FAILED': 0, 'total': 0},
        )

    def test_bogus_model_is_null_zero_empty_shape(self):
        payload = _zero_validation_payload([], 'openai/does-not-exist')
        self.assertIsNone(payload['answer_similarity_t1_mean'])
        self.assertIsNone(payload['answer_similarity_t1_median'])
        self.assertIsNone(payload['answer_similarity_t3_mean'])
        self.assertIsNone(payload['answer_similarity_t3_median'])
        self.assertIsNone(payload['answer_similarity_coverage'])
        self.assertEqual(payload['no_similarity_count'], 0)
        self.assertEqual(payload['answer_similarity_by_category'], {})
        self.assertEqual(payload['answer_similarity_by_prompt_version'], {})
        self.assertEqual(payload['verdict_comparable_count'], 0)
        self.assertEqual(payload['verdict_disagreement_count'], 0)
        self.assertIsNone(payload['verdict_agreement_rate'])
        self.assertEqual(payload['reading_material_counts']['total'], 0)
        for key in AnalysisMetricsContractTests.REMOVED_KEYS:
            self.assertNotIn(key, payload)


class GroundingDetailAdditivityTests(SimpleTestCase):
    """C5: the detail block gains the similarity + shadow keys, shape-stable.

    C8: it also drops the superseded grounding keys (`grounding_similarity`,
    `grounding_payload`, nested `grounding`).
    """

    REMOVED_KEYS = ('grounding_similarity', 'grounding_payload', 'grounding')

    def test_pre_c5_row_still_exposes_new_keys_as_null(self):
        analysis = SimpleNamespace(suggested_materials_json=[])
        detail = _grounding_detail(analysis, {})
        for key in ('answer_similarity_t1', 'answer_similarity_t3',
                    'llm_t1_score', 'llm_t3_score'):
            self.assertIn(key, detail)
            self.assertIsNone(detail[key])
        self.assertEqual(detail['verdict_shadow'], {})
        for key in self.REMOVED_KEYS:
            self.assertNotIn(key, detail)

    def test_c5_row_exposes_similarity_verdict_and_shadow(self):
        analysis = SimpleNamespace(
            suggested_materials_json=[],
            answer_similarity_t1=Decimal('0.6000'),
            answer_similarity_t3=Decimal('0.7000'),
            llm_t1_score='BENAR',
            llm_t3_score='SALAH',
            verdict_shadow_json={'rule_t1': 'BENAR', 'rule_t3': 'SALAH'},
        )
        detail = _grounding_detail(analysis, {})
        self.assertAlmostEqual(detail['answer_similarity_t1'], 0.6, places=4)
        self.assertAlmostEqual(detail['answer_similarity_t3'], 0.7, places=4)
        self.assertEqual(detail['llm_t1_score'], 'BENAR')
        self.assertEqual(detail['llm_t3_score'], 'SALAH')
        self.assertEqual(detail['verdict_shadow'], {'rule_t1': 'BENAR', 'rule_t3': 'SALAH'})
        self.assertIn('concept_breakdown_json', detail)
        for key in self.REMOVED_KEYS:
            self.assertNotIn(key, detail)


class ReadingMaterialStalenessTests(SimpleTestCase):
    """C6/D18: staleness is a read-time sha256 compare, never a network call."""

    def _row(self, fingerprint, **over):
        base = dict(
            input_fingerprint=fingerprint,
            prompt_version='reading-material-v1.0',
            model_identifier='openai/gpt-oss-20b',
            category='MSC',
        )
        base.update(over)
        return SimpleNamespace(**base)

    def _ctx(self, short='A', reason='R'):
        return SimpleNamespace(
            question_prompt='Q', reference_short_answer=short, reference_reason=reason,
        )

    def test_matching_fingerprint_is_not_stale(self):
        fp = input_fingerprint('reading-material-v1.0', 'openai/gpt-oss-20b', 'qv-1',
                               'MSC', 'Q', 'A', 'R')
        with patch('api.validation_views.load_question_version_context', return_value=self._ctx()):
            stale, reason = _reading_material_staleness(self._row(fp), 'qv-1')
        self.assertFalse(stale)
        self.assertIsNone(reason)

    def test_changed_reference_flips_stale_with_reason(self):
        fp = input_fingerprint('reading-material-v1.0', 'openai/gpt-oss-20b', 'qv-1',
                               'MSC', 'Q', 'A', 'R')
        with patch('api.validation_views.load_question_version_context',
                   return_value=self._ctx(short='A2')):
            stale, reason = _reading_material_staleness(self._row(fp), 'qv-1')
        self.assertTrue(stale)
        self.assertIn('berubah', reason.lower())

    def test_changed_question_flips_stale(self):
        fp = input_fingerprint('reading-material-v1.0', 'openai/gpt-oss-20b', 'qv-1',
                               'MSC', 'Q', 'A', 'R')
        changed = SimpleNamespace(
            question_prompt='Q2', reference_short_answer='A', reference_reason='R',
        )
        with patch('api.validation_views.load_question_version_context', return_value=changed):
            stale, _ = _reading_material_staleness(self._row(fp), 'qv-1')
        self.assertTrue(stale)

    def test_null_fingerprint_is_not_stale(self):
        stale, reason = _reading_material_staleness(self._row(None), 'qv-1')
        self.assertFalse(stale)
        self.assertIsNone(reason)

    def test_missing_question_version_is_not_stale_and_never_raises(self):
        with patch('api.validation_views.load_question_version_context',
                   side_effect=ValueError('missing')):
            stale, reason = _reading_material_staleness(self._row('a' * 64), 'qv-1')
        self.assertFalse(stale)
        self.assertIsNone(reason)


class ReadingMaterialDetailTests(SimpleTestCase):
    """C6: the detail payload exposes the full reading-material key set or None."""

    def _analysis(self, qv='qv-1', category='MSC'):
        return SimpleNamespace(
            submission=SimpleNamespace(question_version_id=qv),
            four_tier_category=category,
        )

    def _row(self):
        return SimpleNamespace(
            id='mat-1', status='READY', content_md='# Materi',
            sources_json=[{'chunk_id': 'c1', 'document_title': 'Doc', 'page': 3}],
            grounded=True, ungrounded_source_count=0, input_fingerprint=None,
            review_status='UNREVIEWED', flag_note=None,
            prompt_version='reading-material-v1.0',
            model_identifier='openai/gpt-oss-20b', attempts=1,
        )

    def test_no_row_returns_none_and_queries_by_bucket(self):
        fake = MagicMock()
        fake.objects.filter.return_value.first.return_value = None
        with patch('api.validation_views.GeneratedReadingMaterial', fake):
            self.assertIsNone(_reading_material_detail(self._analysis()))
        fake.objects.filter.assert_called_once_with(question_version_id='qv-1', category='MSC')

    def test_row_exposes_full_key_set(self):
        fake = MagicMock()
        fake.objects.filter.return_value.first.return_value = self._row()
        with patch('api.validation_views.GeneratedReadingMaterial', fake):
            detail = _reading_material_detail(self._analysis())
        self.assertEqual(set(detail), {
            'id', 'status', 'content_md', 'sources', 'grounded',
            'ungrounded_source_count', 'stale', 'stale_reason', 'review_status',
            'flag_note', 'prompt_version', 'model_identifier', 'attempts',
        })
        self.assertEqual(detail['status'], 'READY')
        self.assertIsNone(detail['stale_reason'])
        self.assertFalse(detail['stale'])  # no stored fingerprint yet
        self.assertEqual(detail['sources'][0]['document_title'], 'Doc')

    def test_missing_category_is_none_without_query(self):
        fake = MagicMock()
        with patch('api.validation_views.GeneratedReadingMaterial', fake):
            self.assertIsNone(_reading_material_detail(self._analysis(category=None)))
        fake.objects.filter.assert_not_called()

    def test_sc_or_predrain_analysis_has_null_key_in_grounding_detail(self):
        analysis = SimpleNamespace(
            grounding_similarity=None, grounding_similarity_max=None,
            grounding_citation_count=None, grounding_payload_json={},
            suggested_materials_json=[],
        )
        detail = _grounding_detail(analysis, {})
        self.assertIn('reading_material', detail)
        self.assertIsNone(detail['reading_material'])


class ReadingMaterialFlagTests(SimpleTestCase):
    """C6/D14: flag is a review write — lecturer-gated, no edit surface."""

    def _request(self, note=None, user=None):
        return SimpleNamespace(
            data={} if note is None else {'note': note},
            user=user or SimpleNamespace(id='user-1', username='lect', is_superuser=False),
        )

    def test_missing_material_is_404(self):
        with patch('api.materials_views._material_subject_id', return_value=None):
            res = ReadingMaterialFlagView().post(self._request(), 'mat-1')
        self.assertEqual(res.status_code, 404)

    def test_non_lecturer_is_403(self):
        with patch('api.materials_views._material_subject_id', return_value='subj-1'), \
             patch('api.materials_views.is_lecturer_for_subject', return_value=False):
            res = ReadingMaterialFlagView().post(self._request(), 'mat-1')
        self.assertEqual(res.status_code, 403)

    def test_lecturer_flag_returns_updated_state(self):
        with patch('api.materials_views._material_subject_id', return_value='subj-1'), \
             patch('api.materials_views._flag_material_row',
                   return_value=('STALE', 'FLAGGED', 'bad', '2026-01-01', 2, 'qv-1', 'MSC')) as flag, \
             patch('api.materials_views.is_lecturer_for_subject', return_value=True):
            res = ReadingMaterialFlagView().post(self._request(note='bad'), 'mat-1')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'STALE')
        self.assertEqual(res.data['review_status'], 'FLAGGED')
        self.assertEqual(res.data['flag_note'], 'bad')
        self.assertEqual(res.data['category'], 'MSC')
        # Note recorded verbatim (no transformation) under the caller's id.
        flag.assert_called_once_with('mat-1', 'bad', 'user-1')

    def test_note_is_optional(self):
        with patch('api.materials_views._material_subject_id', return_value='subj-1'), \
             patch('api.materials_views._flag_material_row',
                   return_value=('STALE', 'FLAGGED', None, '2026-01-01', 1, 'qv-1', 'MSC')) as flag, \
             patch('api.materials_views.is_lecturer_for_subject', return_value=True):
            res = ReadingMaterialFlagView().post(self._request(), 'mat-1')
        self.assertEqual(res.status_code, 200)
        flag.assert_called_once_with('mat-1', None, 'user-1')

    def test_flag_sql_marks_stale_and_never_touches_content_md(self):
        import inspect

        from api.materials_views import _flag_material_row
        src = inspect.getsource(_flag_material_row)
        self.assertIn("status = 'STALE'", src)
        self.assertIn('flag_note = %s', src)
        self.assertNotIn('content_md', src)

    def test_flag_route_is_registered_without_content_md(self):
        from api.urls import urlpatterns
        patterns = [str(p.pattern) for p in urlpatterns]
        self.assertIn('materials/reading/<uuid:pk>/flag', patterns)


class StudentReadingMaterialTests(SimpleTestCase):
    """C7: the student surface gets material content only when it is READY.

    Extended: a row that EXISTS but is not READY yet reports its status, so the student
    can distinguish "being generated" from "no material by design" (SC / Benar / never
    enqueued), which all stay silent.
    """

    SOURCES = [{'chunk_id': 'c1', 'document_id': 'd1', 'document_title': 'Doc', 'page': 3}]

    def _fake(self, row):
        fake = MagicMock()
        fake.objects.filter.return_value.first.return_value = row
        return fake

    def _ready_row(self):
        return SimpleNamespace(status='READY', content_md='# Materi',
                               sources_json=self.SOURCES)

    def test_ready_returns_content_and_sources_only(self):
        fake = self._fake(self._ready_row())
        with patch('api.views.GeneratedReadingMaterial', fake):
            detail = _student_reading_material('qv-1', 'MSC')
        self.assertEqual(
            detail, {'status': 'READY', 'content_md': '# Materi', 'sources': self.SOURCES},
        )
        # No lecturer-only field leaks into the student block.
        self.assertEqual(set(detail), {'status', 'content_md', 'sources'})
        # The row is fetched by bucket and branched on in Python: filtering on
        # status='READY' in SQL is what made PENDING indistinguishable from absent.
        fake.objects.filter.assert_called_once_with(
            question_version_id='qv-1', category='MSC',
        )

    def test_pending_returns_a_status_stub_and_no_content(self):
        fake = self._fake(SimpleNamespace(status='PENDING', content_md=None,
                                          sources_json=[]))
        with patch('api.views.GeneratedReadingMaterial', fake):
            detail = _student_reading_material('qv-1', 'FN')
        self.assertEqual(detail, {'status': 'PENDING'})

    def test_stale_returns_a_status_stub(self):
        # A STALE row still holds its old text; the student is told it is being
        # refreshed rather than being served outdated remediation.
        fake = self._fake(SimpleNamespace(status='STALE', content_md='# lama',
                                          sources_json=self.SOURCES))
        with patch('api.views.GeneratedReadingMaterial', fake):
            self.assertEqual(_student_reading_material('qv-1', 'FN'), {'status': 'STALE'})

    def test_absent_row_returns_none(self):
        fake = self._fake(None)
        with patch('api.views.GeneratedReadingMaterial', fake):
            self.assertIsNone(_student_reading_material('qv-1', 'FN'))

    def test_failed_returns_none_not_a_placeholder(self):
        # FAILED is terminal, the student cannot act on it, and the lecturer queue
        # already shows it — so it stays silent rather than becoming a dead-end notice.
        fake = self._fake(SimpleNamespace(status='FAILED', content_md=None,
                                          sources_json=[]))
        with patch('api.views.GeneratedReadingMaterial', fake):
            self.assertIsNone(_student_reading_material('qv-1', 'FN'))

    def test_sc_returns_none_without_querying(self):
        fake = MagicMock()
        with patch('api.views.GeneratedReadingMaterial', fake):
            self.assertIsNone(_student_reading_material('qv-1', 'SC'))
        fake.objects.filter.assert_not_called()

    def test_missing_category_returns_none_without_querying(self):
        fake = MagicMock()
        with patch('api.views.GeneratedReadingMaterial', fake):
            self.assertIsNone(_student_reading_material('qv-1', None))
        fake.objects.filter.assert_not_called()

    def _analysis(self):
        return SimpleNamespace(
            suggested_materials_json=[],
            answer_similarity_t1=None, answer_similarity_t3=None,
            llm_t1_score=None, llm_t3_score=None, verdict_shadow_json={},
            four_tier_category='FN',
            submission=SimpleNamespace(question_version_id='qv-1'),
        )

    def test_student_detail_drops_lecturer_diagnostics(self):
        lecturer_material = MagicMock()
        lecturer_material.objects.filter.return_value.first.return_value = None
        student_material = MagicMock()
        student_material.objects.filter.return_value.first.return_value = None
        with patch('api.validation_views.GeneratedReadingMaterial', lecturer_material), \
             patch('api.views.GeneratedReadingMaterial', student_material):
            detail = _student_analysis_detail(self._analysis(), {}, 'qv-1')
        for key in _STUDENT_HIDDEN_ANALYSIS_KEYS:
            self.assertNotIn(key, detail, key)
        # C8: the grounding keys are gone; references/concept_breakdown and the
        # reading material (None here) remain.
        self.assertNotIn('grounding', detail)
        self.assertNotIn('grounding_similarity', detail)
        self.assertNotIn('grounding_payload', detail)
        self.assertIn('references', detail)
        self.assertIn('concept_breakdown_json', detail)
        self.assertIn('reading_material', detail)
        self.assertIsNone(detail['reading_material'])

    def test_student_detail_serves_ready_material(self):
        lecturer_material = MagicMock()
        lecturer_material.objects.filter.return_value.first.return_value = None
        student_material = MagicMock()
        student_material.objects.filter.return_value.first.return_value = self._ready_row()
        with patch('api.validation_views.GeneratedReadingMaterial', lecturer_material), \
             patch('api.views.GeneratedReadingMaterial', student_material):
            detail = _student_analysis_detail(self._analysis(), {}, 'qv-1')
        self.assertEqual(detail['reading_material']['content_md'], '# Materi')
        self.assertEqual(detail['reading_material']['sources'], self.SOURCES)
        for key in _STUDENT_HIDDEN_ANALYSIS_KEYS:
            self.assertNotIn(key, detail, key)


class LecturerCategoryTests(SimpleTestCase):
    """S1: level -> category mirrors the frontend and preserves FP vs MSC.

    `FP` and `MSC` both map to level 2, so a bare level->code map would silently
    rewrite a lecturer's FP into MSC. When the lecturer left the tier alone the
    AI's own category is kept.
    """

    def _analysis(self, tier_level=2, category='FP'):
        return SimpleNamespace(tier_level_snapshot=tier_level, four_tier_category=category)

    def test_none_level_is_none(self):
        self.assertIsNone(lecturer_category(self._analysis(), None))

    def test_unchanged_tier_keeps_the_ai_category(self):
        self.assertEqual(lecturer_category(self._analysis(2, 'FP'), 2), 'FP')
        self.assertEqual(lecturer_category(self._analysis(2, 'MSC'), 2), 'MSC')

    def test_changed_tier_maps_by_level(self):
        a = self._analysis(tier_level=3, category='FN')
        self.assertEqual(lecturer_category(a, 3), 'FN')   # equal -> AI category
        self.assertEqual(lecturer_category(a, 4), 'SC')
        self.assertEqual(lecturer_category(a, 2), 'MSC')
        self.assertEqual(lecturer_category(a, 1), 'LK')

    def test_unknown_level_is_none(self):
        self.assertIsNone(lecturer_category(self._analysis(3, 'FN'), 9))


class _FakeMaterialStore:
    """A stand-in Postgres for `enqueue_reading_material`'s INSERT.

    Only the ON CONFLICT guarantee is emulated: a repeated (question_version,
    category) insert is a no-op (rowcount 0), a fresh one counts 1. Lets the
    idempotency test drive the REAL enqueue helper without a database.
    """

    def __init__(self):
        self.rows = set()

    def cursor(self):
        return _FakeMaterialCursor(self)


class _FakeMaterialCursor:
    def __init__(self, store):
        self.store = store
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.rowcount = 0
        if 'INSERT INTO generated_reading_materials' in sql:
            key = (str(params[0]), params[1])
            if key not in self.store.rows:
                self.store.rows.add(key)
                self.rowcount = 1


def _hook_analysis(qv='qv-1', tier_level=3, category='FN'):
    """The `LlmAnalysis` the validation hook reads the AI category from."""
    return SimpleNamespace(
        id='ana-1',
        subject_id='subj-1',
        submission_id='sub-1',
        tier_level_snapshot=tier_level,
        four_tier_category=category,
        explanation='llm explanation',
        concept_breakdown_json={},
        submission=SimpleNamespace(
            status='PENDING_VALIDATION',
            question_version_id=qv,
            refresh_from_db=MagicMock(),
        ),
    )


def _hook_validation(**over):
    """A stored `Validation` row as the hook re-reads it after commit."""
    base = dict(
        id='val-1',
        status='ACCEPTED',
        final_percentage=Decimal('50.00'),
        final_tier_level_snapshot=2,
        original_percentage=Decimal('40.00'),
        original_tier_level_snapshot=3,
        original_tier_id='tier-3',
        # Migration 0031. NULL means "written before 0031" (or by a surface that only
        # edits a level), which is what the level->category fallback below still serves.
        final_category=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


class LecturerVerdictEnqueueTests(SimpleTestCase):
    """S1: the lecturer's verdict, not the LLM's, decides the enqueued category.

    DB-free like the rest of this module: the transaction, both raw-SQL branches
    and the re-read are stubbed. `enqueue_reading_material` is observed at the
    hook here; its own `PENDING` insert + ON CONFLICT guard are covered by
    `EnqueueReadingMaterialTests`, and the two are composed in
    `test_saving_the_same_salah_verdict_twice_leaves_one_row`.
    """

    def _run_post(self, data, analysis, validations, store=None, sql_error=None,
                  execute_side_effect=None):
        serializer = MagicMock()
        serializer.is_valid.return_value = True
        serializer.validated_data = data
        request = SimpleNamespace(
            user=SimpleNamespace(id='u-1', is_superuser=True), data={},
        )

        fake_conn = MagicMock()
        cursor = fake_conn.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = None
        if execute_side_effect is not None:
            cursor.execute.side_effect = execute_side_effect
        if sql_error is not None:
            fake_conn.cursor.side_effect = RuntimeError(sql_error)

        llm = MagicMock()
        llm.objects.filter.return_value.select_related.return_value.get.return_value = analysis

        validation = MagicMock()
        validation.objects.filter.return_value.first.side_effect = list(validations)

        enqueue = MagicMock()
        with ExitStack() as stack:
            stack.enter_context(patch(
                'api.validation_views.ValidationSubmitSerializer', return_value=serializer))
            stack.enter_context(patch('api.validation_views.LlmAnalysis', llm))
            stack.enter_context(patch('api.validation_views.Validation', validation))
            stack.enter_context(patch('api.validation_views.connection', fake_conn))
            stack.enter_context(patch('api.validation_views.transaction'))
            if store is not None:
                # Hook must call the REAL enqueue; only the DB engine is faked.
                stack.enter_context(patch('api.reading_materials.connection', store))
            else:
                stack.enter_context(patch(
                    'api.validation_views.enqueue_reading_material', enqueue))
            response = ValidationSubmitView().post(request, 'ana-1')
        return response, enqueue, store

    def _salah_data(self, **over):
        data = {
            'status': 'EDITED',
            'final_percentage': Decimal('50.00'),
            'final_tier_level': 3,
            'final_feedback': 'Perbaiki konsepnya.',
            'notes': None,
        }
        data.update(over)
        return data

    def test_salah_new_validation_enqueues_lecturer_category(self):
        analysis = _hook_analysis(tier_level=3, category='FN')
        row = _hook_validation(final_tier_level_snapshot=3)
        response, enqueue, _ = self._run_post(self._salah_data(), analysis, [None, row])
        self.assertEqual(response.status_code, 201)
        enqueue.assert_called_once_with('qv-1', 'FN')

    def test_salah_changed_tier_uses_the_lecturer_level_not_the_ai_category(self):
        # AI said FN (level 3); the lecturer overrides to level 2 -> MSC, not FN.
        analysis = _hook_analysis(tier_level=3, category='FN')
        row = _hook_validation(final_tier_level_snapshot=2)
        data = self._salah_data(final_tier_level=2)
        response, enqueue, _ = self._run_post(data, analysis, [None, row])
        self.assertEqual(response.status_code, 201)
        enqueue.assert_called_once_with('qv-1', 'MSC')

    def test_stored_final_category_wins_over_the_level(self):
        # Migration 0031. The AI said MSC and the lecturer corrected it to FP: both are
        # level 2, so final_tier_level is untouched and the level cannot tell them apart.
        # If the stored category did not decide, the correction would silently key an MSC
        # reading material for a student whose misconception is the opposite kind.
        analysis = _hook_analysis(tier_level=2, category='MSC')
        row = _hook_validation(final_tier_level_snapshot=2, final_category='FP')
        data = self._salah_data(final_tier_level=2, final_category='FP')
        response, enqueue, _ = self._run_post(data, analysis, [None, row])
        self.assertEqual(response.status_code, 201)
        enqueue.assert_called_once_with('qv-1', 'FP')

    def test_legacy_row_without_a_category_still_falls_back_to_the_level(self):
        # A validation written before 0031 has final_category NULL; the level->category
        # fallback must keep working for it, or every historical row would stop keying
        # a material at all.
        analysis = _hook_analysis(tier_level=2, category='MSC')
        row = _hook_validation(final_tier_level_snapshot=2, final_category=None)
        data = self._salah_data(final_tier_level=2)
        response, enqueue, _ = self._run_post(data, analysis, [None, row])
        self.assertEqual(response.status_code, 201)
        enqueue.assert_called_once_with('qv-1', 'MSC')

    def test_missing_category_procedure_falls_back_to_the_legacy_call(self):
        # The deploy window. deploy.sh runs `up -d --build` BEFORE `manage.py migrate`,
        # so for a few seconds the new code is serving against a database where the
        # 9-argument procedure does not exist yet. A lecturer's submit must degrade to
        # the 7-argument call instead of failing with a 500.
        from django.db import ProgrammingError

        analysis = _hook_analysis(tier_level=2, category='MSC')
        row = _hook_validation(final_tier_level_snapshot=2, final_category='FP')
        data = self._salah_data(final_tier_level=2, final_category='FP')

        calls = []

        def execute(sql, params=None):
            calls.append(sql)
            if len(calls) == 1:
                raise ProgrammingError(
                    'procedure sp_validate_analysis(...) does not exist')
            return None

        response, enqueue, _ = self._run_post(
            data, analysis, [None, row], execute_side_effect=execute)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(calls), 2, 'the fallback call must have been attempted')
        self.assertEqual(calls[0].count('%s'), 8, 'first attempt passes the category')
        self.assertEqual(calls[1].count('%s'), 7, 'fallback omits it')

    def test_benar_does_not_enqueue(self):
        analysis = _hook_analysis(tier_level=4, category='SC')
        row = _hook_validation(
            final_percentage=Decimal('100.00'), final_tier_level_snapshot=4)
        data = self._salah_data(
            status='ACCEPTED', final_percentage=Decimal('100.00'), final_tier_level=4)
        response, enqueue, _ = self._run_post(data, analysis, [None, row])
        self.assertEqual(response.status_code, 201)
        enqueue.assert_not_called()

    def test_rejected_does_not_enqueue(self):
        data = {'status': 'REJECTED', 'final_feedback': None}
        response, enqueue, _ = self._run_post(data, _hook_analysis(), [None])
        self.assertEqual(response.status_code, 201)
        enqueue.assert_not_called()

    def test_missing_validation_row_after_commit_does_not_enqueue(self):
        # The hook re-reads the row; if it is absent nothing is served.
        response, enqueue, _ = self._run_post(
            self._salah_data(), _hook_analysis(), [None, None])
        self.assertEqual(response.status_code, 201)
        enqueue.assert_not_called()

    def test_correction_mode_changing_to_salah_enqueues(self):
        existing = _hook_validation(final_tier_level_snapshot=3)
        row = _hook_validation(
            final_percentage=Decimal('30.00'), final_tier_level_snapshot=2)
        analysis = _hook_analysis(tier_level=3, category='FN')
        data = self._salah_data(
            final_percentage=Decimal('30.00'), final_tier_level=2)
        response, enqueue, _ = self._run_post(data, analysis, [existing, row])
        self.assertEqual(response.status_code, 201)
        enqueue.assert_called_once_with('qv-1', 'MSC')

    def test_saving_the_same_salah_verdict_twice_leaves_one_row(self):
        store = _FakeMaterialStore()
        analysis = _hook_analysis(tier_level=2, category='MSC')
        row = _hook_validation(final_tier_level_snapshot=2)
        data = self._salah_data(final_tier_level=2)
        for _ in range(2):
            response, _, _ = self._run_post(data, analysis, [None, row], store=store)
            self.assertEqual(response.status_code, 201)
        # The real enqueue ran on both saves; ON CONFLICT collapsed it to one row.
        self.assertEqual(store.rows, {('qv-1', 'MSC')})

    def test_rolled_back_validation_never_enqueues(self):
        # The SQL branch raises inside the atomic block -> 400 before the hook.
        response, enqueue, _ = self._run_post(
            self._salah_data(), _hook_analysis(), [None, _hook_validation()],
            sql_error='boom',
        )
        self.assertEqual(response.status_code, 400)
        enqueue.assert_not_called()


class _FakeMaterialTable:
    """A stand-in `GeneratedReadingMaterial` exposing only the READY-filtered read
    `_student_reading_material` performs."""

    def __init__(self, rows):
        self._rows = list(rows)
        self.objects = self

    def filter(self, **kwargs):
        rows = self._rows
        for key, value in kwargs.items():
            rows = [row for row in rows if getattr(row, key) == value]
        return _FakeMaterialQuery(rows)


class _FakeMaterialQuery:
    def __init__(self, rows):
        self._rows = rows

    def first(self):
        return self._rows[0] if self._rows else None


class StudentPackageReadingMaterialTests(SimpleTestCase):
    """S2: `_build_submission_package_groups` serves the material keyed by the
    LECTURER's verdict.

    The domain managers are stubbed (the models are `managed=False`), so the real
    branch and the real `_student_reading_material` run; the only fake with any
    behaviour is the material table, which honours the `status='READY'` filter.
    """

    SOURCES = [{'chunk_id': 'c1', 'document_id': 'd1', 'document_title': 'Doc', 'page': 3}]

    def _ready_row(self, **over):
        base = dict(
            question_version_id='qv-1', category='MSC', status='READY',
            content_md='# Materi', sources_json=self.SOURCES,
            review_status='UNREVIEWED', flagged_by=None, error=None,
            attempts=1, input_fingerprint='f' * 64,
        )
        base.update(over)
        return SimpleNamespace(**base)

    def _version(self):
        return SimpleNamespace(id='qv-1', version_number=1, prompt='P?',
                               short_answer='SA', model_answer='MA')

    def _package(self):
        return SimpleNamespace(
            id='pkg-1', code='PKG', title='Paket', subject_id='subj-1',
            subject=SimpleNamespace(name='Subject'),
            score_policy=ExamPackage.ScorePolicy.HIGHEST,
        )

    def _submission(self, status='VALIDATED'):
        return SimpleNamespace(
            id='sub-1', attempt_no=1, status=status,
            answer_text='jawaban', submitted_at=datetime(2026, 1, 1),
            exam_package_id='pkg-1', question_version_id='qv-1',
            tier1_answer='t1', tier2_confidence=5, tier3_reason='t3',
            tier4_confidence=5, heuristic_flags=[],
        )

    def _analysis(self, tier_level=2, category='MSC'):
        return SimpleNamespace(
            id='ana-1', submission_id='sub-1',
            percentage_correct=Decimal('0.00'),
            tier_level_snapshot=tier_level, tier_label_snapshot='Miskonsepsi',
            explanation='llm', module_c_code=None, four_tier_category=category,
            suggested_materials_json=[], module_a_score=1, module_b_score=0,
            risk_level='high',
        )

    def _validation(self, final_pct='0.00', final_tier=2):
        return SimpleNamespace(
            analysis_id='ana-1', final_percentage=Decimal(final_pct),
            is_score_modified=False, original_percentage=Decimal('0.00'),
            final_tier_level_snapshot=final_tier,
            final_tier_label_snapshot='Miskonsepsi', final_feedback='fb',
            lecturer=SimpleNamespace(full_name='Dosen'), validated_at=None,
        )

    def _run(self, submission, analysis, validation, material_rows=()):
        version = self._version()
        package = self._package()
        item = SimpleNamespace(
            exam_package_id='pkg-1', question_version_id='qv-1', question_id='q-1',
            order_index=0, question_version=version, exam_package=package,
        )
        sub_mgr = MagicMock()
        sub_mgr.objects.filter.return_value.order_by.return_value = [submission]
        item_mgr = MagicMock()
        item_mgr.objects.filter.return_value.select_related.return_value.order_by.return_value = [item]
        llm_mgr = MagicMock()
        llm_mgr.objects.filter.return_value = [analysis] if analysis else []
        val_mgr = MagicMock()
        val_mgr.objects.filter.return_value.select_related.return_value = (
            [validation] if validation else []
        )
        user = SimpleNamespace(id='stu-1')
        with patch('api.views.Submission', sub_mgr), \
                patch('api.views.ExamPackageQuestion', item_mgr), \
                patch('api.views.LlmAnalysis', llm_mgr), \
                patch('api.views.Validation', val_mgr), \
                patch('api.views.GeneratedReadingMaterial', _FakeMaterialTable(material_rows)):
            groups = _build_submission_package_groups(user)
        return groups

    def _evaluation(self, groups):
        return groups[0]['questions'][0]['attempts'][0]['evaluation']

    def test_validated_salah_serves_ready_material(self):
        groups = self._run(
            self._submission(), self._analysis(category='MSC'),
            self._validation(final_pct='0.00', final_tier=2), [self._ready_row()],
        )
        material = self._evaluation(groups)['reading_material']
        self.assertEqual(material['content_md'], '# Materi')
        self.assertEqual(material['sources'], self.SOURCES)

    def test_validated_benar_serves_nothing(self):
        groups = self._run(
            self._submission(), self._analysis(tier_level=4, category='SC'),
            self._validation(final_pct='100.00', final_tier=4),
            [self._ready_row(category='MSC')],
        )
        self.assertIsNone(self._evaluation(groups)['reading_material'])

    def test_validated_salah_non_ready_row_reports_it_is_generating(self):
        # The row exists but is not READY: the student is told it is on the way rather
        # than seeing nothing, which would be indistinguishable from "no material by
        # design" (SC / Benar / never enqueued).
        groups = self._run(
            self._submission(), self._analysis(category='MSC'),
            self._validation(final_pct='0.00', final_tier=2),
            [self._ready_row(status='PENDING')],
        )
        self.assertEqual(
            self._evaluation(groups)['reading_material'], {'status': 'PENDING'},
        )

    def test_validated_salah_level4_category_sc_serves_nothing(self):
        # Contradictory draft: score 0 yet the lecturer set level 4 -> SC, which
        # `_student_reading_material` refuses even though an MSC row is READY.
        groups = self._run(
            self._submission(), self._analysis(tier_level=2, category='MSC'),
            self._validation(final_pct='0.00', final_tier=4), [self._ready_row()],
        )
        self.assertIsNone(self._evaluation(groups)['reading_material'])

    def test_not_validated_has_no_evaluation_block(self):
        groups = self._run(
            self._submission(status='PENDING_VALIDATION'), self._analysis(),
            None, [self._ready_row()],
        )
        attempt = groups[0]['questions'][0]['attempts'][0]
        self.assertIsNone(attempt['evaluation'])
        self.assertNotIn('reading_material', attempt)

    def test_no_lecturer_only_field_leaks_into_the_material(self):
        groups = self._run(
            self._submission(), self._analysis(category='MSC'),
            self._validation(final_pct='0.00', final_tier=2), [self._ready_row()],
        )
        material = self._evaluation(groups)['reading_material']
        # `status` is student-facing (it is how "generating" is expressed); everything
        # lecturer-only stays out.
        self.assertEqual(set(material), {'status', 'content_md', 'sources'})
        for key in ('review_status', 'flagged_by', 'error', 'attempts', 'input_fingerprint',
                    'stale_reason', 'grounded', 'ungrounded_source_count'):
            self.assertNotIn(key, material)


class AnalysisRetryCapTests(SimpleTestCase):
    """Migration 0028 — a submission that keeps failing must not starve the queue.

    `_claim_next` accepts `status IN ('SUBMITTED','ANALYSIS_FAILED')`, but a failure
    at the LLM level writes NO `llm_analyses` row (sp_mark_submission_failed only
    flips the status and appends an audit row), so capping that branch by the
    analysis count left the cap inert: the row stayed claimable, and being the
    oldest it was re-claimed on every pass while later submissions were never
    touched.
    """

    def test_claim_caps_the_retry_branch_by_the_counter(self):
        import inspect

        from api.management.commands.analyze_submissions import Command
        src = inspect.getsource(Command._claim_next)
        self.assertIn('s.analysis_attempts < %s', src,
                      'the SUBMITTED/ANALYSIS_FAILED branch must be capped by the '
                      'retry counter, not by the analysis count')

    def test_fresh_work_sorts_before_retries(self):
        import inspect

        from api.management.commands.analyze_submissions import Command
        src = inspect.getsource(Command._claim_next)
        self.assertIn("ORDER BY (s.status = 'ANALYSIS_FAILED'), s.submitted_at", src,
                      'a failing row must not be the permanent head of the queue')

    def test_both_branches_bind_the_cap(self):
        import inspect

        from api.management.commands.analyze_submissions import Command
        src = inspect.getsource(Command._claim_next)
        self.assertIn('llm_analyses', src, 'the REJECTED branch still caps by analyses')
        self.assertEqual(src.count('%s'), 2,
                         'each capped branch binds max_runs')

    def test_failure_procedure_increments_the_counter(self):
        from pathlib import Path
        mig = (Path(__file__).resolve().parent / 'migrations'
               / '0028_submission_analysis_attempts.py')
        src = mig.read_text(encoding='utf-8')
        self.assertIn('analysis_attempts = analysis_attempts + 1', src,
                      'every failure path must count, including the zombie reaper')
        self.assertIn('ANALYSIS_FAILED', src,
                      'the queue index predicate must cover the retry status')
        self.assertIn('DROP COLUMN IF EXISTS analysis_attempts', src,
                      'the reverse must drop the column')
        self.assertIn('CREATE OR REPLACE PROCEDURE', src,
                      'the procedure is replaced in both directions')

    def test_submission_model_exposes_the_counter(self):
        from api.models import Submission
        field = Submission._meta.get_field('analysis_attempts')
        self.assertEqual(field.default, 0)
        self.assertFalse(field.null)
