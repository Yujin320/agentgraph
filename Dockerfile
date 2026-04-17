# ── Stage 1: Build React/Vite frontend ────────────────────────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# ── Stage 2: Python application ───────────────────────────────────────────────
FROM python:3.11-slim AS app

# System dependencies (libpq-dev + gcc for potential psycopg2, curl for healthchecks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies via pyproject.toml before copying source
# (layer-cached unless pyproject.toml changes)
COPY pyproject.toml ./
RUN pip install --no-cache-dir .    # 容器不可变基础设施，故删除-e

# Copy application source
COPY core/ ./core/
COPY backend/ ./backend/
COPY knowledge/ ./knowledge/

# Copy built frontend from Stage 1
COPY --from=frontend-builder /frontend/dist ./frontend/dist/

# Ensure workspaces and chroma directories exist (will be bind-mounted at runtime)
RUN mkdir -p workspaces

EXPOSE 8001

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8001"]
