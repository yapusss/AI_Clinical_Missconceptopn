from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0008_website_sections')]

    operations = [
        migrations.AddField(
            model_name='websitesection',
            name='content_json',
            field=models.JSONField(default=list),
        ),
    ]
