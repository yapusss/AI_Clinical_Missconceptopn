"""R3 tests — reference retrieval, citation validation, grounding math, zero-chunk path.

These tests are deliberately DB-free. Pure helpers are exercised directly, and
the pipeline test monkeypatches `load_context`, retrieval, the three modules and
`connection`, so nothing touches the shared dev DB or the network. Run with:

    venv/Scripts/python.exe manage.py test api.tests_reference_materials -v 2
"""

import json
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
