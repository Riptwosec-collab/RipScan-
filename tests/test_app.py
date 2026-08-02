import time

from fastapi.testclient import TestClient

import app.main as main

client = TestClient(main.app)

def test_health():
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.json()['status'] in {'healthy', 'needs-setup'}
    assert response.json()['ocrMaxConcurrency'] >= 1
    assert response.json()['ocrFileTimeoutSeconds'] >= 1

def test_rejects_unsupported_file():
    response = client.post('/api/ocr', files=[('files', ('note.txt', b'hello', 'text/plain'))])
    assert response.status_code == 415


def test_ocr_timeout_does_not_hold_the_async_request(monkeypatch):
    def slow_process_image(_content, _language):
        time.sleep(.05)
        return []

    monkeypatch.setattr(main, '_available_languages', lambda: ['tha', 'eng'])
    monkeypatch.setattr(main, '_process_image', slow_process_image)
    monkeypatch.setattr(main, 'OCR_FILE_TIMEOUT_SECONDS', .01)

    response = client.post('/api/ocr', files=[('files', ('scan.png', b'fixture', 'image/png'))])

    assert response.status_code == 504
    assert 'เกิน' in response.json()['detail']
