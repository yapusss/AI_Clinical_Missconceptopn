from django.db.models import Avg, Count, Q
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import TokenAuthentication
from .models import (
    AuthToken,
    LlmAnalysis,
    Misconception,
    QuestionSet,
    Subject,
    Submission,
    User,
    UserSubjectRole,
    Validation,
)
from .serializers import LoginSerializer, RegisterSerializer, UserSerializer


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
                {'slug': r['subject_slug'], 'name': r['subject_name']}
                for r in roles
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