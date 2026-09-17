from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import AuthToken


class TokenAuthentication(BaseAuthentication):
    keyword = 'Bearer'

    def authenticate(self, request):
        header = request.headers.get('Authorization', '')
        if not header:
            return None
        parts = header.split()
        if len(parts) != 2 or parts[0] != self.keyword:
            return None
        try:
            token = AuthToken.objects.select_related('user').get(key=parts[1])
        except AuthToken.DoesNotExist:
            raise AuthenticationFailed('Token tidak valid.')
        if not token.user.is_active:
            raise AuthenticationFailed('Akun niet actief.')
        return (token.user, token)