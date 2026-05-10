"""chunking.py 단위 테스트 — OCR/이미지 처리 및 관련 회귀 방지.

OCR/Tesseract가 설치되지 않은 환경에서도 통과하도록 PIL/pytesseract 의존
테스트는 monkeypatch로 _ocr_image_blob을 모킹한다. _walk_html 같은 순수
파싱 로직 테스트는 모킹 없이 직접 호출.

chunk_pdf OCR 테스트도 포함:
- Tesseract 불필요 (_ocr_image_blob 전체를 monkeypatch로 대체)
- pdfplumber + pypdf 양쪽을 mock으로 대체
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


# ── _ocr_image_blob stats 카운터 ─────────────────────────────────────────────


class TestOCRImageBlobStats:
    """stats 딕셔너리 전달 시 카운터 누적 검증."""

    def test_exception_increments_failed(self, monkeypatch):
        """예외 발생 시 ocr_attempted + ocr_failed += 1."""
        # PIL/pytesseract 없는 환경에서 손상된 blob → 예외 경로
        stats = chunking.make_ocr_stats()
        chunking._ocr_image_blob(b"bad-blob", stats=stats)
        assert stats["ocr_attempted"] == 1
        assert stats["ocr_failed"] == 1
        assert stats["ocr_succeeded"] == 0
        assert stats["ocr_noise_filtered"] == 0

    def test_exception_logs_warning(self, monkeypatch, caplog):
        """예외 발생 시 logger.warning 호출 검증."""
        import logging
        with caplog.at_level(logging.WARNING, logger="chunking"):
            chunking._ocr_image_blob(b"bad-blob")
        # logger.warning 메시지에 "OCR exception:" 포함
        assert any("OCR exception:" in r.message for r in caplog.records)

    def test_noise_filtered_increments(self, monkeypatch):
        """_is_meaningful_ocr이 False → ocr_noise_filtered += 1."""
        def _fake_ocr_noise(img, lang, timeout):
            return "짧"  # 1자 → _is_meaningful_ocr 반환 False

        monkeypatch.setattr("chunking._is_meaningful_ocr", lambda t: False)

        # PIL/pytesseract를 mock으로 대체해 OCR 자체가 노이즈 결과 반환하게 함
        import types, io
        fake_pil_image = types.SimpleNamespace(
            open=lambda buf: types.SimpleNamespace()
        )
        monkeypatch.setitem(sys.modules, "PIL", types.SimpleNamespace(Image=fake_pil_image))
        monkeypatch.setitem(sys.modules, "PIL.Image", fake_pil_image)

        fake_pytesseract = types.SimpleNamespace(
            image_to_string=lambda img, lang, timeout: "짧"
        )
        monkeypatch.setitem(sys.modules, "pytesseract", fake_pytesseract)

        stats = chunking.make_ocr_stats()
        result = chunking._ocr_image_blob(b"fake-image-bytes", stats=stats)
        assert result == ""
        assert stats["ocr_attempted"] == 1
        assert stats["ocr_noise_filtered"] == 1
        assert stats["ocr_succeeded"] == 0

    def test_success_increments(self, monkeypatch):
        """OCR 성공 → ocr_succeeded += 1."""
        import types
        fake_pil_image = types.SimpleNamespace(
            open=lambda buf: types.SimpleNamespace()
        )
        monkeypatch.setitem(sys.modules, "PIL", types.SimpleNamespace(Image=fake_pil_image))
        monkeypatch.setitem(sys.modules, "PIL.Image", fake_pil_image)

        meaningful_text = "1분기 매출 현황 보고서 — 전년 대비 20% 증가"
        fake_pytesseract = types.SimpleNamespace(
            image_to_string=lambda img, lang, timeout: meaningful_text
        )
        monkeypatch.setitem(sys.modules, "pytesseract", fake_pytesseract)

        stats = chunking.make_ocr_stats()
        result = chunking._ocr_image_blob(b"fake-image-bytes", stats=stats)
        assert result == meaningful_text.strip()
        assert stats["ocr_attempted"] == 1
        assert stats["ocr_succeeded"] == 1
        assert stats["ocr_failed"] == 0
        assert stats["ocr_noise_filtered"] == 0

    def test_none_stats_does_not_raise(self):
        """stats=None (기본값) 이면 기존 동작 그대로."""
        # 손상된 blob이어도 예외를 삼키고 빈 문자열 반환
        result = chunking._ocr_image_blob(b"bad-blob", stats=None)
        assert result == ""

    def test_make_ocr_stats_keys(self):
        """make_ocr_stats() 반환값이 4개 키 0 초기화인지 검증."""
        s = chunking.make_ocr_stats()
        assert set(s.keys()) == {"ocr_attempted", "ocr_succeeded", "ocr_noise_filtered", "ocr_failed"}
        assert all(v == 0 for v in s.values())

    def test_counter_invariant(self):
        """ocr_attempted == ocr_succeeded + ocr_noise_filtered + ocr_failed"""
        stats = chunking.make_ocr_stats()
        # 3번 실패 시뮬레이션 (손상된 blob)
        for _ in range(3):
            chunking._ocr_image_blob(b"bad", stats=stats)
        assert stats["ocr_attempted"] == stats["ocr_succeeded"] + stats["ocr_noise_filtered"] + stats["ocr_failed"]


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
    fake_ocr은 stats 인자를 수용해야 BC를 유지할 수 있다.
    """

    def test_monkeypatched_ocr_returns_fake_text(self, monkeypatch):
        def fake_ocr(blob: bytes, stats: dict | None = None) -> str:
            return "OCR된 텍스트 샘플"

        monkeypatch.setattr(chunking, "_ocr_image_blob", fake_ocr)

        result = chunking._ocr_image_blob(b"any-blob")
        assert result == "OCR된 텍스트 샘플"

    def test_monkeypatched_ocr_empty_returns_empty(self, monkeypatch):
        def fake_ocr(blob: bytes, stats: dict | None = None) -> str:
            return ""

        monkeypatch.setattr(chunking, "_ocr_image_blob", fake_ocr)

        result = chunking._ocr_image_blob(b"")
        assert result == ""


# ── chunk_pdf OCR (monkeypatch) ───────────────────────────────────────────────


def _make_pdf_mocks(monkeypatch, pages_text, pages_images=None):
    """pdfplumber + pypdf mock 헬퍼 (chunk_pdf OCR 테스트 전용).

    pages_text:   list[str]             — 페이지 텍스트 (빈 문자열 = 텍스트 없음)
    pages_images: list[list[bytes]]     — 페이지별 이미지 blob 목록
                  None이면 모든 페이지 이미지 없음
    """
    import sys as _sys
    import types

    class _MockPdfPage:
        def __init__(self, text):
            self._text = text

        def extract_text(self):
            return self._text

    class _MockPdf:
        def __init__(self, pages):
            self.pages = pages

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def _mock_pdfplumber_open(_path):
        return _MockPdf([_MockPdfPage(t) for t in pages_text])

    monkeypatch.setitem(_sys.modules, "pdfplumber", types.SimpleNamespace(open=_mock_pdfplumber_open))

    class _MockImageFile:
        def __init__(self, blob):
            self.data = blob

    class _MockPypdfPage:
        def __init__(self, blobs):
            self._blobs = blobs

        @property
        def images(self):
            return [_MockImageFile(b) for b in self._blobs]

    class _MockPypdfReader:
        def __init__(self, pages):
            self.pages = pages

    resolved = pages_images if pages_images is not None else [[] for _ in pages_text]
    monkeypatch.setitem(
        _sys.modules,
        "pypdf",
        types.SimpleNamespace(PdfReader=lambda _path: _MockPypdfReader([_MockPypdfPage(imgs) for imgs in resolved])),
    )


class TestChunkPdfOCR:
    """chunk_pdf inline image OCR 경로 검증.

    Tesseract 미설치 환경에서도 통과하도록 _ocr_image_blob을 monkeypatch로 대체.
    pdfplumber + pypdf 양쪽도 mock으로 대체 — 실제 PDF 파일 불필요.
    monkeypatch lambda는 stats 키워드 인자를 수용해야 함.
    """

    def test_text_only_page_no_markers(self, monkeypatch):
        """이미지 없는 PDF — 텍스트만 청킹, 마커 없음."""
        _make_pdf_mocks(monkeypatch, pages_text=["페이지 1 본문입니다."])
        monkeypatch.setattr(chunking, "_ocr_image_blob", lambda b, stats=None: "절대 호출 안 됨")

        chunks = chunking.chunk_pdf("/fake/text_only.pdf")
        assert len(chunks) == 1
        assert "[이미지:" not in chunks[0]["text"]
        assert "페이지 1 본문입니다." in chunks[0]["text"]

    def test_image_and_text_page_marker_appended(self, monkeypatch):
        """텍스트 + 이미지 PDF — 텍스트 뒤에 [이미지: ...] 마커 추가."""
        _make_pdf_mocks(
            monkeypatch,
            pages_text=["본문 텍스트입니다."],
            pages_images=[[b"fake-image-blob"]],
        )
        monkeypatch.setattr(chunking, "_ocr_image_blob", lambda b, stats=None: "OCR 인식 결과 텍스트")

        chunks = chunking.chunk_pdf("/fake/text_and_image.pdf")
        full = " ".join(c["text"] for c in chunks)
        assert "본문 텍스트입니다." in full
        assert "[이미지: OCR 인식 결과 텍스트]" in full

    def test_scan_only_page_ocr_as_only_content(self, monkeypatch):
        """스캔 PDF — 텍스트 없고 OCR 결과만 있음 → 마커가 유일한 내용."""
        _make_pdf_mocks(
            monkeypatch,
            pages_text=[""],  # extract_text 결과 없음
            pages_images=[[b"scan-blob"]],
        )
        monkeypatch.setattr(chunking, "_ocr_image_blob", lambda b, stats=None: "스캔 문서 본문 내용입니다")

        chunks = chunking.chunk_pdf("/fake/scan_only.pdf")
        assert len(chunks) >= 1
        assert "[이미지: 스캔 문서 본문 내용입니다]" in chunks[0]["text"]

    def test_ocr_failure_silent_chunking_continues(self, monkeypatch):
        """OCR 실패(빈 문자열 반환) — 마커 없음, 텍스트 청킹 정상 진행."""
        _make_pdf_mocks(
            monkeypatch,
            pages_text=["정상 텍스트 페이지입니다."],
            pages_images=[[b"corrupt-blob"]],
        )
        # OCR 항상 실패(빈 문자열) 시뮬레이션
        monkeypatch.setattr(chunking, "_ocr_image_blob", lambda b, stats=None: "")

        chunks = chunking.chunk_pdf("/fake/ocr_fail.pdf")
        assert len(chunks) == 1
        assert "[이미지:" not in chunks[0]["text"]
        assert "정상 텍스트 페이지입니다." in chunks[0]["text"]

    def test_image_cap_limits_ocr_to_ten(self, monkeypatch):
        """페이지 이미지가 11장이면 10장까지만 OCR 시도 (상한 초과분 건너뜀)."""
        call_count = {"n": 0}

        def counting_ocr(blob: bytes, stats: dict | None = None) -> str:
            call_count["n"] += 1
            return "이미지 텍스트 충분히 길어야 함"

        _make_pdf_mocks(
            monkeypatch,
            pages_text=[""],
            pages_images=[[b"blob"] * 11],  # 11장
        )
        monkeypatch.setattr(chunking, "_ocr_image_blob", counting_ocr)

        chunking.chunk_pdf("/fake/many_images.pdf")
        assert call_count["n"] == chunking._PDF_MAX_IMAGES_PER_PAGE  # 10장만

    def test_both_text_empty_and_ocr_empty_page_skipped(self, monkeypatch):
        """텍스트 없고 OCR도 빈 결과 → 완전 빈 페이지는 청크 생성 안 함."""
        _make_pdf_mocks(
            monkeypatch,
            pages_text=["", "두 번째 페이지 텍스트"],
            pages_images=[[b"useless-image"], []],
        )
        monkeypatch.setattr(chunking, "_ocr_image_blob", lambda b, stats=None: "")

        chunks = chunking.chunk_pdf("/fake/mixed.pdf")
        # 첫 페이지는 텍스트도 OCR도 없음 → 청크 없음
        # 두 번째 페이지만 청크 생성
        assert len(chunks) == 1
        assert chunks[0]["metadata"]["page_no"] == 2

    def test_pypdf_open_failure_falls_back_to_text_only(self, monkeypatch):
        """pypdf.PdfReader 실패 시 image OCR 건너뛰고 텍스트 청킹은 정상 진행."""
        import sys as _sys, types

        # pdfplumber mock
        class _MockPage:
            def extract_text(self):
                return "텍스트는 여전히 추출 가능"

        class _MockPdf:
            pages = [_MockPage()]

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        monkeypatch.setitem(
            _sys.modules, "pdfplumber", types.SimpleNamespace(open=lambda _: _MockPdf())
        )

        # pypdf raises on open
        def _failing_reader(_path):
            raise RuntimeError("PDF 파일 손상")

        monkeypatch.setitem(
            _sys.modules, "pypdf", types.SimpleNamespace(PdfReader=_failing_reader)
        )

        chunks = chunking.chunk_pdf("/fake/broken.pdf")
        assert len(chunks) == 1
        assert "텍스트는 여전히 추출 가능" in chunks[0]["text"]
        assert "[이미지:" not in chunks[0]["text"]

    def test_stats_accumulated_on_pdf_ocr_success(self, monkeypatch):
        """chunk_pdf에 stats 전달 시 OCR 성공 카운터 누적 검증."""
        _make_pdf_mocks(
            monkeypatch,
            pages_text=[""],
            pages_images=[[b"blob1", b"blob2"]],
        )
        call_count = {"n": 0}

        def fake_ocr(blob: bytes, stats: dict | None = None) -> str:
            call_count["n"] += 1
            if stats is not None:
                stats["ocr_attempted"] += 1
                stats["ocr_succeeded"] += 1
            return "이미지 텍스트 충분히 길어야 함"

        monkeypatch.setattr(chunking, "_ocr_image_blob", fake_ocr)

        stats = chunking.make_ocr_stats()
        chunking.chunk_pdf("/fake/two_images.pdf", stats=stats)
        assert call_count["n"] == 2
        assert stats["ocr_attempted"] == 2
        assert stats["ocr_succeeded"] == 2

    def test_stats_accumulated_on_pdf_ocr_failure(self, monkeypatch):
        """chunk_pdf에 stats 전달 시 OCR 실패 카운터 누적 검증."""
        _make_pdf_mocks(
            monkeypatch,
            pages_text=["본문 있음"],
            pages_images=[[b"bad-blob"]],
        )

        def fake_ocr_fail(blob: bytes, stats: dict | None = None) -> str:
            if stats is not None:
                stats["ocr_attempted"] += 1
                stats["ocr_failed"] += 1
            return ""

        monkeypatch.setattr(chunking, "_ocr_image_blob", fake_ocr_fail)

        stats = chunking.make_ocr_stats()
        chunking.chunk_pdf("/fake/one_fail.pdf", stats=stats)
        assert stats["ocr_attempted"] == 1
        assert stats["ocr_failed"] == 1

    def test_cap_skipped_images_not_counted(self, monkeypatch):
        """상한(10장) 초과로 건너뛴 이미지는 ocr_attempted에 포함 안 됨."""
        _make_pdf_mocks(
            monkeypatch,
            pages_text=[""],
            pages_images=[[b"blob"] * 11],  # 11장 → 10장만 시도, 1장 건너뜀
        )

        def fake_ocr(blob: bytes, stats: dict | None = None) -> str:
            if stats is not None:
                stats["ocr_attempted"] += 1
                stats["ocr_succeeded"] += 1
            return "텍스트 충분히 길어야 통과"

        monkeypatch.setattr(chunking, "_ocr_image_blob", fake_ocr)

        stats = chunking.make_ocr_stats()
        chunking.chunk_pdf("/fake/eleven.pdf", stats=stats)
        # 상한 초과 1장은 _ocr_image_blob 호출 자체가 안 됨 → ocr_attempted = 10
        assert stats["ocr_attempted"] == chunking._PDF_MAX_IMAGES_PER_PAGE
