import uuid
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0003_llm_pipeline_v21')]

    operations = [
        migrations.CreateModel(
            name='HelpArticle',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('role', models.CharField(choices=[('ADMIN', 'Admin'), ('LECTURER', 'Lecturer'), ('STUDENT', 'Student'), ('GENERAL', 'General')], max_length=20)),
                ('title', models.CharField(max_length=200)), ('body', models.TextField()),
                ('order_index', models.PositiveIntegerField(default=0)), ('is_published', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)), ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'db_table': 'help_articles', 'ordering': ('order_index', 'title')},
        ),
    ]
