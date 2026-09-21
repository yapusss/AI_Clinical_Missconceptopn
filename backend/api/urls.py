from django.urls import path

from .validation_views import (
    ModelMetricsView,
    ValidationDetailView,
    ValidationQueueView,
    ValidationSubmitView,
    ValidationTiersView,
)
from .views import (
    DashboardView,
    LoginView,
    MeView,
    QuestionDetailView,
    QuestionListCreateView,
    QuestionPublishView,
    QuestionToggleActiveView,
    RegisterView,
    StudentSetLookupView,
    StudentSubmissionCreateView,
    StudentSubmissionListView,
    StudentSubmissionSetDetailView,
    StudentSubmissionSetListView,
)

urlpatterns = [
    path('auth/register', RegisterView.as_view(), name='auth-register'),
    path('auth/login', LoginView.as_view(), name='auth-login'),
    path('auth/me', MeView.as_view(), name='auth-me'),
    path('dashboard/summary', DashboardView.as_view(), name='dashboard-summary'),

    # Sprint 2 Dosen Endpoints
    path('questions', QuestionListCreateView.as_view(), name='question-list-create'),
    path('questions/<uuid:pk>', QuestionDetailView.as_view(), name='question-detail'),
    path('questions/<uuid:pk>/toggle-active', QuestionToggleActiveView.as_view(), name='question-toggle-active'),
    path('questions/versions/<uuid:version_id>/publish', QuestionPublishView.as_view(), name='question-version-publish'),

    # Sprint 3 Student Endpoints (UC-01 / P3)
    path('student/sets', StudentSetLookupView.as_view(), name='student-set-lookup'),
    path('student/sets/<uuid:pk>/questions/<uuid:qid>/submissions', StudentSubmissionCreateView.as_view(), name='student-submission-create'),
    path('student/submissions', StudentSubmissionListView.as_view(), name='student-submission-list'),
    path('student/submission-sets', StudentSubmissionSetListView.as_view(), name='student-submission-set-list'),
    path('student/submission-sets/<uuid:pk>', StudentSubmissionSetDetailView.as_view(), name='student-submission-set-detail'),

    # Sprint 5 Lecturer Validation (UC-05 / P5) + Model Metrics
    path('validations/queue', ValidationQueueView.as_view(), name='validation-queue'),
    path('validations/tiers', ValidationTiersView.as_view(), name='validation-tiers'),
    path('validations/<uuid:analysis_id>', ValidationDetailView.as_view(), name='validation-detail'),
    path('validations/<uuid:analysis_id>/submit', ValidationSubmitView.as_view(), name='validation-submit'),
    path('metrics/model', ModelMetricsView.as_view(), name='model-metrics'),
]