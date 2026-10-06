import { Children, Fragment, cloneElement, isValidElement, type ReactNode } from 'react';
import { Route, type RouteProps } from 'react-router';
import { staffPortalPath } from '@afhomes/contracts';

export function roleRoutes(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment)
      return <>{roleRoutes(child.props.children)}</>;
    if (!isValidElement<RouteProps>(child) || child.type !== Route) return child;
    const nested = child.props.children ? roleRoutes(child.props.children) : undefined;
    const path = child.props.path;
    const original = cloneElement(child, {}, nested);
    if (
      !path ||
      !path.startsWith('/admin') ||
      /\/(login|forgot-password|reset-password|activate-account)$/.test(path)
    )
      return original;
    return [
      original,
      ...['employee', 'finance', 'hr', 'sales_manager'].map((role) =>
        cloneElement(
          child,
          { key: staffPortalPath(role, path), path: staffPortalPath(role, path) },
          nested,
        ),
      ),
    ];
  });
}
