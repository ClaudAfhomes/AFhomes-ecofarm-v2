import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profilePhotoSchema } from '@afhomes/contracts';
import { ProfilePhotoEditor } from '@afhomes/ui';
import { request } from '../../lib/api/client';
import { useCustomerSession } from '../../lib/customer-session';

export function ProfilePhotoCard({ scope = 'customer' }: { scope?: 'customer' | 'staff' }) {
  const { user } = useCustomerSession(),
    client = useQueryClient();
  const queryKey = ['profile-photo', scope, user?.authUserId];
  const photo = useQuery({
    queryKey,
    enabled: !!user?.authUserId,
    retry: false,
    staleTime: 120000,
    queryFn: () => request(`/profile-photo/${scope}`, profilePhotoSchema),
  });
  const upload = useMutation({
    retry: false,
    mutationFn: (input: { dataBase64: string; expectedUserId: string }) =>
      request(`/profile-photo/${scope}`, profilePhotoSchema, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: (data, input) => {
      if (input.expectedUserId === user?.authUserId && client.getQueryState(queryKey))
        client.setQueryData(queryKey, data);
    },
    onError: (_error, input) => {
      if (input.expectedUserId === user?.authUserId) void client.invalidateQueries({ queryKey });
    },
  });
  return (
    <ProfilePhotoEditor
      photo={photo.data}
      loading={photo.isPending}
      error={photo.error?.message}
      onRefresh={() => void photo.refetch()}
      onUpload={(data) =>
        user
          ? upload.mutateAsync({ dataBase64: data, expectedUserId: user.authUserId })
          : Promise.reject(new Error('Sign in again before uploading.'))
      }
    />
  );
}
