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