import uuid
from decimal import Decimal
from django.db import connection, transaction
from django.db.models import Avg, Count, Q
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