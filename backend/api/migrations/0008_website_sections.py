import uuid

from django.db import migrations, models


DEFAULT_SECTIONS = [
    ('hero', 'Temukan miskonsepsi sebelum menjadi kebiasaan belajar.', 'Evaluasi konseptual berbantuan AI', 'EvalAI Academic membantu pengajar memahami jawaban mahasiswa lebih dalam, dari evaluasi berbasis kode hingga validasi hasil analisis AI.', 1),
    ('features', 'Dari jawaban mentah menjadi keputusan pembelajaran.', 'Dirancang untuk evaluasi bermakna', 'Satu sistem untuk mempersiapkan evaluasi, memahami jawaban, dan menjaga keputusan akademik tetap berada di tangan pengajar.', 2),
    ('workflow', 'Evaluasi yang tetap manusiawi, meski dibantu AI.', 'Alur yang jelas', 'AI mempercepat pembacaan pola. Dosen tetap menjadi pengambil keputusan atas hasil evaluasi.', 3),
    ('roles', 'Buat evaluasi konseptual lebih mudah ditelusuri dan lebih siap ditindaklanjuti.', 'Satu sistem, tiga peran', '', 4),
]


def seed_sections(apps, schema_editor):
    WebsiteSection = apps.get_model('api', 'WebsiteSection')
    for key, title, eyebrow, body, order_index in DEFAULT_SECTIONS:
        WebsiteSection.objects.get_or_create(
            key=key,
            defaults={
                'title': title,
                'eyebrow': eyebrow,
                'body': body,
                'order_index': order_index,
                'is_visible': True,
                'is_system': True,
            },
        )


class Migration(migrations.Migration):
    dependencies = [('api', '0007_user_roles')]

    operations = [
        migrations.CreateModel(
            name='WebsiteSection',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('key', models.SlugField(max_length=80, unique=True)),
                ('title', models.CharField(max_length=255)),
                ('eyebrow', models.CharField(blank=True, max_length=120)),
                ('body', models.TextField(blank=True)),
                ('image_url', models.URLField(blank=True, max_length=1000)),
                ('button_label', models.CharField(blank=True, max_length=80)),
                ('button_url', models.CharField(blank=True, max_length=500)),
                ('order_index', models.PositiveIntegerField(default=0)),
                ('is_visible', models.BooleanField(default=True)),
                ('is_system', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'db_table': 'website_sections', 'ordering': ('order_index', 'title')},
        ),
        migrations.RunPython(seed_sections, migrations.RunPython.noop),
    ]
