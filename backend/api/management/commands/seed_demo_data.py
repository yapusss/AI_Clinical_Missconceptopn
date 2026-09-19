from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand

from api.models import Subject, User, UserSubjectRole

PASSWORD = 'demo12345'

SUBJECTS = [
    ('Biology', 'biology', 'Cell biology, genetics and physiology.'),
    ('Physics', 'physics', 'Mechanics, electromagnetism and thermodynamics.'),
]

ACCOUNTS = [
    ('demo@acm.local', 'Demo User', False, None),
    ('admin@acm.local', 'Admin User', True, None),
    ('lecturer@acm.local', 'Lecturer Demo', False, 'LECTURER'),
    ('student@acm.local', 'Student Demo', False, 'STUDENT'),
]


class Command(BaseCommand):
    help = 'Seed demo subjects, accounts and role assignments.'

    def handle(self, *args, **options):
        subjects = {}
        for name, slug, description in SUBJECTS:
            subject, _ = Subject.objects.get_or_create(
                slug=slug,
                defaults={'name': name, 'description': description},
            )
            subjects[subject.slug] = subject
            self.stdout.write(f'subject ensured: {name}')

        for email, full_name, is_superuser, role in ACCOUNTS:
            user, created = User.objects.get_or_create(
                email=email,
                defaults={
                    'full_name': full_name,
                    'password_hash': make_password(PASSWORD),
                    'is_superuser': is_superuser,
                },
            )
            if created:
                self.stdout.write(f'user created: {email}')
            else:
                self.stdout.write(f'user exists: {email}')
            if role:
                for subject in subjects.values():
                    _, role_created = UserSubjectRole.objects.get_or_create(
                        user=user, subject=subject, role=role,
                    )
                self.stdout.write(f'roles ensured: {email} -> {role}')

        removed = UserSubjectRole.objects.filter(role='RESEARCHER').delete()
        User.objects.filter(email='researcher@acm.local').delete()
        self.stdout.write(f'researcher role cleaned (rows removed: {removed[0]})')

        admin_created = self.ensure_django_admin()
        if admin_created:
            self.stdout.write('django admin user created: admin (auth_user)')

    def ensure_django_admin(self):
        AdminUser = get_user_model()
        admin = AdminUser.objects.filter(username='admin').first()
        if admin:
            return False
        AdminUser.objects.create_user(
            username='admin',
            email='admin@acm.local',
            password=PASSWORD,
            is_staff=True,
            is_superuser=True,
        )
        return True