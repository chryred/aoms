"""첨부 OCR 처리 — 이미지/PDF/문서 통합 텍스트 추출.

처리 대상:
- 이미지: png/jpg/webp/gif → pytesseract (lang='kor+eng')
- PDF: pdfplumber.extract_text() → 텍스트 없으면 .images blob → _ocr_image_blob 폴백
- docx: python-docx 텍스트 추출
- xlsx: openpyxl 시트별 셀 텍스트 join
- pptx: python-pptx 텍스트 + 도형 이미지 OCR
- txt: 그대로
"""

from pathlib import Path
import logging

import pdfplumber
from docx import Document as DocxDocument
from openpyxl import load_workbook
from pptx import Presentation

# chunking.py:_ocr_image_blob 가져오기
from chunking import _ocr_image_blob

logger = logging.getLogger(__name__)

_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_PDF_MIME = "application/pdf"
_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
_TEXT_MIME = "text/plain"


def extract_text(file_path: Path, mime_type: str) -> str:
    """동기 함수. 첨부 파일에서 텍스트 추출. 실패 시 빈 문자열 반환 + warn 로그."""
    try:
        if mime_type in _IMAGE_MIMES:
            return _ocr_image_blob(file_path.read_bytes())
        if mime_type == _PDF_MIME:
            return _extract_pdf(file_path)
        if mime_type == _DOCX_MIME:
            return _extract_docx(file_path)
        if mime_type == _XLSX_MIME:
            return _extract_xlsx(file_path)
        if mime_type == _PPTX_MIME:
            return _extract_pptx(file_path)
        if mime_type == _TEXT_MIME:
            return file_path.read_text(encoding="utf-8", errors="replace")
        logger.warning("Unsupported MIME for OCR: %s (%s)", mime_type, file_path)
        return ""
    except Exception as exc:
        logger.warning("OCR 실패 (%s, %s): %s", file_path, mime_type, exc)
        return ""


def _extract_pdf(path: Path) -> str:
    """pdfplumber 우선. 텍스트 미추출 시 페이지 이미지 blob → OCR."""
    parts: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            txt = page.extract_text() or ""
            if txt.strip():
                parts.append(txt)
                continue
            # 텍스트 없는 페이지 — 이미지 OCR 폴백
            for img in page.images:
                # img는 dict (x0, top, x1, bottom, stream). 이미지 blob 추출
                try:
                    img_obj = page.crop((img["x0"], img["top"], img["x1"], img["bottom"])).to_image(resolution=150)
                    import io
                    buf = io.BytesIO()
                    img_obj.save(buf, format="PNG")
                    parts.append(_ocr_image_blob(buf.getvalue()))
                except Exception as exc:
                    logger.warning("PDF page OCR fallback fail: %s", exc)
    return "\n\n".join(p for p in parts if p.strip())


def _extract_docx(path: Path) -> str:
    doc = DocxDocument(path)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _extract_xlsx(path: Path) -> str:
    wb = load_workbook(path, read_only=True, data_only=True)
    parts: list[str] = []
    for sheet in wb.worksheets:
        sheet_lines = [f"[Sheet: {sheet.title}]"]
        for row in sheet.iter_rows(values_only=True):
            cells = [str(c) for c in row if c is not None]
            if cells:
                sheet_lines.append("\t".join(cells))
        parts.append("\n".join(sheet_lines))
    wb.close()
    return "\n\n".join(parts)


def _extract_pptx(path: Path) -> str:
    prs = Presentation(path)
    parts: list[str] = []
    for slide_idx, slide in enumerate(prs.slides, 1):
        slide_parts = [f"[Slide {slide_idx}]"]
        for shape in slide.shapes:
            if shape.has_text_frame:
                for p in shape.text_frame.paragraphs:
                    txt = "".join(r.text for r in p.runs)
                    if txt.strip():
                        slide_parts.append(txt)
            # 도형 이미지 — try OCR
            if hasattr(shape, "image") and shape.image:
                try:
                    slide_parts.append(_ocr_image_blob(shape.image.blob))
                except Exception:
                    pass
        parts.append("\n".join(slide_parts))
    return "\n\n".join(parts)
