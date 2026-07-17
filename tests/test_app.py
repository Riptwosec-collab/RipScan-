from fastapi.testclient import TestClient
import fitz
import pytest
from fastapi import HTTPException
from app.main import app, _process_pdf

client = TestClient(app)

def test_health():
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.json()['status'] in {'healthy', 'degraded', 'needs-setup'}
    assert response.json()['maxImagePixels'] > 0
    assert response.json()['maxOcrConcurrency'] > 0

def test_rejects_unsupported_file():
    response = client.post('/api/ocr', files=[('files', ('note.txt', b'hello', 'text/plain'))])
    assert response.status_code == 415

def test_frontend_assets_are_served_from_root():
    index = client.get('/')
    assert index.status_code == 200
    assert '/quality-center.js' in index.text
    assert '/project-workspace.js' in index.text
    assert '/document-studio.js' in index.text
    assert client.get('/app.js').status_code == 200
    assert client.get('/sw.js').status_code == 200

def test_rejects_spoofed_image_mime():
    response = client.post('/api/ocr', files=[('files', ('fake.png', b'not an image', 'image/png'))])
    assert response.status_code == 415

def test_security_headers_are_present():
    response = client.get('/')
    assert response.headers['x-frame-options'] == 'DENY'
    assert "frame-ancestors 'none'" in response.headers['content-security-policy']

def test_rejects_oversized_pdf_page_before_rendering():
    document = fitz.open()
    document.new_page(width=10000, height=10000)
    payload = document.tobytes()
    document.close()
    with pytest.raises(HTTPException) as error:
        _process_pdf(payload, 'eng')
    assert error.value.status_code == 413
