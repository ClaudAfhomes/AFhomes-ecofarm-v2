import { useQuery } from '@tanstack/react-query';
import { getContent } from '../services/content';

export function useContent() {
  return useQuery({ queryKey: ['admin', 'content'], queryFn: getContent });
}
