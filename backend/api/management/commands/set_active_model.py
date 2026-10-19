"""`manage.py set_active_model <identifier>` — point the pipeline at a model the provider serves.

Why this command exists: `get_active_model_identifier()` prefers the admin-approved model in
`ai_runtime_settings` over `settings.LLM_MODEL`. Changing `LLM_MODEL` (env, compose, deploy
workflow) therefore does **not** change what an analysis asks for. After production moved to
OpenCode Go it kept requesting `openai/gpt-oss-20b` — a Groq identifier — and every call came
back `400 {'error': {'type': 'server_error', 'message': 'Upstream request failed: Model is
unavailable.'}}`, burning attempts until submissions parked as ANALYSIS_FAILED.

Idempotent: creates the `llm_models` row when the identifier is new, re-enables and
un-deprecates it, activates it, and writes the same `ai_model_changes` audit row the Settings
page writes — so the switch shows up in the UI history like any other.

    python manage.py set_active_model deepseek-v4-pro
    python manage.py set_active_model deepseek-v4.1-flash --by admin@example.com
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from api.models import User


def _provider_for(base_url: str) -> str:
    url = (base_url or '').lower()
    if 'opencode' in url:
        return 'opencode-go'
    if 'groq' in url:
        return 'groq'
    if 'openrouter' in url:
        return 'openrouter'
    if 'anthropic' in url:
        return 'anthropic'
    if 'openai' in url:
        return 'openai'
    return 'custom'


class Command(BaseCommand):
    help = ('Activate an LLM model for the analysis pipeline (upserts llm_models, points '
            'ai_runtime_settings at it, writes the ai_model_changes audit row).')

    def add_arguments(self, parser):
        parser.add_argument('identifier', help='Model identifier as the provider names it')
        parser.add_argument('--display-name', default=None)
        parser.add_argument('--provider', default=None,
                            help='Override the provider label derived from LLM_BASE_URL')
        parser.add_argument('--by', default=None,
                            help='Email of the admin to record in ai_model_changes '
                                 '(default: the earliest superuser)')

    def handle(self, *args, **options):
        from django.conf import settings

        identifier = options['identifier'].strip()
        if not identifier:
            raise CommandError('identifier tidak boleh kosong.')

        actor = self._resolve_actor(options['by'])
        provider = options['provider'] or _provider_for(settings.LLM_BASE_URL)
        display_name = options['display_name'] or identifier

        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute(
                    """SELECT m.identifier
                       FROM ai_runtime_settings s
                       JOIN llm_models m ON m.id = s.active_model_id
                       WHERE s.id = TRUE"""
                )
                row = cur.fetchone()
                previous = row[0] if row else ''

                cur.execute(
                    """INSERT INTO llm_models (identifier, provider, display_name, is_enabled)
                       VALUES (%s, %s, %s, TRUE)
                       ON CONFLICT (identifier) DO UPDATE
                           SET is_enabled = TRUE,
                               deprecated_at = NULL,
                               provider = EXCLUDED.provider,
                               display_name = EXCLUDED.display_name
                       RETURNING id""",
                    [identifier, provider, display_name],
                )
                model_id = cur.fetchone()[0]

                cur.execute(
                    """INSERT INTO ai_runtime_settings (id, active_model_id, updated_by)
                       VALUES (TRUE, %s, %s)
                       ON CONFLICT (id) DO UPDATE
                           SET active_model_id = EXCLUDED.active_model_id,
                               updated_by = EXCLUDED.updated_by,
                               updated_at = CURRENT_TIMESTAMP""",
                    [model_id, actor.id],
                )

                cur.execute(
                    """INSERT INTO ai_model_changes
                           (previous_model_identifier, active_model_id, changed_by)
                       VALUES (%s, %s, %s)""",
                    [previous, model_id, actor.id],
                )

        from api.llm import get_active_model_identifier

        self.stdout.write(self.style.SUCCESS(
            f'Active model: {previous or "(none)"} -> {identifier} (provider={provider}, by={actor.email})'
        ))
        # Read it back through the same function the analysis pipeline uses, so a mismatch
        # (a disabled or deprecated row) surfaces here instead of as a 400 in production.
        effective = get_active_model_identifier()
        if effective != identifier:
            raise CommandError(
                f'Activated {identifier} but the pipeline would still use {effective} — '
                'check is_enabled/deprecated_at on llm_models.'
            )
        self.stdout.write(f'Pipeline will use: {effective}')

    def _resolve_actor(self, email):
        if email:
            try:
                return User.objects.get(email=email)
            except User.DoesNotExist:
                raise CommandError(f'User {email} tidak ditemukan.')
        actor = User.objects.filter(is_superuser=True).order_by('created_at').first()
        if actor is None:
            raise CommandError('Tidak ada superuser; berikan --by <email>.')
        return actor
