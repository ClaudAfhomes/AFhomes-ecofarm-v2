import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getContact, updateContact } from '../services/cmsRepository';
import type { ContactContent } from '@jad/contracts';

export function useContactCms() {
  return useQuery<ContactContent>({
    queryKey: ['cms', 'contact'],
    queryFn: getContact,
  });
}

export function useUpdateContactCms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: ContactContent) => updateContact(draft),
    onSuccess: (data) => {
      qc.setQueryData(['cms', 'contact'], data);
    },
  });
}
