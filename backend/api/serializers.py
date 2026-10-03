import re

from django.contrib.auth.hashers import check_password, make_password
from rest_framework import serializers

from .models import User, UserRole


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'full_name', 'nim', 'is_active', 'is_superuser', 'created_at']
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=255)
    nim = serializers.CharField(max_length=32)
    password = serializers.CharField(write_only=True, min_length=8)

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Email sudah terdaftar.')
        return value

    def validate_nim(self, value):
        nim = value.strip().upper()
        if User.objects.filter(nim__iexact=nim).exists():
            raise serializers.ValidationError('NIM sudah terdaftar.')
        return nim

    def create(self, validated_data):
        user = User.objects.create(
            email=validated_data['email'].lower(),
            full_name=validated_data['full_name'],
            nim=validated_data['nim'].strip().upper(),
            password_hash=make_password(validated_data['password']),
        )
        UserRole.objects.create(user=user, role=UserRole.Role.STUDENT)
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        email = attrs['email'].lower()
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            raise serializers.ValidationError({'detail': 'Email atau password salah.'})
        if not user.is_active:
            raise serializers.ValidationError({'detail': 'Akun tidak aktif.'})
        if not check_password(attrs['password'], user.password_hash):
            raise serializers.ValidationError({'detail': 'Email atau password salah.'})
        attrs['user'] = user
        return attrs


class AdminManagedUserSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=255)
    nim = serializers.CharField(max_length=32, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, min_length=8)
    is_active = serializers.BooleanField(required=False, default=True)
    subject_ids = serializers.ListField(child=serializers.UUIDField(), required=False)


# ============================================================================
# SPRINT 2: QUESTION BANK SERIALIZERS (DOSEN)
# ============================================================================

CODE_REGEX = re.compile(r'^[A-Z0-9][A-Z0-9\-]{1,62}[A-Z0-9]$')


class QuestionVersionSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    version_number = serializers.IntegerField(read_only=True)
    prompt = serializers.CharField(required=False, default='')
    short_answer = serializers.CharField(required=False, allow_blank=True, default='')
    model_answer = serializers.CharField(required=False, default='')
    is_published = serializers.BooleanField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)


class QuestionItemCreateSerializer(serializers.Serializer):
    prompt = serializers.CharField()
    short_answer = serializers.CharField(required=False, allow_blank=True, default='')
    model_answer = serializers.CharField()


class QuestionSetCreateSerializer(serializers.Serializer):
    subject_id = serializers.UUIDField()
    topic_id = serializers.UUIDField(required=True, allow_null=False)
    code = serializers.CharField(max_length=64, required=False, allow_blank=True, default='')
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    
    prompt = serializers.CharField(required=False)
    short_answer = serializers.CharField(required=False, allow_blank=True, default='')
    model_answer = serializers.CharField(required=False)
    questions = QuestionItemCreateSerializer(many=True, required=False, default=list)
    publish = serializers.BooleanField(default=False)

    def validate_code(self, value):
        if not value:
            return ''
        val = value.strip().upper()
        if not CODE_REGEX.match(val):
            raise serializers.ValidationError(
                "Format kode soal harus huruf besar, angka, atau tanda hubung (-), minimal 3 karakter, dan tidak boleh diawali/diakhiri tanda hubung."
            )
        return val

    def validate(self, attrs):
        questions = attrs.get('questions', [])
        if questions:
            first_q = questions[0]
            attrs['prompt'] = first_q['prompt']
            attrs['short_answer'] = first_q.get('short_answer', '')
            attrs['model_answer'] = first_q['model_answer']
        else:
            if not attrs.get('prompt'):
                raise serializers.ValidationError({'prompt': ['This field is required.']})
            if not attrs.get('model_answer'):
                raise serializers.ValidationError({'model_answer': ['This field is required.']})

        return attrs


class QuestionSetUpdateSerializer(serializers.Serializer):
    topic_id = serializers.UUIDField(required=False, allow_null=False)
    title = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    prompt = serializers.CharField(required=False)
    short_answer = serializers.CharField(required=False, allow_blank=True)
    model_answer = serializers.CharField(required=False)
    questions = QuestionItemCreateSerializer(many=True, required=False)
    publish = serializers.BooleanField(required=False)


class ExamPackageCreateSerializer(serializers.Serializer):
    subject_id = serializers.UUIDField()
    code = serializers.CharField(max_length=64)
    title = serializers.CharField(max_length=255)
    question_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=True, required=False, default=list)
    is_active = serializers.BooleanField(default=False)
    opens_at = serializers.DateTimeField(required=False, allow_null=True)
    closes_at = serializers.DateTimeField(required=False, allow_null=True)
    duration_minutes = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    max_attempts = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    password = serializers.CharField(required=False, allow_blank=True, write_only=True, max_length=255)

    def validate_code(self, value):
        val = value.strip().upper()
        if not CODE_REGEX.match(val):
            raise serializers.ValidationError(
                'Format kode paket harus huruf besar, angka, atau tanda hubung (-), minimal 3 karakter, dan tidak boleh diawali/diakhiri tanda hubung.'
            )
        return val

    def validate_question_ids(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError('Setiap soal hanya boleh dipilih satu kali.')
        return value

    def validate(self, attrs):
        opens_at = attrs.get('opens_at')
        closes_at = attrs.get('closes_at')
        if opens_at and closes_at and opens_at >= closes_at:
            raise serializers.ValidationError({'closes_at': ['Waktu tutup harus setelah waktu buka.']})
        return attrs


class FourTierSubmissionItemSerializer(serializers.Serializer):
    question_id = serializers.UUIDField()
    tier1_answer = serializers.CharField(max_length=120, allow_blank=False)
    tier2_confidence = serializers.IntegerField(min_value=1, max_value=6)
    tier3_reason = serializers.CharField(min_length=1, max_length=10000, allow_blank=False)
    tier4_confidence = serializers.IntegerField(min_value=1, max_value=6)

    def validate_tier1_answer(self, val):
        val = val.strip()
        if not val:
            raise serializers.ValidationError("Tier 1 kesimpulan tidak boleh kosong.")
        if len(val) > 120:
            raise serializers.ValidationError("Tier 1 kesimpulan dibatasi maksimal 120 karakter.")
        return val


class FourTierPackageSubmissionSerializer(serializers.Serializer):
    answers = FourTierSubmissionItemSerializer(many=True, allow_empty=False)

    def validate_answers(self, answers):
        q_ids = [a['question_id'] for a in answers]
        if len(q_ids) != len(set(q_ids)):
            raise serializers.ValidationError("Setiap pertanyaan hanya boleh dijawab satu kali.")
        return answers

# ============================================================================
# SPRINT 3: STUDENT SUBMISSION SERIALIZERS (UC-01 / P3)
# ============================================================================

class SubmissionCreateSerializer(serializers.Serializer):
    answer_text = serializers.CharField(min_length=1, max_length=20000)

    def validate_answer_text(self, value):
        val = value.strip()
        if not val:
            raise serializers.ValidationError('Jawaban tidak boleh kosong.')
        return val


class PackageSubmissionAnswerSerializer(SubmissionCreateSerializer):
    question_id = serializers.UUIDField()


class PackageSubmissionCreateSerializer(serializers.Serializer):
    answers = PackageSubmissionAnswerSerializer(many=True, allow_empty=False)

    def validate_answers(self, answers):
        question_ids = [answer['question_id'] for answer in answers]
        if len(question_ids) != len(set(question_ids)):
            raise serializers.ValidationError('Setiap pertanyaan hanya boleh dijawab satu kali.')
        return answers

# ============================================================================
# SPRINT 5: VALIDATION SERIALIZERS (DOSEN / P5)
# ============================================================================

class MisconceptionConfirmationSerializer(serializers.Serializer):
    misconception_id = serializers.UUIDField()
    confirmed = serializers.BooleanField()


class ValidationSubmitSerializer(serializers.Serializer):
    """Input for sp_validate_analysis (accept/edit/reject)."""

    status = serializers.ChoiceField(choices=['ACCEPTED', 'EDITED', 'REJECTED'])
    final_percentage = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, allow_null=True,
        min_value=0, max_value=100,
    )
    final_tier_level = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=10)
    final_feedback = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=5000)
    notes = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=5000)
    misconception_confirmations = MisconceptionConfirmationSerializer(
        many=True, required=False,
    )

    def validate(self, attrs):
        if attrs['status'] == 'EDITED':
            has_change = (
                attrs.get('final_percentage') is not None
                or attrs.get('final_tier_level') is not None
                or attrs.get('final_feedback')
            )
            if not has_change:
                raise serializers.ValidationError(
                    {'detail': 'Status EDITED memerlukan minimal satu koreksi (skor, tier, atau umpan balik).'}
                )
        return attrs
