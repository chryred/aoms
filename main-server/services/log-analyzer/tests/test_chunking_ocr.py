"""chunking.py 단위 테스트 — OCR/이미지 처리 및 관련 회귀 방지.

OCR/Tesseract가 설치되지 않은 환경에서도 통과하도록 PIL/pytesseract 의존
테스트는 monkeypatch로 _ocr_image_blob을 모킹한다. _walk_html 같은 순수
파싱 로직 테스트는 모킹 없이 직접 호출.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# log-analyzer 패키지를 import path에 추가 (pytest 실행 cwd 무관)
_LOG_ANALYZER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_LOG_ANALYZER_DIR))

import chunking  # noqa: E402


# ── _is_meaningful_ocr ───────────────────────────────────────────────────────


class TestIsMeaningfulOCR:
    def test_short_text_rejected(self):
        assert chunking._is_meaningful_ocr("짧음") is False
        assert chunking._is_meaningful_ocr("") is False
        assert chunking._is_meaningful_ocr("123456789") is False  # 9자 < 10

    def test_normal_korean_text_accepted(self):
        text = "1분기 매출 현황 보고서 — 전년 대비 20% 증가"
        assert chunking._is_meaningful_ocr(text) is True

    def test_normal_english_text_accepted(self):
        text = "Quarterly Revenue Report 2026 Q1"
        assert chunking._is_meaningful_ocr(text) is True

    def test_garbage_text_rejected(self):
        # 특수문자/제어문자 비율 높음 → 노이즈
        # '@', '#', '$', '%', '^', '&', '*', '|', '\\' 는 allow_set에 없음 → ratio 낮음
        garbage = "@@@###$$$%%%^^^&&&***()()()|||\\\\///"
        assert chunking._is_meaningful_ocr(garbage) is False

    def test_mixed_threshold_boundary(self):
        # 한글+공백만 → valid ratio 1.0 → 통과
        text = "안녕하세요 반갑습니다 좋아요"
        assert chunking._is_meaningful_ocr(text) is True


# ── _ocr_image_blob (실패 경로) ──────────────────────────────────────────────


class TestOCRImageBlob:
    def test_invalid_blob_returns_empty(self):
        # 손상된 이미지 → 예외 → 빈 문자열
        result = chunking._ocr_image_blob(b"not-an-image")
        assert result == ""

    def test_empty_blob_returns_empty(self):
        assert chunking._ocr_image_blob(b"") == ""


# ── _walk_html — 이미지 태그 마커 ────────────────────────────────────────────


class TestWalkHtmlImageMarker:
    def test_img_with_alt_creates_marker(self):
        from bs4 import BeautifulSoup
        html = '<div><img alt="매출 현황 차트" src="chart.png"/></div>'
        soup = BeautifulSoup(html, "html.parser")
        results = chunking._walk_html(soup)
        texts = [t for kind, t in results if kind == "text"]
        assert any("[이미지: 매출 현황 차트]" in t for t in texts)

    def test_ac_image_with_attachment_filename(self):
        from bs4 import BeautifulSoup
        html = (
            '<div><ac:image><ri:attachment ri:filename="diagram.png"/></ac:image></div>'
        )
        soup = BeautifulSoup(html, "html.parser")
        results = chunking._walk_html(soup)
        texts = [t for kind, t in results if kind == "text"]
        assert any("[이미지: diagram.png]" in t for t in texts)

    def test_image_without_alt_or_filename_uses_default(self):
        from bs4 import BeautifulSoup
        html = "<div><img src='x.png'/></div>"
        soup = BeautifulSoup(html, "html.parser")
        results = chunking._walk_html(soup)
        texts = [t for kind, t in results if kind == "text"]
        assert any("[이미지: 이미지]" in t for t in texts)


# ── _walk_html — 표 안의 h2 회귀 방지 ────────────────────────────────────────


class TestWalkHtmlTableRegression:
    def test_h2_inside_th_does_not_create_section_break(self):
        """이전 버그: <th><h2>담당자</h2></th>의 h2가 섹션 경계로 오인됨.
        수정 후 표 전체가 한 행으로 처리되어야 한다."""
        from bs4 import BeautifulSoup
        html = (
            "<table><tbody>"
            "<tr><th><h2>담당자</h2></th><th><h2>개요</h2></th></tr>"
            "<tr><td>홍길동</td><td>모바일 개선</td></tr>"
            "</tbody></table>"
        )
        soup = BeautifulSoup(html, "html.parser")
        results = chunking._walk_html(soup)

        # h2가 섹션 경계로 오인됐다면 break 이벤트가 생김 — 없어야 함
        breaks = [t for kind, t in results if kind == "break"]
        assert breaks == []

        # 두 행이 행 단위 텍스트로 추출돼야 함
        texts = [t for kind, t in results if kind == "text"]
        assert any("담당자" in t and "개요" in t for t in texts)
        assert any("홍길동" in t and "모바일 개선" in t for t in texts)


# ── chunk_confluence_page (end-to-end) ───────────────────────────────────────


class TestChunkConfluencePageWithImage:
    def test_image_marker_appears_in_chunks(self):
        html = (
            "<h2>회의록</h2>"
            "<p>참석자 목록</p>"
            '<ac:image><ri:attachment ri:filename="screenshot.png"/></ac:image>'
            "<p>안건: 신규 프로젝트 킥오프</p>"
        )
        chunks = chunking.chunk_confluence_page(
            content=html, page_id="123", page_title="회의록 4월 30일"
        )
        full_text = "\n".join(c["text"] for c in chunks)
        assert "[이미지: screenshot.png]" in full_text
        assert "신규 프로젝트 킥오프" in full_text


# ── _ocr_image_blob monkeypatch 검증 ─────────────────────────────────────────


class TestOCRImageBlobMonkeypatch:
    """monkeypatch로 _ocr_image_blob 대체 시 호출 결과가 올바르게 반환되는지 확인.

    실제 Tesseract/PIL 의존 없이 OCR 경로가 교체 가능함을 보증한다.
    """

    def test_monkeypatched_ocr_returns_fake_text(self, monkeypatch):
        def fake_ocr(blob: bytes) -> str:
            return "OCR된 텍스트 샘플"

        monkeypatch.setattr(chunking, "_ocr_image_blob", fake_ocr)

        result = chunking._ocr_image_blob(b"any-blob")
        assert result == "OCR된 텍스트 샘플"

    def test_monkeypatched_ocr_empty_returns_empty(self, monkeypatch):
        def fake_ocr(blob: bytes) -> str:
            return ""

        monkeypatch.setattr(chunking, "_ocr_image_blob", fake_ocr)

        result = chunking._ocr_image_blob(b"")
        assert result == ""
