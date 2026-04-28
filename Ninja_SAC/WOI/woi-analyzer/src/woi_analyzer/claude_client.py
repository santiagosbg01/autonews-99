"""Wrapper para Anthropic SDK con prompt caching y retries."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from anthropic import Anthropic, APIError, RateLimitError
from pydantic import BaseModel, Field, ValidationError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from woi_analyzer.config import CONFIG
from woi_analyzer.logging_setup import log

PROMPTS_DIR = Path(__file__).parent / "prompts"

_client: Anthropic | None = None


def get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=CONFIG.anthropic.api_key)
    return _client


def _read_prompt(filename: str) -> str:
    return (PROMPTS_DIR / filename).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------
VALID_CATEGORIES = {
    # Bucket A (7)
    "presentacion_unidad", "presentacion_chofer", "presentacion_auxiliar",
    "confirmacion_llegada", "confirmacion_salida", "reporte_entrega",
    "confirmacion_evidencias",
    # Bucket B (9)
    "problema_unidad", "problema_horario", "problema_entrada", "problema_salida",
    "problema_trafico", "problema_manifestacion", "robo_incidencia",
    "problema_sistema", "problema_proveedor",
    # Bucket C (5)
    "acuse_recibo", "confirmacion_resolucion", "consulta_info", "saludo_ruido", "otro",
}

CATEGORY_TO_BUCKET = {
    **{c: "A" for c in [
        "presentacion_unidad", "presentacion_chofer", "presentacion_auxiliar",
        "confirmacion_llegada", "confirmacion_salida", "reporte_entrega",
        "confirmacion_evidencias",
    ]},
    **{c: "B" for c in [
        "problema_unidad", "problema_horario", "problema_entrada", "problema_salida",
        "problema_trafico", "problema_manifestacion", "robo_incidencia",
        "problema_sistema", "problema_proveedor",
    ]},
    **{c: "C" for c in [
        "acuse_recibo", "confirmacion_resolucion", "consulta_info", "saludo_ruido", "otro",
    ]},
}


class ClassificationResult(BaseModel):
    category: str
    bucket: str = Field(pattern="^[ABC]$")
    sentiment: float = Field(ge=-1.0, le=1.0)
    urgency: str = Field(pattern="^(baja|media|alta)$")
    is_incident_open: bool
    is_incident_close: bool
    reasoning: str = ""

    def coerce_bucket(self) -> "ClassificationResult":
        """Si el modelo devolvió un bucket inconsistente con la categoría, lo corregimos."""
        expected = CATEGORY_TO_BUCKET.get(self.category)
        if expected and expected != self.bucket:
            log.warning(
                "bucket_mismatch_corrected",
                category=self.category,
                model_bucket=self.bucket,
                expected_bucket=expected,
            )
            return self.model_copy(update={"bucket": expected})
        return self


# ---------------------------------------------------------------------------
# JSON extraction (defensive)
# ---------------------------------------------------------------------------
def _extract_json(text: str) -> dict[str, Any]:
    """Extrae el primer objeto JSON del texto. Tolera fences ```json ... ```."""
    t = text.strip()
    if t.startswith("```"):
        first_brace = t.find("{")
        last_brace = t.rfind("}")
        if first_brace != -1 and last_brace != -1:
            t = t[first_brace : last_brace + 1]
    # Intentar parse directo
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    # Fallback: buscar primer {...} balanceado
    start = t.find("{")
    if start == -1:
        raise ValueError(f"No JSON object found in response: {text[:200]!r}")
    depth = 0
    for i, ch in enumerate(t[start:], start=start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(t[start : i + 1])
    raise ValueError(f"Unbalanced JSON: {text[:200]!r}")


# ---------------------------------------------------------------------------
# Classify
# ---------------------------------------------------------------------------
def _build_user_content(
    *,
    few_shot: str,
    group_name: str,
    country: str,
    timezone: str,
    sender_role: str,
    sender_phone_last4: str,
    timestamp: str,
    context_messages: list[dict[str, Any]],
    message_content: str,
) -> str:
    ctx_lines = []
    for m in context_messages:
        role = m.get("sender_role") or "otro"
        name = m.get("sender_display_name") or m.get("sender_phone", "")
        content = (m.get("content") or f"[{m.get('media_type') or 'media'}]")[:200]
        ctx_lines.append(f"[{role}] {name}: {content}")
    ctx_block = "\n".join(ctx_lines) if ctx_lines else "(sin mensajes previos recientes)"

    return (
        f"{few_shot}\n\n"
        f"---\n\n"
        f"Group: {group_name}\n"
        f"Country: {country}\n"
        f"Timezone: {timezone}\n"
        f"Sender role: {sender_role}\n"
        f"Sender phone (last 4): {sender_phone_last4}\n"
        f"Timestamp: {timestamp}\n"
        f"Previous messages (chronological, oldest first):\n"
        f"{ctx_block}\n\n"
        f'Message to classify:\n"{message_content}"\n\n'
        f"Return the JSON object now."
    )


@retry(
    retry=retry_if_exception_type((RateLimitError, APIError)),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(4),
    reraise=True,
)
def classify_message(
    *,
    group_name: str,
    country: str,
    timezone: str,
    sender_role: str,
    sender_phone: str,
    timestamp: str,
    context_messages: list[dict[str, Any]],
    message_content: str,
    model: str | None = None,
) -> tuple[ClassificationResult, dict[str, Any], dict[str, Any]]:
    """
    Clasifica un mensaje con Sonnet. Devuelve (result, claude_raw_dict, usage_dict).
    `model` permite forzar un slug específico (por ejemplo para A/B testing); por
    defecto se usa CONFIG.anthropic.sonnet_model.
    """
    system_prompt = _read_prompt("classification_system.md")
    few_shot = _read_prompt("few_shot_examples.md")

    user_content = _build_user_content(
        few_shot=few_shot,
        group_name=group_name,
        country=country,
        timezone=timezone,
        sender_role=sender_role,
        sender_phone_last4=sender_phone[-4:] if sender_phone else "????",
        timestamp=timestamp,
        context_messages=context_messages,
        message_content=message_content,
    )

    chosen_model = model or CONFIG.anthropic.sonnet_model

    system_block = [
        {
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }
    ]

    response = get_client().messages.create(
        model=chosen_model,
        max_tokens=CONFIG.anthropic.max_tokens_classify,
        system=system_block,
        messages=[{"role": "user", "content": user_content}],
    )

    if not response.content:
        raise RuntimeError(f"Empty response from Claude: {response}")

    text = "".join(
        getattr(block, "text", "") for block in response.content if getattr(block, "type", "") == "text"
    )

    try:
        data = _extract_json(text)
        result = ClassificationResult.model_validate(data).coerce_bucket()
    except (ValueError, ValidationError) as e:
        log.error("classification_parse_failed", error=str(e), response_text=text[:500])
        raise

    if result.category not in VALID_CATEGORIES:
        log.warning("invalid_category_coerced_to_otro", original=result.category)
        result = result.model_copy(update={"category": "otro", "bucket": "C"})

    usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
        "cache_read_input_tokens": getattr(response.usage, "cache_read_input_tokens", 0),
        "cache_creation_input_tokens": getattr(response.usage, "cache_creation_input_tokens", 0),
    }
    raw_dict = {
        "id": response.id,
        "model": response.model,
        "stop_reason": response.stop_reason,
        "text": text,
    }
    return result, raw_dict, usage


# ---------------------------------------------------------------------------
# Incident summary (Sonnet)
# ---------------------------------------------------------------------------
@retry(
    retry=retry_if_exception_type((RateLimitError, APIError)),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(3),
    reraise=True,
)
def generate_incident_summary(
    messages: list[dict[str, Any]],
    category: str | None,
    urgency: str | None,
    ttfr_seconds: int | None,
    ttr_seconds: int | None,
    is_closed: bool,
) -> str:
    """Genera un resumen breve (2-3 oraciones) de un hilo de incidente con Sonnet."""
    system_prompt = _read_prompt("incident_summary.md")

    lines = []
    for m in messages:
        role = m.get("sender_role") or "otro"
        name = m.get("sender_display_name") or m.get("sender_phone", "")
        content = (m.get("content") or f"[{m.get('media_type') or 'media'}]")[:200]
        ts = str(m.get("timestamp", ""))[:16]
        lines.append(f"[{ts}] [{role}] {name}: {content}")

    meta = (
        f"Categoría: {category or 'desconocida'}\n"
        f"Urgencia: {urgency or 'baja'}\n"
        f"TTFR: {round(ttfr_seconds / 60, 1)} min\n" if ttfr_seconds else ""
        f"TTR: {round(ttr_seconds / 60, 1)} min\n" if ttr_seconds else ""
        f"Estado: {'cerrada operativamente' if is_closed else 'pendiente de cierre formal'}\n"
    )

    user_content = (
        f"Metadatos del incidente:\n{meta}\n"
        f"Mensajes del hilo ({len(messages)} total):\n"
        + "\n".join(lines)
        + "\n\nGenera el resumen ahora."
    )

    response = get_client().messages.create(
        model=CONFIG.anthropic.sonnet_model,
        max_tokens=200,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )
    return "".join(
        getattr(b, "text", "") for b in response.content if getattr(b, "type", "") == "text"
    ).strip()


# ---------------------------------------------------------------------------
# Group analysis (Sonnet) — hourly snapshot
# ---------------------------------------------------------------------------
@retry(
    retry=retry_if_exception_type((RateLimitError, APIError)),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(3),
    reraise=True,
)
def generate_group_analysis(
    group_name: str,
    country: str,
    vertical: str | None,
    timezone: str,
    messages: list[dict[str, Any]],
    window_hours: int = 1,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Genera un análisis Sonnet del grupo para la ventana dada.
    Retorna (parsed_result_dict, usage_dict).
    """
    system_prompt = _read_prompt("group_analysis.md")

    lines = []
    category_counts: dict[str, int] = {}
    for m in messages:
        role = m.get("sender_role") or "otro"
        name = m.get("sender_display_name") or m.get("sender_phone", "???")
        ts = str(m.get("timestamp", ""))[:16]
        content = (m.get("content") or f"[{m.get('media_type') or 'media'}]")[:300]
        cat = m.get("category")
        sent = m.get("sentiment")
        urg = m.get("urgency")

        meta = ""
        if cat:
            category_counts[cat] = category_counts.get(cat, 0) + 1
            meta = f" [cat:{cat}"
            if sent is not None:
                meta += f" sent:{float(sent):+.2f}"
            if urg and urg != "baja":
                meta += f" urg:{urg}"
            meta += "]"

        lines.append(f"[{ts}] [{role}] {name}{meta}: {content}")

    ctx = "\n".join(lines) if lines else "(Sin mensajes en este período)"

    user_content = (
        f"Grupo: {group_name}\n"
        f"Vertical: {vertical or 'desconocido'}\n"
        f"País: {country}\n"
        f"Zona horaria: {timezone}\n"
        f"Ventana de análisis: últimas {window_hours}h\n"
        f"Total mensajes: {len(messages)}\n\n"
        f"--- MENSAJES ---\n{ctx}\n\n"
        f"Genera el análisis JSON ahora."
    )

    response = get_client().messages.create(
        model=CONFIG.anthropic.sonnet_model,
        max_tokens=4096,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_content}],
    )

    text = "".join(
        getattr(b, "text", "") for b in response.content if getattr(b, "type", "") == "text"
    ).strip()

    try:
        result = _extract_json(text)
    except ValueError:
        log.warning("group_analysis_json_failed", text_len=len(text), last_100=text[-100:])
        result = {"narrative": text, "key_topics": [], "anomalies": [], "recommendations": [],
                  "participants": [], "dynamics": "", "client_sentiment_label": "neutro",
                  "risk_level": "bajo", "risk_reason": None}

    result["_category_counts"] = category_counts

    usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }
    return result, usage


# ---------------------------------------------------------------------------
# Resolution check (Sonnet) — is this incident thread resolved?
# ---------------------------------------------------------------------------
def ask_is_resolved(
    messages: list[dict],
    category: str | None,
    *,
    eod_mode: bool = False,
) -> dict:
    """
    Pregunta a Sonnet si el hilo de mensajes indica que el incidente fue resuelto.

    El razonamiento sigue 3 pasos explícitos:
      1. ¿Cuál fue la queja/problema original del CLIENTE?
      2. ¿El equipo 99 respondió? ¿Qué hicieron?
      3. ¿Hay evidencia en los mensajes posteriores de que el problema
         se atendió/resolvió (la unidad llegó, el cliente dejó de quejarse,
         se confirmó la entrega, etc.)?

    Args:
        messages: lista cronológica con sender_role, sender_display_name,
                  content, timestamp, category.
        category: categoría dominante del incidente (orienta a Sonnet).
        eod_mode: si True, usa el prompt de "fin del día" — más estricto,
                  diseñado para forzar un veredicto final cuando el día
                  cierra sin resolución clara.

    Returns:
        dict con shape:
          {
            "resolved": bool,
            "reason":   str,            # 1 frase ≤200 chars
            "confidence": "alta"|"media"|"baja",
          }
        Si la llamada a Sonnet falla, retorna {"resolved": False, "reason": "", "confidence": "baja"}.
    """
    lines = []
    for m in messages:
        role = m.get("sender_role") or "otro"
        name = m.get("sender_display_name") or ""
        content = (m.get("content") or "[media]")[:250]
        cat = m.get("category") or ""
        ts = str(m.get("timestamp", ""))[:16]
        lines.append(f"[{ts}] [{role}]{f' {name}' if name else ''} ({cat}): {content}")
    thread = "\n".join(lines)

    system_base = (
        "Eres un analista de operaciones logísticas de última milla.\n"
        "Tu tarea es decidir si un incidente operativo está RESUELTO leyendo el hilo "
        "completo de WhatsApp del grupo (cliente + agentes 99).\n\n"
        "PROCEDE EN 3 PASOS:\n"
        "  1. Identifica la QUEJA/PROBLEMA ORIGINAL del cliente — ¿qué pidió o de qué se quejó?\n"
        "     (Ej: 'la unidad no ha llegado', '¿dónde está el conductor?', "
        "      'tengo un retraso de 2 horas', 'falta evidencia de entrega'.)\n"
        "  2. Identifica las RESPUESTAS del equipo 99 y CUALQUIER MENSAJE POSTERIOR del cliente.\n"
        "  3. Decide: ¿el problema original quedó atendido? Mira evidencia EXPLÍCITA o IMPLÍCITA.\n\n"

        "EVIDENCIA EXPLÍCITA de resolución (resuelto=true, confidence=alta):\n"
        "- La unidad llegó / descargó / salió tras la queja del cliente\n"
        "- Se compartió evidencia (foto, video, comprobante) que cierra el caso\n"
        "- Cliente o agente confirmó verbalmente: 'ya llegó', 'gracias, listo', 'ya se resolvió'\n"
        "- Se reportó la entrega/recolección como completada después del problema\n\n"

        "EVIDENCIA IMPLÍCITA de resolución (resuelto=true, confidence=media):\n"
        "- El cliente cambió de tono de molesto a neutro/positivo después de la respuesta del agente\n"
        "- El último mensaje del cliente fue 'ok', 'gracias', emojis positivos, o equivalente\n"
        "- El hilo siguió con conversación normal del día sin retomar la queja\n"
        "- El agente confirmó acción concreta y el cliente no volvió a reclamar el mismo punto\n\n"

        "SEÑALES DE NO RESOLUCIÓN (resuelto=false):\n"
        "- El cliente sigue insistiendo en lo mismo en mensajes recientes\n"
        "- Hay escalamiento ('ya van varias veces', 'voy a hablar con tu jefe')\n"
        "- El agente prometió '¿ahorita reviso?' pero nunca volvió con conclusión\n"
        "- La queja era específica (ej: 'la unidad no ha llegado') y el hilo no muestra "
        "  que efectivamente llegó\n"
        "- Silencio sin respuesta final del agente cuando había pregunta abierta del cliente\n\n"

        "REGLAS DE FORMATO:\n"
        "- Responde SOLO con JSON válido. Sin markdown, sin texto extra.\n"
        "- 'reason' debe explicar AMBAS cosas en 1 frase (≤200 chars):\n"
        "    qué pidió el cliente Y por qué consideras resuelto/no resuelto.\n"
        "    Ejemplo: 'Cliente reportó retraso de la unidad 1234; agente confirmó llegada y descarga 40 min después.'\n"
        "    Ejemplo: 'Cliente preguntó por la unidad faltante; agente prometió revisar pero no hubo confirmación posterior.'\n"
        "- 'confidence': alta (evidencia explícita), media (evidencia implícita), baja (inferencia frágil).\n"
        "Schema: {\"resolved\": true|false, \"reason\": \"...\", \"confidence\": \"alta|media|baja\"}"
    )

    if eod_mode:
        system = system_base + (
            "\n\nMODO FIN DE DÍA (EOD):\n"
            "Estamos cerrando el día operativo. Este ticket NO se cerró por sí solo. "
            "Necesitas un veredicto final.\n"
            "- Si hay evidencia explícita o implícita razonable de resolución → resuelto=true.\n"
            "- Si la queja original quedó SIN atender o sin confirmación clara → resuelto=false. "
            "  Esto NO es error del análisis: significa que operacionalmente quedó pendiente "
            "  y debe contar como 'no resuelto el mismo día'."
        )
    else:
        system = system_base

    prompt = (
        f"Categoría del incidente (clasificación inicial): {category or 'desconocida'}\n\n"
        f"Hilo cronológico ({len(lines)} mensajes):\n{thread}\n\n"
        f"{'¿Quedó resuelto este incidente al cierre del día?' if eod_mode else '¿Fue resuelto este incidente?'}"
    )

    try:
        response = get_client().messages.create(
            model=CONFIG.anthropic.sonnet_model,
            max_tokens=200,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(
            getattr(b, "text", "") for b in response.content if getattr(b, "type", "") == "text"
        ).strip()
        data = _extract_json(text)
        resolved = bool(data.get("resolved", False))
        reason = str(data.get("reason", "") or "")[:200]
        confidence = str(data.get("confidence", "media") or "media").lower()
        if confidence not in ("alta", "media", "baja"):
            confidence = "media"
        log.info(
            "sonnet_resolution_check",
            resolved=resolved,
            confidence=confidence,
            eod_mode=eod_mode,
            reason=reason[:120],
        )
        return {"resolved": resolved, "reason": reason, "confidence": confidence}
    except Exception as e:
        log.warning("ask_is_resolved_failed", error=str(e))
        return {"resolved": False, "reason": "", "confidence": "baja"}


# ---------------------------------------------------------------------------
# Daily summary (Sonnet)
# ---------------------------------------------------------------------------
@retry(
    retry=retry_if_exception_type((RateLimitError, APIError)),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(3),
    reraise=True,
)
def generate_morning_briefing(input_data: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Genera el morning briefing con Sonnet.
    Retorna (briefing_json, usage_dict).
    """
    system_prompt = _read_prompt("morning_briefing.md")
    user_content = (
        "Datos para el briefing (JSON):\n\n"
        f"```json\n{json.dumps(input_data, ensure_ascii=False, indent=2, default=str)}\n```\n\n"
        "Genera el briefing JSON ahora."
    )

    response = get_client().messages.create(
        model=CONFIG.anthropic.sonnet_model,
        max_tokens=4096,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_content}],
    )
    text = "".join(
        getattr(b, "text", "") for b in response.content if getattr(b, "type", "") == "text"
    ).strip()

    try:
        result = _extract_json(text)
    except ValueError:
        log.warning("morning_briefing_json_failed", text_len=len(text), tail=text[-200:])
        result = {
            "headline": "Briefing no disponible (parse error).",
            "highlights": [],
            "incidents_summary": [],
            "groups_to_watch": [],
            "trend_note": "",
            "churn_signals": [],
            "agents_red_zone": [],
        }

    usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }
    return result, usage


@retry(
    retry=retry_if_exception_type((RateLimitError, APIError)),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(3),
    reraise=True,
)
def generate_daily_summary(input_data: dict[str, Any]) -> str:
    """Genera el brief ejecutivo con Sonnet."""
    system_prompt = _read_prompt("daily_summary.md")
    user_content = (
        "Input data del día (JSON):\n\n"
        f"```json\n{json.dumps(input_data, ensure_ascii=False, indent=2, default=str)}\n```\n\n"
        "Genera el brief en el formato indicado."
    )
    response = get_client().messages.create(
        model=CONFIG.anthropic.sonnet_model,
        max_tokens=CONFIG.anthropic.max_tokens_summary,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_content}],
    )
    return "".join(
        getattr(b, "text", "") for b in response.content if getattr(b, "type", "") == "text"
    ).strip()
