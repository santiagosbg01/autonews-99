"""Logging estructurado con structlog."""

from __future__ import annotations

import logging
import os
import sys

import structlog


def setup_logging() -> structlog.stdlib.BoundLogger:
    level = os.environ.get("LOG_LEVEL", "info").upper()
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level, logging.INFO),
    )
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            (
                structlog.dev.ConsoleRenderer(colors=sys.stdout.isatty())
                if os.environ.get("NODE_ENV") != "production"
                else structlog.processors.JSONRenderer()
            ),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
    return structlog.get_logger()


log = setup_logging()
