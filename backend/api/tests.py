import uuid
from pathlib import Path

from django.db import connection
from django.test import SimpleTestCase, TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient

from .models import (
    AuthToken,
    ConceptIndicator,
    Question,
    QuestionSet,
    QuestionVersion,
    Subject,
    Submission,
    User,
    UserSubjectRole,
)

# Domain schema is unmanaged (managed=False): Django migrations do NOT own it,
# so bootstrap the test DB from the canonical V2 script before any test runs.
V2_SQL = Path(__file__).resolve().parent.parent.parent / 'V2_Full_Script.sql'


class StudentSubmissionAPITests(TransactionTestCase):
    """Sprint 3: student flow (UC-01 / P3) — code lookup, submit via
    sp_submit_conceptual_answer, submission list."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass('public.users')")
            if cursor.fetchone()[0] is None:
                with connection.cursor() as cur:
                    cur.execute(V2_SQL.read_text(encoding='utf-8'))

    def setUp(self):
        self.client = APIClient()
        self.subject = Subject.objects.create(
            id=uuid.uuid4(),
            name=f'Physics Test {uuid.uuid4().hex[:8]}',
            slug=f'physics-{uuid.uuid4().hex[:8]}',
            description='',
        )
        self.student = User.objects.create(
            id=uuid.uuid4(),
            email=f'student_{uuid.uuid4().hex[:8]}@acm.local',
            full_name='Student Test',
            password_hash='!',
            is_active=True,
            is_superuser=False,
        )
        self.other = User.objects.create(
            id=uuid.uuid4(),
            email=f'other_{uuid.uuid4().hex[:8]}@acm.local',
            full_name='Other Test',
            password_hash='!',
            is_active=True,
            is_superuser=False,
        )
        UserSubjectRole.objects.create(
            user=self.student, subject=self.subject, role=UserSubjectRole.Role.STUDENT
        )
        self.q_set = QuestionSet.objects.create(
            id=uuid.uuid4(),
            subject=self.subject,
            created_by=self.student,
            code=f'SET-{uuid.uuid4().hex[:8].upper()}',
            title='Set Test',
            description='',
            is_active=True,
        )
        self.question = Question.objects.create(
            id=uuid.uuid4(), question_set=self.q_set, order_index=1
        )
        self.version = QuestionVersion.objects.create(
            id=uuid.uuid4(),
            question=self.question,
            version_number=1,
            prompt='Pertanyaan konseptual test?',
            model_answer='Jawaban referensi',
            is_published=True,
            created_by=self.student,
        )
        ConceptIndicator.objects.create(
            id=uuid.uuid4(),
            question_version=self.version,
            label='Ketepatan Konsep',
            description='',
            weight='0.5000',
            order_index=1,
        )

    # ------------------------------------------------------------------ helpers

    def _auth(self, user):
        token = AuthToken.generate(user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token.key}')

    def _lookup(self, code=None):
        if code is None:
            code = self.q_set.code
        url = reverse('student-set-lookup')
        return self.client.get(url, {'code': code})

    def _submit(self, answer='Jawaban test mahasiswa', user=None):
        if user is not None:
            self._auth(user)
        url = reverse('student-submission-create', kwargs={
            'pk': self.q_set.id, 'qid': self.question.id,
        })
        return self.client.post(url, {'answer_text': answer}, format='json')

    def _make_draft_question(self):
        q = Question.objects.create(
            id=uuid.uuid4(), question_set=self.q_set, order_index=2
        )
        v = QuestionVersion.objects.create(
            id=uuid.uuid4(),
            question=q,
            version_number=1,
            prompt='Pertanyaan draft?',
            model_answer='Referensi',
            is_published=False,
            created_by=self.student,
        )
        return q, v

    # ------------------------------------------------------------------ lookup

    def test_lookup_success(self):
        self._auth(self.student)
        resp = self._lookup()
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['code'], self.q_set.code)
        self.assertEqual(len(body['questions']), 1)
        q = body['questions'][0]
        self.assertEqual(q['question_id'], str(self.question.id))
        self.assertEqual(q['version_id'], str(self.version.id))
        self.assertEqual(q['prompt'], 'Pertanyaan konseptual test?')
        self.assertIsNone(q['latest_submission'])

    def test_lookup_missing_code(self):
        self._auth(self.student)
        resp = self._lookup(code='TIDAK-ADA')
        self.assertEqual(resp.status_code, 404)

    def test_lookup_inactive_set_returns_404(self):
        self._auth(self.student)
        self.q_set.is_active = False
        self.q_set.save(update_fields=['is_active'])
        resp = self._lookup()
        self.assertEqual(resp.status_code, 404)

    def test_lookup_only_published_versions(self):
        self._auth(self.student)
        draft_q, draft_v = self._make_draft_question()
        resp = self._lookup()
        body = resp.json()
        ids = [q['question_id'] for q in body['questions']]
        self.assertIn(str(self.question.id), ids)
        self.assertNotIn(str(draft_q.id), ids)

    # ------------------------------------------------------------------ submit

    def test_submit_success(self):
        self._auth(self.student)
        resp = self._submit('Gaya normal lebih besar dari gaya berat.')
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body['status'], 'SUBMITTED')
        self.assertEqual(body['attempt_no'], 1)
        self.assertEqual(body['question_version_id'], str(self.version.id))
        sub = Submission.objects.get(pk=body['submission_id'])
        self.assertEqual(sub.status, 'SUBMITTED')
        self.assertEqual(sub.attempt_no, 1)
        self.assertEqual(sub.subject_id, self.subject.id)
        self.assertEqual(sub.question_version_id, self.version.id)

    def test_submit_increments_attempt(self):
        self._auth(self.student)
        first = self._submit('Jawaban pertama.').json()
        second = self._submit('Jawaban kedua.').json()
        self.assertEqual(first['attempt_no'], 1)
        self.assertEqual(second['attempt_no'], 2)
        self.assertNotEqual(first['submission_id'], second['submission_id'])

    def test_submit_draft_version_blocked(self):
        self._auth(self.student)
        draft_q, draft_v = self._make_draft_question()
        url = reverse('student-submission-create', kwargs={
            'pk': self.q_set.id, 'qid': draft_q.id,
        })
        resp = self.client.post(url, {'answer_text': 'Jawaban ke draft.'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_submit_not_enrolled_blocked(self):
        self._auth(self.other)
        resp = self._submit()
        self.assertEqual(resp.status_code, 403)

    def test_submit_empty_answer_blocked(self):
        self._auth(self.student)
        resp = self._submit(answer='   ')
        self.assertEqual(resp.status_code, 400)

    def test_submit_answer_too_long_blocked(self):
        self._auth(self.student)
        resp = self._submit(answer='a' * 20001)
        self.assertEqual(resp.status_code, 400)

    def test_submit_unknown_set_404(self):
        self._auth(self.student)
        url = reverse('student-submission-create', kwargs={
            'pk': uuid.uuid4(), 'qid': self.question.id,
        })
        resp = self.client.post(url, {'answer_text': 'Jawaban.'}, format='json')
        self.assertEqual(resp.status_code, 404)

    # ------------------------------------------------------------------ list

    def test_submission_list(self):
        self._auth(self.student)
        self._submit('Jawaban untuk daftar.')
        resp = self.client.get(reverse('student-submission-list'))
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]['status'], 'SUBMITTED')
        self.assertEqual(body[0]['attempt_no'], 1)
        self.assertEqual(body[0]['set_code'], self.q_set.code)
        self.assertEqual(body[0]['set_title'], 'Set Test')
        self.assertEqual(body[0]['answer_text'], 'Jawaban untuk daftar.')
        self.assertEqual(body[0]['subject_name'], self.subject.name)
        self.assertEqual(body[0]['subject_id'], str(self.subject.id))
        self.assertEqual(body[0]['set_id'], str(self.q_set.id))
        self.assertIn('question_prompt', body[0])

    def test_submission_list_scoped_to_student(self):
        self._auth(self.student)
        self._submit('Milik student.')
        other = User.objects.create(
            id=uuid.uuid4(),
            email=f'student_lain_{uuid.uuid4().hex[:8]}@acm.local',
            full_name='Student Lain',
            password_hash='!',
            is_active=True,
            is_superuser=False,
        )
        UserSubjectRole.objects.create(
            user=other, subject=self.subject, role=UserSubjectRole.Role.STUDENT
        )
        self._auth(other)
        resp = self.client.get(reverse('student-submission-list'))
        self.assertEqual(resp.json(), [])

    # ------------------------------------------------------------------ lookup after submit

    def test_lookup_shows_latest_submission(self):
        self._auth(self.student)
        self._submit('Jawaban pertama.')
        self._submit('Jawaban kedua.')
        resp = self._lookup()
        q = resp.json()['questions'][0]
        self.assertIsNotNone(q['latest_submission'])
        self.assertEqual(q['latest_submission']['attempt_no'], 2)
        self.assertEqual(q['latest_submission']['status'], 'SUBMITTED')

    # ------------------------------------------------------ set-level grouping

    def _add_published_question(self, order_index=2, prompt='Pertanyaan kedua?', weight='1.0000'):
        q = Question.objects.create(
            id=uuid.uuid4(), question_set=self.q_set, order_index=order_index
        )
        v = QuestionVersion.objects.create(
            id=uuid.uuid4(),
            question=q,
            version_number=1,
            prompt=prompt,
            model_answer='Referensi',
            is_published=True,
            created_by=self.student,
        )
        ConceptIndicator.objects.create(
            id=uuid.uuid4(),
            question_version=v,
            label='Indikator',
            description='',
            weight=weight,
            order_index=1,
        )
        return q, v

    def test_submission_sets_group_by_set(self):
        self._auth(self.student)
        self._add_published_question()
        self._submit('Jawaban pertama.')
        self._submit('Jawaban kedua.')

        resp = self.client.get(reverse('student-submission-set-list'))
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(len(body), 1)
        group = body[0]
        self.assertEqual(group['set_id'], str(self.q_set.id))
        self.assertEqual(group['code'], self.q_set.code)
        self.assertEqual(group['subject_name'], self.subject.name)
        self.assertEqual(group['question_count'], 2)
        self.assertEqual(group['answered_count'], 1)
        self.assertEqual(group['total_attempts'], 2)
        self.assertEqual(group['max_attempt_no'], 2)
        self.assertEqual(group['status_summary'], 'SUBMITTED')
        self.assertEqual(group['status_counts'], {'SUBMITTED': 2})

        questions = group['questions']
        self.assertEqual(len(questions), 2)
        self.assertEqual([q['order_index'] for q in questions], [1, 2])
        answered_q, unanswered_q = questions
        self.assertTrue(answered_q['answered'])
        self.assertEqual([a['attempt_no'] for a in answered_q['attempts']], [1, 2])
        self.assertEqual(answered_q['attempts'][0]['answer_text'], 'Jawaban pertama.')
        self.assertIsNone(answered_q['attempts'][0]['evaluation'])
        self.assertFalse(unanswered_q['answered'])
        self.assertEqual(unanswered_q['attempts'], [])
        self.assertEqual(unanswered_q['prompt'], 'Pertanyaan kedua?')

    def test_submission_set_mixed_status(self):
        self._auth(self.student)
        other_q, _ = self._add_published_question()
        self._submit('Jawaban soal satu.')
        url = reverse('student-submission-create', kwargs={
            'pk': self.q_set.id, 'qid': other_q.id,
        })
        self.client.post(url, {'answer_text': 'Jawaban soal dua.'}, format='json')

        Submission.objects.filter(question_version_id=self.version.id).update(
            status='PENDING_VALIDATION'
        )

        group = self.client.get(reverse('student-submission-set-list')).json()[0]
        self.assertEqual(group['status_summary'], 'MIXED')
        self.assertEqual(
            group['status_counts'], {'PENDING_VALIDATION': 1, 'SUBMITTED': 1}
        )
        self.assertEqual(group['answered_count'], 2)
        self.assertEqual(group['question_count'], 2)

    def test_submission_set_detail_endpoint(self):
        self._auth(self.student)
        self._submit('Jawaban untuk rincian.')
        url = reverse('student-submission-set-detail', kwargs={'pk': self.q_set.id})
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['set_id'], str(self.q_set.id))
        self.assertEqual(body['questions'][0]['attempts'][0]['answer_text'], 'Jawaban untuk rincian.')

        missing = reverse('student-submission-set-detail', kwargs={'pk': uuid.uuid4()})
        self.assertEqual(self.client.get(missing).status_code, 404)

    def test_submission_set_list_scoped_to_student(self):
        self._auth(self.student)
        self._submit('Milik student.')
        other = User.objects.create(
            id=uuid.uuid4(),
            email=f'student_set_{uuid.uuid4().hex[:8]}@acm.local',
            full_name='Student Set Lain',
            password_hash='!',
            is_active=True,
            is_superuser=False,
        )
        UserSubjectRole.objects.create(
            user=other, subject=self.subject, role=UserSubjectRole.Role.STUDENT
        )
        self._auth(other)
        self.assertEqual(self.client.get(reverse('student-submission-set-list')).json(), [])


class DomainSchemaInvariantTests(SimpleTestCase):
    """The domain schema is owned by V2_Full_Script.sql, not by Django.

    Every domain model must carry managed=False. If one loses it, Django starts
    emitting real DDL (CREATE TABLE / FKs) against tables V2 already owns - which
    breaks `migrate` on a fresh deploy and in the test-database bootstrap.
    Only AuthToken is Django-managed on purpose.
    """

    def test_domain_models_stay_unmanaged(self):
        from django.apps import apps as django_apps

        config = django_apps.get_app_config('api')
        managed = sorted(m.__name__ for m in config.get_models() if m._meta.managed)
        self.assertEqual(
            managed,
            ['AuthToken'],
            'Only AuthToken may be Django-managed; domain models must stay managed=False',
        )
