from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
    # Uploaded media (subject banners, question images, editor content) is stored on
    # the shared MEDIA_ROOT volume and served by Django. `static()` only registers
    # these routes while DEBUG is on, but DEBUG is off in this deployment, which made
    # every /media/... URL 404 and left subject cards without their picture.
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
]
