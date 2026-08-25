export function googleSignInUrl(supabaseUrl: string, redirectTo: string): string {
  const url = new URL("/auth/v1/authorize", supabaseUrl);

  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}

