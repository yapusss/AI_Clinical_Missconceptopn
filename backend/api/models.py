import uuid

from django.db import models


class User(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=255)
    password_hash = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    is_superuser = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'users'
        managed = False

    @property
    def is_authenticated(self):
        return True

    def __str__(self):
        return self.email


class AuthToken(models.Model):
    key = models.CharField(max_length=64, primary_key=True, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tokens')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'auth_tokens'

    @classmethod
    def generate(cls, user):
        return cls.objects.create(user=user, key=uuid.uuid4().hex)

    def __str__(self):
        return f'{self.user.email} token'


class Subject(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150, unique=True)
    slug = models.SlugField(max_length=150, unique=True)
    description = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    archived_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'subjects'
        managed = False

    def __str__(self):
        return self.name


class UserSubjectRole(models.Model):
    class Role(models.TextChoices):
        LECTURER = 'LECTURER'
        STUDENT = 'STUDENT'

    id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column='user_id')
    subject = models.ForeignKey(Subject, on_delete=models.RESTRICT, db_column='subject_id')
    role = models.CharField(max_length=20, choices=Role.choices)
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'user_subject_roles'
        managed = False
        unique_together = (('user', 'subject', 'role'),)

    def __str__(self):
        return f'{self.user.email}:{self.role}@{self.subject.slug}'


class Topic(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, on_delete=models.RESTRICT, db_column='subject_id')
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'topics'
        managed = False

    def __str__(self):
        return self.name


class QuestionSet(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, on_delete=models.RESTRICT, db_column='subject_id')
    topic = models.ForeignKey(Topic, on_delete=models.SET_NULL, db_column='topic_id', null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.RESTRICT, db_column='created_by')
    code = models.CharField(max_length=64)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'question_sets'
        managed = False

    def __str__(self):
        return f'[{self.code}] {self.title}'


class Question(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    question_set = models.ForeignKey(QuestionSet, on_delete=models.CASCADE, db_column='question_set_id', related_name='questions')
    external_key = models.CharField(max_length=100, null=True, blank=True)
    order_index = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'questions'
        managed = False


class QuestionVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    question = models.ForeignKey(Question, on_delete=models.CASCADE, db_column='question_id', related_name='versions')
    version_number = models.IntegerField(default=1)
    prompt = models.TextField()
    model_answer = models.TextField()
    is_published = models.BooleanField(default=False)
    created_by = models.ForeignKey(User, on_delete=models.RESTRICT, db_column='created_by')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'question_versions'
        managed = False


class ConceptIndicator(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    question_version = models.ForeignKey(QuestionVersion, on_delete=models.CASCADE, db_column='question_version_id', related_name='indicators')
    label = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    weight = models.DecimalField(max_digits=5, decimal_places=4)
    order_index = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'concept_indicators'
        managed = False


class ReferenceAnswer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    question_version = models.ForeignKey(QuestionVersion, on_delete=models.CASCADE, db_column='question_version_id')
    answer_key = models.CharField(max_length=100, null=True, blank=True)
    answer_text = models.TextField()
    answer_type = models.CharField(max_length=30, default='CANONICAL')
    is_primary = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'reference_answers'
        managed = False


class ImportJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, on_delete=models.RESTRICT, db_column='subject_id')
    requested_by = models.ForeignKey(User, on_delete=models.RESTRICT, db_column='requested_by')
    file_name = models.CharField(max_length=255)
    package_code = models.CharField(max_length=64)
    package_title = models.CharField(max_length=255)
    package_description = models.TextField(null=True, blank=True)
    import_type = models.CharField(max_length=30, default='QUESTION_ANSWER_CSV')
    status = models.CharField(max_length=30, default='UPLOADED')
    total_rows = models.IntegerField(default=0)
    valid_rows = models.IntegerField(default=0)
    invalid_rows = models.IntegerField(default=0)
    error_summary = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'import_jobs'
        managed = False


class ImportRow(models.Model):
    id = models.BigAutoField(primary_key=True)
    import_job = models.ForeignKey(ImportJob, on_delete=models.CASCADE, db_column='import_job_id', related_name='rows')
    row_number = models.IntegerField()
    question_key = models.CharField(max_length=100, null=True, blank=True)
    raw_data = models.JSONField(default=dict)
    status = models.CharField(max_length=20, default='VALID')
    errors = models.JSONField(default=list)

    class Meta:
        db_table = 'import_rows'
        managed = False


class Misconception(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, on_delete=models.RESTRICT, db_column='subject_id')
    topic_id = models.UUIDField(null=True, blank=True)
    label = models.CharField(max_length=255)
    source = models.CharField(max_length=30)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'misconceptions'
        managed = False


class Submission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(User, on_delete=models.RESTRICT, db_column='student_id', related_name='submissions')
    question_version_id = models.UUIDField()
    subject = models.ForeignKey(Subject, on_delete=models.RESTRICT, db_column='subject_id')
    answer_text = models.TextField()
    attempt_no = models.IntegerField(default=1)
    status = models.CharField(max_length=30)
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'submissions'
        managed = False


class LlmAnalysis(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, db_column='submission_id')
    subject = models.ForeignKey(Subject, on_delete=models.RESTRICT, db_column='subject_id')
    run_number = models.IntegerField(default=1)
    is_current = models.BooleanField(default=True)
    model_identifier = models.CharField(max_length=100)
    prompt_version = models.CharField(max_length=50)
    percentage_correct = models.DecimalField(max_digits=5, decimal_places=2)
    tier_id = models.UUIDField()
    tier_level_snapshot = models.IntegerField()
    tier_label_snapshot = models.CharField(max_length=100)
    concept_breakdown_json = models.JSONField()
    suggested_materials_json = models.JSONField()
    explanation = models.TextField()
    confidence = models.DecimalField(max_digits=4, decimal_places=3)
    raw_output_json = models.JSONField()
    execution_time_ms = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'llm_analyses'
        managed = False


class Validation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    analysis = models.ForeignKey(LlmAnalysis, on_delete=models.RESTRICT, db_column='analysis_id')
    lecturer = models.ForeignKey(User, on_delete=models.RESTRICT, db_column='lecturer_id')
    subject = models.ForeignKey(Subject, on_delete=models.RESTRICT, db_column='subject_id')
    status = models.CharField(max_length=20)
    original_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    original_tier_id = models.UUIDField()
    original_tier_level_snapshot = models.IntegerField()
    original_tier_label_snapshot = models.CharField(max_length=100)
    final_percentage = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    final_tier_id = models.UUIDField(null=True, blank=True)
    final_tier_level_snapshot = models.IntegerField(null=True, blank=True)
    final_tier_label_snapshot = models.CharField(max_length=100, null=True, blank=True)
    final_feedback = models.TextField(null=True, blank=True)
    is_score_modified = models.BooleanField(default=False)
    is_tier_modified = models.BooleanField(default=False)
    structured_diff_json = models.JSONField()
    notes = models.TextField(null=True, blank=True)
    validated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'validations'
        managed = False