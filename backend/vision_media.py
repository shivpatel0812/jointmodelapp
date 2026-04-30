"""
Vision / multimodal helpers — decode attachments once per request and format per provider.

TODO(storage): swap raw bytes here for Firebase Storage URLs once uploads exist + guardrails on TTL.

TODO(images): tune max_dimensions per provider if we resize server-side.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field

ALLOWED_MIMES = frozenset({"image/png", "image/jpeg", "image/webp"})
MAX_ATTACHMENTS_PER_REQUEST = 5
MAX_BYTES_PER_IMAGE = 10 * 1024 * 1024  # 10 MB decoded payload


class ImageAttachment(BaseModel):
    """Inbound multimodal attachment from the JSON API."""

    file_name: str = Field(..., max_length=256)
    mime_type: str = Field(..., max_length=128)
    base64: str = Field(..., max_length=26_000_000)


@dataclass(frozen=True)
class DecodedImage:
    file_name: str
    mime_type: str
    data: bytes


def normalize_images(images: list[ImageAttachment] | None) -> list[DecodedImage]:
    if not images:
        return []
    if len(images) > MAX_ATTACHMENTS_PER_REQUEST:
        raise HTTPException(
            status_code=400,
            detail=f"Too many images (max {MAX_ATTACHMENTS_PER_REQUEST}).",
        )
    out: list[DecodedImage] = []
    for img in images:
        mime = img.mime_type.strip().lower()
        if mime not in ALLOWED_MIMES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported image type '{mime}'. Allowed: {sorted(ALLOWED_MIMES)}.",
            )
        try:
            raw = base64.b64decode(img.base64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(
                status_code=400,
                detail=f"Could not decode base64 image '{img.file_name}'.",
            ) from None
        if len(raw) > MAX_BYTES_PER_IMAGE:
            raise HTTPException(
                status_code=400,
                detail=f"Image '{img.file_name}' exceeds max size ({MAX_BYTES_PER_IMAGE // (1024 * 1024)} MB).",
            )
        if len(raw) == 0:
            raise HTTPException(
                status_code=400,
                detail=f"Empty image payload for '{img.file_name}'.",
            )
        out.append(DecodedImage(file_name=img.file_name, mime_type=mime, data=raw))
    return out


def meta_supports_vision(meta: dict[str, Any]) -> bool:
    return bool(meta.get("supports_vision"))


def meta_max_images(meta: dict[str, Any]) -> int:
    try:
        n = int(meta.get("max_images") or 4)
    except (TypeError, ValueError):
        return 4
    return max(1, min(n, MAX_ATTACHMENTS_PER_REQUEST))


def clamp_images_for_model(
    meta: dict[str, Any],
    images: list[DecodedImage],
) -> list[DecodedImage]:
    cap = meta_max_images(meta)
    return images[:cap]


SKIP_IMAGE_UNSUPPORTED = "Skipped: This model does not support image input."
