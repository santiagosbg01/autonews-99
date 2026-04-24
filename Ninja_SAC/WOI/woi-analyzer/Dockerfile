FROM python:3.11-slim

WORKDIR /app

# Install build tools needed for psycopg binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies first (cache layer)
COPY pyproject.toml ./
# Stub README so hatchling is satisfied
RUN echo "# woi-analyzer" > README.md

COPY src/ ./src/

RUN pip install --no-cache-dir .

# Default command: run the production scheduler
CMD ["woi-scheduler"]
