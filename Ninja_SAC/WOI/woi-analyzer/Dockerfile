FROM python:3.11-slim

WORKDIR /app

# Install build tools needed for psycopg binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
 && rm -rf /var/lib/apt/lists/*

# Install the package
COPY pyproject.toml ./
COPY src/ ./src/

RUN pip install --no-cache-dir -e ".[all]" || pip install --no-cache-dir -e .

# Default command: run the production scheduler
CMD ["woi-scheduler"]
