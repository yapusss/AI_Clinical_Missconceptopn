from django.urls import path

from .views import DashboardView, LoginView, MeView, RegisterView

urlpatterns = [
    path('auth/register', RegisterView.as_view(), name='auth-register'),
    path('auth/login', LoginView.as_view(), name='auth-login'),
    path('auth/me', MeView.as_view(), name='auth-me'),
    path('dashboard/summary', DashboardView.as_view(), name='dashboard-summary'),
]