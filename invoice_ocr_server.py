"""Small PaddleOCR service for uploaded invoice images and PDF documents."""
import base64
import binascii
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO

import cv2
import numpy as np
import pypdfium2 as pdfium
from PIL import Image
from paddleocr import PaddleOCR

HOST = os.environ.get("INVOICE_OCR_HOST", "127.0.0.1")
PORT = 5556
MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
MAX_PDF_PAGES = 20
MAX_IMAGE_PIXELS = 30_000_000
OCR_ENGINE = None
OCR_LOCK = threading.Lock()


def get_ocr_engine():
    global OCR_ENGINE
    if OCR_ENGINE is None:
        OCR_ENGINE = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    return OCR_ENGINE


def decode_document(encoded, mime_type):
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("The uploaded document is not valid base64 data.") from error
    if not data or len(data) > MAX_DOCUMENT_BYTES:
        raise ValueError("The document must be no larger than 8 MB.")

    if data.startswith(b"%PDF-") and mime_type == "application/pdf":
        document = pdfium.PdfDocument(data)
        if len(document) == 0 or len(document) > MAX_PDF_PAGES:
            raise ValueError("PDF invoices must contain between 1 and 20 pages.")
        pages = []
        for page_index in range(len(document)):
            page = document[page_index]
            width, height = page.get_size()
            if width * 2 * height * 2 > 30_000_000:
                raise ValueError("A PDF page is too large to process safely.")
            bitmap = page.render(scale=2)
            rgb = bitmap.to_numpy()
            pages.append(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        return pages

    is_png = data.startswith(b"\x89PNG\r\n\x1a\n")
    is_jpeg = data.startswith(b"\xff\xd8\xff")
    if (mime_type == "image/png" and is_png) or (mime_type in ("image/jpeg", "image/jpg") and is_jpeg):
        with Image.open(BytesIO(data)) as decoded:
            if decoded.width * decoded.height > MAX_IMAGE_PIXELS:
                raise ValueError("The image dimensions are too large to process safely.")
            rgb = np.asarray(decoded.convert("RGB"))
            return [cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)]
    raise ValueError("The file contents do not match a supported PDF, PNG, or JPEG format.")


def extract_document(encoded, mime_type):
    pages = decode_document(encoded, mime_type)
    output = []
    with OCR_LOCK:
        engine = get_ocr_engine()
        for image in pages:
            result = engine.ocr(image, cls=True)
            detections = []
            for line in (result[0] if result and result[0] else []):
                points, recognition = line
                text, confidence = recognition
                xs = [point[0] for point in points]
                ys = [point[1] for point in points]
                detections.append({
                    "text": text,
                    "confidence": float(confidence),
                    "box": [float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))],
                })
            output.append(detections)
    return {"pages": output}


class InvoiceOCRHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self._send_json(200, {"status": "ok"})

    def do_POST(self):
        if self.path != "/ocr":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_DOCUMENT_BYTES * 2:
                raise ValueError("The document must be no larger than 8 MB.")
            payload = json.loads(self.rfile.read(length))
            encoded = payload.get("document")
            mime_type = payload.get("mimeType")
            if not isinstance(encoded, str) or mime_type not in (
                "application/pdf", "image/png", "image/jpeg", "image/jpg"
            ):
                raise ValueError("Upload a PDF, PNG, or JPEG invoice.")
            self._send_json(200, extract_document(encoded, mime_type))
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json(400, {"error": str(error)})
        except Exception as error:
            print(f"[invoice-ocr] processing failed: {error}", flush=True)
            self._send_json(500, {"error": "Invoice OCR failed. Try a clearer document."})

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        if self.path == "/health":
            return
        super().log_message(format_string, *args)


if __name__ == "__main__":
    print(f"Invoice OCR service listening on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), InvoiceOCRHandler).serve_forever()
