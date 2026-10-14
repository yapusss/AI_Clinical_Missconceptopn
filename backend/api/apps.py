from django.apps import AppConfig


class ApiConfig(AppConfig):
    name = 'api'

    def ready(self):
        # C4: register the reading-material invalidation hooks (D13).
        from api import signals  # noqa: F401
