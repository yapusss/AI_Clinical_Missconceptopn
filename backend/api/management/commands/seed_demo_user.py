from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand

from api.models import User

DEMO_EMAIL = 'demo@acm.local'
DEMO_PASSWORD = 'demo12345'


class Command(BaseCommand):
    help = 'Ensure the demo user exists.'

    def handle(self, *args, **options):
        user, created = User.objects.get_or_create(
            email=DEMO_EMAIL,
            defaults={
                'full_name': 'Demo User',
                'password_hash': make_password(DEMO_PASSWORD),
            },
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f'Demo user created: {DEMO_EMAIL}'))
        else:
            self.stdout.write(self.style.WARNING(f'Demo user already exists: {DEMO_EMAIL}'))