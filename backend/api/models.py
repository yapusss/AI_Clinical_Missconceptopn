import uuid

from django.contrib.auth.hashers import make_password
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
        RESEARCHER = 'RESEARCHER'
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