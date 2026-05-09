import base64
import uuid
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import UploadFile

from .config import settings


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".py", ".js", ".ts", ".html", ".css", ".log"}
PDF_EXTENSIONS = {".pdf"}

MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
}


async def save_upload(file: UploadFile) -> Path:
    suffix = Path(file.filename or "").suffix.lower()
    safe_name = f"{uuid.uuid4().hex}{suffix}"
    dest = settings.UPLOAD_DIR / safe_name

    total = 0
    async with aiofiles.open(dest, "wb") as f:
        while chunk := await file.read(64 * 1024):
            total += len(chunk)
            if total > settings.MAX_UPLOAD_BYTES:
                await f.close()
                dest.unlink(missing_ok=True)
                raise ValueError(
                    f"File exceeds maximum size of {settings.MAX_UPLOAD_BYTES // (1024 * 1024)} MB"
                )
            await f.write(chunk)
    return dest


def extract_text_from_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    try:
        reader = PdfReader(str(path))
        chunks = []
        for page in reader.pages:
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            if text.strip():
                chunks.append(text)
        return "\n\n".join(chunks).strip()
    except Exception:
        return ""


async def read_text_file(path: Path) -> str:
    try:
        async with aiofiles.open(path, "r", encoding="utf-8", errors="replace") as f:
            return await f.read()
    except Exception:
        return ""


def encode_image_data_url(path: Path) -> Optional[str]:
    suffix = path.suffix.lower()
    mime = MIME_BY_EXT.get(suffix)
    if not mime:
        return None
    try:
        b = path.read_bytes()
    except Exception:
        return None
    return f"data:{mime};base64,{base64.b64encode(b).decode('ascii')}"


async def process_upload(file: UploadFile) -> dict:
    """Save upload and return a dict with extracted info for the model."""
    path = await save_upload(file)
    suffix = path.suffix.lower()
    original_name = file.filename or path.name

    if suffix in IMAGE_EXTENSIONS:
        data_url = encode_image_data_url(path)
        return {
            "kind": "image",
            "name": original_name,
            "path": str(path),
            "data_url": data_url,
        }

    if suffix in PDF_EXTENSIONS:
        text = extract_text_from_pdf(path)
        if len(text) > 60_000:
            text = text[:60_000] + "\n\n[document truncated]"
        return {
            "kind": "text",
            "name": original_name,
            "path": str(path),
            "text": text or "[empty or unreadable PDF]",
        }

    if suffix in TEXT_EXTENSIONS or suffix == "":
        text = await read_text_file(path)
        if len(text) > 60_000:
            text = text[:60_000] + "\n\n[file truncated]"
        return {
            "kind": "text",
            "name": original_name,
            "path": str(path),
            "text": text or "[empty file]",
        }

    return {
        "kind": "unsupported",
        "name": original_name,
        "path": str(path),
        "text": f"[file '{original_name}' uploaded but its format is not supported for content extraction]",
    }
