from django.urls import path

from .views import (
    DashboardView,
    LoginView,
    MeView,
    QuestionDetailView,
    QuestionListCreateView,
    QuestionPublishView,
    QuestionToggleActiveView,
    RegisterView,
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
]