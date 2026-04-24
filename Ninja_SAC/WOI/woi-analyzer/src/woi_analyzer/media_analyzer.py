"""
Análisis de imágenes y documentos con Claude Vision.

Categorías detectadas:
  evidencia_entrega  – Prueba de entrega: fotos de paquetes, firmas, acuses
  estatus_ruta       – Foto de estatus en ruta: GPS, tráfico, condiciones viales
  foto_vehiculo      – Unidad: exterior/interior de camión/van, placas visibles
  id_conductor       – Identificación: INE, licencia, credencial, badge de empleado
  documento          – Guía de envío, factura, remisión, orden de compra, label
  problema_fisico    – Incidencia física: mercancía dañada, accidente, bloqueo
  otro               – Cualquier otra imagen
"""

from __future__ import annotations

import base64
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import httpx
from anthropic import APIError, Anthropic, RateLimitError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from woi_analyzer.config import CONFIG
from woi_analyzer.db import connect, fetch_unanalyzed_media, insert_media_analysis
from woi_analyzer.logging_setup import log

MAX_IMAGE_BYTES = 5 * 1024 * 1024   # 5 MB — Claude Vision limit
MAX_PARALLEL    = 3                  # concurrent Vision calls

SYSTEM_PROMPT = """\
Eres un analizador de imágenes para un sistema de operaciones logísticas de 99minutos,
empresa de última milla en Latinoamérica. Recibes fotos y documentos de grupos WhatsApp operativos.

Clasifica la imagen en UNA de estas categorías:
• evidencia_entrega  — Prueba de entrega: fotos de paquetes en puerta, firmas del receptor,
  etiquetas escaneadas, sellos de acuse, pantallas de confirmación de entrega.
• estatus_ruta       — Foto de estatus en ruta: captura de GPS / Waze / Google Maps,
  fotos desde la unidad en movimiento, tráfico, calles bloqueadas, semáforos, filas.
• foto_vehiculo      — Foto de unidad: exterior o interior de camión, van, moto de reparto.
  Puede incluir placas, logos de empresa, carga dentro del vehículo.
• id_conductor       — Identificación del conductor: INE/DNI, licencia de manejo,
  credencial de empleado, badge, foto del conductor con uniforme.
• documento          — Documento logístico: guía de envío, factura, remisión, orden de compra,
  hoja de ruta, label de paquete, formulario físico.
• problema_fisico    — Incidencia física: paquete dañado o roto, accidente de tránsito,
  puerta bloqueada, rampa dañada, situación peligrosa visible.
• otro               — Cualquier imagen que no encaje en las categorías anteriores.

Responde SOLO con un objeto JSON (sin fences, sin texto extra):
{
  "category": "<una de las 7 categorías>",
  "description": "<1-2 oraciones en español describiendo qué muestra la imagen>",
  "extracted_text": "<texto visible importante: placas, números de guía, nombres, direcciones — o null>",
  "confidence": <0.0-1.0>
}
"""

VALID_CATEGORIES = {
    "evidencia_entrega", "estatus_ruta", "foto_vehiculo",
    "id_conductor", "documento", "problema_fisico", "otro",
}

# Mimetypes soportados por Claude Vision
SUPPORTED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


def _detect_mime(url: str, content_type_header: str) -> str | None:
    """Determina el mime-type de la imagen."""
    ct = content_type_header.split(";")[0].strip().lower()
    if ct in SUPPORTED_IMAGE_MIMES:
        return ct
    # Inferir desde extensión de URL
    ext = url.lower().split("?")[0].rsplit(".", 1)[-1]
    return {"jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "gif": "image/gif", "webp": "image/webp"}.get(ext)


@retry(
    retry=retry_if_exception_type((RateLimitError, APIError)),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(3),
    reraise=True,
)
def analyze_image(
    media_url: str,
    caption: str | None = None,
    group_name: str | None = None,
) -> dict[str, Any]:
    """
    Descarga la imagen desde `media_url` y la analiza con Claude Vision.
    Retorna dict con keys: category, description, extracted_text, confidence, claude_model.
    Lanza ValueError si la imagen no es soportada (PDF, video, etc.).
    """
    # Descargar imagen
    try:
        resp = httpx.get(media_url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise ValueError(f"Failed to download media: {e}") from e

    mime = _detect_mime(media_url, resp.headers.get("content-type", ""))
    if not mime:
        raise ValueError(f"Unsupported media type for URL: {media_url}")

    if len(resp.content) > MAX_IMAGE_BYTES:
        raise ValueError(f"Image too large ({len(resp.content) // 1024} KB)")

    image_b64 = base64.standard_b64encode(resp.content).decode()

    # Construir prompt
    user_content: list[dict] = [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": mime, "data": image_b64},
        }
    ]
    context_parts = []
    if group_name:
        context_parts.append(f"Grupo: {group_name}")
    if caption:
        context_parts.append(f"Caption del remitente: \"{caption}\"")
    if context_parts:
        context_parts.append("Analiza y clasifica esta imagen.")
        user_content.append({"type": "text", "text": "\n".join(context_parts)})
    else:
        user_content.append({"type": "text", "text": "Analiza y clasifica esta imagen."})

    client = Anthropic(api_key=CONFIG.anthropic.api_key)
    response = client.messages.create(
        model=CONFIG.anthropic.sonnet_model,
        max_tokens=400,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )

    text = "".join(
        getattr(b, "text", "") for b in response.content if getattr(b, "type", "") == "text"
    ).strip()

    # Limpiar fences si los hay
    if text.startswith("```"):
        first = text.find("{")
        last = text.rfind("}")
        if first != -1 and last != -1:
            text = text[first : last + 1]

    result = json.loads(text)

    # Sanitize category
    if result.get("category") not in VALID_CATEGORIES:
        result["category"] = "otro"

    result["claude_model"] = response.model
    return result


def _analyze_one(row: dict) -> str:
    """Analiza un mensaje de media. Retorna 'analyzed' | 'skipped' | 'failed'."""
    msg_id    = row["id"]
    group_id  = row["group_id"]
    media_url = row["media_url"]
    caption   = row.get("content")
    group_name = row.get("group_name")

    # Solo imágenes (PDFs y docs no soportados por Vision)
    media_type = row.get("media_type", "")
    if media_type not in ("image",) and not media_url.lower().split("?")[0].endswith(
        (".jpg", ".jpeg", ".png", ".gif", ".webp")
    ):
        log.debug("media_skipped_unsupported_type", msg_id=msg_id, media_type=media_type)
        return "skipped"

    try:
        result = analyze_image(media_url, caption=caption, group_name=group_name)
        insert_media_analysis(
            message_id=msg_id,
            group_id=group_id,
            media_url=media_url,
            media_category=result["category"],
            description=result.get("description", ""),
            extracted_text=result.get("extracted_text"),
            confidence=result.get("confidence", 0.8),
            claude_model=result.get("claude_model", CONFIG.anthropic.sonnet_model),
        )
        log.info(
            "media_analyzed",
            msg_id=msg_id,
            category=result["category"],
            confidence=result.get("confidence"),
        )
        return "analyzed"
    except ValueError as e:
        log.debug("media_skipped", msg_id=msg_id, reason=str(e))
        return "skipped"
    except Exception as e:
        log.error("media_analysis_failed", msg_id=msg_id, error=str(e))
        return "failed"


def run_media_analysis_batch(limit: int = 50) -> dict:
    """
    Analiza hasta `limit` imágenes pendientes en paralelo con Claude Vision.
    Retorna { analyzed, skipped, failed }.
    """
    rows = fetch_unanalyzed_media(limit=limit)
    if not rows:
        log.info("no_unanalyzed_media")
        return {"analyzed": 0, "skipped": 0, "failed": 0}

    log.info("media_batch_start", count=len(rows))
    analyzed = skipped = failed = 0

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
        futures = {pool.submit(_analyze_one, row): row["id"] for row in rows}
        for future in as_completed(futures):
            msg_id = futures[future]
            try:
                outcome = future.result()
                if outcome == "analyzed":
                    analyzed += 1
                elif outcome == "skipped":
                    skipped += 1
                else:
                    failed += 1
            except Exception as e:
                log.error("media_future_error", msg_id=msg_id, error=str(e))
                failed += 1

    log.info("media_batch_done", analyzed=analyzed, skipped=skipped, failed=failed)
    return {"analyzed": analyzed, "skipped": skipped, "failed": failed}
