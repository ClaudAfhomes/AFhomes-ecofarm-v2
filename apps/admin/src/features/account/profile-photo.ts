import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profilePhotoSchema } from '@afhomes/contracts';
import { request } from '../../lib/api/client';
import { useSession } from '../../lib/session';

export function useProfilePhoto() {
  const { user } = useSession(),
    client = useQueryClient();
  const queryKey = ['profile-photo', 'staff', user?.id];
  const photo = useQuery({
    queryKey,
    enabled: !!user?.id,
    retry: false,
    staleTime: 120000,
    queryFn: () => request('/profile-photo/staff', profilePhotoSchema, { auth: 'required' }),
  });
  const upload = useMutation({
    retry: false,
    mutationFn: (input: { dataBase64: string; expectedUserId: string }) =>
      request('/profile-photo/staff', profilePhotoSchema, {
        method: 'PUT',
        auth: 'required',
        body: JSON.stringify(input),
      }),
    onSuccess: (data, input) => {
      if (input.expectedUserId === user?.id && client.getQueryState(queryKey))
        client.setQueryData(queryKey, data);
    },
    // A lost response does not prove the upload failed; reread the one owner path.
    onError: (_error, input) => {
      if (input.expectedUserId === user?.id) void client.invalidateQueries({ queryKey });
    },
  });
  return { photo, upload };
}
