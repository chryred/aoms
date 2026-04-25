"""문서 포맷별 청킹 전략 (한국어 RAG 최적화).

청크 크기: 1500자 (한국어 ≈ 800~1000 토큰, bge-m3 8192 한도 내 안전 마진)
오버랩: 200자 (의미 연결 보존)

각 함수는 list[dict] 반환:
  [{"text": "...", "metadata": {"chunk_index": 0, "source_type": "...", ...}}]

설계 원칙:
- 순수 텍스트 sliding window는 ``chunk_text``를 베이스로 모든 포맷이 재사용
- 한국어 청크 경계는 단어/조사 중간을 피하기 위해 단락(\\n\\n) → 줄바꿈(\\n) → 공백 순으로 백트래킹
- xlsx/pptx는 의미 단위(시트/슬라이드)가 곧 청크 — 1500자를 넘어도 분할하지 않음
- vector_client.py 등 기존 모듈은 수정하지 않음 (이 모듈은 독립 유틸리티)
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


# ── 베이스: 텍스트 sliding window ──────────────────────────────────────────────

def _find_break_point(text: str, end: int, lookback: int) -> int:
    """``end`` 위치 기준으로 단락→줄바꿈→공백 순으로 거꾸로 탐색해 끊기 좋은 지점 반환.

    ``lookback`` 범위 내에서 적절한 경계를 찾지 못하면 ``end``를 그대로 돌려준다.
    한국어 청크가 조사/단어 중간에서 끊기는 것을 막기 위한 보조 함수.
    """
    if end >= len(text):
        return len(text)
    window_start = max(0, end - lookback)
    # 단락 경계 우선
    para_break = text.rfind("\n\n", window_start, end)
    if para_break != -1 and para_break > window_start:
        return para_break + 2
    # 줄바꿈
    newline = text.rfind("\n", window_start, end)
    if newline != -1 and newline > window_start:
        return newline + 1
    # 공백
    space = text.rfind(" ", window_start, end)
    if space != -1 and space > window_start:
        return space + 1
    # 적절한 경계 없으면 그대로 자름
    return end


def chunk_text(
    text: str,
    max_chars: int = 1500,
    overlap: int = 200,
    base_metadata: dict | None = None,
) -> list[dict]:
    """순수 텍스트 sliding window 청킹 (베이스 함수).

    - ``max_chars``: 청크 최대 길이 (한국어 1500자 ≈ 800~1000 토큰 권장)
    - ``overlap``: 인접 청크 간 중첩 길이 (의미 연결 보존)
    - ``base_metadata``: 모든 청크에 공통으로 박을 메타데이터 (선택)

    경계가 단어 중간이면 ``_find_break_point``로 단락/줄바꿈/공백 위치까지 백트래킹한다.
    """
    if not text:
        return []
    if max_chars <= 0:
        raise ValueError("max_chars must be > 0")
    if overlap < 0 or overlap >= max_chars:
        raise ValueError("overlap must be in [0, max_chars)")

    base_meta = dict(base_metadata) if base_metadata else {}
    chunks: list[dict] = []
    n = len(text)
    start = 0
    chunk_index = 0

    while start < n:
        tentative_end = min(start + max_chars, n)
        if tentative_end < n:
            end = _find_break_point(text, tentative_end, lookback=overlap)
            # 백트래킹이 너무 짧게 끊으면 그대로 사용
            if end <= start:
                end = tentative_end
        else:
            end = n

        piece = text[start:end].strip()
        if piece:
            meta = dict(base_meta)
            meta["chunk_index"] = chunk_index
            chunks.append({"text": piece, "metadata": meta})
            chunk_index += 1

        if end >= n:
            break
        # 다음 시작점: end - overlap (단, 진행을 보장)
        next_start = end - overlap
        if next_start <= start:
            next_start = start + 1
        start = next_start

    return chunks


# ── Confluence 페이지 (HTML or 텍스트) ─────────────────────────────────────────

def _looks_like_html(text: str) -> bool:
    snippet = text[:512].lower()
    return "<" in snippet and (">" in snippet) and any(
        tag in snippet for tag in ("<p", "<div", "<h1", "<h2", "<h3", "<span", "<br", "<ul", "<ol", "<table")
    )


def chunk_confluence_page(
    content: str,
    page_id: str,
    page_title: str,
    space: str = "",
    **extra_meta: Any,
) -> list[dict]:
    """Confluence 페이지: H2/H3 heading 우선 분할 → 큰 섹션은 sliding window.

    - HTML이면 BeautifulSoup으로 파싱 후 H2/H3 경계로 섹션 분할
    - plain text면 ``chunk_text``로 바로 분할
    - 각 섹션이 1500자를 넘으면 ``chunk_text``를 다시 적용
    - 메타에 heading(있으면), page_id, page_title, space, source_type='confluence' 보존
    """
    if not content:
        return []

    base_meta: dict[str, Any] = {
        "source_type": "confluence",
        "page_id": page_id,
        "page_title": page_title,
    }
    if space:
        base_meta["space"] = space
    for k, v in extra_meta.items():
        base_meta[k] = v

    if not _looks_like_html(content):
        return chunk_text(content, base_metadata=base_meta)

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(content, "html.parser")

    # 본문 흐름 순서대로 H2/H3을 경계로 섹션을 끊는다.
    sections: list[tuple[str, str]] = []  # (heading, text)
    current_heading = ""
    current_buffer: list[str] = []

    # body 또는 root 직속 자식들을 순회해 헤딩 기준으로 분할
    root = soup.body if soup.body else soup
    for elem in root.descendants:
        if not getattr(elem, "name", None):
            continue
        if elem.name in ("h2", "h3"):
            # 누적된 본문을 섹션으로 확정
            buf_text = "\n".join(s for s in current_buffer if s).strip()
            if buf_text:
                sections.append((current_heading, buf_text))
            current_heading = elem.get_text(strip=True)
            current_buffer = []
        elif elem.name in ("p", "li", "td", "th", "pre", "blockquote", "h1", "h4", "h5", "h6"):
            txt = elem.get_text(separator=" ", strip=True)
            if txt:
                current_buffer.append(txt)

    # 마지막 섹션 마무리
    tail = "\n".join(s for s in current_buffer if s).strip()
    if tail:
        sections.append((current_heading, tail))

    # 헤딩이 하나도 없었던 경우(=descendants 순회로 잡히는 게 없음): 전체 텍스트를 하나로
    if not sections:
        plain = soup.get_text(separator="\n", strip=True)
        return chunk_text(plain, base_metadata=base_meta)

    chunks: list[dict] = []
    chunk_index = 0
    for heading, body in sections:
        if not body:
            continue
        section_meta = dict(base_meta)
        if heading:
            section_meta["heading"] = heading
        # 섹션이 작으면 1 청크, 크면 sliding window
        if len(body) <= 1500:
            section_meta["chunk_index"] = chunk_index
            chunks.append({"text": body, "metadata": section_meta})
            chunk_index += 1
        else:
            sub_chunks = chunk_text(body, base_metadata=section_meta)
            for sc in sub_chunks:
                # chunk_text는 chunk_index를 0부터 부여 → 전역 인덱스로 재할당
                sc["metadata"]["chunk_index"] = chunk_index
                chunks.append(sc)
                chunk_index += 1

    return chunks


# ── DOCX ─────────────────────────────────────────────────────────────────────

def chunk_docx(
    file_path: str,
    max_chars: int = 1500,
    overlap: int = 200,
) -> list[dict]:
    """DOCX 파일: paragraphs 합쳐서 sliding window 청킹.

    - paragraphs와 tables(행 단위)에서 텍스트 추출
    - 단락 사이는 \\n\\n으로 결합 → ``chunk_text``의 단락 경계 백트래킹과 결합
    - metadata: ``{file_name, doc_type: "docx"}``
    """
    from docx import Document

    doc = Document(file_path)
    parts: list[str] = []

    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            parts.append(text)

    for table in doc.tables:
        for row in table.rows:
            row_cells = [cell.text.strip() for cell in row.cells]
            row_text = " | ".join(c for c in row_cells if c)
            if row_text:
                parts.append(row_text)

    full_text = "\n\n".join(parts)
    base_meta = {
        "source_type": "docx",
        "doc_type": "docx",
        "file_name": os.path.basename(file_path),
    }
    return chunk_text(full_text, max_chars=max_chars, overlap=overlap, base_metadata=base_meta)


# ── PDF ──────────────────────────────────────────────────────────────────────

def chunk_pdf(
    file_path: str,
    max_chars: int = 1500,
    overlap: int = 200,
) -> list[dict]:
    """PDF 파일: 페이지별 텍스트 추출 후 sliding window 청킹.

    - pdfplumber로 페이지 단위 추출
    - 페이지마다 ``chunk_text``로 분할(긴 페이지는 여러 청크가 됨)
    - metadata: ``{file_name, doc_type: "pdf", page_no}``
    - 청크 인덱스는 문서 전역으로 누적
    """
    import pdfplumber

    file_name = os.path.basename(file_path)
    chunks: list[dict] = []
    chunk_index = 0

    with pdfplumber.open(file_path) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            page_text = page.extract_text() or ""
            page_text = page_text.strip()
            if not page_text:
                continue
            page_meta = {
                "source_type": "pdf",
                "doc_type": "pdf",
                "file_name": file_name,
                "page_no": page_no,
            }
            sub = chunk_text(page_text, max_chars=max_chars, overlap=overlap, base_metadata=page_meta)
            for c in sub:
                c["metadata"]["chunk_index"] = chunk_index
                chunks.append(c)
                chunk_index += 1

    return chunks


# ── XLSX ─────────────────────────────────────────────────────────────────────

def _sheet_to_markdown(ws) -> str:
    """openpyxl Worksheet → markdown 표 형태 텍스트.

    - 첫 행을 헤더로 가정. 첫 행이 비어 있으면 그냥 cell 텍스트만 join.
    - 빈 행/완전히 비어 있는 시트는 ""를 돌려준다.
    """
    rows = list(ws.iter_rows(values_only=True))
    # 빈 셀만 있는 행 제거
    rows = [tuple("" if c is None else str(c) for c in row) for row in rows]
    rows = [row for row in rows if any(c.strip() for c in row)]
    if not rows:
        return ""

    # 열 폭 정규화 (가장 긴 행 기준)
    max_cols = max(len(r) for r in rows)
    rows = [r + ("",) * (max_cols - len(r)) for r in rows]

    header = rows[0]
    body = rows[1:] if len(rows) > 1 else []

    lines: list[str] = []
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * max_cols) + " |")
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def chunk_xlsx(file_path: str) -> list[dict]:
    """Excel 파일: 시트별 1 chunk (시트 = 표 단위 의미 묶음).

    - openpyxl 사용, 시트 전체를 markdown 표 형태로 변환
    - **한 시트가 1500자 초과해도 분할 안 함** (시트 의미 보존)
    - metadata: ``{file_name, sheet_name, doc_type: "xlsx"}``
    """
    from openpyxl import load_workbook

    wb = load_workbook(file_path, data_only=True, read_only=True)
    file_name = os.path.basename(file_path)

    chunks: list[dict] = []
    chunk_index = 0
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        sheet_text = _sheet_to_markdown(ws)
        if not sheet_text:
            continue
        # 시트명을 본문 맨 앞에 붙여 검색에 활용 가능하도록
        body = f"# {sheet_name}\n\n{sheet_text}"
        meta = {
            "source_type": "xlsx",
            "doc_type": "xlsx",
            "file_name": file_name,
            "sheet_name": sheet_name,
            "chunk_index": chunk_index,
        }
        chunks.append({"text": body, "metadata": meta})
        chunk_index += 1

    wb.close()
    return chunks


# ── PPTX ─────────────────────────────────────────────────────────────────────

def _shape_text(shape) -> str:
    """pptx shape에서 텍스트 추출 (text_frame, table 셀 모두 처리)."""
    chunks: list[str] = []
    if shape.has_text_frame:
        for para in shape.text_frame.paragraphs:
            text = "".join(run.text for run in para.runs).strip()
            if text:
                chunks.append(text)
    if shape.has_table:
        for row in shape.table.rows:
            row_cells = []
            for cell in row.cells:
                cell_text = cell.text.strip()
                if cell_text:
                    row_cells.append(cell_text)
            if row_cells:
                chunks.append(" | ".join(row_cells))
    return "\n".join(chunks)


def chunk_pptx(file_path: str) -> list[dict]:
    """PowerPoint 파일: 슬라이드별 1 chunk.

    - python-pptx 사용. title + body shapes의 text + speaker notes 합산
    - 표는 셀별 텍스트 추출
    - metadata: ``{file_name, slide_no, slide_title, doc_type: "pptx"}``
    - 슬라이드 의미 보존을 위해 길어도 분할하지 않음
    """
    from pptx import Presentation

    prs = Presentation(file_path)
    file_name = os.path.basename(file_path)

    chunks: list[dict] = []
    chunk_index = 0
    for slide_no, slide in enumerate(prs.slides, start=1):
        slide_title = ""
        body_parts: list[str] = []

        # title placeholder 우선 추출
        if slide.shapes.title is not None:
            try:
                slide_title = (slide.shapes.title.text or "").strip()
            except AttributeError:
                slide_title = ""

        for shape in slide.shapes:
            # 타이틀은 위에서 이미 처리 → 본문 부분만
            if shape == slide.shapes.title:
                continue
            txt = _shape_text(shape)
            if txt:
                body_parts.append(txt)

        # speaker notes
        notes_text = ""
        if slide.has_notes_slide and slide.notes_slide and slide.notes_slide.notes_text_frame:
            notes_text = (slide.notes_slide.notes_text_frame.text or "").strip()

        sections: list[str] = []
        if slide_title:
            sections.append(f"# {slide_title}")
        if body_parts:
            sections.append("\n".join(body_parts))
        if notes_text:
            sections.append(f"[발표자 노트]\n{notes_text}")

        if not sections:
            continue

        body = "\n\n".join(sections)
        meta = {
            "source_type": "pptx",
            "doc_type": "pptx",
            "file_name": file_name,
            "slide_no": slide_no,
            "slide_title": slide_title,
            "chunk_index": chunk_index,
        }
        chunks.append({"text": body, "metadata": meta})
        chunk_index += 1

    return chunks
