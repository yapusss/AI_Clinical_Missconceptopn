import uuid
from decimal import Decimal
from django.db import connection, transaction
from django.db.models import Avg, Count, Q, Sum
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import TokenAuthentication
from .models import (
    AuthToken,
    ConceptIndicator,     
    LlmAnalysis,
    Misconception,
    Question,             
    QuestionSet,
    QuestionVersion,      
    Subject,
    Submission,
    Topic,                
    User,
    UserSubjectRole,
    Validation,
)
from .serializers import (
    LoginSerializer,
    QuestionSetCreateSerializer,  
    QuestionSetUpdateSerializer,  
    RegisterSerializer,
    SubmissionCreateSerializer,
    UserSerializer,
)


class RegisterView(APIView):
    authentication_classes = []

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token = AuthToken.generate(user)
        return Response({
            'token': token.key,
            'user': UserSerializer(user).data,
        }, status=status.HTTP_201_CREATED)


class LoginView(APIView):
    authentication_classes = []

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        token = AuthToken.generate(user)
        return Response({
            'token': token.key,
            'user': UserSerializer(user).data,
        })


class MeView(APIView):
    authentication_classes = [TokenAuthentication]

    def get(self, request):
        data = UserSerializer(request.user).data
        data['roles'] = self._roles(request.user)
        return Response(data)

    def post(self, request):
        AuthToken.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @staticmethod
    def _roles(user):
        qs = UserSubjectRole.objects.filter(user=user).select_related('subject')
        return [
            {
                'role': r.role,
                'subject_slug': r.subject.slug,
                'subject_name': r.subject.name,
            }
            for r in qs
        ]


class DashboardView(APIView):
    authentication_classes = [TokenAuthentication]

    def get(self, request):
        user = request.user
        role_rows = UserSubjectRole.objects.filter(user=user).select_related('subject')
        roles = [
            {'role': r.role, 'subject_slug': r.subject.slug, 'subject_name': r.subject.name}
            for r in role_rows
        ]
        role_set = {r['role'] for r in roles}

        summary = {
            'my_subjects': [
                {
                    'id': str(r.subject.id),
                    'slug': r.subject.slug,
                    'name': r.subject.name,
                }
                for r in role_rows
            ],
        }

        my_subjects_ids = [r.subject_id for r in role_rows]

        if user.is_superuser:
            summary.update({
                'total_users': User.objects.count(),
                'total_subjects': Subject.objects.count(),
                'total_question_sets': QuestionSet.objects.count(),
                'total_submissions': Submission.objects.count(),
                'total_misconceptions': Misconception.objects.count(),
                'total_analyses': LlmAnalysis.objects.count(),
                'total_validations': Validation.objects.count(),
            })

        if 'STUDENT' in role_set or user.is_superuser:
            mine = Submission.objects.filter(student=user)
            avg = LlmAnalysis.objects.filter(
                submission__student=user, is_current=True,
            ).aggregate(avg=Avg('percentage_correct'))['avg']
            summary.update({
                'my_submissions': mine.count(),
                'my_analyzed': mine.filter(status='ANALYZING').count(),
                'my_validated': mine.filter(status__in=['VALIDATED', 'PENDING_VALIDATION']).count(),
                'my_avg_score': round(float(avg), 2) if avg is not None else None,
            })

        if 'LECTURER' in role_set or user.is_superuser:
            in_scope = Q(subject_id__in=my_subjects_ids) if my_subjects_ids else Q()
            summary.update({
                'my_question_sets': QuestionSet.objects.filter(created_by=user).count(),
                'subject_question_sets': QuestionSet.objects.filter(in_scope).count(),
                'subject_submissions': Submission.objects.filter(in_scope).count(),
                'pending_validations': Submission.objects.filter(
                    in_scope & Q(status='PENDING_VALIDATION')
                ).count(),
            })

        return Response({
            'roles': roles,
            'is_superuser': user.is_superuser,
            'summary': summary,
        })


# ============================================================================
# SPRINT 2: QUESTION BANK VIEWS (LECTURER)
# ============================================================================

def is_lecturer_for_subject(user, subject_id):
    if user.is_superuser:
        return True
    return UserSubjectRole.objects.filter(
        user=user, subject_id=subject_id, role=UserSubjectRole.Role.LECTURER
    ).exists()


class QuestionListCreateView(APIView):
    authentication_classes = [TokenAuthentication]

    def get(self, request):
        user = request.user
        subject_id = request.query_params.get('subject_id')

        if user.is_superuser:
            qs = QuestionSet.objects.all()
        else:
            lecturer_subjects = UserSubjectRole.objects.filter(
                user=user, role=UserSubjectRole.Role.LECTURER
            ).values_list('subject_id', flat=True)
            qs = QuestionSet.objects.filter(subject_id__in=lecturer_subjects)

        if subject_id:
            qs = qs.filter(subject_id=subject_id)

        qs = qs.select_related('subject', 'created_by').order_by('-created_at')

        results = []
        for item in qs:
            set_questions = list(Question.objects.filter(question_set=item).order_by('order_index'))
            version_data = []
            for question in set_questions:
                v = QuestionVersion.objects.filter(question=question).order_by('-version_number').first()
                if v:
                    version_data.append({
                        'id': str(v.id),
                        'question_id': str(question.id),
                        'order_index': question.order_index,
                        'version_number': v.version_number,
                        'prompt_preview': v.prompt[:160] + ('...' if len(v.prompt) > 160 else ''),
                        'is_published': v.is_published,
                    })

            results.append({
                'id': str(item.id),
                'code': item.code,
                'title': item.title,
                'description': item.description or '',
                'subject_id': str(item.subject_id),
                'subject_name': item.subject.name,
                'is_active': item.is_active,
                'created_by_name': item.created_by.full_name,
                'created_at': item.created_at,
                'question_count': len(set_questions),
                'latest_versions': version_data,
                'latest_version': version_data[0] if version_data else None,
            })

        return Response(results)

    def post(self, request):
        serializer = QuestionSetCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        subject_id = data['subject_id']
        if not is_lecturer_for_subject(request.user, subject_id):
            return Response(
                {'detail': 'Anda tidak berwenang menambahkan soal pada mata kuliah ini.'},
                status=status.HTTP_403_FORBIDDEN
            )

        code = data['code']
        if QuestionSet.objects.filter(code__iexact=code).exists():
            return Response(
                {'code': ['Kode soal sudah digunakan. Gunakan kode unik lainnya.']},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            q_set = QuestionSet.objects.create(
                id=uuid.uuid4(),
                subject_id=subject_id,
                topic_id=data.get('topic_id'),
                created_by=request.user,
                code=code,
                title=data['title'],
                description=data.get('description', ''),
                is_active=True,
            )

            question_payloads = data.get('questions') or [{
                'prompt': data['prompt'],
                'model_answer': data['model_answer'],
                'indicators': data.get('indicators', []),
            }]
            created_versions = []
            for order_index, question_data in enumerate(question_payloads, start=1):
                q = Question.objects.create(id=uuid.uuid4(), question_set=q_set, order_index=order_index)
                qv = QuestionVersion.objects.create(
                    id=uuid.uuid4(), question=q, version_number=1,
                    prompt=question_data['prompt'], model_answer=question_data['model_answer'],
                    is_published=False, created_by=request.user,
                )
                for indicator_index, ind in enumerate(question_data.get('indicators', []), start=1):
                    ConceptIndicator.objects.create(
                        id=uuid.uuid4(), question_version=qv,
                        label=ind['label'], description=ind.get('description', ''),
                        weight=ind['weight'], order_index=indicator_index,
                    )
                created_versions.append(qv)

            if data.get('publish', False):
                for qv in created_versions:
                    with connection.cursor() as cursor:
                        cursor.execute("CALL sp_publish_question_version(%s, %s);", [str(qv.id), str(request.user.id)])
                    qv.refresh_from_db()

        return Response({
            'id': str(q_set.id),
            'code': q_set.code,
            'title': q_set.title,
            'question_count': len(created_versions),
            'version_ids': [str(version.id) for version in created_versions],
            'is_published': all(version.is_published for version in created_versions),
            'is_active': q_set.is_active,
            'message': 'Soal berhasil disimpan.',
        }, status=status.HTTP_201_CREATED)


class QuestionDetailView(APIView):
    authentication_classes = [TokenAuthentication]

    def get(self, request, pk):
        try:
            q_set = QuestionSet.objects.select_related('subject', 'created_by').get(pk=pk)
        except QuestionSet.DoesNotExist:
            return Response({'detail': 'Soal tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_lecturer_for_subject(request.user, q_set.subject_id):
            return Response({'detail': 'Anda tidak berwenang mengakses soal ini.'}, status=status.HTTP_403_FORBIDDEN)

        questions = []
        for question in Question.objects.filter(question_set=q_set).order_by('order_index'):
            versions = []
            for version in QuestionVersion.objects.filter(question=question).order_by('-version_number'):
                indicators = ConceptIndicator.objects.filter(question_version=version).order_by('order_index')
                versions.append({
                    'id': str(version.id),
                    'version_number': version.version_number,
                    'prompt': version.prompt,
                    'model_answer': version.model_answer,
                    'is_published': version.is_published,
                    'created_at': version.created_at,
                    'indicators': [
                        {
                            'id': str(indicator.id),
                            'label': indicator.label,
                            'description': indicator.description or '',
                            'weight': str(indicator.weight),
                            'order_index': indicator.order_index,
                        }
                        for indicator in indicators
                    ],
                })
            questions.append({
                'id': str(question.id),
                'order_index': question.order_index,
                'versions': versions,
            })

        return Response({
            'id': str(q_set.id),
            'code': q_set.code,
            'title': q_set.title,
            'description': q_set.description or '',
            'subject_id': str(q_set.subject_id),
            'subject_name': q_set.subject.name,
            'is_active': q_set.is_active,
            'created_at': q_set.created_at,
            'questions': questions,
        })

    def put(self, request, pk):
        try:
            q_set = QuestionSet.objects.get(pk=pk)
        except QuestionSet.DoesNotExist:
            return Response({'detail': 'Soal tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_lecturer_for_subject(request.user, q_set.subject_id):
            return Response({'detail': 'Anda tidak berwenang mengubah soal ini.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = QuestionSetUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            if 'title' in data:
                q_set.title = data['title']
            if 'description' in data:
                q_set.description = data['description']
            q_set.save()

            q = Question.objects.filter(question_set=q_set).order_by('order_index').first()
            if not q:
                q = Question.objects.create(id=uuid.uuid4(), question_set=q_set, order_index=1)

            latest_v = QuestionVersion.objects.filter(question=q).order_by('-version_number').first()

            prompt = data.get('prompt', latest_v.prompt if latest_v else "")
            model_answer = data.get('model_answer', latest_v.model_answer if latest_v else "")

            if latest_v and latest_v.is_published:
                new_v_id = uuid.uuid4()
                next_version = latest_v.version_number + 1
                target_v = QuestionVersion.objects.create(
                    id=new_v_id,
                    question=q,
                    version_number=next_version,
                    prompt=prompt,
                    model_answer=model_answer,
                    is_published=False,
                    created_by=request.user,
                )
            elif latest_v:
                latest_v.prompt = prompt
                latest_v.model_answer = model_answer
                latest_v.save()
                target_v = latest_v
            else:
                target_v = QuestionVersion.objects.create(
                    id=uuid.uuid4(),
                    question=q,
                    version_number=1,
                    prompt=prompt,
                    model_answer=model_answer,
                    is_published=False,
                    created_by=request.user,
                )

            if 'indicators' in data:
                ConceptIndicator.objects.filter(question_version=target_v).delete()
                for idx, ind in enumerate(data['indicators'], start=1):
                    ConceptIndicator.objects.create(
                        id=uuid.uuid4(),
                        question_version=target_v,
                        label=ind['label'],
                        description=ind.get('description', ''),
                        weight=ind['weight'],
                        order_index=idx,
                    )

            if data.get('publish', False) and not target_v.is_published:
                with connection.cursor() as cursor:
                    cursor.execute("CALL sp_publish_question_version(%s, %s);", [str(target_v.id), str(request.user.id)])
                target_v.refresh_from_db()

        return Response({'detail': 'Soal berhasil diperbarui.'})


class QuestionToggleActiveView(APIView):
    authentication_classes = [TokenAuthentication]

    def patch(self, request, pk):
        try:
            q_set = QuestionSet.objects.get(pk=pk)
        except QuestionSet.DoesNotExist:
            return Response({'detail': 'Soal tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_lecturer_for_subject(request.user, q_set.subject_id):
            return Response({'detail': 'Anda tidak berwenang mengelola status soal ini.'}, status=status.HTTP_403_FORBIDDEN)

        q_set.is_active = not q_set.is_active
        q_set.save(update_fields=['is_active', 'updated_at'])

        status_text = "diaktifkan" if q_set.is_active else "dinonaktifkan"
        return Response({
            'id': str(q_set.id),
            'is_active': q_set.is_active,
            'message': f'Soal berhasil {status_text}.'
        })


class QuestionSetPublishView(APIView):
    authentication_classes = [TokenAuthentication]

    def post(self, request, pk):
        try:
            q_set = QuestionSet.objects.get(pk=pk)
        except QuestionSet.DoesNotExist:
            return Response({'detail': 'Paket ujian tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_lecturer_for_subject(request.user, q_set.subject_id):
            return Response({'detail': 'Anda tidak berwenang menerbitkan paket ini.'}, status=status.HTTP_403_FORBIDDEN)

        questions = list(Question.objects.filter(question_set=q_set).order_by('order_index'))
        if not questions:
            return Response({'detail': 'Paket harus memiliki minimal satu pertanyaan.'}, status=status.HTTP_400_BAD_REQUEST)

        versions = []
        for question in questions:
            version = QuestionVersion.objects.filter(question=question).order_by('-version_number').first()
            if not version:
                return Response({'detail': f'Pertanyaan ke-{question.order_index} belum memiliki versi.'}, status=status.HTTP_400_BAD_REQUEST)
            total_weight = ConceptIndicator.objects.filter(question_version=version).aggregate(total=Sum('weight'))['total'] or Decimal('0')
            if abs(total_weight - Decimal('1.0000')) > Decimal('0.0001'):
                return Response({'detail': f'Bobot indikator pertanyaan ke-{question.order_index} harus tepat 1.0000.'}, status=status.HTTP_400_BAD_REQUEST)
            versions.append(version)

        try:
            with transaction.atomic():
                for version in versions:
                    if not version.is_published:
                        with connection.cursor() as cursor:
                            cursor.execute("CALL sp_publish_question_version(%s, %s);", [str(version.id), str(request.user.id)])
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'id': str(q_set.id),
            'code': q_set.code,
            'question_count': len(versions),
            'is_published': True,
            'message': 'Paket ujian berhasil diterbitkan.',
        })


class QuestionPublishView(APIView):
    authentication_classes = [TokenAuthentication]

    def post(self, request, version_id):
        try:
            qv = QuestionVersion.objects.select_related('question__question_set').get(pk=version_id)
        except QuestionVersion.DoesNotExist:
            return Response({'detail': 'Versi soal tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        subject_id = qv.question.question_set.subject_id
        if not is_lecturer_for_subject(request.user, subject_id):
            return Response({'detail': 'Anda tidak berwenang mempublikasikan soal ini.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            with connection.cursor() as cursor:
                cursor.execute("CALL sp_publish_question_version(%s, %s);", [str(qv.id), str(request.user.id)])
            qv.refresh_from_db()
            return Response({'detail': 'Versi soal berhasil dipublikasikan.', 'is_published': qv.is_published})
        except Exception as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

def is_lecturer_for_subject(user, subject_id):
    if user.is_superuser:
        return True
    return UserSubjectRole.objects.filter(
        user=user, subject_id=subject_id, role=UserSubjectRole.Role.LECTURER
    ).exists()


class QuestionListCreateView(APIView):
    authentication_classes = [TokenAuthentication]

    def get(self, request):
        user = request.user
        subject_id = request.query_params.get('subject_id')

        if user.is_superuser:
            qs = QuestionSet.objects.all()
        else:
            lecturer_subjects = UserSubjectRole.objects.filter(
                user=user, role=UserSubjectRole.Role.LECTURER
            ).values_list('subject_id', flat=True)
            qs = QuestionSet.objects.filter(subject_id__in=lecturer_subjects)

        if subject_id:
            qs = qs.filter(subject_id=subject_id)

        qs = qs.select_related('subject', 'created_by').order_by('-created_at')

        results = []
        for item in qs:
            first_q = Question.objects.filter(question_set=item).order_by('order_index').first()
            version_data = None
            if first_q:
                v = QuestionVersion.objects.filter(question=first_q).order_by('-version_number').first()
                if v:
                    version_data = {
                        'id': str(v.id),
                        'version_number': v.version_number,
                        'prompt_preview': v.prompt[:160] + ('...' if len(v.prompt) > 160 else ''),
                        'is_published': v.is_published,
                    }

            results.append({
                'id': str(item.id),
                'code': item.code,
                'title': item.title,
                'description': item.description or '',
                'subject_id': str(item.subject_id),
                'subject_name': item.subject.name,
                'is_active': item.is_active,
                'created_by_name': item.created_by.full_name,
                'created_at': item.created_at,
                'latest_version': version_data,
            })

        return Response(results)

    def post(self, request):
        serializer = QuestionSetCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        subject_id = data['subject_id']
        if not is_lecturer_for_subject(request.user, subject_id):
            return Response(
                {'detail': 'Anda tidak berwenang menambahkan soal pada mata kuliah ini.'},
                status=status.HTTP_403_FORBIDDEN
            )

        code = data['code']
        if QuestionSet.objects.filter(code__iexact=code).exists():
            return Response(
                {'code': ['Kode soal sudah digunakan. Gunakan kode unik lainnya.']},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            q_set = QuestionSet.objects.create(
                id=uuid.uuid4(),
                subject_id=subject_id,
                topic_id=data.get('topic_id'),
                created_by=request.user,
                code=code,
                title=data['title'],
                description=data.get('description', ''),
                is_active=True,
            )

            q = Question.objects.create(
                id=uuid.uuid4(),
                question_set=q_set,
                order_index=1,
            )

            qv = QuestionVersion.objects.create(
                id=uuid.uuid4(),
                question=q,
                version_number=1,
                prompt=data['prompt'],
                model_answer=data['model_answer'],
                is_published=False,
                created_by=request.user,
            )

            indicators_data = data.get('indicators', [])
            for idx, ind in enumerate(indicators_data, start=1):
                ConceptIndicator.objects.create(
                    id=uuid.uuid4(),
                    question_version=qv,
                    label=ind['label'],
                    description=ind.get('description', ''),
                    weight=ind['weight'],
                    order_index=idx,
                )

            if data.get('publish', False):
                with connection.cursor() as cursor:
                    cursor.execute("CALL sp_publish_question_version(%s, %s);", [str(qv.id), str(request.user.id)])
                qv.refresh_from_db()

        return Response({
            'id': str(q_set.id),
            'code': q_set.code,
            'title': q_set.title,
            'version_id': str(qv.id),
            'is_published': qv.is_published,
            'is_active': q_set.is_active,
            'message': 'Soal berhasil disimpan.',
        }, status=status.HTTP_201_CREATED)


class QuestionDetailView(APIView):
    authentication_classes = [TokenAuthentication]

    def get(self, request, pk):
        try:
            q_set = QuestionSet.objects.select_related('subject', 'created_by').get(pk=pk)
        except QuestionSet.DoesNotExist:
            return Response({'detail': 'Soal tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_lecturer_for_subject(request.user, q_set.subject_id):
            return Response({'detail': 'Anda tidak berwenang mengakses soal ini.'}, status=status.HTTP_403_FORBIDDEN)

        q = Question.objects.filter(question_set=q_set).order_by('order_index').first()
        versions = []
        if q:
            all_v = QuestionVersion.objects.filter(question=q).order_by('-version_number')
            for v in all_v:
                inds = ConceptIndicator.objects.filter(question_version=v).order_by('order_index')
                versions.append({
                    'id': str(v.id),
                    'version_number': v.version_number,
                    'prompt': v.prompt,
                    'model_answer': v.model_answer,
                    'is_published': v.is_published,
                    'created_at': v.created_at,
                    'indicators': [
                        {
                            'id': str(i.id),
                            'label': i.label,
                            'description': i.description or '',
                            'weight': str(i.weight),
                            'order_index': i.order_index,
                        }
                        for i in inds
                    ]
                })

        return Response({
            'id': str(q_set.id),
            'code': q_set.code,
            'title': q_set.title,
            'description': q_set.description or '',
            'subject_id': str(q_set.subject_id),
            'subject_name': q_set.subject.name,
            'is_active': q_set.is_active,
            'created_at': q_set.created_at,
            'versions': versions,
        })

    def put(self, request, pk):
        try:
            q_set = QuestionSet.objects.get(pk=pk)
        except QuestionSet.DoesNotExist:
            return Response({'detail': 'Soal tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_lecturer_for_subject(request.user, q_set.subject_id):
            return Response({'detail': 'Anda tidak berwenang mengubah soal ini.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = QuestionSetUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            if 'title' in data:
                q_set.title = data['title']
            if 'description' in data:
                q_set.description = data['description']
            q_set.save()

            q = Question.objects.filter(question_set=q_set).order_by('order_index').first()
            if not q:
                q = Question.objects.create(id=uuid.uuid4(), question_set=q_set, order_index=1)

            latest_v = QuestionVersion.objects.filter(question=q).order_by('-version_number').first()

            prompt = data.get('prompt', latest_v.prompt if latest_v else "")
            model_answer = data.get('model_answer', latest_v.model_answer if latest_v else "")

            if latest_v and latest_v.is_published:
                new_v_id = uuid.uuid4()
                next_version = latest_v.version_number + 1
                target_v = QuestionVersion.objects.create(
                    id=new_v_id,
                    question=q,
                    version_number=next_version,
                    prompt=prompt,
                    model_answer=model_answer,
                    is_published=False,
                    created_by=request.user,
                )
            elif latest_v:
                latest_v.prompt = prompt
                latest_v.model_answer = model_answer
                latest_v.save()
                target_v = latest_v
            else:
                target_v = QuestionVersion.objects.create(
                    id=uuid.uuid4(),
                    question=q,
                    version_number=1,
                    prompt=prompt,
                    model_answer=model_answer,
                    is_published=False,
                    created_by=request.user,
                )

            if 'indicators' in data:
                ConceptIndicator.objects.filter(question_version=target_v).delete()
                for idx, ind in enumerate(data['indicators'], start=1):
                    ConceptIndicator.objects.create(
                        id=uuid.uuid4(),
                        question_version=target_v,
                        label=ind['label'],
                        description=ind.get('description', ''),
                        weight=ind['weight'],
                        order_index=ind.get('order_index', idx),
                    )

            if data.get('publish', False) and not target_v.is_published:
                with connection.cursor() as cursor:
                    cursor.execute("CALL sp_publish_question_version(%s, %s);", [str(target_v.id), str(request.user.id)])
                target_v.refresh_from_db()

        return Response({'detail': 'Soal berhasil diperbarui.'})


class QuestionToggleActiveView(APIView):
    authentication_classes = [TokenAuthentication]

    def patch(self, request, pk):
        try:
            q_set = QuestionSet.objects.get(pk=pk)
        except QuestionSet.DoesNotExist:
            return Response({'detail': 'Soal tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        if not is_lecturer_for_subject(request.user, q_set.subject_id):
            return Response({'detail': 'Anda tidak berwenang mengelola status soal ini.'}, status=status.HTTP_403_FORBIDDEN)

        q_set.is_active = not q_set.is_active
        q_set.save(update_fields=['is_active', 'updated_at'])

        status_text = "diaktifkan" if q_set.is_active else "dinonaktifkan"
        return Response({
            'id': str(q_set.id),
            'is_active': q_set.is_active,
            'message': f'Soal berhasil {status_text}.'
        })


class QuestionPublishView(APIView):
    authentication_classes = [TokenAuthentication]

    def post(self, request, version_id):
        try:
            qv = QuestionVersion.objects.select_related('question__question_set').get(pk=version_id)
        except QuestionVersion.DoesNotExist:
            return Response({'detail': 'Versi soal tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        subject_id = qv.question.question_set.subject_id
        if not is_lecturer_for_subject(request.user, subject_id):
            return Response({'detail': 'Anda tidak berwenang mempublikasikan soal ini.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            with connection.cursor() as cursor:
                cursor.execute("CALL sp_publish_question_version(%s, %s);", [str(qv.id), str(request.user.id)])
            qv.refresh_from_db()
            return Response({'detail': 'Versi soal berhasil dipublikasikan.', 'is_published': qv.is_published})
        except Exception as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
# ============================================================================
# SPRINT 3: STUDENT SUBMISSION API (UC-01 / P3)
# ============================================================================

def is_student_for_subject(user, subject_id):
    if user.is_superuser:
        return True
    return UserSubjectRole.objects.filter(
        user=user, subject_id=subject_id, role=UserSubjectRole.Role.STUDENT
    ).exists()


class StudentSetLookupView(APIView):
    """Lookup soal set by kode (UC-01: mahasiswa memasukkan kode soal)."""

    authentication_classes = [TokenAuthentication]

    def get(self, request):
        code = (request.query_params.get('code') or '').strip()
        if not code:
            return Response(
                {'detail': 'Parameter kode wajib diisi.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            q_set = QuestionSet.objects.select_related('subject', 'created_by').get(
                code__iexact=code, is_active=True
            )
        except QuestionSet.DoesNotExist:
            return Response(
                {'detail': 'Kode soal tidak ditemukan.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        questions = Question.objects.filter(question_set=q_set).order_by('order_index')

        items = []
        for q in questions:
            version = QuestionVersion.objects.filter(
                question=q, is_published=True
            ).order_by('-version_number').first()
            if not version:
                continue
            latest_sub = Submission.objects.filter(
                student=request.user, question_version_id=version.id
            ).order_by('-attempt_no').first()
            items.append({
                'question_id': str(q.id),
                'order_index': q.order_index,
                'version_id': str(version.id),
                'version_number': version.version_number,
                'prompt': version.prompt,
                'latest_submission': {
                    'submission_id': str(latest_sub.id),
                    'attempt_no': latest_sub.attempt_no,
                    'status': latest_sub.status,
                    'submitted_at': latest_sub.submitted_at,
                } if latest_sub else None,
            })

        return Response({
            'id': str(q_set.id),
            'code': q_set.code,
            'title': q_set.title,
            'description': q_set.description or '',
            'subject_id': str(q_set.subject_id),
            'subject_name': q_set.subject.name,
            'is_active': q_set.is_active,
            'questions': items,
        })


class StudentSubmissionCreateView(APIView):
    """Simpan jawaban konseptual mahasiswa (UC-01; sp_submit_conceptual_answer)."""

    authentication_classes = [TokenAuthentication]

    def post(self, request, pk, qid):
        try:
            q_set = QuestionSet.objects.get(pk=pk, is_active=True)
        except QuestionSet.DoesNotExist:
            return Response(
                {'detail': 'Soal tidak ditemukan.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            question = Question.objects.get(pk=qid, question_set=q_set)
        except Question.DoesNotExist:
            return Response(
                {'detail': 'Pertanyaan tidak ditemukan.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        version = QuestionVersion.objects.filter(
            question=question, is_published=True
        ).order_by('-version_number').first()
        if not version:
            return Response(
                {'detail': 'Versi soal belum dipublikasikan. Tidak dapat mengumpulkan jawaban.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not is_student_for_subject(request.user, q_set.subject_id):
            return Response(
                {'detail': 'Anda tidak terdaftar pada mata kuliah ini.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = SubmissionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        answer_text = serializer.validated_data['answer_text']

        try:
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(
                        "CALL sp_submit_conceptual_answer(%s, %s, %s, NULL);",
                        [str(request.user.id), str(version.id), answer_text],
                    )
                    row = cursor.fetchone()
                    submission_id = str(row[0]) if row and row[0] else None
                    if not submission_id:
                        cursor.execute(
                            """
                            SELECT id FROM submissions
                            WHERE student_id = %s AND question_version_id = %s
                            ORDER BY attempt_no DESC LIMIT 1
                            """,
                            [str(request.user.id), str(version.id)],
                        )
                        fallback = cursor.fetchone()
                        submission_id = str(fallback[0]) if fallback else None
        except Exception as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        if not submission_id:
            return Response(
                {'detail': 'Gagal menyimpan jawaban. Silakan coba lagi.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        submission = Submission.objects.get(pk=submission_id)
        return Response({
            'submission_id': str(submission.id),
            'question_id': str(question.id),
            'question_version_id': str(version.id),
            'attempt_no': submission.attempt_no,
            'status': submission.status,
            'submitted_at': submission.submitted_at,
        }, status=status.HTTP_201_CREATED)


class StudentSubmissionListView(APIView):
    """Daftar pengumpulan mahasiswa (status state machine P3)."""

    authentication_classes = [TokenAuthentication]

    def get(self, request):
        submissions = list(
            Submission.objects.filter(student=request.user).order_by('-submitted_at')
        )

        version_ids = {s.question_version_id for s in submissions}
        versions = {
            v.id: v
            for v in QuestionVersion.objects.filter(id__in=version_ids)
        }
        question_ids = {v.question_id for v in versions.values()}
        questions = {
            q.id: q
            for q in Question.objects.filter(id__in=question_ids)
        }
        set_ids = {q.question_set_id for q in questions.values()}
        sets_map = {
            s.id: s
            for s in QuestionSet.objects.filter(id__in=set_ids).select_related('subject')
        }

        results = []
        for s in submissions:
            v = versions.get(s.question_version_id)
            q = questions.get(v.question_id) if v else None
            qs = sets_map.get(q.question_set_id) if q else None
            results.append({
                'id': str(s.id),
                'set_id': str(qs.id) if qs else None,
                'question_version_id': str(s.question_version_id),
                'question_prompt': v.prompt if v else None,
                'set_title': qs.title if qs else None,
                'set_code': qs.code if qs else None,
                'subject_id': str(qs.subject_id) if qs else None,
                'subject_name': qs.subject.name if qs else None,
                'attempt_no': s.attempt_no,
                'status': s.status,
                'answer_text': s.answer_text,
                'submitted_at': s.submitted_at,
            })

        return Response(results)
# ============================================================================
# SPRINT 4: STUDENT SUBMISSION GROUPING BY QUESTION SET
# ============================================================================


def _build_submission_set_groups(user):
    """Group a student's submissions per question set (read-only aggregation).

    Mirrors what the student is allowed to see: only published question versions,
    and every published question is reported (answered or not).
    """
    submissions = list(
        Submission.objects.filter(student=user).order_by('submitted_at')
    )
    if not submissions:
        return []

    version_ids = {s.question_version_id for s in submissions}
    versions = {
        v.id: v
        for v in QuestionVersion.objects.filter(id__in=version_ids).select_related('question')
    }
    question_ids = {v.question_id for v in versions.values()}
    questions = {q.id: q for q in Question.objects.filter(id__in=question_ids)}
    set_ids = {q.question_set_id for q in questions.values()}
    sets_map = {
        s.id: s
        for s in QuestionSet.objects.filter(id__in=set_ids).select_related('subject')
    }

    # Published question count per set (a question counts once, latest version wins)
    published_rows = (
        QuestionVersion.objects.filter(
            is_published=True, question__question_set_id__in=set_ids
        )
        .values_list('question_id', 'question__question_set_id')
        .distinct()
    )
    published_count = {}
    for _qid, _sid in published_rows:
        published_count[_sid] = published_count.get(_sid, 0) + 1

    grouped = {}
    for s in submissions:
        v = versions.get(s.question_version_id)
        q = questions.get(v.question_id) if v else None
        if not q:
            continue
        grouped.setdefault(q.question_set_id, {}).setdefault(q.id, []).append(s)

    results = []
    for set_id, question_map in grouped.items():
        q_set = sets_map.get(set_id)
        if not q_set:
            continue

        status_counts = {}
        max_attempt = 0
        last_submitted = None
        questions_payload = []

        for qid, subs in question_map.items():
            q = questions[qid]
            attempts = []
            for s in sorted(subs, key=lambda x: x.attempt_no):
                status_counts[s.status] = status_counts.get(s.status, 0) + 1
                max_attempt = max(max_attempt, s.attempt_no)
                if last_submitted is None or s.submitted_at > last_submitted:
                    last_submitted = s.submitted_at
                attempts.append({
                    'submission_id': str(s.id),
                    'attempt_no': s.attempt_no,
                    'status': s.status,
                    'answer_text': s.answer_text,
                    'submitted_at': s.submitted_at,
                    # Reserved for P5/P6: score, tier, explanation, suggested materials
                    'evaluation': None,
                })

            latest_version = versions[sorted(subs, key=lambda x: x.attempt_no)[-1].question_version_id]
            questions_payload.append({
                'question_id': str(qid),
                'order_index': q.order_index,
                'version_id': str(latest_version.id),
                'version_number': latest_version.version_number,
                'prompt': latest_version.prompt,
                'answered': True,
                'attempts': attempts,
            })

        # Published questions this student has not answered yet
        unanswered = Question.objects.filter(question_set_id=set_id).exclude(
            id__in=list(question_map.keys())
        ).order_by('order_index')
        for q in unanswered:
            v = QuestionVersion.objects.filter(
                question=q, is_published=True
            ).order_by('-version_number').first()
            if not v:
                continue
            questions_payload.append({
                'question_id': str(q.id),
                'order_index': q.order_index,
                'version_id': str(v.id),
                'version_number': v.version_number,
                'prompt': v.prompt,
                'answered': False,
                'attempts': [],
            })

        questions_payload.sort(key=lambda item: item['order_index'])

        status_summary = next(iter(status_counts)) if len(status_counts) == 1 else 'MIXED'

        results.append({
            'set_id': str(q_set.id),
            'code': q_set.code,
            'title': q_set.title,
            'subject_id': str(q_set.subject_id),
            'subject_name': q_set.subject.name,
            'question_count': published_count.get(set_id, 0),
            'answered_count': sum(1 for item in questions_payload if item['answered']),
            'total_attempts': sum(status_counts.values()),
            'max_attempt_no': max_attempt,
            'status_summary': status_summary,
            'status_counts': status_counts,
            'last_submitted_at': last_submitted,
            'questions': questions_payload,
        })

    results.sort(key=lambda item: item['last_submitted_at'], reverse=True)
    return results


class StudentSubmissionSetListView(APIView):
    """Daftar pengumpulan mahasiswa dikelompokkan per bank soal (UC-01)."""

    authentication_classes = [TokenAuthentication]

    def get(self, request):
        return Response(_build_submission_set_groups(request.user))


class StudentSubmissionSetDetailView(APIView):
    """Rincian satu bank soal: seluruh pertanyaan, jawaban, dan evaluasi."""

    authentication_classes = [TokenAuthentication]

    def get(self, request, pk):
        for group in _build_submission_set_groups(request.user):
            if group['set_id'] == str(pk):
                return Response(group)
        return Response(
            {'detail': 'Pengumpulan untuk bank soal ini tidak ditemukan.'},
            status=status.HTTP_404_NOT_FOUND,
        )
class LecturerSubmissionsView(APIView):
    authentication_classes = [TokenAuthentication]

    def get(self, request):
        user = request.user

        if user.is_superuser:
            scoped = Submission.objects.all()
        else:
            lecturer_subjects = list(
                UserSubjectRole.objects.filter(user=user, role=UserSubjectRole.Role.LECTURER)
                .values_list('subject_id', flat=True)
            )
            if not lecturer_subjects:
                return Response({'detail': 'Akses ditolak.'}, status=status.HTTP_403_FORBIDDEN)
            scoped = Submission.objects.filter(subject_id__in=lecturer_subjects)

        status_param = request.query_params.get('status')
        if status_param:
            scoped = scoped.filter(status=status_param)
        subject_slug = request.query_params.get('subject_slug')
        if subject_slug:
            scoped = scoped.filter(subject__slug=subject_slug)

        submissions = list(scoped.select_related('student', 'subject').order_by('-submitted_at')[:300])

        analyses = {
            a.submission_id: a
            for a in LlmAnalysis.objects.filter(
                submission_id__in=[s.id for s in submissions], is_current=True
            )
        }
        validations = {
            v.analysis_id: v
            for v in Validation.objects.filter(
                analysis_id__in=[a.id for a in analyses.values()]
            )
        }
        versions = {
            v.id: v
            for v in QuestionVersion.objects.filter(
                id__in={s.question_version_id for s in submissions}
            ).select_related('question__question_set')
        }

        rows = []
        for s in submissions:
            version = versions.get(s.question_version_id)
            question = version.question if version else None
            qset = question.question_set if question else None
            analysis = analyses.get(s.id)
            validation = validations.get(analysis.id) if analysis else None
            rows.append({
                'id': str(s.id),
                'student_name': s.student.full_name,
                'student_email': s.student.email,
                'subject_slug': s.subject.slug,
                'subject_name': s.subject.name,
                'question_code': qset.code if qset else None,
                'question_title': qset.title if qset else None,
                'version_number': version.version_number if version else None,
                'prompt_preview': (version.prompt[:240] + 'â€¦') if version and version.prompt else '',
                'answer': s.answer_text,
                'status': s.status,
                'submitted_at': s.submitted_at.isoformat() if s.submitted_at else None,
                'score': float(analysis.percentage_correct) if analysis and analysis.percentage_correct is not None else None,
                'tier_label': analysis.tier_label_snapshot if analysis else None,
                'validation_status': validation.status if validation else None,
            })

        return Response({'submissions': rows})
