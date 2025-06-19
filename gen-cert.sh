#!/bin/bash
set -e

echo "🔐 Generating CA EC key and self-signed certificate..."
openssl ecparam -name secp384r1 -genkey -noout -out server-ca-key.pem

openssl req -x509 -new -key server-ca-key.pem -out server-ca-cert.pem -days 3650 \
  -subj "/C=JP/ST=Tokyo/L=Chiyoda/O=FPV Japan CA/CN=FPV Japan Root CA"

echo "🔐 Generating server EC key..."
openssl ecparam -name secp384r1 -genkey -noout -out server-key.pem

echo "🔐 Generating certificate signing request (CSR) using cert.conf..."
openssl req -new -key server-key.pem -out server.csr -config cert.conf

echo "✅ Signing server certificate with CA and cert.conf..."
openssl x509 -req -in server.csr -CA server-ca-cert.pem -CAkey server-ca-key.pem \
  -CAcreateserial -out server-cert.pem -days 1825 -extensions v3_req -extfile cert.conf

echo "✅ Done: server-cert.pem and server-key.pem are ready."
