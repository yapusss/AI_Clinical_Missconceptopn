import re
from decimal import Decimal

from django.contrib.auth.hashers import check_password, make_password
from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'full_name', 'is_active', 'is_superuser', 'created_at']
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=255)
    password = serializers.CharField(write_only=True, min_length=8)

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Email sudah terdaftar.')
        return value

    def create(self, validated_data):
        return User.objects.create(
            email=validated_data['email'].lower(),
            full_name=validated_data['full_name'],
            password_hash=make_password(validated_data['password']),
        )


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


# ============================================================================
# SPRINT 2: QUESTION BANK SERIALIZERS (DOSEN)
# ============================================================================

CODE_REGEX = re.compile(r'^[A-Z0-9][A-Z0-9\-]{1,62}[A-Z0-9]$')


class ConceptIndicatorSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    label = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    weight = serializers.DecimalField(
        max_digits=5,
        decimal_places=4,
        min_value=Decimal('0.0001'),
        max_value=Decimal('1.0000'),
    )
    order_index = serializers.IntegerField(read_only=True)


class QuestionVersionSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    version_number = serializers.IntegerField(read_only=True)
    prompt = serializers.CharField()
    model_answer = serializers.CharField()
    is_published = serializers.BooleanField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    indicators = ConceptIndicatorSerializer(many=True, required=False, default=list)


class QuestionSetCreateSerializer(serializers.Serializer):
    subject_id = serializers.UUIDField()
    topic_id = serializers.UUIDField(required=False, allow_null=True)
    code = serializers.CharField(max_length=64)
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    prompt = serializers.CharField()
    model_answer = serializers.CharField()
    indicators = ConceptIndicatorSerializer(many=True, required=False, default=list)
    publish = serializers.BooleanField(default=False)

    def validate_code(self, value):
        val = value.strip().upper()
        if not CODE_REGEX.match(val):
            raise serializers.ValidationError(
                "Format kode soal harus huruf besar, angka, atau tanda hubung (-), minimal 3 karakter, dan tidak boleh diawali/diakhiri tanda hubung."
            )
        return val

    def validate(self, attrs):
        indicators = attrs.get('indicators', [])
        publish = attrs.get('publish', False)

        if indicators:
            total_weight = sum(Decimal(str(i['weight'])) for i in indicators)
            if publish and abs(total_weight - Decimal('1.0000')) > Decimal('0.0001'):
                raise serializers.ValidationError({
                    'indicators': f"Total bobot indikator harus tepat 1.0000 untuk dapat dipublikasikan. Saat ini: {total_weight}"
                })
        elif publish:
            raise serializers.ValidationError({
                'indicators': "Minimal harus ada satu indikator konsep dengan bobot 1.0000 untuk mempublikasikan soal."
            })

        return attrs


class QuestionSetUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    prompt = serializers.CharField(required=False)
    model_answer = serializers.CharField(required=False)
    indicators = ConceptIndicatorSerializer(many=True, required=False)
    publish = serializers.BooleanField(required=False)

    def validate(self, attrs):
        indicators = attrs.get('indicators')
        publish = attrs.get('publish')
        if indicators is not None and publish:
            total_weight = sum(Decimal(str(i['weight'])) for i in indicators)
            if abs(total_weight - Decimal('1.0000')) > Decimal('0.0001'):
                raise serializers.ValidationError({
                    'indicators': f"Total bobot indikator harus tepat 1.0000 untuk dipublikasikan. Saat ini: {total_weight}"
                })
        return attrs