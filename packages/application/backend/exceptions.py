from __future__ import annotations


class AppError(Exception):
    """Base exception carrying an HTTP status code."""

    status_code: int = 500

    def __init__(self, detail: str = ""):
        self.detail = detail
        super().__init__(detail)


class NotFoundError(AppError):
    status_code = 404


class ConflictError(AppError):
    status_code = 409


class ValidationError(AppError):
    status_code = 422
