import { useState, useMemo } from 'react';
import { StatusChip } from '@afhomes/ui';
import { humanizeCode } from '../business/format';
import { getGenealogyDownline, getGenealogyNode } from './services';
import { useQuery } from '@tanstack/react-query';
import { genealogyKeys } from '../business/queryKeys';
import type { GenealogyNode } from '@afhomes/contracts';
import styles from './GenealogyTree.module.css';

interface GenealogyTreeProps {
  rootStaffId: string;
  viewerRole: string;
  viewerId: string;
  onMemberClick?: (member: GenealogyNode) => void | Promise<void>;
}

export function GenealogyTree({ rootStaffId, viewerRole, viewerId, onMemberClick }: GenealogyTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([rootStaffId]));

  // Fetch the root node separately
  const rootQuery = useQuery({
    queryKey: genealogyKeys.node(rootStaffId),
    queryFn: () => getGenealogyNode(rootStaffId),
  });

  // Fetch descendants
  const downlineQuery = useQuery({
    queryKey: genealogyKeys.downline(rootStaffId),
    queryFn: () => getGenealogyDownline(rootStaffId),
  });

  const rootNode = rootQuery.data;
  const descendants = downlineQuery.data ?? [];

  // Build tree structure from descendants
  const childrenMap = useMemo(() => {
    const map = new Map<string, GenealogyNode[]>();
    for (const node of descendants) {
      if (node.uplineStaffId) {
        map.set(node.uplineStaffId, [...(map.get(node.uplineStaffId) ?? []), node]);
      }
    }
    return map;
  }, [descendants]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: GenealogyNode, depth: number) => {
    const kids = childrenMap.get(node.staffId) ?? [];
    const isExpanded = expanded.has(node.staffId);
    const hasChildren = kids.length > 0;
    const clickable = viewerId === node.staffId || (onMemberClick && viewerRole !== 'ost');

    return (
      <div key={node.staffId} className={styles.nodeWrapper} style={{ paddingLeft: depth * 24 }}>
        <div
          className={`${styles.nodeRow} ${clickable ? styles.clickable : ''}`}
          onClick={() => {
            if (clickable) onMemberClick?.(node);
          }}
        >
          {hasChildren && (
            <button
              className={styles.expandBtn}
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.staffId);
              }}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `Collapse ${node.fullName}` : `Expand ${node.fullName}`}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          <span className={styles.avatar} aria-hidden="true">
            {node.fullName.trim().charAt(0).toUpperCase() || '•'}
          </span>
          <span className={styles.name}>{node.fullName}</span>
          <StatusChip label={humanizeCode(node.role)} tone="neutral" />
          <StatusChip label={humanizeCode(node.ostStatus ?? node.status)} />
        </div>
        {isExpanded && hasChildren && (
          <div className={styles.children}>
            {kids.map((kid) => renderNode(kid, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (rootQuery.isPending || downlineQuery.isPending) return <div className={styles.loading}>Loading team…</div>;
  if (rootQuery.isError || downlineQuery.isError) return <div className={styles.error}>Failed to load team</div>;

  if (!rootNode) return <div className={styles.error}>Root member not found</div>;

  // If no descendants, show root with empty state
  if (descendants.length === 0) {
    return (
      <div className={styles.tree}>
        {renderNode(rootNode, 0)}
        <div className={styles.emptyState}>No downline yet</div>
      </div>
    );
  }

  return <div className={styles.tree}>{renderNode(rootNode, 0)}</div>;
}