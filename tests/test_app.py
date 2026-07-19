from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health():
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.json()['status'] in {'healthy', 'needs-setup'}

def test_rejects_unsupported_file():
    response = client.post('/api/ocr', files=[('files', ('note.txt', b'hello', 'text/plain'))])
    assert response.status_code == 415
