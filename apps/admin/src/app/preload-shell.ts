/** Fetch staff shell code alongside startup settings, without rendering it or reading account data. */
export async function preloadAdminShell(pathname: string): Promise<void> {
  if (/\/(login|forgot-password|reset-password|activate-account|mfa)\/?$/.test(pathname)) return;
  await import('./AdminLayout');
}
