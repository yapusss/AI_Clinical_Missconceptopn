import uuid
from datetime import timedelta
from pathlib import Path

from django.db import connection
from django.utils import timezone
from django.test import SimpleTestCase, TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient

from .models import (
    AuthToken,
    ConceptIndicator,
    ExamPackage,
    ExamPackageAttempt,
    ExamPackageQuestion,
    Question,
    QuestionSet,
    QuestionVersion,
    Subject,
    Submission,
    User,
    UserRole,
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
        UserRole.objects.create(user=self.student, role=UserRole.Role.STUDENT)
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
        self.exam_package = ExamPackage.objects.create(
            id=uuid.uuid4(),
            subject=self.subject,
            created_by=self.student,
            code=f'EXAM-{uuid.uuid4().hex[:8].upper()}',
            title='Paket Ujian Test',
            is_active=True,
        )
        ExamPackageQuestion.objects.create(
            id=uuid.uuid4(),
            exam_package=self.exam_package,
            question=self.question,
            question_version=self.version,
            order_index=1,
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
            'pk': self.exam_package.id, 'qid': self.question.id,
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

    def _submit_package(self, answers, user=None):
        if user is not None:
            self._auth(user)
        return self.client.post(
            reverse('student-package-submission-create', kwargs={'pk': self.exam_package.id}),
            {'answers': answers}, format='json',
        )

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
            'pk': self.exam_package.id, 'qid': draft_q.id,
        })
        resp = self.client.post(url, {'answer_text': 'Jawaban ke draft.'}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_submit_without_global_student_role_blocked(self):
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

    def test_package_submit_creates_all_published_question_submissions(self):
        self._auth(self.student)
        other_question, other_version = self._add_published_question()

        response = self._submit_package([
            {'question_id': str(self.question.id), 'answer_text': 'Jawaban soal pertama.'},
            {'question_id': str(other_question.id), 'answer_text': 'Jawaban soal kedua.'},
        ])

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(len(body['submissions']), 2)
        self.assertEqual(
            set(Submission.objects.filter(student=self.student).values_list('question_version_id', flat=True)),
            {self.version.id, other_version.id},
        )

    def test_package_submit_requires_every_published_question_and_is_atomic(self):
        self._auth(self.student)
        self._add_published_question()

        response = self._submit_package([
            {'question_id': str(self.question.id), 'answer_text': 'Hanya jawaban pertama.'},
        ])

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Submission.objects.filter(student=self.student).count(), 0)

    def test_lookup_without_global_student_role_blocked(self):
        self._auth(self.other)
        self.assertEqual(self._lookup().status_code, 403)

    def test_global_student_can_access_active_package_without_subject_assignment(self):
        UserRole.objects.create(user=self.other, role=UserRole.Role.STUDENT)
        self._auth(self.other)
        self.assertEqual(self._lookup().status_code, 200)
        self.assertEqual(self._submit(user=self.other).status_code, 201)

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

    def test_lecturer_review_includes_submitted_student_only(self):
        lecturer = User.objects.create(
            id=uuid.uuid4(),
            email=f'lecturer_{uuid.uuid4().hex[:8]}@acm.local',
            full_name='Lecturer Test',
            password_hash='!',
            is_active=True,
            is_superuser=False,
        )
        UserSubjectRole.objects.create(
            user=lecturer, subject=self.subject, role=UserSubjectRole.Role.LECTURER
        )
        UserRole.objects.create(user=lecturer, role=UserRole.Role.LECTURER)
        Submission.objects.create(
            id=uuid.uuid4(), student=self.student, subject=self.subject,
            question_version_id=self.version.id, answer_text='Jawaban paket.', attempt_no=1,
            status='SUBMITTED',
        )
        self._auth(lecturer)

        resp = self.client.get(reverse('question-set-review', kwargs={'pk': self.q_set.id}))

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['published_question_count'], 1)
        self.assertEqual(len(body['students']), 1)
        self.assertEqual(body['students'][0]['student_id'], str(self.student.id))
        self.assertEqual(body['roster_scope'], 'submitted_students')
        self.assertFalse(body['unsubmitted_roster_available'])
        self.assertEqual(body['students'][0]['answered_count'], 1)
        self.assertEqual(body['students'][0]['published_question_count'], 1)
        self.assertEqual(len(body['students'][0]['latest_submissions']), 1)

    def test_lecturer_package_student_review_includes_answers_and_unanswered_questions(self):
        lecturer = User.objects.create(
            id=uuid.uuid4(), email=f'lecturer_package_{uuid.uuid4().hex[:8]}@acm.local',
            full_name='Lecturer Package', password_hash='!', is_active=True, is_superuser=False,
        )
        UserSubjectRole.objects.create(
            user=lecturer, subject=self.subject, role=UserSubjectRole.Role.LECTURER
        )
        UserRole.objects.create(user=lecturer, role=UserRole.Role.LECTURER)
        self._add_published_question()
        submission = Submission.objects.create(
            id=uuid.uuid4(), student=self.student, subject=self.subject,
            question_version_id=self.version.id, answer_text='Jawaban paket.', attempt_no=1,
            status='ANALYSIS_FAILED',
        )
        self._auth(lecturer)

        response = self.client.get(reverse('question-set-student-review', kwargs={
            'pk': self.q_set.id, 'student_id': self.student.id,
        }))

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['package']['id'], str(self.q_set.id))
        self.assertEqual(body['student']['id'], str(self.student.id))
        self.assertEqual(body['published_question_count'], 2)
        self.assertEqual(body['answered_count'], 1)
        self.assertEqual(body['questions'][0]['submission']['id'], str(submission.id))
        self.assertEqual(body['questions'][0]['submission']['answer_text'], 'Jawaban paket.')
        self.assertEqual(body['questions'][0]['model_answer'], self.version.model_answer)
        self.assertNotIn('indicators', body['questions'][0])
        self.assertIsNone(body['questions'][0]['analysis'])
        self.assertEqual(body['questions'][1]['status'], 'UNANSWERED')
        self.assertIsNone(body['questions'][1]['submission'])

    def test_lecturer_package_student_review_is_scoped_to_assigned_subject(self):
        self._auth(self.other)
        response = self.client.get(reverse('question-set-student-review', kwargs={
            'pk': self.q_set.id, 'student_id': self.student.id,
        }))
        self.assertEqual(response.status_code, 403)

    def test_lecturer_submission_detail_returns_answer_without_analysis(self):
        lecturer = User.objects.create(
            id=uuid.uuid4(), email=f'lecturer_detail_{uuid.uuid4().hex[:8]}@acm.local',
            full_name='Lecturer Detail', password_hash='!', is_active=True, is_superuser=False,
        )
        UserSubjectRole.objects.create(
            user=lecturer, subject=self.subject, role=UserSubjectRole.Role.LECTURER
        )
        UserRole.objects.create(user=lecturer, role=UserRole.Role.LECTURER)
        submission = Submission.objects.create(
            id=uuid.uuid4(), student=self.student, subject=self.subject,
            question_version_id=self.version.id, answer_text='Jawaban tanpa analisis.',
            attempt_no=1, status='ANALYSIS_FAILED',
        )

        self._auth(lecturer)
        response = self.client.get(reverse('lecturer-submission-detail', kwargs={'pk': submission.id}))

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['id'], str(submission.id))
        self.assertEqual(body['answer_text'], 'Jawaban tanpa analisis.')
        self.assertEqual(body['question']['prompt'], self.version.prompt)
        self.assertEqual(body['question']['model_answer'], self.version.model_answer)
        self.assertNotIn('indicators', body['question'])
        self.assertEqual(body['current_analysis'], None)

    def test_lecturer_submission_detail_is_scoped_to_assigned_subject(self):
        submission = Submission.objects.create(
            id=uuid.uuid4(), student=self.student, subject=self.subject,
            question_version_id=self.version.id, answer_text='Jawaban privat.', attempt_no=1, status='SUBMITTED',
        )
        self._auth(self.other)

        response = self.client.get(reverse('lecturer-submission-detail', kwargs={'pk': submission.id}))

        self.assertEqual(response.status_code, 403)

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
        ExamPackageQuestion.objects.create(
            id=uuid.uuid4(),
            exam_package=self.exam_package,
            question=q,
            question_version=v,
            order_index=order_index,
        )
        return q, v

    def test_submission_packages_group_by_package(self):
        self._auth(self.student)
        self._add_published_question()
        self._submit('Jawaban pertama.')
        self._submit('Jawaban kedua.')

        resp = self.client.get(reverse('student-submission-package-list'))
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(len(body), 1)
        group = body[0]
        self.assertEqual(group['package_id'], str(self.exam_package.id))
        self.assertEqual(group['code'], self.exam_package.code)
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
            'pk': self.exam_package.id, 'qid': other_q.id,
        })
        self.client.post(url, {'answer_text': 'Jawaban soal dua.'}, format='json')

        Submission.objects.filter(question_version_id=self.version.id).update(
            status='PENDING_VALIDATION'
        )

        group = self.client.get(reverse('student-submission-package-list')).json()[0]
        self.assertEqual(group['status_summary'], 'MIXED')
        self.assertEqual(
            group['status_counts'], {'PENDING_VALIDATION': 1, 'SUBMITTED': 1}
        )
        self.assertEqual(group['answered_count'], 2)
        self.assertEqual(group['question_count'], 2)

    def test_submission_package_detail_endpoint(self):
        self._auth(self.student)
        self._submit('Jawaban untuk rincian.')
        url = reverse('student-submission-package-detail', kwargs={'pk': self.exam_package.id})
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['package_id'], str(self.exam_package.id))
        self.assertEqual(body['questions'][0]['attempts'][0]['answer_text'], 'Jawaban untuk rincian.')

        missing = reverse('student-submission-package-detail', kwargs={'pk': uuid.uuid4()})
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
        self.assertEqual(self.client.get(reverse('student-submission-package-list')).json(), [])

    def test_submission_packages_only_expose_selected_versions(self):
        self._auth(self.student)
        selected = [self.question]
        selected_versions = [self.version]
        for index in range(2, 11):
            question = Question.objects.create(
                id=uuid.uuid4(), question_set=self.q_set, order_index=index
            )
            version = QuestionVersion.objects.create(
                id=uuid.uuid4(), question=question, version_number=1,
                prompt=f'Pertanyaan {index}', model_answer='Referensi',
                is_published=True, created_by=self.student,
            )
            if index <= 3:
                ExamPackageQuestion.objects.create(
                    id=uuid.uuid4(), exam_package=self.exam_package,
                    question=question, question_version=version, order_index=index,
                )
                selected.append(question)
                selected_versions.append(version)
            elif index == 4:
                other_package = ExamPackage.objects.create(
                    id=uuid.uuid4(), subject=self.subject, created_by=self.student,
                    code=f'OTHER-{uuid.uuid4().hex[:8].upper()}', title='Paket Lain',
                    is_active=True,
                )
                ExamPackageQuestion.objects.create(
                    id=uuid.uuid4(), exam_package=other_package,
                    question=question, question_version=version, order_index=1,
                )
                other_question, other_version = question, version

        Submission.objects.create(
            id=uuid.uuid4(), student=self.student, subject=self.subject,
            exam_package=self.exam_package, question_version_id=selected_versions[0].id,
            answer_text='Jawaban paket utama.', attempt_no=1, status='SUBMITTED',
        )
        Submission.objects.create(
            id=uuid.uuid4(), student=self.student, subject=self.subject,
            exam_package=other_package, question_version_id=other_version.id,
            answer_text='Jawaban paket lain.', attempt_no=1, status='SUBMITTED',
        )

        groups = self.client.get(reverse('student-submission-package-list')).json()
        primary = next(group for group in groups if group['package_id'] == str(self.exam_package.id))
        self.assertEqual(primary['question_count'], 3)
        self.assertEqual(primary['answered_count'], 1)
        self.assertEqual(
            {question['question_id'] for question in primary['questions']},
            {str(question.id) for question in selected},
        )
        self.assertNotIn(str(other_question.id), {question['question_id'] for question in primary['questions']})

        detail = self.client.get(reverse(
            'student-submission-package-detail', kwargs={'pk': self.exam_package.id}
        ))
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()['question_count'], 3)
        self.assertNotIn(
            str(other_version.id),
            {question['version_id'] for question in detail.json()['questions']},
        )

    def test_student_lookup_rejects_closed_and_password_protected_packages(self):
        self.exam_package.closes_at = timezone.now() - timedelta(minutes=1)
        self.exam_package.save(update_fields=['closes_at'])
        self._auth(self.student)
        response = self.client.get(reverse('student-set-lookup'), {'code': self.exam_package.code})
        self.assertEqual(response.status_code, 403)

        self.exam_package.closes_at = None
        from django.contrib.auth.hashers import make_password
        self.exam_package.password_hash = make_password('rahasia')
        self.exam_package.save(update_fields=['closes_at', 'password_hash'])
        self.assertEqual(self.client.get(reverse('student-set-lookup'), {'code': self.exam_package.code}).status_code, 403)
        response = self.client.get(reverse('student-set-lookup'), {'code': self.exam_package.code, 'password': 'rahasia'})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('password_hash', response.json())

    def test_student_package_submission_enforces_attempt_limit(self):
        self.exam_package.max_attempts = 1
        self.exam_package.save(update_fields=['max_attempts'])
        self._auth(self.student)
        answers = [{'question_id': str(self.question.id), 'tier1_answer': 'Kesimpulan', 'tier2_confidence': 4, 'tier3_reason': 'Alasan lengkap', 'tier4_confidence': 4}]
        self.assertEqual(self._submit_package(answers).status_code, 201)
        self.assertEqual(self._submit_package(answers).status_code, 403)
        self.assertEqual(ExamPackageAttempt.objects.filter(exam_package=self.exam_package, student=self.student, submitted_at__isnull=False).count(), 1)


class ExamPackageDuplicateTests(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass('public.users')")
            if cursor.fetchone()[0] is None:
                cursor.execute(V2_SQL.read_text(encoding='utf-8'))

    def setUp(self):
        self.client = APIClient()
        self.subject = Subject.objects.create(id=uuid.uuid4(), name='Duplicate Subject', slug=f'duplicate-{uuid.uuid4().hex}', description='')
        self.lecturer = User.objects.create(id=uuid.uuid4(), email=f'duplicate-lecturer-{uuid.uuid4().hex}@test.local', full_name='Lecturer', password_hash='!', is_active=True)
        UserSubjectRole.objects.create(user=self.lecturer, subject=self.subject, role=UserSubjectRole.Role.LECTURER)
        question_set = QuestionSet.objects.create(id=uuid.uuid4(), subject=self.subject, created_by=self.lecturer, code=f'BANK-{uuid.uuid4().hex[:8].upper()}', title='Bank', is_active=True)
        self.question = Question.objects.create(id=uuid.uuid4(), question_set=question_set, order_index=1)
        self.version = QuestionVersion.objects.create(id=uuid.uuid4(), question=self.question, version_number=1, prompt='Prompt', model_answer='Answer', is_published=True, created_by=self.lecturer)
        self.package = ExamPackage.objects.create(
            id=uuid.uuid4(), subject=self.subject, created_by=self.lecturer,
            code='DUPLICATE-PACKAGE', title='Paket Asli', description='Deskripsi asli', is_active=True,
            opens_at=timezone.now(), closes_at=timezone.now() + timedelta(hours=1),
            duration_minutes=45, max_attempts=2, score_policy=ExamPackage.ScorePolicy.HIGHEST,
            password_hash='stored-password-hash',
        )
        ExamPackage.objects.create(
            id=uuid.uuid4(), subject=self.subject, created_by=self.lecturer,
            code='DUPLICATE-PACKAGE-COPY', title='Kode yang sudah dipakai',
        )
        ExamPackageQuestion.objects.create(id=uuid.uuid4(), exam_package=self.package, question=self.question, question_version=self.version, order_index=3)
        self.student = User.objects.create(id=uuid.uuid4(), email=f'duplicate-student-{uuid.uuid4().hex}@test.local', full_name='Student', password_hash='!', is_active=True)
        ExamPackageAttempt.objects.create(id=uuid.uuid4(), exam_package=self.package, student=self.student, attempt_number=1)
        Submission.objects.create(id=uuid.uuid4(), student=self.student, subject=self.subject, exam_package=self.package, question_version_id=self.version.id, answer_text='Jawaban asli', attempt_no=1, status='SUBMITTED')
        token = AuthToken.generate(self.lecturer)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token.key}')

    def test_duplicate_copies_settings_and_selected_versions_as_draft(self):
        response = self.client.post(reverse('exam-package-duplicate', kwargs={'pk': self.package.id}))

        self.assertEqual(response.status_code, 201)
        body = response.json()
        duplicate = ExamPackage.objects.get(pk=body['id'])
        self.assertFalse(duplicate.is_active)
        self.assertNotEqual(duplicate.code.upper(), self.package.code.upper())
        self.assertLessEqual(len(duplicate.code), 64)
        self.assertEqual(ExamPackage.objects.filter(code__iexact=duplicate.code).count(), 1)
        self.assertEqual(duplicate.title, self.package.title)
        self.assertEqual(duplicate.description, self.package.description)
        self.assertEqual(duplicate.opens_at, self.package.opens_at)
        self.assertEqual(duplicate.closes_at, self.package.closes_at)
        self.assertEqual(duplicate.duration_minutes, self.package.duration_minutes)
        self.assertEqual(duplicate.max_attempts, self.package.max_attempts)
        self.assertEqual(duplicate.score_policy, self.package.score_policy)
        self.assertEqual(duplicate.password_hash, self.package.password_hash)
        item = ExamPackageQuestion.objects.get(exam_package=duplicate)
        self.assertEqual(item.question_id, self.question.id)
        self.assertEqual(item.question_version_id, self.version.id)
        self.assertEqual(item.order_index, 3)
        self.assertTrue(ExamPackageAttempt.objects.filter(exam_package=self.package).exists())
        self.assertTrue(Submission.objects.filter(exam_package=self.package).exists())
        self.assertFalse(ExamPackageAttempt.objects.filter(exam_package=duplicate).exists())
        self.assertFalse(Submission.objects.filter(exam_package=duplicate).exists())
        self.assertNotIn('password_hash', body)


class ExamPackageReviewScopingTests(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass('public.users')")
            if cursor.fetchone()[0] is None:
                cursor.execute(V2_SQL.read_text(encoding='utf-8'))

    def setUp(self):
        self.client = APIClient()
        self.subject = Subject.objects.create(id=uuid.uuid4(), name='Review Subject', slug=f'review-{uuid.uuid4().hex}', description='')
        self.lecturer = User.objects.create(id=uuid.uuid4(), email=f'lecturer-{uuid.uuid4().hex}@test.local', full_name='Lecturer', password_hash='!', is_active=True)
        UserSubjectRole.objects.create(user=self.lecturer, subject=self.subject, role=UserSubjectRole.Role.LECTURER)
        self.student = User.objects.create(id=uuid.uuid4(), email=f'student-{uuid.uuid4().hex}@test.local', full_name='Included Student', password_hash='!', is_active=True)
        self.other_student = User.objects.create(id=uuid.uuid4(), email=f'other-{uuid.uuid4().hex}@test.local', full_name='Other Student', password_hash='!', is_active=True)
        for student in (self.student, self.other_student):
            UserRole.objects.create(user=student, role=UserRole.Role.STUDENT)
        question_set = QuestionSet.objects.create(id=uuid.uuid4(), subject=self.subject, created_by=self.lecturer, code=f'BANK-{uuid.uuid4().hex}', title='Bank', is_active=True)
        self.package_question, self.package_version = self._question(question_set, 1)
        self.other_question, self.other_version = self._question(question_set, 2)
        self.package = self._package('PACKAGE-A', self.package_question, self.package_version)
        self.other_package = self._package('PACKAGE-B', self.other_question, self.other_version)
        Submission.objects.create(id=uuid.uuid4(), student=self.student, subject=self.subject, question_version_id=self.package_version.id, answer_text='In package', status='SUBMITTED', attempt_no=1)
        Submission.objects.create(id=uuid.uuid4(), student=self.other_student, subject=self.subject, question_version_id=self.other_version.id, answer_text='Other package', status='SUBMITTED', attempt_no=1)
        token = AuthToken.generate(self.lecturer)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token.key}')

    def _question(self, question_set, order_index):
        question = Question.objects.create(id=uuid.uuid4(), question_set=question_set, order_index=order_index)
        version = QuestionVersion.objects.create(id=uuid.uuid4(), question=question, version_number=1, prompt=f'Prompt {order_index}', model_answer='Answer', is_published=True, created_by=self.lecturer)
        return question, version

    def _package(self, prefix, question, version):
        package = ExamPackage.objects.create(id=uuid.uuid4(), subject=self.subject, created_by=self.lecturer, code=f'{prefix}-{uuid.uuid4().hex[:8]}', title=prefix, is_active=True)
        ExamPackageQuestion.objects.create(id=uuid.uuid4(), exam_package=package, question=question, question_version=version, order_index=1)
        return package

    def test_review_list_excludes_students_from_other_packages(self):
        response = self.client.get(reverse('exam-package-review', kwargs={'pk': self.package.id}))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual([student['student_id'] for student in body['students']], [str(self.student.id)])
        self.assertEqual(body['students'][0]['all_submissions'][0]['question_id'], str(self.package_question.id))

    def test_student_review_rejects_student_without_submission_in_package(self):
        response = self.client.get(reverse('exam-package-student-review', kwargs={'pk': self.package.id, 'student_id': self.other_student.id}))
        self.assertEqual(response.status_code, 404)

    def test_student_review_contains_only_requested_package_versions(self):
        response = self.client.get(reverse('exam-package-student-review', kwargs={'pk': self.package.id, 'student_id': self.student.id}))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual([question['version_id'] for question in body['questions']], [str(self.package_version.id)])
        self.assertEqual(body['questions'][0]['attempts'][0]['answer_text'], 'In package')


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
