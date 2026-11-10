"""Crea el certificado HTTPS del servidor si no existe y muestra la huella que confirma la app."""
import base64
import datetime as dt
import hashlib
import ipaddress
import os
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

carpeta = Path(os.environ.get("CERTS_DIR", "/certs"))
ip = os.environ.get("IP_PUBLICA", "127.0.0.1")
crt, key = carpeta / "servidor.crt", carpeta / "servidor.key"

if not crt.exists():
    carpeta.mkdir(parents=True, exist_ok=True)
    llave = ec.generate_private_key(ec.SECP256R1())
    nombre = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "El Firme")])
    ahora = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(nombre).issuer_name(nombre).public_key(llave.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(ahora - dt.timedelta(days=1))
            .not_valid_after(ahora + dt.timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(ip))]), critical=False)
            .sign(llave, hashes.SHA256()))
    key.write_bytes(llave.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                        serialization.NoEncryption()))
    key.chmod(0o600)
    crt.write_bytes(cert.public_bytes(serialization.Encoding.PEM))

cert = x509.load_pem_x509_certificate(crt.read_bytes())
spki = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
huella = base64.b64encode(hashlib.sha256(spki).digest()).decode()
print(f"HUELLA DEL SERVIDOR (confirmar en la app): {huella}", flush=True)
