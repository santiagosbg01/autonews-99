#!/usr/bin/env bash
# Setup inicial del repo WOI en el Mac Mini.
# Pre-requisitos: Node 20+, Python 3.12+, psql client.
# Asume que ya hay .env lleno en la raíz del repo.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo ">> 1/6 Creando carpeta logs/"
mkdir -p logs

echo ">> 2/6 Verificando .env"
if [[ ! -f .env ]]; then
  echo "FATAL: .env no existe. Copia .env.example → .env y llena los valores antes de continuar."
  exit 1
fi

echo ">> 3/6 Instalando woi-listener (Node)"
cd "$REPO_ROOT/woi-listener"
npm install

echo ">> 4/6 Instalando woi-analyzer (Python)"
cd "$REPO_ROOT/woi-analyzer"
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e .
deactivate

echo ">> 5/6 Instalando woi-reporter (Python)"
cd "$REPO_ROOT/woi-reporter"
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate

echo ">> 6/6 Instalando woi-onboarding-ui (Python)"
cd "$REPO_ROOT/woi-onboarding-ui"
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate

cd "$REPO_ROOT"
echo ""
echo "Setup completo."
echo ""
echo "Siguiente paso:"
echo "  1. Aplicar migrations de Supabase:"
echo "       psql \"\$SUPABASE_DB_URL\" -f supabase/migrations/001_initial_schema.sql"
echo "       psql \"\$SUPABASE_DB_URL\" -f supabase/migrations/002_taxonomy_seed.sql"
echo "  2. Escanear QR del listener:"
echo "       cd woi-listener && npm run qr"
echo "  3. Levantar listener en PM2:"
echo "       cd woi-listener && npm run pm2:start && pm2 save && pm2 startup"
echo "  4. Instalar launchd para cron jobs:"
echo "       bash scripts/install-launchd.sh"
echo "  5. Abrir UI de onboarding para mapear grupos/participantes:"
echo "       cd woi-onboarding-ui && streamlit run app.py"
