from fastapi.testclient import TestClient

from backend.app import app


def test_storage_health():
    client = TestClient(app)
    resp = client.get("/storage/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
