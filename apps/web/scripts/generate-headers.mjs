import { writeFile } from "node:fs/promises";

const api = process.env.VITE_API_ORIGIN ?? "http://localhost:8000";
const upload = process.env.VITE_UPLOAD_ORIGIN ?? "https://*.s3.us-east-1.amazonaws.com";
const cognito = process.env.VITE_COGNITO_DOMAIN ?? "https://*.auth.us-east-1.amazoncognito.com";
const cognitoAuthority = new URL(
  process.env.VITE_COGNITO_AUTHORITY ?? "https://cognito-idp.us-east-1.amazonaws.com",
).origin;
const uploadOrigins = new Set([upload]);
const parsedUpload = new URL(upload.replace("*.", "wildcard."));
const regionalS3 = parsedUpload.hostname.match(/^(.+)\.s3\.[^.]+\.amazonaws\.com$/);
if (regionalS3) {
  const bucket = regionalS3[1]?.replace("wildcard.", "*.");
  uploadOrigins.add(`${parsedUpload.protocol}//${bucket}.s3.amazonaws.com`);
}
const uploadSources = [...uploadOrigins].join(" ");

for (const value of [api, ...uploadOrigins, cognito, cognitoAuthority]) {
  const parsed = new URL(value.replace("*.", "placeholder."));
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Refusing non-HTTP CSP origin: ${value}`);
  }
}

const headers = `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self' ${uploadSources}; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' ${api} ${uploadSources} ${cognitoAuthority} ${cognito}; font-src 'self'; upgrade-insecure-requests

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: no-store
`;
await writeFile(new URL("../public/_headers", import.meta.url), headers, "utf8");
