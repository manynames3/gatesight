/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN: string;
  readonly VITE_UPLOAD_ORIGIN: string;
  readonly VITE_COGNITO_AUTHORITY: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  readonly VITE_COGNITO_REDIRECT_URI: string;
  readonly VITE_COGNITO_LOGOUT_URI: string;
  readonly VITE_COGNITO_DOMAIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
