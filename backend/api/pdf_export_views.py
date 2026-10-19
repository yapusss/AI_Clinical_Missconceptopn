"""PDF export endpoint for a student's validated reading material (W2)."""

import logging
from urllib.parse import quote

from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import TokenAuthentication
from .reading_material_export import collect_export_sections, render_reading_pdf

logger = logging.getLogger(__name__)

EMPTY_DETAIL = (
    'Belum ada materi bacaan yang siap diunduh. Materi tersedia setelah dosen '
    'memvalidasi jawaban Anda.'
)
NOT_FOUND_DETAIL = 'Paket tidak ditemukan.'
ERROR_DETAIL = 'Gagal membuat berkas PDF materi bacaan. Silakan coba lagi.'


def _filename(identity):
    code = str(identity.get('package_code') or '').strip() or 'Paket'
    nim = str(identity.get('nim') or '').strip() or 'Mahasiswa'
    return f'Materi-Bacaan-{code}-{nim}.pdf'


def _content_disposition(filename):
    # The plain `filename=` value must be ASCII; the UTF-8 form carries the
    # original name/code (which may contain non-ASCII characters).
    ascii_name = filename.encode('ascii', 'ignore').decode('ascii')
    ascii_name = ascii_name.replace('"', '_').replace('\\', '_').replace('\r', '').replace('\n', '')
    if not ascii_name:
        ascii_name = 'Materi-Bacaan.pdf'
    return (
        f'attachment; filename="{ascii_name}"; '
        f"filename*=UTF-8''{quote(filename, safe='')}"
    )


class StudentReadingMaterialExportView(APIView):
    """Download one PDF containing the student's validated reading material.

    The student is always `request.user`; there is no student id in the path, so
    the export cannot be requested on another student's behalf.
    """

    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            identity, sections = collect_export_sections(request.user, pk)
            if identity is None:
                return Response(
                    {'detail': NOT_FOUND_DETAIL},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if not sections:
                return Response(
                    {'detail': EMPTY_DETAIL},
                    status=status.HTTP_409_CONFLICT,
                )
            pdf_bytes = render_reading_pdf(identity, sections)
            response = HttpResponse(pdf_bytes, content_type='application/pdf')
            response['Content-Disposition'] = _content_disposition(_filename(identity))
            return response
        except Exception:  # noqa: BLE001 — never leak a traceback or a partial PDF
            logger.exception(
                'Reading-material export failed for student %s / package %s',
                getattr(request.user, 'pk', None), pk,
            )
            return Response(
                {'detail': ERROR_DETAIL},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
