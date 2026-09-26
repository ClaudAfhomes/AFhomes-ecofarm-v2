import { useQuery } from '@tanstack/react-query';

import { getInquiries } from '../services/inquiries';

export function useInquiries() {
  return useQuery({ queryKey: ['admin', 'inquiries'], queryFn: getInquiries });
}
