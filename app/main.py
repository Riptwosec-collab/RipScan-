from __future__ import annotations

import io
import os
import shutil
import asyncio
from functools import lru_cache
from pathlib import Path
from statistics import mean
from typing import Any

import fitz
import pytesseract
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel
from pytesseract import Output

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "50"))
MAX_FILES = int(os.getenv("MAX_FILES_PER_UPLOAD", "10"))
MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "40000000"))
MAX_OCR_CONCURRENCY = max(1, int(os.getenv("MAX_OCR_CONCURRENCY", "2")))
OCR_SEMAPHORE = asyncio.Semaphore(MAX_OCR_CONCURRENCY)
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
TESSERACT_CMD = os.getenv("TESSERACT_CMD", "").strip()
if TESSERACT_CMD:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

LANGUAGE_MAP = {"auto": "tha+eng", "th": "tha", "en": "eng", "th+en": "tha+eng"}
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/tiff", "image/bmp"}

app = FastAPI(title="RipScan Thai-English OCR", description="OCR ภาษาไทยและอังกฤษสำหรับภาพและ PDF", version="3.3.1")
app.add_middleware(CORSMiddleware, allow_origins=[origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:8000").split(",") if origin.strip()], allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])

@app.middleware("http")
async def security_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
        "form-action 'self'; script-src 'self' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        "font-src 'self' data:; connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com; "
        "worker-src 'self' blob:",
    )
    return response

class WordResult(BaseModel):
    text: str
    confidence: float
    left: int
    top: int
    width: int
    height: int

class PageResult(BaseModel):
    page: int
    text: str
    confidence: float
    source: str
    words: list[WordResult]

class DocumentResult(BaseModel):
    filename: str
    mimeType: str
    pageCount: int
    fullText: str
    confidence: float
    pages: list[PageResult]

@lru_cache(maxsize=1)
def _available_languages() -> list[str]:
    try: return sorted(pytesseract.get_languages(config=""))
    except Exception: return []

def _prepare_image(image: Image.Image) -> Image.Image:
    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=413, detail="ภาพมีจำนวนพิกเซลเกินขีดจำกัด")
    image = ImageOps.exif_transpose(image)
    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=413, detail="ภาพมีจำนวนพิกเซลเกินขีดจำกัด")
    image = image.convert("RGB")
    if image.width < 1400:
        ratio = min(2.2, 1400 / max(1, image.width))
        image = image.resize((int(image.width * ratio), int(image.height * ratio)), Image.Resampling.LANCZOS)
    return ImageOps.autocontrast(image)

def _ocr_image(image: Image.Image, language: str) -> PageResult:
    data: dict[str, list[Any]] = pytesseract.image_to_data(_prepare_image(image), lang=language, config="--oem 3 --psm 6", output_type=Output.DICT)
    words=[]; confidences=[]; text_parts=[]
    for index, raw_text in enumerate(data.get("text", [])):
        text=str(raw_text).strip()
        try: raw_confidence=float(data["conf"][index])
        except (ValueError, TypeError, KeyError, IndexError): raw_confidence=-1
        if not text or raw_confidence < 0: continue
        confidence=max(0.0,min(1.0,raw_confidence/100)); confidences.append(confidence); text_parts.append(text)
        words.append(WordResult(text=text, confidence=confidence, left=int(data["left"][index]), top=int(data["top"][index]), width=int(data["width"][index]), height=int(data["height"][index])))
    return PageResult(page=1, text=" ".join(text_parts).strip(), confidence=mean(confidences) if confidences else 0.0, source="ocr", words=words)

def _process_image(content: bytes, language: str) -> list[PageResult]:
    try:
        page=_ocr_image(Image.open(io.BytesIO(content)), language); page.page=1; return [page]
    except Image.DecompressionBombError as exc: raise HTTPException(status_code=413, detail="ภาพมีจำนวนพิกเซลเกินขีดจำกัด") from exc
    except (UnidentifiedImageError, OSError) as exc: raise HTTPException(status_code=400, detail="ไม่สามารถอ่านไฟล์ภาพนี้ได้") from exc

def _process_pdf(content: bytes, language: str) -> list[PageResult]:
    try: document=fitz.open(stream=content,filetype="pdf")
    except Exception as exc: raise HTTPException(status_code=400, detail="ไม่สามารถอ่านไฟล์ PDF นี้ได้") from exc
    if document.page_count > 100: document.close(); raise HTTPException(status_code=400, detail="PDF รองรับไม่เกิน 100 หน้า")
    results=[]
    try:
        for page_index,page in enumerate(document):
            text_layer=page.get_text("text").strip()
            if len(text_layer)>=12:
                results.append(PageResult(page=page_index+1,text=text_layer,confidence=1.0,source="pdf-text",words=[])); continue
            render_width = int(page.rect.width * 2.2)
            render_height = int(page.rect.height * 2.2)
            if render_width * render_height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail=f"PDF หน้า {page_index + 1} มีจำนวนพิกเซลเกินขีดจำกัด")
            pixmap=page.get_pixmap(matrix=fitz.Matrix(2.2,2.2),alpha=False)
            result=_ocr_image(Image.frombytes("RGB",(pixmap.width,pixmap.height),pixmap.samples),language); result.page=page_index+1; results.append(result)
    finally: document.close()
    return results

@app.get("/api/health")
def health() -> dict[str, Any]:
    command = str(pytesseract.pytesseract.tesseract_cmd)
    executable = command if Path(command).is_file() else shutil.which(command)
    languages=_available_languages()
    available=[language for language in ("tha","eng") if language in languages]
    if not executable or not available: status="needs-setup"
    elif set(("tha", "eng")).issubset(languages): status="healthy"
    else: status="degraded"
    return {"status":status,"tesseract":bool(executable),"languages":available,"maxFileSizeMb":MAX_FILE_SIZE_MB,"maxFiles":MAX_FILES,"maxImagePixels":MAX_IMAGE_PIXELS,"maxOcrConcurrency":MAX_OCR_CONCURRENCY}

@app.post("/api/ocr", response_model=list[DocumentResult])
async def run_ocr(files: list[UploadFile] = File(...), language: str = "auto") -> list[DocumentResult]:
    if not files: raise HTTPException(status_code=400,detail="กรุณาเลือกไฟล์")
    if len(files)>MAX_FILES: raise HTTPException(status_code=400,detail=f"อัปโหลดได้ไม่เกิน {MAX_FILES} ไฟล์ต่อครั้ง")
    ocr_language=LANGUAGE_MAP.get(language)
    if not ocr_language: raise HTTPException(status_code=400,detail="ภาษาที่เลือกไม่ถูกต้อง")
    output=[]
    for upload in files:
        content=await upload.read(MAX_FILE_SIZE_MB*1024*1024+1)
        if len(content)>MAX_FILE_SIZE_MB*1024*1024: raise HTTPException(status_code=413,detail=f"ไฟล์ {upload.filename} ใหญ่เกิน {MAX_FILE_SIZE_MB} MB")
        mime_type=upload.content_type or "application/octet-stream"
        filename = upload.filename or "document"
        extension = Path(filename).suffix.lower()
        is_pdf = content.startswith(b"%PDF-")
        is_image = content.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"II*\x00", b"MM\x00*", b"BM", b"RIFF"))
        if is_pdf and (mime_type == "application/pdf" or extension == ".pdf"):
            missing=[item for item in ocr_language.split("+") if item not in _available_languages()]
            if missing: raise HTTPException(status_code=503,detail=f"Tesseract ยังไม่มีภาษา: {', '.join(missing)}")
            async with OCR_SEMAPHORE:
                pages = await asyncio.to_thread(_process_pdf, content, ocr_language)
            mime_type="application/pdf"
        elif is_image and mime_type in IMAGE_TYPES and extension in {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"}:
            missing=[item for item in ocr_language.split("+") if item not in _available_languages()]
            if missing: raise HTTPException(status_code=503,detail=f"Tesseract ยังไม่มีภาษา: {', '.join(missing)}")
            async with OCR_SEMAPHORE:
                pages = await asyncio.to_thread(_process_image, content, ocr_language)
        else: raise HTTPException(status_code=415,detail=f"ไม่รองรับไฟล์ {upload.filename}")
        confidence_values=[page.confidence for page in pages if page.text]
        output.append(DocumentResult(filename=upload.filename or "document",mimeType=mime_type,pageCount=len(pages),fullText="\n\n".join(page.text for page in pages).strip(),confidence=mean(confidence_values) if confidence_values else 0.0,pages=pages))
    return output

# Keep this mount last so /api routes win while root-relative frontend assets work
# identically in Docker, local Uvicorn, and the static Vercel deployment.
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
