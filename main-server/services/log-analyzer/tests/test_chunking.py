"""chunking.py 단위 테스트 — 포맷별 청킹 전략 검증."""
import sys
from pathlib import Path

import pytest

# log-analyzer 루트 디렉터리를 import path에 추가
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chunking  # noqa: E402
from chunking import (  # noqa: E402
    _find_break_point,
    chunk_confluence_page,
    chunk_docx,
    chunk_pdf,
    chunk_pptx,
    chunk_text,
    chunk_xlsx,
)


# ── chunk_text ────────────────────────────────────────────────────────────────

def test_chunk_text_empty():
    assert chunk_text("") == []


def test_chunk_text_short():
    chunks = chunk_text("짧은 텍스트", max_chars=1500, overlap=200)
    assert len(chunks) == 1
    assert chunks[0]["text"] == "짧은 텍스트"
    assert chunks[0]["metadata"]["chunk_index"] == 0


def test_chunk_text_5000_chars_yields_4_chunks_with_overlap():
    """5000자(공백 없음) → max=1500, overlap=200 → 4 청크 + overlap 검증.

    공백/줄바꿈이 없으면 _find_break_point가 백트래킹 실패 → 그대로 자름.
    step = max - overlap = 1300
    [0,1500), [1300,2800), [2600,4100), [3900,5000) → 4 청크
    각 인접 청크의 마지막 200자 ⊂ 다음 청크 시작 200자
    """
    text = "가나다라" * 1250  # 5000자, 공백 없음
    assert len(text) == 5000

    chunks = chunk_text(text, max_chars=1500, overlap=200)
    assert len(chunks) == 4
    assert chunks[0]["metadata"]["chunk_index"] == 0
    assert chunks[3]["metadata"]["chunk_index"] == 3

    # 인접 청크 overlap 검증: 청크 N의 끝 200자가 청크 N+1의 시작에 포함
    for i in range(len(chunks) - 1):
        tail = chunks[i]["text"][-200:]
        head = chunks[i + 1]["text"][:200]
        assert tail == head, f"chunk {i}↔{i+1} overlap mismatch"


def test_chunk_text_prefers_paragraph_break():
    """단락(\\n\\n) 경계가 lookback 범위에 있으면 거기서 끊긴다."""
    # 1400자 + \n\n + 200자 → 첫 청크는 1400자 단락 끝에서 끊겨야 함
    para1 = "가" * 1400
    para2 = "나" * 200
    text = para1 + "\n\n" + para2
    chunks = chunk_text(text, max_chars=1500, overlap=200)
    # 첫 청크는 단락 경계에서 끊김 → para1만 포함
    assert chunks[0]["text"] == para1
    # 다음 청크는 para2부터
    assert "나" in chunks[1]["text"]


def test_chunk_text_with_base_metadata():
    chunks = chunk_text("hello world", base_metadata={"source": "manual"})
    assert chunks[0]["metadata"]["source"] == "manual"
    assert chunks[0]["metadata"]["chunk_index"] == 0


def test_chunk_text_invalid_overlap():
    with pytest.raises(ValueError):
        chunk_text("text", max_chars=100, overlap=100)
    with pytest.raises(ValueError):
        chunk_text("text", max_chars=100, overlap=-1)


def test_find_break_point_no_boundary():
    """경계가 없으면 end 그대로."""
    text = "가나다라마바사아자차"
    assert _find_break_point(text, 5, lookback=5) == 5


# ── chunk_confluence_page ─────────────────────────────────────────────────────

def test_chunk_confluence_page_html_with_h2_h3():
    """H2/H3 경계로 섹션 분할되는지 검증."""
    html = """
    <html><body>
      <h1>전체 제목</h1>
      <p>인트로 단락</p>
      <h2>섹션 1</h2>
      <p>섹션 1 본문 첫 단락</p>
      <p>섹션 1 본문 둘째 단락</p>
      <h2>섹션 2</h2>
      <p>섹션 2 본문</p>
      <h3>섹션 2-1</h3>
      <p>하위 섹션 본문</p>
    </body></html>
    """
    chunks = chunk_confluence_page(
        html, page_id="123", page_title="테스트 페이지", space="DOC"
    )
    # 인트로 + 섹션1 + 섹션2 + 섹션2-1 = 최소 3개 이상
    assert len(chunks) >= 3
    # 모든 청크가 공통 메타 보존
    for c in chunks:
        assert c["metadata"]["source_type"] == "confluence"
        assert c["metadata"]["page_id"] == "123"
        assert c["metadata"]["page_title"] == "테스트 페이지"
        assert c["metadata"]["space"] == "DOC"
    # 헤딩이 메타에 들어갔는지
    headings = {c["metadata"].get("heading") for c in chunks if c["metadata"].get("heading")}
    assert "섹션 1" in headings
    assert "섹션 2" in headings
    assert "섹션 2-1" in headings


def test_chunk_confluence_page_plain_text():
    """HTML이 아닌 plain text는 chunk_text로 fallback."""
    text = "단순 텍스트 본문입니다."
    chunks = chunk_confluence_page(text, page_id="p1", page_title="title")
    assert len(chunks) == 1
    assert chunks[0]["metadata"]["source_type"] == "confluence"
    assert chunks[0]["metadata"]["page_id"] == "p1"


def test_chunk_confluence_page_long_section_splits():
    """긴 섹션은 sliding window로 분할된다."""
    body = "가" * 3500
    html = f"<body><h2>긴 섹션</h2><p>{body}</p></body>"
    chunks = chunk_confluence_page(html, page_id="x", page_title="t")
    assert len(chunks) >= 2
    # 모두 동일 heading 메타
    for c in chunks:
        assert c["metadata"]["heading"] == "긴 섹션"


def test_chunk_confluence_page_empty():
    assert chunk_confluence_page("", page_id="x", page_title="t") == []


# ── chunk_docx ────────────────────────────────────────────────────────────────

def test_chunk_docx_basic(tmp_path):
    """python-docx로 가짜 docx 생성 → 청킹 결과 검증."""
    docx = pytest.importorskip("docx")
    from docx import Document

    doc = Document()
    doc.add_paragraph("첫 번째 단락입니다. 한국어 본문 내용.")
    doc.add_paragraph("두 번째 단락. 추가 내용이 들어 있습니다.")
    # 표 추가
    table = doc.add_table(rows=2, cols=2)
    table.rows[0].cells[0].text = "이름"
    table.rows[0].cells[1].text = "값"
    table.rows[1].cells[0].text = "CPU"
    table.rows[1].cells[1].text = "80%"

    file_path = tmp_path / "sample.docx"
    doc.save(str(file_path))

    chunks = chunk_docx(str(file_path))
    assert len(chunks) >= 1
    combined = "\n".join(c["text"] for c in chunks)
    assert "첫 번째 단락" in combined
    assert "두 번째 단락" in combined
    assert "CPU" in combined and "80%" in combined
    assert chunks[0]["metadata"]["doc_type"] == "docx"
    assert chunks[0]["metadata"]["file_name"] == "sample.docx"


def test_chunk_docx_long_paragraphs_split(tmp_path):
    """1500자 초과 시 여러 청크로 분할."""
    pytest.importorskip("docx")
    from docx import Document

    doc = Document()
    for _ in range(20):
        doc.add_paragraph("가" * 200)  # 단락당 200자, 총 4000자

    file_path = tmp_path / "long.docx"
    doc.save(str(file_path))

    chunks = chunk_docx(str(file_path), max_chars=1500, overlap=200)
    assert len(chunks) >= 2


# ── chunk_pdf (mock) ─────────────────────────────────────────────────────────

def test_chunk_pdf_mocked(monkeypatch):
    """pdfplumber를 mock으로 대체 → 페이지별 청킹 검증."""

    class _MockPage:
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

    def _mock_open(_path):
        return _MockPdf([
            _MockPage("페이지 1 본문입니다."),
            _MockPage("페이지 2 본문. 좀 더 길게 작성한 내용."),
            _MockPage(""),  # 빈 페이지는 건너뛰어야 함
            _MockPage("페이지 4 본문."),
        ])

    import sys as _sys
    import types
    fake_pdfplumber = types.SimpleNamespace(open=_mock_open)
    monkeypatch.setitem(_sys.modules, "pdfplumber", fake_pdfplumber)

    chunks = chunk_pdf("/fake/path/dummy.pdf")
    assert len(chunks) == 3  # 빈 페이지 제외
    page_nos = [c["metadata"]["page_no"] for c in chunks]
    assert page_nos == [1, 2, 4]
    for c in chunks:
        assert c["metadata"]["doc_type"] == "pdf"
        assert c["metadata"]["file_name"] == "dummy.pdf"
    # chunk_index 전역 누적
    assert [c["metadata"]["chunk_index"] for c in chunks] == [0, 1, 2]


# ── chunk_xlsx ────────────────────────────────────────────────────────────────

def test_chunk_xlsx_basic(tmp_path):
    """openpyxl로 가짜 xlsx 생성 → 시트 단위 청킹 검증."""
    pytest.importorskip("openpyxl")
    from openpyxl import Workbook

    wb = Workbook()
    ws1 = wb.active
    ws1.title = "메트릭"
    ws1.append(["항목", "값"])
    ws1.append(["CPU", "80%"])
    ws1.append(["MEM", "70%"])

    ws2 = wb.create_sheet(title="알림")
    ws2.append(["시각", "메시지"])
    ws2.append(["10:00", "고부하"])

    file_path = tmp_path / "report.xlsx"
    wb.save(str(file_path))

    chunks = chunk_xlsx(str(file_path))
    assert len(chunks) == 2  # 시트 = 청크
    sheet_names = [c["metadata"]["sheet_name"] for c in chunks]
    assert sheet_names == ["메트릭", "알림"]
    for c in chunks:
        assert c["metadata"]["doc_type"] == "xlsx"
        assert c["metadata"]["file_name"] == "report.xlsx"
        assert "|" in c["text"]  # markdown 표 형식
    # 메트릭 시트 본문에 데이터 포함
    metric_chunk = next(c for c in chunks if c["metadata"]["sheet_name"] == "메트릭")
    assert "CPU" in metric_chunk["text"]
    assert "80%" in metric_chunk["text"]


def test_chunk_xlsx_large_sheet_not_split(tmp_path):
    """1500자 초과해도 시트당 1청크 유지."""
    pytest.importorskip("openpyxl")
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "huge"
    ws.append(["col1", "col2"])
    for i in range(200):
        ws.append([f"value-{i}-가나다라마", f"value-{i}-바사아자차"])

    file_path = tmp_path / "huge.xlsx"
    wb.save(str(file_path))

    chunks = chunk_xlsx(str(file_path))
    assert len(chunks) == 1
    assert len(chunks[0]["text"]) > 1500  # 분할 안 됨


# ── chunk_pptx ────────────────────────────────────────────────────────────────

def test_chunk_pptx_basic(tmp_path):
    """python-pptx로 가짜 pptx 생성 → 슬라이드 단위 청킹 검증."""
    pytest.importorskip("pptx")
    from pptx import Presentation

    prs = Presentation()
    # 슬라이드 1 — 제목 + 본문
    slide_layout = prs.slide_layouts[1]  # Title and Content
    slide1 = prs.slides.add_slide(slide_layout)
    slide1.shapes.title.text = "첫 슬라이드"
    body_placeholder = slide1.placeholders[1]
    body_placeholder.text = "첫 슬라이드 본문 내용"
    # 발표자 노트 추가
    slide1.notes_slide.notes_text_frame.text = "발표자 메모입니다"

    # 슬라이드 2 — 제목만
    slide2 = prs.slides.add_slide(prs.slide_layouts[5])
    slide2.shapes.title.text = "두 번째 슬라이드"

    file_path = tmp_path / "deck.pptx"
    prs.save(str(file_path))

    chunks = chunk_pptx(str(file_path))
    assert len(chunks) == 2
    # 슬라이드 1
    assert chunks[0]["metadata"]["slide_no"] == 1
    assert chunks[0]["metadata"]["slide_title"] == "첫 슬라이드"
    assert chunks[0]["metadata"]["doc_type"] == "pptx"
    assert chunks[0]["metadata"]["file_name"] == "deck.pptx"
    assert "첫 슬라이드 본문 내용" in chunks[0]["text"]
    assert "발표자 메모" in chunks[0]["text"]
    # 슬라이드 2
    assert chunks[1]["metadata"]["slide_no"] == 2
    assert chunks[1]["metadata"]["slide_title"] == "두 번째 슬라이드"
