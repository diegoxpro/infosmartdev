FROM python:3.12-slim

RUN useradd --create-home --uid 1000 firme
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY generar_cert.py .
RUN mkdir /certs && chown firme:firme /certs

USER firme
EXPOSE 8443
CMD ["sh", "-c", "python generar_cert.py && exec uvicorn app.main:app --host 0.0.0.0 --port 8443 --workers 1 --ssl-keyfile /certs/servidor.key --ssl-certfile /certs/servidor.crt --no-server-header"]
