export interface CognitoLogoutConfig {
  cognitoDomain: string;
  clientId: string;
  logoutUri: string;
}

export function cognitoLogoutUrl({
  cognitoDomain,
  clientId,
  logoutUri,
}: CognitoLogoutConfig): string {
  const url = new URL("/logout", cognitoDomain);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("logout_uri", logoutUri);
  return url.toString();
}

export function replaceWithCognitoLogout(url: string): void {
  window.location.replace(url);
}
