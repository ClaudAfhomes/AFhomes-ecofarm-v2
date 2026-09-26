import { useNavigate } from 'react-router';

import type { RegisterRequest } from '@jad/contracts';

import { useQuery } from '@tanstack/react-query';
import { getGlobalCmsPublic, getRegisterCmsPublic } from '@/lib/cms';
import { AUTH } from '../content';
import { AuthLayout } from '../components/AuthLayout';
import { RegistrationForm } from '../components/RegistrationForm';
import { registerApplication } from '../services/auth';

/**
 * Registration (SCR-AUTH-002). Multi-step program → profile → qualification →
 * referral → ID → account; submits `POST /auth/register` and routes to the
 * email verification screen (SCR-AUTH-003) with the applicant's email.
 */
export function RegisterPage() {
  const { data: cmsRegister } = useQuery({
    queryKey: ['cms', 'register'],
    queryFn: getRegisterCmsPublic,
    staleTime: 0,
  });
  const { data: globalCms } = useQuery({
    queryKey: ['cms', 'global'],
    queryFn: getGlobalCmsPublic,
    staleTime: 0,
  });
  const regCopy = cmsRegister?.copy ?? AUTH.register;
  const regImage = cmsRegister?.image ?? AUTH.images.register;
  const brandMark = globalCms?.brandMark ?? null;
  const navigate = useNavigate();

  return (
    <AuthLayout
      eyebrow={regCopy.eyebrow}
      title={regCopy.title}
      lead={regCopy.lead}
      brandTitle={regCopy.brandTitle}
      brandLead={regCopy.brandLead}
      image={regImage}
      brandMark={brandMark}
      wide
    >
      <RegistrationForm
        submit={async (payload) => {
          const response = await registerApplication(payload as RegisterRequest);
          const emailValue = response.application.email;
          try {
            sessionStorage.setItem('jad:register:email', emailValue);
          } catch {
            // storage may be unavailable in some environments - non-blocking
          }
          navigate('/register/verify-email', {
            replace: true,
            state: {
              email: emailValue,
              emailSent: response.emailSent,
              replayed: response.replayed,
            },
          });
        }}
      />
    </AuthLayout>
  );
}
