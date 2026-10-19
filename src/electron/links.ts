/** stremio://127.0.0.1:<port>/manifest.json - the only protocol link the app may hand to the OS. */
export function isStremioInstallUrl(url: string): boolean {
  return /^stremio:\/\/127\.0\.0\.1:\d{2,5}\/manifest\.json$/.test(url);
}
