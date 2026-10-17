from django.apps import AppConfig


class ApiConfig(AppConfig):
    name = 'api'

    def ready(self):
        # C4: register the reading-material invalidation hooks (D13).
        from api import signals  # noqa: F401

        # Keep the background LLM workers alive next to the web process: the API
        # records work that only they can perform, so letting them drift out of
        # existence leaves submissions parked at SUBMITTED with no error anywhere.
        from api.worker_supervisor import start_supervisor

        start_supervisor()
