FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV PROJECT_DIR=/project
ENV WIKI_DIR=/project/wiki
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/sse')" || exit 1

CMD ["python", "server.py"]
