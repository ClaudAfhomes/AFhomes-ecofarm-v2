// Phase 1: source is retained; enabling a module requires a reviewed code change.
export const FEATURE_FLAGS = Object.freeze({ redemption: false, services: false, reports: false, cms: false });

export function isFeaturePathEnabled(pathname: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(pathname.split('?')[0] ?? '');
  } catch {
    return false;
  }
  const isApi = /^\/api(?:\/v1)?(?=\/)/.test(path);
  path = path.replace(/^\/api(?:\/v1)?(?=\/)/, '');
  if (!isApi) path = path.replace(/^\/(employee|finance|hr|sales)(?=\/)/, '/admin');
  const covers = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (!FEATURE_FLAGS.reports && ['/admin/reports', '/admin/audit', '/reports'].some(covers)) return false;
  if (!FEATURE_FLAGS.cms && ['/admin/cms', '/cms'].some(covers)) return false;
  if (
    !FEATURE_FLAGS.redemption &&
    [
      '/admin/redemption',
      '/admin/member-lookup',
      '/customer/redemptions',
      '/redemptions',
      '/reports/redemptions',
    ].some(covers)
  )
    return false;
  if (!FEATURE_FLAGS.services && ['/admin/points', '/customer/refunds', '/earning'].some(covers) && !(isApi && path === '/earning/adjust'))
    return false;
  if (!FEATURE_FLAGS.services && !isApi && covers('/customer/points')) return false;
  return true;
}
